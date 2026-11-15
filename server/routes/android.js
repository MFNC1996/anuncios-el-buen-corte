const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const express = require('express');
const multer = require('multer');
const { broadcast } = require('../ws');
const { detectServerIp } = require('../network-info');

const router = express.Router();
const INSTALL_ROOT = path.join(__dirname, '..', '..');
const ADB_EXE = path.join(INSTALL_ROOT, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const DEPLOY_TIMEOUT_MS = 60 * 1000;

let activeJob = null;

function adbAvailable() {
  return fs.existsSync(ADB_EXE);
}

router.get('/check', (req, res) => {
  res.json({ ready: adbAvailable(), serverIp: detectServerIp(), busy: !!activeJob });
});

// shell:true porque en Windows adb.exe a veces queda bloqueado por el
// antivirus/Defender al primer uso y conviene pasar por la shell del
// sistema igual que con las demás herramientas externas de este proyecto.
function runAdb(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ADB_EXE, args, { shell: process.platform === 'win32' });
    activeJob = child;
    let output = '';
    const forward = (data) => {
      output += data.toString();
      data
        .toString()
        .split('\n')
        .filter((l) => l.trim())
        .forEach((line) => broadcast('android:log', { line }));
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('error', reject);
    child.on('close', () => resolve({ output }));
  });
}

async function deploy(tvIp, playerUrl) {
  const target = `${tvIp}:5555`;
  broadcast('android:log', { line: `==> Conectando a ${target}...` });
  const { output } = await runAdb(['connect', target]);
  if (!/connected/i.test(output)) {
    throw new Error(
      'No se pudo conectar. Revisa que la depuración por red/USB esté activada en la TV y que la IP sea correcta.'
    );
  }

  broadcast('android:log', { line: `==> Abriendo ${playerUrl} en la TV...` });
  await runAdb(['-s', target, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', playerUrl]);
  broadcast('android:log', { line: '==> Listo. Revisa la pantalla de la TV.' });
}

router.post('/deploy', (req, res) => {
  const { tvIp, serverIp } = req.body;
  if (!tvIp || !IPV4_RE.test(tvIp)) return res.status(400).json({ error: 'La IP de la TV no es válida' });
  if (!serverIp || !IPV4_RE.test(serverIp)) return res.status(400).json({ error: 'La IP del servidor no es válida' });
  if (!adbAvailable()) return res.status(409).json({ error: 'No se encontraron las herramientas de Android en este PC' });
  if (activeJob) return res.status(409).json({ error: 'Ya hay una operación en curso' });

  const playerUrl = `http://${serverIp}:4010/player/1`;
  activeJob = true;
  broadcast('android:log', { line: `Conectando con ${tvIp}...` });

  const timeoutId = setTimeout(() => {
    if (activeJob && activeJob.kill) activeJob.kill();
    broadcast('android:log', { line: `Operación cancelada — tardó más de ${DEPLOY_TIMEOUT_MS / 1000}s.` });
    broadcast('android:done', { success: false });
    activeJob = null;
  }, DEPLOY_TIMEOUT_MS);

  deploy(tvIp, playerUrl)
    .then(() => {
      clearTimeout(timeoutId);
      broadcast('android:done', { success: true });
      activeJob = null;
    })
    .catch((err) => {
      clearTimeout(timeoutId);
      broadcast('android:log', { line: `Error: ${err.message}` });
      broadcast('android:done', { success: false });
      activeJob = null;
    });

  res.status(202).json({ started: true });
});

// Abre la ficha de Fully Kiosk Browser en la Play Store de la TV (no en
// Fire TV Stick, que no tiene Play Store — ahí se sigue instalando a mano
// por ADB, como ya explica la guía). No instala nada por sí solo: solo deja
// la pantalla de instalar lista para apretar "Instalar" con el control.
router.post('/open-play-store', (req, res) => {
  const { tvIp } = req.body;
  if (!tvIp || !IPV4_RE.test(tvIp)) return res.status(400).json({ error: 'La IP de la TV no es válida' });
  if (!adbAvailable()) return res.status(409).json({ error: 'No se encontraron las herramientas de Android en este PC' });
  if (activeJob) return res.status(409).json({ error: 'Ya hay una operación en curso' });

  const target = `${tvIp}:5555`;
  activeJob = true;
  runAdb(['connect', target])
    .then(() =>
      runAdb([
        '-s',
        target,
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        'market://details?id=de.ozerov.fully',
      ])
    )
    .then(() => {
      broadcast('android:log', { line: '==> Abrí la Play Store en la TV. Aprieta "Instalar" con el control.' });
      broadcast('android:done', { success: true });
      activeJob = null;
    })
    .catch((err) => {
      broadcast('android:log', { line: `Error: ${err.message}` });
      broadcast('android:done', { success: false });
      activeJob = null;
    });

  res.status(202).json({ started: true });
});

// Instala un .apk que el usuario ya tiene descargado en este PC (ej. Fully
// Kiosk Browser para Fire TV Stick, que no está en la tienda de Amazon). No
// se redistribuye ningún archivo de terceros: el usuario sube el suyo.
const apkUpload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 150 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.apk')) return cb(new Error('El archivo debe ser un .apk'));
    cb(null, true);
  },
});

router.post('/install-apk', apkUpload.single('apk'), (req, res) => {
  const { tvIp } = req.body;
  const cleanup = () => req.file && fs.unlink(req.file.path, () => {});

  if (!req.file) return res.status(400).json({ error: 'Falta el archivo .apk' });
  if (!tvIp || !IPV4_RE.test(tvIp)) {
    cleanup();
    return res.status(400).json({ error: 'La IP de la TV no es válida' });
  }
  if (!adbAvailable()) {
    cleanup();
    return res.status(409).json({ error: 'No se encontraron las herramientas de Android en este PC' });
  }
  if (activeJob) {
    cleanup();
    return res.status(409).json({ error: 'Ya hay una operación en curso' });
  }

  const target = `${tvIp}:5555`;
  activeJob = true;
  broadcast('android:log', { line: `Instalando ${req.file.originalname} en ${tvIp}...` });

  runAdb(['connect', target])
    .then(() => runAdb(['-s', target, 'install', '-r', req.file.path]))
    .then(({ output }) => {
      cleanup();
      const ok = /success/i.test(output);
      broadcast('android:log', {
        line: ok ? '==> Instalado correctamente.' : '==> La instalación no terminó en éxito, revisa el registro de arriba.',
      });
      broadcast('android:done', { success: ok });
      activeJob = null;
    })
    .catch((err) => {
      cleanup();
      broadcast('android:log', { line: `Error: ${err.message}` });
      broadcast('android:done', { success: false });
      activeJob = null;
    });

  res.status(202).json({ started: true });
});

router.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message });
  next();
});

module.exports = router;
