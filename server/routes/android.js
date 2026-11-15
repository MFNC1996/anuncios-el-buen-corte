const path = require('path');
const os = require('os');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { broadcast } = require('../ws');
const { detectServerIp } = require('../network-info');
const { spawnSafe } = require('../spawn-safe');
const jobLock = require('../job-lock');

const router = express.Router();
const INSTALL_ROOT = path.join(__dirname, '..', '..');
const ADB_EXE = path.join(INSTALL_ROOT, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const JOB_TIMEOUT_MS = 60 * 1000;

function adbAvailable() {
  return fs.existsSync(ADB_EXE);
}

router.get('/check', (req, res) => {
  res.json({ ready: adbAvailable(), serverIp: detectServerIp(), busy: jobLock.isBusy(), busyWith: jobLock.currentLabel() });
});

// Corre un comando de adb y manda la salida por WebSocket a medida que
// llega. Resuelve con {code, output} siempre que el proceso haya podido
// correr — adb no siempre refleja el éxito real en su código de salida
// (connect/am start suelen devolver 0 incluso cuando fallan), así que cada
// caller decide si además necesita revisar el texto de salida.
function runAdb(args, logEvent = 'android:log') {
  return new Promise((resolve, reject) => {
    const child = spawnSafe(ADB_EXE, args);
    let output = '';
    const forward = (data) => {
      output += data.toString();
      data
        .toString()
        .split('\n')
        .filter((l) => l.trim())
        .forEach((line) => broadcast(logEvent, { line }));
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

// Corre `fn` bajo el candado global, con un timeout real (broadcast de
// fallo + liberar el candado) si se cuelga — ej. un `adb connect` contra una
// TV apagada o cuya wifi descarta el paquete en silencio en vez de
// rechazarlo, que si no tendría a esta ruta "ocupada" para siempre.
function runTrackedJob({ label, doneEvent, logEvent, fn }) {
  if (!jobLock.tryAcquire(label)) return false;

  let settled = false;
  const timeoutId = setTimeout(() => {
    finish(false, `Cancelado — tardó más de ${JOB_TIMEOUT_MS / 1000}s.`);
  }, JOB_TIMEOUT_MS);

  function finish(success, errorLine) {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    if (errorLine) broadcast(logEvent, { line: errorLine });
    broadcast(doneEvent, { success });
    jobLock.release(label);
  }

  fn()
    .then((success = true) => finish(success))
    .catch((err) => finish(false, `Error: ${err.message}`));

  return true;
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
  const start = await runAdb(['-s', target, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', playerUrl]);
  if (start.code !== 0 || /error/i.test(start.output)) {
    throw new Error('La TV no abrió la cartelera. Revisa que haya un navegador/Fully Kiosk instalado.');
  }
  broadcast('android:log', { line: '==> Listo. Revisa la pantalla de la TV.' });
}

router.post('/deploy', (req, res) => {
  const { tvIp, serverIp } = req.body;
  if (!tvIp || !IPV4_RE.test(tvIp)) return res.status(400).json({ error: 'La IP de la TV no es válida' });
  if (!serverIp || !IPV4_RE.test(serverIp)) return res.status(400).json({ error: 'La IP del servidor no es válida' });
  if (!adbAvailable()) return res.status(409).json({ error: 'No se encontraron las herramientas de Android en este PC' });

  const playerUrl = `http://${serverIp}:4010/player/1`;
  broadcast('android:log', { line: `Conectando con ${tvIp}...` });
  const started = runTrackedJob({
    label: 'android-deploy',
    doneEvent: 'android:done',
    logEvent: 'android:log',
    fn: () => deploy(tvIp, playerUrl),
  });

  if (!started) return res.status(409).json({ error: `Ya hay una operación en curso (${jobLock.currentLabel()})` });
  res.status(202).json({ started: true });
});

// Abre la ficha de Fully Kiosk Browser en la Play Store de la TV (no en
// Fire TV Stick, que no tiene Play Store — ahí se sigue instalando a mano
// por ADB, como ya explica la guía). No instala nada por sí solo: solo deja
// la pantalla de instalar lista para apretar "Instalar" con el control.
async function openPlayStore(tvIp) {
  const target = `${tvIp}:5555`;
  const { output: connectOutput } = await runAdb(['connect', target]);
  if (!/connected/i.test(connectOutput)) {
    throw new Error('No se pudo conectar a la TV. Revisa la IP y que la depuración por red esté activada.');
  }
  const { output } = await runAdb([
    '-s',
    target,
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    'market://details?id=de.ozerov.fully',
  ]);
  if (/error/i.test(output)) {
    throw new Error('La TV no abrió la Play Store (¿es un Fire TV Stick? esos no tienen Play Store).');
  }
  broadcast('android:log', { line: '==> Abrí la Play Store en la TV. Aprieta "Instalar" con el control.' });
}

router.post('/open-play-store', (req, res) => {
  const { tvIp } = req.body;
  if (!tvIp || !IPV4_RE.test(tvIp)) return res.status(400).json({ error: 'La IP de la TV no es válida' });
  if (!adbAvailable()) return res.status(409).json({ error: 'No se encontraron las herramientas de Android en este PC' });

  const started = runTrackedJob({
    label: 'android-open-store',
    doneEvent: 'android:done',
    logEvent: 'android:log',
    fn: () => openPlayStore(tvIp),
  });

  if (!started) return res.status(409).json({ error: `Ya hay una operación en curso (${jobLock.currentLabel()})` });
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

  const target = `${tvIp}:5555`;
  const apkName = req.file.originalname;
  const apkPath = req.file.path;
  broadcast('android:log', { line: `Instalando ${apkName} en ${tvIp}...` });

  const started = runTrackedJob({
    label: 'android-install-apk',
    doneEvent: 'android:done',
    logEvent: 'android:log',
    fn: async () => {
      await runAdb(['connect', target]);
      const { code, output } = await runAdb(['-s', target, 'install', '-r', apkPath]);
      cleanup();
      const ok = code === 0 && /success/i.test(output);
      broadcast('android:log', {
        line: ok ? '==> Instalado correctamente.' : '==> La instalación no terminó en éxito, revisa el registro de arriba.',
      });
      return ok;
    },
  });

  if (!started) {
    cleanup();
    return res.status(409).json({ error: `Ya hay una operación en curso (${jobLock.currentLabel()})` });
  }
  res.status(202).json({ started: true });
});

router.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message });
  next();
});

module.exports = router;
