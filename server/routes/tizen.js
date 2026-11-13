const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const express = require('express');
const { broadcast } = require('../ws');

const router = express.Router();
const TIZEN_APP_DIR = path.join(__dirname, '..', '..', 'tizen-app');

function tizenEnv() {
  const home = os.homedir();
  const tizenPath = `${home}/tizen-studio/tools/ide/bin:${home}/tizen-studio/tools`;
  return { ...process.env, PATH: `${tizenPath}:${process.env.PATH}` };
}

function commandExists(cmd, env) {
  return new Promise((resolve) => {
    execFile(cmd, ['version'], { env, timeout: 10000 }, (err) => resolve(!err));
  });
}

function detectServerIp() {
  const nets = os.networkInterfaces();
  for (const ifaceList of Object.values(nets)) {
    for (const net of ifaceList) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

let activeJob = null;
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const DEPLOY_TIMEOUT_MS = 2 * 60 * 1000;

router.get('/check', async (req, res) => {
  const env = tizenEnv();
  const [tizenOk, sdbOk] = await Promise.all([commandExists('tizen', env), commandExists('sdb', env)]);
  res.json({ ready: tizenOk && sdbOk, tizenOk, sdbOk, serverIp: detectServerIp(), busy: !!activeJob });
});

router.post('/deploy', (req, res) => {
  const { tvIp, serverIp } = req.body;
  if (!tvIp || !serverIp) return res.status(400).json({ error: 'Falta la IP de la TV o del servidor' });
  if (!IPV4_RE.test(tvIp) || !IPV4_RE.test(serverIp)) {
    return res.status(400).json({ error: 'La IP de la TV y del servidor deben ser direcciones IPv4 válidas' });
  }
  if (activeJob) return res.status(409).json({ error: 'Ya hay una instalación en curso' });

  const env = tizenEnv();
  const child = spawn('bash', ['deploy-to-tv.sh', tvIp, serverIp], {
    cwd: TIZEN_APP_DIR,
    env,
    timeout: DEPLOY_TIMEOUT_MS,
  });
  activeJob = child;

  broadcast('tizen:log', { line: `Instalando en ${tvIp} (servidor ${serverIp})...` });

  const forward = (data) => {
    data
      .toString()
      .split('\n')
      .filter((line) => line.trim())
      .forEach((line) => broadcast('tizen:log', { line }));
  };
  child.stdout.on('data', forward);
  child.stderr.on('data', forward);

  child.on('close', (code, signal) => {
    if (signal) broadcast('tizen:log', { line: `Instalación cancelada (${signal}) — tardó más de ${DEPLOY_TIMEOUT_MS / 1000}s.` });
    broadcast('tizen:done', { success: code === 0, code });
    activeJob = null;
  });

  child.on('error', (err) => {
    broadcast('tizen:log', { line: `Error: ${err.message}` });
    broadcast('tizen:done', { success: false, code: -1 });
    activeJob = null;
  });

  res.status(202).json({ started: true });
});

module.exports = router;
