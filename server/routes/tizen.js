const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const express = require('express');
const { broadcast } = require('../ws');
const { detectServerIp } = require('../network-info');

const router = express.Router();
const TIZEN_APP_DIR = path.join(__dirname, '..', '..', 'tizen-app');
const BUILD_DIR = path.join(TIZEN_APP_DIR, '.build');
const SRC_DIR = path.join(BUILD_DIR, 'src');

// PATH de las herramientas de Tizen Studio (tizen/sdb), igual en Windows,
// Mac o Linux: siempre viven en ~/tizen-studio dentro del home del usuario
// que corre el servidor. path.delimiter/path.join resuelven el separador
// (';' en Windows, ':' en Mac/Linux) y las barras correctas de cada OS solos.
function tizenEnv() {
  const home = os.homedir();
  const toolsBin = path.join(home, 'tizen-studio', 'tools', 'ide', 'bin');
  const tools = path.join(home, 'tizen-studio', 'tools');
  return { ...process.env, PATH: `${toolsBin}${path.delimiter}${tools}${path.delimiter}${process.env.PATH}` };
}

function commandExists(cmd, env) {
  return new Promise((resolve) => {
    execFile(cmd, ['version'], { env, timeout: 10000 }, (err) => resolve(!err));
  });
}

let activeJob = null;
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const DEPLOY_TIMEOUT_MS = 2 * 60 * 1000;

router.get('/check', async (req, res) => {
  const env = tizenEnv();
  const [tizenOk, sdbOk] = await Promise.all([commandExists('tizen', env), commandExists('sdb', env)]);
  res.json({ ready: tizenOk && sdbOk, tizenOk, sdbOk, serverIp: detectServerIp(), busy: !!activeJob });
});

// Corre un comando externo (tizen/sdb) y manda cada línea de su salida por
// WebSocket a medida que llega, en vez de esperar a que termine todo.
function runStep(cmd, args, env, { ignoreError = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env });
    activeJob = child;

    const forward = (data) => {
      data
        .toString()
        .split('\n')
        .filter((line) => line.trim())
        .forEach((line) => broadcast('tizen:log', { line }));
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);

    let output = '';
    child.stdout.on('data', (d) => (output += d.toString()));

    child.on('error', (err) => {
      if (ignoreError) return resolve({ code: -1, output });
      reject(err);
    });
    child.on('close', (code) => {
      if (code !== 0 && !ignoreError) {
        reject(new Error(`"${cmd} ${args.join(' ')}" terminó con código ${code}`));
        return;
      }
      resolve({ code, output });
    });
  });
}

async function deploy(tvIp, serverIp) {
  const env = tizenEnv();

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.mkdirSync(SRC_DIR, { recursive: true });
  fs.copyFileSync(path.join(TIZEN_APP_DIR, 'config.xml'), path.join(SRC_DIR, 'config.xml'));
  fs.copyFileSync(path.join(TIZEN_APP_DIR, 'icon.png'), path.join(SRC_DIR, 'icon.png'));

  broadcast('tizen:log', { line: `==> Apuntando la app a http://${serverIp}:4010/player/1` });
  const indexHtml = fs.readFileSync(path.join(TIZEN_APP_DIR, 'index.html'), 'utf8');
  const patchedHtml = indexHtml.replace(
    /var PLAYER_URL = '[^']*'/,
    `var PLAYER_URL = 'http://${serverIp}:4010/player/1'`
  );
  fs.writeFileSync(path.join(SRC_DIR, 'index.html'), patchedHtml);

  broadcast('tizen:log', { line: `==> Conectando a la TV (${tvIp})...` });
  await runStep('sdb', ['connect', tvIp], env, { ignoreError: true });
  await runStep('sdb', ['connect', `${tvIp}:26101`], env, { ignoreError: true });

  const { output: devicesOutput } = await runStep('sdb', ['devices'], env, { ignoreError: true });
  const deviceId = devicesOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.toLowerCase().startsWith('list of devices'))
    .map((line) => line.split(/\s+/)[0])
    .find(Boolean);

  if (!deviceId) {
    throw new Error('No se encontró la TV conectada. Revisa que Modo Desarrollador esté activo y la IP sea correcta.');
  }
  broadcast('tizen:log', { line: `==> TV detectada: ${deviceId}` });

  broadcast('tizen:log', { line: '==> Empaquetando la app (.wgt)...' });
  await runStep('tizen', ['package', '-t', 'wgt', '-s', 'ebcorte', '-o', BUILD_DIR, '--', SRC_DIR], env);

  const wgtFile = fs.readdirSync(BUILD_DIR).find((f) => f.endsWith('.wgt'));
  if (!wgtFile) throw new Error('No se generó el archivo .wgt esperado.');
  const wgtPath = path.join(BUILD_DIR, wgtFile);

  broadcast('tizen:log', { line: `==> Instalando ${wgtFile} en la TV...` });
  await runStep('tizen', ['install', '-n', wgtPath, '-t', deviceId], env);

  broadcast('tizen:log', { line: "==> Listo. Busca 'Cartelera El Buen Corte' en el menú Apps de la TV y ábrela." });
}

router.post('/deploy', (req, res) => {
  const { tvIp, serverIp } = req.body;
  if (!tvIp || !serverIp) return res.status(400).json({ error: 'Falta la IP de la TV o del servidor' });
  if (!IPV4_RE.test(tvIp) || !IPV4_RE.test(serverIp)) {
    return res.status(400).json({ error: 'La IP de la TV y del servidor deben ser direcciones IPv4 válidas' });
  }
  if (activeJob) return res.status(409).json({ error: 'Ya hay una instalación en curso' });

  activeJob = true; // marcador hasta que el primer paso real lo reemplace
  broadcast('tizen:log', { line: `Instalando en ${tvIp} (servidor ${serverIp})...` });

  const timeoutId = setTimeout(() => {
    if (activeJob && activeJob.kill) activeJob.kill();
    broadcast('tizen:log', { line: `Instalación cancelada — tardó más de ${DEPLOY_TIMEOUT_MS / 1000}s.` });
    broadcast('tizen:done', { success: false, code: -1 });
    activeJob = null;
  }, DEPLOY_TIMEOUT_MS);

  deploy(tvIp, serverIp)
    .then(() => {
      clearTimeout(timeoutId);
      broadcast('tizen:done', { success: true, code: 0 });
      activeJob = null;
    })
    .catch((err) => {
      clearTimeout(timeoutId);
      broadcast('tizen:log', { line: `Error: ${err.message}` });
      broadcast('tizen:done', { success: false, code: -1 });
      activeJob = null;
    });

  res.status(202).json({ started: true });
});

module.exports = router;
