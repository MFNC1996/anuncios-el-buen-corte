const express = require('express');
const db = require('../db');
const { broadcast } = require('../ws');

const router = express.Router();

function getSlides(playlistId) {
  return db
    .prepare(
      `SELECT ps.*, c.name AS category_name
       FROM playlist_slides ps
       LEFT JOIN categories c ON c.id = ps.category_id
       WHERE ps.playlist_id = ?
       ORDER BY ps.order_index`
    )
    .all(playlistId);
}

router.get('/:id', (req, res) => {
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'No encontrada' });
  res.json({ ...playlist, slides: getSlides(playlist.id) });
});

router.post('/:id/slides', (req, res) => {
  const { category_id, template_key, animation_key, duration_seconds } = req.body;
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!playlist) return res.status(404).json({ error: 'Playlist no encontrada' });

  const maxOrder = db
    .prepare('SELECT MAX(order_index) AS m FROM playlist_slides WHERE playlist_id = ?')
    .get(playlist.id).m;

  const info = db
    .prepare(
      `INSERT INTO playlist_slides (playlist_id, order_index, category_id, template_key, animation_key, duration_seconds)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      playlist.id,
      (maxOrder ?? -1) + 1,
      category_id ?? null,
      template_key ?? 'grid',
      animation_key ?? 'fade',
      duration_seconds ?? 8
    );

  broadcast('playlist:changed', { playlist_id: playlist.id });
  res.status(201).json(db.prepare('SELECT * FROM playlist_slides WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/slides/:slideId', (req, res) => {
  const existing = db.prepare('SELECT * FROM playlist_slides WHERE id = ?').get(req.params.slideId);
  if (!existing) return res.status(404).json({ error: 'Slide no encontrado' });

  const { category_id, template_key, animation_key, duration_seconds, order_index } = req.body;

  db.prepare(
    `UPDATE playlist_slides
     SET category_id = ?, template_key = ?, animation_key = ?, duration_seconds = ?, order_index = ?
     WHERE id = ?`
  ).run(
    category_id !== undefined ? category_id : existing.category_id,
    template_key ?? existing.template_key,
    animation_key ?? existing.animation_key,
    duration_seconds ?? existing.duration_seconds,
    order_index ?? existing.order_index,
    req.params.slideId
  );

  broadcast('playlist:changed', { playlist_id: existing.playlist_id });
  res.json(db.prepare('SELECT * FROM playlist_slides WHERE id = ?').get(req.params.slideId));
});

router.delete('/slides/:slideId', (req, res) => {
  const existing = db.prepare('SELECT * FROM playlist_slides WHERE id = ?').get(req.params.slideId);
  db.prepare('DELETE FROM playlist_slides WHERE id = ?').run(req.params.slideId);
  if (existing) broadcast('playlist:changed', { playlist_id: existing.playlist_id });
  res.status(204).end();
});

router.post('/:id/slides/reorder', (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds requerido' });

  const update = db.prepare('UPDATE playlist_slides SET order_index = ? WHERE id = ?');
  const reorder = db.transaction((ids) => {
    ids.forEach((id, index) => update.run(index, id));
  });
  reorder(orderedIds);

  broadcast('playlist:changed', { playlist_id: Number(req.params.id) });
  res.status(204).end();
});

module.exports = router;
