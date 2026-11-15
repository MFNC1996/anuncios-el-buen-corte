const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { broadcast } = require('../ws');

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
