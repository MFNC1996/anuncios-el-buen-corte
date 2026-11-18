const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { imageSize } = require('image-size');
const db = require('../db');
const { broadcast } = require('../ws');

// Mismo criterio que usa el reproductor para recortar el mosaico entre las
// pantallas de un perfil (ver renderMosaic en public/player/player.js): el
// total de filas/columnas sale de la posición más alta ocupada por alguna
// pantalla de ese perfil. Una TV de referencia mide 1920x1080 — la imagen
// completa tiene que medir exactamente columnas×1920 por filas×1080, si no,
// el recorte de cada pantalla queda estirado o con bordes en vez de calzar
// pixel a pixel.
const MOSAIC_TILE_WIDTH = 1920;
const MOSAIC_TILE_HEIGHT = 1080;

function mosaicGridFor(profileId) {
  const screens = db.prepare('SELECT position_row, position_col FROM screens WHERE profile_id = ?').all(profileId);
  const rows = Math.max(1, ...screens.map((s) => (s.position_row ?? 0) + 1));
  const cols = Math.max(1, ...screens.map((s) => (s.position_col ?? 0) + 1));
  return { rows, cols };
}

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// La extensión del archivo guardado sale del mimetype ya validado, nunca del
// nombre original que manda el cliente: así un archivo renombrado "foto.svg"
// con el Content-Type falseado a "image/png" no puede terminar guardado (y
// servido por express.static) como .svg — un vector clásico de XSS
// almacenado, ya que los navegadores sí ejecutan <script> dentro de un SVG
// abierto directamente.
const MIME_EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = MIME_EXTENSIONS[file.mimetype] || '';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const ALLOWED_TYPES = new Set(Object.keys(MIME_EXTENSIONS));

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return cb(new Error('Formato no permitido (usa PNG, JPG o WEBP)'));
    }
    cb(null, true);
  },
});

router.post('/item/:id', upload.single('photo'), (req, res) => {
  const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo photo' });

  const photoPath = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE items SET photo_path = ? WHERE id = ?').run(photoPath, req.params.id);

  broadcast('content:changed', { entity: 'items', category_id: existing.category_id });
  res.json(db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id));
});

function removeUploadedFile(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return;
  const filePath = path.join(UPLOADS_DIR, path.basename(publicPath));
  fs.unlink(filePath, () => {});
}

router.post('/background', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo photo' });
  const existing = db.prepare('SELECT * FROM business_info WHERE id = 1').get();

  const imagePath = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE business_info SET background_image_path = ? WHERE id = 1').run(imagePath);
  removeUploadedFile(existing?.background_image_path);

  broadcast('content:changed', { entity: 'settings' });
  res.json({ background_image_path: imagePath });
});

router.post('/slide/:id', upload.single('photo'), (req, res) => {
  const existing = db.prepare('SELECT * FROM playlist_slides WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Cartel no encontrado' });
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo photo' });

  const photoPath = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE playlist_slides SET photo_path = ? WHERE id = ?').run(photoPath, req.params.id);
  removeUploadedFile(existing.photo_path);

  broadcast('playlist:changed', { playlist_id: existing.playlist_id });
  res.json(db.prepare('SELECT * FROM playlist_slides WHERE id = ?').get(req.params.id));
});

router.post('/profile/:id', upload.single('photo'), (req, res) => {
  const existing = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!existing) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: 'Perfil no encontrado' });
  }
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo photo' });

  const { rows, cols } = mosaicGridFor(req.params.id);
  const expectedWidth = cols * MOSAIC_TILE_WIDTH;
  const expectedHeight = rows * MOSAIC_TILE_HEIGHT;
  let actual;
  try {
    actual = imageSize(fs.readFileSync(req.file.path));
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'No se pudo leer la imagen — ¿está dañada?' });
  }
  if (actual.width !== expectedWidth || actual.height !== expectedHeight) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({
      error:
        `La imagen debe medir exactamente ${expectedWidth}x${expectedHeight}px ` +
        `(${cols} pantalla${cols === 1 ? '' : 's'} de ancho × ${rows} de alto, a 1920x1080 cada una) — ` +
        `subiste una de ${actual.width}x${actual.height}px.`,
    });
  }

  const imagePath = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE profiles SET mosaic_image_path = ? WHERE id = ?').run(imagePath, req.params.id);
  removeUploadedFile(existing.mosaic_image_path);

  broadcast('profiles:changed', {});
  res.json(db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id));
});

router.delete('/background', (req, res) => {
  const existing = db.prepare('SELECT * FROM business_info WHERE id = 1').get();
  db.prepare('UPDATE business_info SET background_image_path = NULL WHERE id = 1').run();
  removeUploadedFile(existing?.background_image_path);

  broadcast('content:changed', { entity: 'settings' });
  res.status(204).end();
});

router.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message });
  next();
});

module.exports = router;
