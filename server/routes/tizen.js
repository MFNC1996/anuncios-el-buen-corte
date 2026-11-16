const path = require('path');
const os = require('os');
const fs = require('fs');
const express = require('express');
const { broadcast } = require('../ws');
const { detectServerIp } = require('../network-info');
const { spawnSafe, execFileSafe } = require('../spawn-safe');
const jobLock = require('../job-lock');

const router = express.Router();
const INSTALL_ROOT = path.join(__dirname, '..', '..');
const TIZEN_APP_DIR = path.join(INSTALL_ROOT, 'tizen-app');
const BUILD_DIR = path.join(TIZEN_APP_DIR, '.build');
const SRC_DIR = path.join(BUILD_DIR, 'src');
const INSTALLER_EXE = path.join(INSTALL_ROOT, 'tizen-studio-installer.exe');

function tizenHome() {
  return path.join(os.homedir(), 'tizen-studio');
}

function tizenEnv() {
  const toolsBin = path.join(tizenHome(), 'tools', 'ide', 'bin');
  const tools = path.join(tizenHome(), 'tools');
  return { ...process.env, PATH: `${toolsBin}${path.delimiter}${tools}${path.delimiter}${process.env.PATH}` };
}

function commandExists(cmd, env) {
  return new Promise((resolve) => {
    execFileSafe(cmd, ['version'], { env, timeout: 10000 }, (err) => resolve(!err));
  });
}

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const DEPLOY_TIMEOUT_MS = 2 * 60 * 1000;
const SDK_INSTALL_TIMEOUT_MS = 40 * 60 * 1000;
const DEPLOY_LABEL = 'tizen-deploy';
const SDK_LABEL = 'tizen-install-sdk';

const TIZEN_LOG_PATH = path.join(INSTALL_ROOT, 'server', 'data', 'tizen.log');

// Deja cada paso en server/data/tizen.log además de mandarlo por WebSocket
// (igual patrón que update.js) — si nadie tenía el panel abierto durante una
// instalación larga (el SDK de Tizen puede tardar 20+ minutos bajando
// paquetes), esto es la única forma de ver después qué pasó.
function logLine(event, line) {
  broadcast(event, { line });
  try {
    fs.mkdirSync(path.dirname(TIZEN_LOG_PATH), { recursive: true });
    fs.appendFileSync(TIZEN_LOG_PATH, `[${new Date().toISOString()}] ${line}\n`);
  } catch (err) {
    // no hay mucho que hacer si ni el log se puede escribir
  }
}

router.get('/check', async (req, res) => {
  const env = tizenEnv();
  const [tizenOk, sdbOk] = await Promise.all([commandExists('tizen', env), commandExists('sdb', env)]);
  res.json({
    ready: tizenOk && sdbOk,
    tizenOk,
    sdbOk,
    canAutoInstallSdk: process.platform === 'win32' && fs.existsSync(INSTALLER_EXE),
    serverIp: detectServerIp(),
    busy: jobLock.isBusy(),
    busyWith: jobLock.currentLabel(),
  });
});

// Corre un comando externo y manda cada línea de su salida por WebSocket a
// medida que llega. `cancelToken` se revisa antes de arrancar el paso: si ya
// se canceló (por el timeout de más abajo), se corta ahí en vez de lanzar un
// comando más sobre un trabajo que el panel ya dio por terminado.
function runStep(cmd, args, env, { ignoreError = false, logEvent = 'tizen:log', cancelToken } = {}) {
  if (cancelToken?.cancelled) return Promise.reject(new Error('Cancelado por tiempo de espera agotado.'));

  return new Promise((resolve, reject) => {
    const child = spawnSafe(cmd, args, { env });
    if (cancelToken) cancelToken.activeChild = child;

    const forward = (data) => {
      data
        .toString()
        .split('\n')
        .filter((line) => line.trim())
        .forEach((line) => logLine(logEvent, line));
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);

    let output = '';
    child.stdout.on('data', (d) => (output += d.toString()));
    child.stderr.on('data', (d) => (output += d.toString()));

    child.on('error', (err) => {
      if (ignoreError) return resolve({ code: -1, output });
      reject(err);
    });
    child.on('close', (code) => {
      if (cancelToken?.cancelled) {
        reject(new Error('Cancelado por tiempo de espera agotado.'));
        return;
      }
      if (code !== 0 && !ignoreError) {
        // Se adjunta la salida real del comando al error (no solo el código)
        // para que quien llama pueda distinguir un fallo transitorio de sdb
        // (ver installWgt más abajo) de uno real, sin tener que repetir el
        // comando solo para ver qué dijo.
        const err = new Error(`"${cmd} ${args.join(' ')}" terminó con código ${code}`);
        err.output = output;
        reject(err);
        return;
      }
      resolve({ code, output });
    });
  });
}

