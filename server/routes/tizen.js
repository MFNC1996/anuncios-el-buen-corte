const path = require('path');
const os = require('os');
const fs = require('fs');
const express = require('express');
const { broadcast } = require('../ws');
const { detectServerIp } = require('../network-info');
const { spawnSafe, execFileSafe, killTree } = require('../spawn-safe');
const jobLock = require('../job-lock');

const router = express.Router();
const INSTALL_ROOT = path.join(__dirname, '..', '..');
const TIZEN_APP_DIR = path.join(INSTALL_ROOT, 'tizen-app');
const BUILD_DIR = path.join(TIZEN_APP_DIR, '.build');
const SRC_DIR = path.join(BUILD_DIR, 'src');
const INSTALLER_EXE = path.join(INSTALL_ROOT, 'tizen-studio-installer.exe');

// Acá es donde nuestro propio instalador (el botón "Instalar herramientas
// de Tizen") siempre instala/repara el SDK — no cambia nunca, para que ese
// botón sepa siempre dónde actuar.
function defaultTizenHome() {
  return path.join(os.homedir(), 'tizen-studio');
}

function tizenBinPath(home) {
  return path.join(home, 'tools', 'ide', 'bin', process.platform === 'win32' ? 'tizen.bat' : 'tizen');
}

// Ubicaciones donde alguien pudo haber instalado el SDK a mano (con el
// instalador oficial de Samsung, no con nuestro botón) antes de usar este
// programa — ahí el "tizen" nunca se iba a encontrar porque solo
// mirábamos la carpeta por defecto.
function candidateTizenHomes() {
  const candidates = [defaultTizenHome(), 'C:\\tizen-studio'];
  if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, 'Tizen Studio'));
  if (process.env['ProgramFiles(x86)']) candidates.push(path.join(process.env['ProgramFiles(x86)'], 'Tizen Studio'));
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'tizen-studio'));
  return candidates;
}

let cachedTizenHome = null;

// Dónde usar de verdad tizen/sdb para CORRER comandos (chequeos, deploy,
// empaquetado) — a diferencia de defaultTizenHome(), esta sí busca en otras
// ubicaciones si no está en la de siempre, y recuerda el resultado para no
// repetir la búsqueda en cada chequeo. installSdk() sigue usando siempre
// defaultTizenHome() como destino, nunca esto — instalar/reparar el SDK
// adentro de una carpeta que resultó estar en otro lado sería sorpresivo.
function resolveTizenHome({ forceRescan = false } = {}) {
  if (cachedTizenHome && !forceRescan) return cachedTizenHome;
  const found = candidateTizenHomes().find((home) => fs.existsSync(tizenBinPath(home)));
  cachedTizenHome = found || defaultTizenHome();
  return cachedTizenHome;
}

function tizenEnv() {
  const home = resolveTizenHome();
  const toolsBin = path.join(home, 'tools', 'ide', 'bin');
  const tools = path.join(home, 'tools');
  return { ...process.env, PATH: `${toolsBin}${path.delimiter}${tools}${path.delimiter}${process.env.PATH}` };
}

function execFileOnce(cmd, env, timeoutMs) {
  return new Promise((resolve) => {
    execFileSafe(cmd, ['version'], { env, timeout: timeoutMs }, (err) => resolve(!err));
  });
}

// "tizen"/"sdb" son herramientas basadas en Java — tardan varios segundos
// en arrancar la primera vez, mucho más si el PC recién prendió y Windows
// todavía está ocupado levantando el resto de programas de inicio (justo
// el momento en que alguien llega al local, abre el panel y mira esta
// pestaña). Esta versión "paciente" es para el único lugar donde una
// respuesta falsa de "no está" realmente bloquea algo real: el chequeo
// previo de deploy() antes de intentar instalar de verdad, y el sondeo de
// que la instalación del SDK haya terminado.
async function commandExists(cmd, env) {
  if (await execFileOnce(cmd, env, 25000)) return true;
  await sleep(3000);
  return execFileOnce(cmd, env, 25000);
}

