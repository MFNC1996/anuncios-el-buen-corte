const express = require('express');
const db = require('../db');
const { broadcast } = require('../ws');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM screens ORDER BY id').all());
});

router.get('/:id', (req, res) => {
  const screen = db.prepare('SELECT * FROM screens WHERE id = ?').get(req.params.id);
  if (!screen) return res.status(404).json({ error: 'Pantalla no encontrada' });
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(screen.profile_id);
  res.json({ ...screen, profile });
});

router.post('/', (req, res) => {
  const { name, profile_id } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Falta el nombre de la pantalla' });

  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile_id);
  if (!profile) return res.status(400).json({ error: 'El perfil indicado no existe' });

  // Cada pantalla independiente necesita su propia playlist para poder
  // editarle el orden de carteles por separado de las demás.
  const playlistId = db.prepare('INSERT INTO playlists (name) VALUES (?)').run(`Playlist de ${name.trim()}`)
    .lastInsertRowid;
  db.prepare(
    `INSERT INTO playlist_slides (playlist_id, order_index, category_id, template_key, animation_key, duration_seconds)
     VALUES (?, 0, NULL, 'portada', 'fade', 6)`
  ).run(playlistId);

  const maxPos = db
    .prepare('SELECT MAX(position_col) AS m FROM screens WHERE profile_id = ?')
    .get(profile_id).m;

  const info = db
    .prepare('INSERT INTO screens (name, active_playlist_id, profile_id, position_row, position_col) VALUES (?, ?, ?, 0, ?)')
    .run(name.trim(), playlistId, profile_id, (maxPos ?? -1) + 1);

  broadcast('profiles:changed', {});
  res.status(201).json(db.prepare('SELECT * FROM screens WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM screens WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Pantalla no encontrada' });

  const { name, profile_id, active_playlist_id, position_row, position_col } = req.body;
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
  if (profile_id !== undefined && !db.prepare('SELECT id FROM profiles WHERE id = ?').get(profile_id)) {
    return res.status(400).json({ error: 'El perfil indicado no existe' });
  }

  db.prepare(
    `UPDATE screens SET name = ?, profile_id = ?, active_playlist_id = ?, position_row = ?, position_col = ? WHERE id = ?`
  ).run(
    name !== undefined ? name.trim() : existing.name,
    profile_id !== undefined ? profile_id : existing.profile_id,
    active_playlist_id !== undefined ? active_playlist_id : existing.active_playlist_id,
    position_row !== undefined ? position_row : existing.position_row,
    position_col !== undefined ? position_col : existing.position_col,
    req.params.id
  );

  broadcast('profiles:changed', {});
  res.json(db.prepare('SELECT * FROM screens WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM screens WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Pantalla no encontrada' });

  const screenCount = db.prepare('SELECT COUNT(*) AS c FROM screens').get().c;
  if (screenCount <= 1) return res.status(400).json({ error: 'No se puede eliminar la única pantalla' });

  db.prepare('DELETE FROM screens WHERE id = ?').run(req.params.id);
  broadcast('profiles:changed', {});
  res.status(204).end();
});

module.exports = router;
