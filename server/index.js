const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');

// Red de seguridad a nivel de proceso: esta es una pantalla en un local sin
// nadie mirando la consola, así que un bug no atrapado en cualquier parte
// (ej. una promesa sin .catch en una ruta de tizen/android/update) no puede
// tirar abajo TODO el servidor — eso dejaría sin cartelera y sin panel a las
// demás pantallas/funciones que no tienen nada que ver con el bug. Se deja
// registro en server/data/crash.log para poder diagnosticarlo después.
const CRASH_LOG_PATH = path.join(__dirname, 'data', 'crash.log');
function logCrash(label, err) {
  const line = `[${new Date().toISOString()}] ${label}: ${(err && err.stack) || err}\n`;
  console.error(line);
  try {
    fs.mkdirSync(path.dirname(CRASH_LOG_PATH), { recursive: true });
    fs.appendFileSync(CRASH_LOG_PATH, line);
  } catch (_) {
    // si ni el log se puede escribir, no hay más que hacer
  }
}
process.on('uncaughtException', (err) => logCrash('uncaughtException', err));
process.on('unhandledRejection', (err) => logCrash('unhandledRejection', err));

const { initWs } = require('./ws');
require('./db'); // asegura que la base de datos exista y tenga los datos semilla

const categoriesRouter = require('./routes/categories');
const itemsRouter = require('./routes/items');
const uploadsRouter = require('./routes/uploads');
const playlistsRouter = require('./routes/playlists');
const screensRouter = require('./routes/screens');
const settingsRouter = require('./routes/settings');
const tizenRouter = require('./routes/tizen');
const serverInfoRouter = require('./routes/server-info');
const updateRouter = require('./routes/update');
const androidRouter = require('./routes/android');
const networkRouter = require('./routes/network');
const profilesRouter = require('./routes/profiles');

const app = express();
const PORT = process.env.PORT || 4010;

app.use(express.json());

app.use('/api/categories', categoriesRouter);
app.use('/api/items', itemsRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/playlists', playlistsRouter);
app.use('/api/screens', screensRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/tizen', tizenRouter);
app.use('/api/server-info', serverInfoRouter);
app.use('/api/update', updateRouter);
app.use('/api/android', androidRouter);
app.use('/api/network', networkRouter);
app.use('/api/profiles', profilesRouter);

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/shared', express.static(path.join(__dirname, '..', 'public', 'shared')));
app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));

// /player/:screenId sirve siempre la misma página; el id se lee en el cliente
// (ej. http://<ip>/player/1). Los assets (css/js) viven aparte en /player-assets.
app.use('/player-assets', express.static(path.join(__dirname, '..', 'public', 'player')));
app.get('/player/:screenId', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'player', 'index.html'));
});

app.get('/', (req, res) => res.redirect('/admin'));

// Si algo revienta en una ruta (ej. una restricción de la base de datos),
// que el cliente reciba un JSON parejo en vez del handler por defecto de
// Express, que manda el stack trace completo con rutas de archivos del
// servidor al navegador.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const server = http.createServer(app);
initWs(server);

// Al actualizar, el proceso nuevo arranca mientras el viejo todavia esta
// soltando el puerto (ver server/routes/update.js) — reintenta un rato antes
// de darse por vencido, en vez de fallar con EADDRINUSE por una carrera de
// milisegundos.
let listenRetriesLeft = 20;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && listenRetriesLeft > 0) {
    listenRetriesLeft -= 1;
    setTimeout(() => server.listen(PORT, '0.0.0.0'), 500);
  } else {
    console.error(err);
    process.exit(1);
  }
});
server.on('listening', () => {
  console.log(`Servidor de cartelera escuchando en el puerto ${PORT}`);
  console.log(`Panel admin:  http://localhost:${PORT}/admin`);
  console.log(`Pantalla TV:  http://localhost:${PORT}/player/1`);
});
server.listen(PORT, '0.0.0.0');