async function deploy(tvIp, serverIp, screenId, cancelToken) {
  const env = tizenEnv();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(SRC_DIR, { recursive: true });
  fs.copyFileSync(path.join(TIZEN_APP_DIR, 'config.xml'), path.join(SRC_DIR, 'config.xml'));
  fs.copyFileSync(path.join(TIZEN_APP_DIR, 'icon.png'), path.join(SRC_DIR, 'icon.png'));

  logLine('tizen:log', `==> Apuntando la app a http://${serverIp}:4010/player/${screenId}`);
  const indexHtml = fs.readFileSync(path.join(TIZEN_APP_DIR, 'index.html'), 'utf8');
  const patchedHtml = indexHtml.replace(
    /var PLAYER_URL = '[^']*'/,
    `var PLAYER_URL = 'http://${serverIp}:4010/player/${screenId}'`
  );
  fs.writeFileSync(path.join(SRC_DIR, 'index.html'), patchedHtml);

  logLine('tizen:log', `==> Conectando a la TV (${tvIp})...`);
  await runStep('sdb', ['connect', tvIp], env, { ignoreError: true, cancelToken });
  await runStep('sdb', ['connect', `${tvIp}:26101`], env, { ignoreError: true, cancelToken });

  const { output: devicesOutput } = await runStep('sdb', ['devices'], env, { ignoreError: true, cancelToken });
  const deviceId = devicesOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.toLowerCase().startsWith('list of devices'))
    .map((line) => line.split(/\s+/)[0])
    .find(Boolean);

  if (!deviceId) {
    throw new Error('No se encontró la TV conectada. Revisa que Modo Desarrollador esté activo y la IP sea correcta.');
  }
  logLine('tizen:log', `==> TV detectada: ${deviceId}`);

  logLine('tizen:log', '==> Empaquetando la app (.wgt)...');
  await runStep('tizen', ['package', '-t', 'wgt', '-s', 'ebcorte', '-o', BUILD_DIR, '--', SRC_DIR], env, { cancelToken });

  const wgtFile = fs.readdirSync(BUILD_DIR).find((f) => f.endsWith('.wgt'));
  if (!wgtFile) throw new Error('No se generó el archivo .wgt esperado.');
  const wgtPath = path.join(BUILD_DIR, wgtFile);

  logLine('tizen:log', `==> Instalando ${wgtFile} en la TV...`);
  await installWgt(wgtPath, deviceId, tvIp, env, cancelToken);

  logLine('tizen:log', "==> Listo. Busca 'Cartelera El Buen Corte' en el menú Apps de la TV y ábrela.");
}

