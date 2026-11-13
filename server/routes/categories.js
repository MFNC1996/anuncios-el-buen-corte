const express = require('express');
const db = require('../db');
const { broadcast } = require('../ws');

const router = express.Router();

router.get('/', (req, res) => {
  const categories = db
    .prepare('SELECT * FROM categories WHERE active = 1 ORDER BY order_index')
    .all();
  res.json(categories);
});

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name es requerido' });

  const maxOrder = db.prepare('SELECT MAX(order_index) AS m FROM categories').get().m;
  const info = db
    .prepare('INSERT INTO categories (name, order_index) VALUES (?, ?)')
    .run(name.trim(), (maxOrder ?? -1) + 1);

  broadcast('content:changed', { entity: 'categories' });
  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const { name, order_index, active } = req.body;
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'No encontrada' });
  if (name !== undefined && !name.trim()) {
    return res.status(400).json({ error: 'name no puede quedar vacío' });
  }

  db.prepare('UPDATE categories SET name = ?, order_index = ?, active = ? WHERE id = ?').run(
    name !== undefined ? name.trim() : existing.name,
    order_index ?? existing.order_index,
    active ?? existing.active,
    req.params.id
  );

  broadcast('content:changed', { entity: 'categories' });
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'No encontrada' });
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  broadcast('content:changed', { entity: 'categories' });
  res.status(204).end();
});

router.post('/reorder', (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds requerido' });

  const update = db.prepare('UPDATE categories SET order_index = ? WHERE id = ?');
  const reorder = db.transaction((ids) => {
    ids.forEach((id, index) => update.run(index, id));
  });
  reorder(orderedIds);

  broadcast('content:changed', { entity: 'categories' });
  res.status(204).end();
});

module.exports = router;
