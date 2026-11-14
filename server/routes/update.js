const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const express = require('express');
const AdmZip = require('adm-zip');
const { broadcast } = require('../ws');

const router = express.Router();

// Carpeta de instalación real: server/routes/update.js -> server/routes -> server -> raíz.
const INSTALL_ROOT = path.join(__dirname, '..', '..');
const REPO = require('../../package.json').repository || 'MFNC1996/anuncios-el-buen-corte';

// Nunca se tocan al actualizar: ahí viven los precios/fotos del local.
const PRESERVE_PATHS = ['server/data', 'server/uploads'];

let activeJob = false;

function currentVersion() {
  return require('../../package.json').version;
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
      busy: activeJob,
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
    const child = spawn(cmd, args, options);
    child.stdout?.on('data', (d) =>
      d
        .toString()
        .split('\n')
        .filter((l) => l.trim())
        .forEach((line) => broadcast('update:log', { line }))
    );
    child.stderr?.on('data', (d) =>
      d
        .toString()
        .split('\n')
        .filter((l) => l.trim())
        .forEach((line) => broadcast('update:log', { line }))
    );
    child.on('error', reject);
    child.on('close', (code) => {
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

  broadcast('update:log', { line: `==> Descargando versión ${latestVersion}...` });
  const assetRes = await fetch(asset.browser_download_url);
  if (!assetRes.ok) throw new Error(`No se pudo descargar la actualización (HTTP ${assetRes.status})`);
  const buf = Buffer.from(await assetRes.arrayBuffer());
  fs.writeFileSync(tmpZip, buf);

  broadcast('update:log', { line: '==> Descomprimiendo...' });
  fs.rmSync(tmpExtract, { recursive: true, force: true });
  fs.mkdirSync(tmpExtract, { recursive: true });
  new AdmZip(tmpZip).extractAllTo(tmpExtract, true);

  broadcast('update:log', { line: '==> Copiando archivos nuevos (sin tocar precios ni fotos guardadas)...' });
  copyUpdateFiles(tmpExtract);

  fs.rmSync(tmpZip, { force: true });
  fs.rmSync(tmpExtract, { recursive: true, force: true });

  broadcast('update:log', { line: '==> Instalando dependencias...' });
  await runStep(npmExecutable(), ['install', '--omit=dev', '--no-fund', '--no-audit'], {
    cwd: INSTALL_ROOT,
    env: process.env,
  });

  broadcast('update:log', { line: '==> Reiniciando el servidor...' });
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
  if (activeJob) return res.status(409).json({ error: 'Ya hay una actualización en curso' });
  activeJob = true;
  res.status(202).json({ started: true });

  applyUpdate()
    .then(() => {
      broadcast('update:done', { success: true });
    })
    .catch((err) => {
      activeJob = false;
      broadcast('update:log', { line: `Error: ${err.message}` });
      broadcast('update:done', { success: false });
    });
});

module.exports = router;