// "tizen install -t <ip>:26101" a veces falla con "There is no <ip>:26101
// target" aunque "sdb devices" lo haya mostrado conectado segundos antes
// (pasó en una TV real: entre conectar y terminar de empaquetar el .wgt, la
// TV soltó la conexión de depuración). Es un problema conocido de Tizen
// Studio, no de esta app — la solución que funciona es reconectar y
// reintentar una vez, no cambiar nada de cómo se arma el paquete.
async function installWgt(wgtPath, deviceId, tvIp, env, cancelToken) {
  try {
    await runStep('tizen', ['install', '-n', wgtPath, '-t', deviceId], env, { cancelToken });
    return;
  } catch (err) {
    if (!/there is no .*target/i.test(err.output || err.message || '')) throw err;
  }

  logLine('tizen:log', '==> La TV se desconectó justo antes de instalar — reconectando y reintentando...');
  await runStep('sdb', ['connect', tvIp], env, { ignoreError: true, cancelToken });
  await runStep('sdb', ['connect', `${tvIp}:26101`], env, { ignoreError: true, cancelToken });
  await sleep(2000);
  try {
    await runStep('tizen', ['install', '-n', wgtPath, '-t', deviceId], env, { cancelToken });
  } catch (err) {
    throw new Error(
      'La TV se desconectó justo antes de instalar (puede pasar si la pantalla entró en reposo). ' +
        'Revisa que la TV esté encendida y con la pantalla prendida, y vuelve a intentar.'
    );
  }
}

// Corre `fn` bajo el candado global (jobLock), con un timeout que cancela
// de verdad: marca cancelToken.cancelled para que runStep() no siga
// lanzando pasos nuevos ni reporte éxito de uno que ya se dio por vencido,
// en vez de solo matar el proceso hijo que esté activo en ese instante
// (que podía ya estar cerrado, dejando el job "cancelado" corriendo igual).
function runTrackedJob({ label, timeoutMs, doneEvent, logEvent, fn }) {
  if (!jobLock.tryAcquire(label)) return false;

  const cancelToken = { cancelled: false, activeChild: null };
  let settled = false;

  const timeoutId = setTimeout(() => {
    cancelToken.cancelled = true;
    if (cancelToken.activeChild?.kill) cancelToken.activeChild.kill();
    finish(false, `Cancelado — tardó más de ${timeoutMs / 1000}s.`);
  }, timeoutMs);

  function finish(success, errorLine) {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    if (errorLine) logLine(logEvent, errorLine);
    broadcast(doneEvent, { success, error: errorLine || null });
    jobLock.release(label);
  }

  fn(cancelToken)
    .then(() => finish(true))
    .catch((err) => finish(false, `Error: ${err.message}`));

  return true;
}