// Versión rápida, de un solo intento, para /check: ese endpoint es puramente
// informativo (el botón de instalar ya no se deshabilita por su resultado,
// deploy() tiene su propio chequeo paciente antes de proceder de verdad), así
// que no vale la pena que el panel (ni nada que lo consulte, CI incluido) se
// quede esperando hasta 53s solo para pintar dos puntitos de estado.
function commandExistsQuick(cmd, env) {
  return execFileOnce(cmd, env, 6000);
}

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
// El chequeo preventivo de tizen/sdb al principio de deploy() puede tardar
// hasta ~53s por sí solo si el PC recién prendió (ver commandExists) — con
// el límite viejo de 2 minutos, eso dejaba muy poco margen para empaquetar,
// conectar e instalar de verdad, y un deploy que iba a funcionar terminaba
// cortado por el timeout general antes de completarse.
const DEPLOY_TIMEOUT_MS = 4 * 60 * 1000;
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
  const [tizenOk, sdbOk] = await Promise.all([commandExistsQuick('tizen', env), commandExistsQuick('sdb', env)]);
  res.json({
    ready: tizenOk && sdbOk,
    tizenOk,
    sdbOk,
    foundAt: resolveTizenHome(),
    canAutoInstallSdk: process.platform === 'win32' && fs.existsSync(INSTALLER_EXE),
    serverIp: detectServerIp(),
    busy: jobLock.isBusy(),
    busyWith: jobLock.currentLabel(),
  });
});

