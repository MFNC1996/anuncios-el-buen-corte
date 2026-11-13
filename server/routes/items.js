const express = require('express');
const db = require('../db');
const { broadcast } = require('../ws');

const router = express.Router();

router.get('/', (req, res) => {
  const { category_id } = req.query;
  const items = category_id
    ? db
        .prepare('SELECT * FROM items WHERE active = 1 AND category_id = ? ORDER BY order_index')
        .all(category_id)
    : db.prepare('SELECT * FROM items WHERE active = 1 ORDER BY category_id, order_index').all();
  res.json(items);
});

router.post('/', (req, res) => {
  const { category_id, name, price, unit } = req.body;
  if (category_id == null || !name || !name.trim()) {
    return res.status(400).json({ error: 'category_id y name son requeridos' });
  }

  const maxOrder = db
    .prepare('SELECT MAX(order_index) AS m FROM items WHERE category_id = ?')
    .get(category_id).m;

  const info = db
    .prepare('INSERT INTO items (category_id, name, price, unit, order_index) VALUES (?, ?, ?, ?, ?)')
    .run(category_id, name.trim(), price ?? 0, unit ?? 'kg', (maxOrder ?? -1) + 1);

  broadcast('content:changed', { entity: 'items', category_id });
  res.status(201).json(db.prepare('SELECT * FROM items WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'No encontrado' });

  // photo_path no se acepta aquí a propósito: la única vía legítima para
  // cambiar la foto de un producto es /api/uploads/item/:id, que genera un
  // nombre de archivo propio. Aceptar un valor arbitrario del cliente en este
  // PUT permitiría guardar un src="..." manipulado (XSS almacenado) en el
  // <img> del player/admin.
  const { name, price, unit, order_index, active, category_id } = req.body;

  db.prepare(
    `UPDATE items SET name = ?, price = ?, unit = ?, order_index = ?, active = ?, category_id = ?
     WHERE id = ?`
  ).run(
    name ?? existing.name,
    price ?? existing.price,
    unit ?? existing.unit,
    order_index ?? existing.order_index,
    active ?? existing.active,
    category_id ?? existing.category_id,
    req.params.id
  );

  broadcast('content:changed', { entity: 'items', category_id: category_id ?? existing.category_id });
  res.json(db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  broadcast('content:changed', { entity: 'items', category_id: existing?.category_id });
  res.status(204).end();
});

router.post('/reorder', (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds requerido' });

  const update = db.prepare('UPDATE items SET order_index = ? WHERE id = ?');
  const reorder = db.transaction((ids) => {
    ids.forEach((id, index) => update.run(index, id));
  });
  reorder(orderedIds);

  broadcast('content:changed', { entity: 'items' });
  res.status(204).end();
});

module.exports = router;