router.post('/deploy', (req, res) => {
  const { tvIp, serverIp } = req.body;
  const screenId = req.body.screenId || 1; // 1 = la única pantalla que existía antes de haber perfiles
  if (!tvIp || !serverIp) return res.status(400).json({ error: 'Falta la IP de la TV o del servidor' });
  if (!IPV4_RE.test(tvIp) || !IPV4_RE.test(serverIp)) {
    return res.status(400).json({ error: 'La IP de la TV y del servidor deben ser direcciones IPv4 válidas' });
  }

  logLine('tizen:log', `Instalando en ${tvIp} (servidor ${serverIp})...`);
  const started = runTrackedJob({
    label: DEPLOY_LABEL,
    timeoutMs: DEPLOY_TIMEOUT_MS,
    doneEvent: 'tizen:done',
    logEvent: 'tizen:log',
    fn: (cancelToken) => deploy(tvIp, serverIp, screenId, cancelToken),
  });

  if (!started) return res.status(409).json({ error: `Ya hay una operación en curso (${jobLock.currentLabel()})` });
  res.status(202).json({ started: true });
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Corre en paralelo contra el proceso del instalador: gana lo que pase
// primero, que el proceso cierre solo o que "tizen"/"sdb" ya respondan.
async function waitForToolsOrExit(child, env, cancelToken) {
  let exited = false;
  let exitError = null;
  child.on('close', (code) => {
    exited = true;
    if (code !== 0) exitError = new Error(`El instalador del SDK terminó con código ${code}`);
  });
  child.on('error', (err) => {
    exited = true;
    exitError = err;
  });

  while (!exited) {
    if (cancelToken?.cancelled) throw new Error('Cancelado por tiempo de espera agotado.');
    await sleep(4000);
    const [tizenOk, sdbOk] = await Promise.all([commandExists('tizen', env), commandExists('sdb', env)]);
    if (tizenOk && sdbOk) return;
  }
  if (exitError) throw exitError;

  // El proceso cerró solo justo antes de que lográramos detectar las
  // herramientas listas en la última vuelta — se revisa una vez más.
  const [tizenOk, sdbOk] = await Promise.all([commandExists('tizen', env), commandExists('sdb', env)]);
  if (!tizenOk || !sdbOk) throw new Error('El instalador terminó pero tizen/sdb no quedaron utilizables.');
}

// Instala el SDK de Tizen usando el instalador que ya viene adentro del
// programa (tizen-studio-installer.exe) — nada que descargar ni buscar a
// mano, todo desde el botón del panel.
async function installSdk(cancelToken) {
  if (process.platform !== 'win32') {
    throw new Error('La instalación automática del SDK solo está disponible en Windows.');
  }
  if (!fs.existsSync(INSTALLER_EXE)) {
    throw new Error('No se encontró el instalador del SDK junto al programa. Reinstala con la versión más reciente.');
  }

  const home = tizenHome();
  const env = tizenEnv();
  logLine('tizensdk:log', '==> Instalando el SDK de Tizen (necesita internet, puede tardar varios minutos)...');

  // El instalador de Tizen Studio sigue corriendo (bajando paquetes extra,
  // limpieza interna) mucho después de que "tizen"/"sdb" ya quedaron
  // instalados y utilizables en disco — en un runner de CI real esto tardó
  // 40+ minutos de puro silencio después de que las herramientas ya
  // funcionaban. En vez de esperar a que el proceso cierre solo, se corre
  // sin esperarlo y en paralelo se revisa cada pocos segundos si "tizen" y
  // "sdb" ya responden: lo que pase primero (vía waitForToolsOrExit).
  const installerChild = spawnSafe(INSTALLER_EXE, ['--accept-license', '--no-java-check', home], {});
  if (cancelToken) cancelToken.activeChild = installerChild;
  const forwardInstallerLine = (data) =>
    data
      .toString()
      .split('\n')
      .filter((l) => l.trim())
      .forEach((l) => logLine('tizensdk:log', l));
  installerChild.stdout?.on('data', forwardInstallerLine);
  installerChild.stderr?.on('data', forwardInstallerLine);

  await waitForToolsOrExit(installerChild, env, cancelToken);

  const tizenBin = path.join(home, 'tools', 'ide', 'bin', 'tizen.bat');
  if (!fs.existsSync(tizenBin)) {
    throw new Error('El instalador terminó pero no se encontró tizen.bat — revisa el registro de arriba.');
  }

  logLine('tizensdk:log', '==> tizen/sdb ya responden — creando el certificado de firma de la app...');
  await runStep('tizen', ['certificate', '-a', 'El Buen Corte', '-p', '0000', '-f', 'ebcorte', '-c', 'CL'], env, {
    logEvent: 'tizensdk:log',
    cancelToken,
  });
  await runStep(
    'tizen',
    ['security-profiles', 'add', '-n', 'ebcorte', '-a', path.join(`${home}-data`, 'keystore', 'author', 'ebcorte.p12'), '-p', '0000'],
    env,
    { logEvent: 'tizensdk:log', cancelToken }
  );
  await runStep('tizen', ['cli-config', `profiles.path=${path.join(`${home}-data`, 'profile', 'profiles.xml')}`], env, {
    logEvent: 'tizensdk:log',
    cancelToken,
  });

  logLine('tizensdk:log', '==> Listo. Ya puedes usar "Instalar en la TV" de abajo.');
}

router.post('/install-sdk', (req, res) => {
  const started = runTrackedJob({
    label: SDK_LABEL,
    timeoutMs: SDK_INSTALL_TIMEOUT_MS,
    doneEvent: 'tizensdk:done',
    logEvent: 'tizensdk:log',
    fn: installSdk,
  });

  if (!started) return res.status(409).json({ error: `Ya hay una operación en curso (${jobLock.currentLabel()})` });
  res.status(202).json({ started: true });
});

module.exports = router;
