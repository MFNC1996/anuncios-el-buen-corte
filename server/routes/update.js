const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const express = require('express');
const AdmZip = require('adm-zip');
const { broadcast } = require('../ws');
const { spawnSafe } = require('../spawn-safe');
const jobLock = require('../job-lock');

const router = express.Router();

// Carpeta de instalación real: server/routes/update.js -> server/routes -> server -> raíz.
const INSTALL_ROOT = path.join(__dirname, '..', '..');
const REPO = require('../../package.json').repository || 'MFNC1996/anuncios-el-buen-corte';

// Nunca se tocan al actualizar: ahí viven los precios/fotos del local.
const PRESERVE_PATHS = ['server/data', 'server/uploads'];

const UPDATE_LABEL = 'update-apply';
const NPM_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

function currentVersion() {
  return require('../../package.json').version;
}

const UPDATE_LOG_PATH = path.join(INSTALL_ROOT, 'server', 'data', 'update.log');

// Deja cada paso en server/data/update.log ademas de mandarlo por WebSocket,
// para poder ver que paso incluso si nadie tenia el panel abierto en el
// momento, o si el proceso murio antes de reiniciar.
function logLine(line) {
  broadcast('update:log', { line });
  try {
    fs.mkdirSync(path.dirname(UPDATE_LOG_PATH), { recursive: true });
    fs.appendFileSync(UPDATE_LOG_PATH, `[${new Date().toISOString()}] ${line}\n`);
  } catch (err) {
    // no hay mucho que hacer si ni el log se puede escribir
  }
}

// Compara "1.2.0" vs "1.10.0" numéricamente (no alfabéticamente), para que
// 1.10.0 cuente como más nueva que 1.2.0.
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function fetchLatestRelease() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'User-Agent': 'CarteleraElBuenCorte-Updater', Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub respondió ${res.status} al buscar la última versión`);
  const data = await res.json();
  const latestVersion = String(data.tag_name || '').replace(/^v/, '');
  const asset = (data.assets || []).find((a) => a.name === 'update.zip');
  return { latestVersion, notes: data.body || '', asset };
}

router.get('/check', async (req, res) => {
  try {
    const { latestVersion, notes, asset } = await fetchLatestRelease();
    res.json({
      currentVersion: currentVersion(),
      latestVersion,
      updateAvailable: Boolean(asset) && compareVersions(latestVersion, currentVersion()) > 0,
      notes,
      busy: jobLock.isBusy(),
      busyWith: jobLock.currentLabel(),
    });
  } catch (err) {
    res.status(502).json({ error: err.message, currentVersion: currentVersion() });
  }
});

function npmExecutable() {
  const nodeDir = path.dirname(process.execPath);
  return path.join(nodeDir, process.platform === 'win32' ? 'npm.cmd' : 'npm');
}

function runStep(cmd, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawnSafe(cmd, args, options);

    const timeoutId = setTimeout(() => {
      child.kill();
      reject(new Error(`"${cmd} ${args.join(' ')}" tardó más de ${NPM_INSTALL_TIMEOUT_MS / 1000}s y se canceló`));
    }, NPM_INSTALL_TIMEOUT_MS);

    child.stdout?.on('data', (d) =>
      d
        .toString()
        .split('\n')
        .filter((l) => l.trim())
        .forEach((line) => logLine(line))
    );
    child.stderr?.on('data', (d) =>
      d
        .toString()
        .split('\n')
        .filter((l) => l.trim())
        .forEach((line) => logLine(line))
    );
    child.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timeoutId);
      if (code !== 0) return reject(new Error(`"${cmd} ${args.join(' ')}" terminó con código ${code}`));
      resolve();
    });
  });
}

// Copia extractDir sobre INSTALL_ROOT, sin tocar nunca PRESERVE_PATHS.
function copyUpdateFiles(extractDir) {
  const preserveAbs = PRESERVE_PATHS.map((p) => path.join(INSTALL_ROOT, p));

  function walk(src, relBase) {
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const rel = relBase ? path.join(relBase, entry.name) : entry.name;
      const destPath = path.join(INSTALL_ROOT, rel);

      if (preserveAbs.some((p) => destPath === p || destPath.startsWith(p + path.sep))) continue;

      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        walk(srcPath, rel);
      } else {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  walk(extractDir, '');
}

async function applyUpdate() {
  const { latestVersion, asset } = await fetchLatestRelease();
  if (!asset) throw new Error('La última versión no tiene un paquete de actualización (update.zip).');

  const tmpZip = path.join(os.tmpdir(), 'ebcorte-update.zip');
  const tmpExtract = path.join(os.tmpdir(), 'ebcorte-update-extract');

  logLine(`==> Descargando versión ${latestVersion}...`);
  const assetRes = await fetch(asset.browser_download_url);
  if (!assetRes.ok) throw new Error(`No se pudo descargar la actualización (HTTP ${assetRes.status})`);
  const buf = Buffer.from(await assetRes.arrayBuffer());
  fs.writeFileSync(tmpZip, buf);

  logLine('==> Descomprimiendo...');
  fs.rmSync(tmpExtract, { recursive: true, force: true });
  fs.mkdirSync(tmpExtract, { recursive: true });
  new AdmZip(tmpZip).extractAllTo(tmpExtract, true);

  logLine('==> Copiando archivos nuevos (sin tocar precios ni fotos guardadas)...');
  copyUpdateFiles(tmpExtract);

  fs.rmSync(tmpZip, { force: true });
  fs.rmSync(tmpExtract, { recursive: true, force: true });

  logLine('==> Instalando dependencias...');
  // Node portatil no esta en el PATH de Windows: sin esto, paquetes como
  // better-sqlite3 fallan al compilar porque no encuentran "node" al
  // invocarlo ellos mismos durante su propia instalacion.
  const nodeDir = path.dirname(process.execPath);
  await runStep(npmExecutable(), ['install', '--omit=dev', '--no-fund', '--no-audit'], {
    cwd: INSTALL_ROOT,
    env: { ...process.env, PATH: `${nodeDir}${path.delimiter}${process.env.PATH}` },
  });

  logLine('==> Reiniciando el servidor...');
  const entryPoint = require.main ? require.main.filename : path.join(INSTALL_ROOT, 'server', 'index.js');
  const dataDir = path.join(INSTALL_ROOT, 'server', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const logFd = fs.openSync(path.join(dataDir, 'update.log'), 'a');
  const child = spawn(process.execPath, [entryPoint], {
    cwd: INSTALL_ROOT,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });
  child.unref();
  setTimeout(() => process.exit(0), 500);
}

router.post('/apply', (req, res) => {
  if (!jobLock.tryAcquire(UPDATE_LABEL)) {
    return res.status(409).json({ error: `Ya hay una operación en curso (${jobLock.currentLabel()})` });
  }
  res.status(202).json({ started: true });

  applyUpdate()
    .then(() => {
      // No se libera el candado en el camino feliz: applyUpdate() termina
      // matando este mismo proceso (process.exit) para reiniciar con el
      // codigo nuevo, asi que no hay "despues" en el que liberarlo importe.
      broadcast('update:done', { success: true });
    })
    .catch((err) => {
      jobLock.release(UPDATE_LABEL);
      logLine(`Error: ${err.message}`);
      broadcast('update:done', { success: false, error: err.message });
    });
});

module.exports = router;