// Botón "Buscar instalación existente": por si alguien ya tenía el SDK de
// Tizen instalado a mano (con el instalador oficial de Samsung, en vez de
// con el botón de este panel) antes de usar este programa, en una carpeta
// que no es la de siempre — sin esto, nunca se iba a encontrar.
router.post('/find', async (req, res) => {
  const home = resolveTizenHome({ forceRescan: true });
  const env = tizenEnv();
  const [tizenOk, sdbOk] = await Promise.all([commandExistsQuick('tizen', env), commandExistsQuick('sdb', env)]);
  res.json({ ready: tizenOk && sdbOk, tizenOk, sdbOk, foundAt: home });
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

  // Sin este chequeo, si "tizen"/"sdb" de verdad no están instalados, lo
  // único que se veía más abajo era "No se encontró la TV conectada" — un
  // error que suena a problema de red/TV cuando en realidad el problema es
  // que las herramientas no están en este PC. Mejor decirlo directo.
  const [tizenOk, sdbOk] = await Promise.all([commandExists('tizen', env), commandExists('sdb', env)]);
  if (!tizenOk || !sdbOk) {
    throw new Error(
      'Las herramientas de Tizen no respondieron en este PC. Si recién lo prendiste, espera un minuto y reintenta — ' +
        'si sigue igual, puede que haga falta instalar el SDK de nuevo desde el botón de arriba.'
    );
  }

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

  // Un simple "sdb connect" de nuevo no sirve acá: en la práctica la TV
  // seguía conectada todo el rato (confirmado — "already connected" antes
  // Y después) y "tizen install" igual decía que no existía el target. Eso
  // apunta a que el SERVIDOR de sdb (el proceso de fondo que sdb y tizen
  // consultan) quedó en un estado raro, no a que la conexión se cayera.
  // "kill-server" lo apaga para que el siguiente comando lo levante limpio
  // — mismo remedio que "adb kill-server" para el mismo síntoma en Android.
  logLine('tizen:log', '==> "tizen install" no reconoce la TV aunque sigue conectada — reiniciando el servidor de sdb...');
  await runStep('sdb', ['kill-server'], env, { ignoreError: true, cancelToken });
  await sleep(1500);
  await runStep('sdb', ['connect', tvIp], env, { ignoreError: true, cancelToken });
  await runStep('sdb', ['connect', `${tvIp}:26101`], env, { ignoreError: true, cancelToken });
  await sleep(1500);

  const { output: devicesOutput } = await runStep('sdb', ['devices'], env, { ignoreError: true, cancelToken });
  logLine('tizen:log', `==> Estado de sdb después de reiniciar el servidor:\n${devicesOutput.trim() || '(sin salida)'}`);

  try {
    await runStep('tizen', ['install', '-n', wgtPath, '-t', deviceId], env, { cancelToken });
  } catch (err) {
    // Si el segundo intento falló por un motivo DISTINTO (ej. el deploy se
    // canceló por el timeout general mientras este reintento estaba en
    // curso, o un error real de tizen como un certificado vencido), hay
    // que mostrar ESE error — culpar siempre a la TV/PC con un mensaje fijo
    // tapaba la causa real y mandaba a reiniciar hardware que nunca fue el
    // problema.
    if (!/there is no .*target/i.test(err.output || err.message || '')) throw err;
    throw new Error(
      '"tizen install" sigue sin reconocer la TV aunque sdb la ve conectada (revisa el registro de arriba). ' +
        'No es un problema de red — probablemente haga falta reiniciar la TV y el PC, o instalar esta versión ' +
        'directamente desde Tizen Studio (IDE) en vez del botón del panel.'
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
    // killTree en vez de .kill(): en Windows (shell:true) el child de
    // spawnSafe es el cmd.exe envoltorio, no el java.exe real de
    // tizen/sdb — matar solo el envoltorio dejaba el proceso real
    // corriendo de fondo con BUILD_DIR abierto, y un reintento inmediato
    // fallaba con un EBUSY/EPERM sin relación aparente con la TV.
    if (cancelToken.activeChild) killTree(cancelToken.activeChild);
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

  const home = defaultTizenHome();
  const env = tizenEnv();
  const tizenBin = tizenBinPath(home);

  // Si alguien aprieta este botón "para estar seguro" aunque el SDK ya haya
  // quedado bien instalado antes (algo totalmente esperable — el panel no
  // explica cuándo es seguro no tocarlo), correr el instalador de nuevo no
  // sirve: el instalador de Samsung rechaza instalar sobre una carpeta que
  // ya existe ("Invalid the destination directory") y además el certificado
  // de firma ya estaría creado. Antes esto se disfrazaba de instalación
  // exitosa (porque tizen/sdb ya respondían de antes) y después tronaba en
  // el paso del certificado con "Already exist the specified filename",
  // reportando como error algo que en realidad no estaba roto.
  const [tizenAlreadyOk, sdbAlreadyOk] = await Promise.all([commandExists('tizen', env), commandExists('sdb', env)]);
  if (fs.existsSync(tizenBin) && tizenAlreadyOk && sdbAlreadyOk) {
    logLine('tizensdk:log', '==> El SDK de Tizen ya estaba instalado y funcionando — reviso el certificado de firma.');
  } else {
    // Una carpeta a medio instalar de un intento anterior (instalador
    // cortado, PC apagado a mitad de proceso) hace que el instalador la
    // rechace igual que si fuera una instalación completa, sin explicar por
    // qué — hay que limpiarla antes para que pueda crear una instalación
    // nueva y completa ahí.
    if (fs.existsSync(home)) {
      logLine('tizensdk:log', '==> Encontré una instalación anterior incompleta — la limpio antes de instalar de nuevo...');
      fs.rmSync(home, { recursive: true, force: true });
    }

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

    if (!fs.existsSync(tizenBin)) {
      throw new Error('El instalador terminó pero no se encontró tizen.bat — revisa el registro de arriba.');
    }
    // El disco acaba de cambiar de verdad (se instaló/reparó el SDK) — que el
    // próximo chequeo vuelva a buscar en vez de confiar en un resultado
    // cacheado de antes de esta instalación.
    cachedTizenHome = null;

    logLine('tizensdk:log', '==> tizen/sdb ya responden — creando el certificado de firma de la app...');
  }

  await ensureCertificateAndProfile(home, env, cancelToken);

  logLine('tizensdk:log', '==> Listo. Ya puedes usar "Instalar en la TV" de abajo.');
}

// El certificado y el perfil de seguridad fallan con "ya existe" si se
// corren una segunda vez sobre una instalación que ya los tenía — eso no es
// un error real (es justo lo que se espera si el SDK ya estaba configurado
// de antes), así que no debe tumbar la instalación entera.
//
// Antes había un tercer paso acá, "tizen cli-config profiles.path=...", para
// apuntar el perfil "global" de Tizen Studio a este mismo profiles.xml. Se
// quitó: en Windows ese comando SIEMPRE fallaba (tizen.bat lo rechaza con
// "configuration must be specified in the form:<key>=<value>" por más que se
// probara encomillarlo de varias formas — un problema conocido de Tizen
// Studio en Windows, no de cómo arma el comando esta app), y además era
// puro adorno: "security-profiles add" ya deja el perfil "ebcorte" en la
// ubicación por defecto que Tizen usa de todas formas, y nuestro propio
// empaquetado (deploy() más abajo) siempre pasa "-s ebcorte" explícito al
// firmar, así que nunca dependió de ese default global. Confirmado con un
// empaquetado real de prueba en Windows sin este paso.
async function ensureCertificateAndProfile(home, env, cancelToken) {
  const steps = [
    ['certificado', ['certificate', '-a', 'El Buen Corte', '-p', '0000', '-f', 'ebcorte', '-c', 'CL']],
    [
      'perfil de seguridad',
      [
        'security-profiles',
        'add',
        '-n',
        'ebcorte',
        '-a',
        path.join(`${home}-data`, 'keystore', 'author', 'ebcorte.p12'),
        '-p',
        '0000',
      ],
    ],
  ];
  for (const [name, args] of steps) {
    try {
      await runStep('tizen', args, env, { logEvent: 'tizensdk:log', cancelToken });
    } catch (err) {
      if (/already exist/i.test(err.output || '')) {
        logLine('tizensdk:log', `==> (${name}: ya estaba configurado de antes, se deja igual)`);
        continue;
      }
      throw err;
    }
  }
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
