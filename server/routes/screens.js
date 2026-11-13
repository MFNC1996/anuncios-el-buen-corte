const express = require('express');
const db = require('../db');

const router = express.Router();

// Fase 1: una sola pantalla. group_id/position_row/position_col quedan
// reservados para la Fase 3 (video wall) y hoy siempre son NULL.
router.get('/:id', (req, res) => {
  const screen = db.prepare('SELECT * FROM screens WHERE id = ?').get(req.params.id);
  if (!screen) return res.status(404).json({ error: 'Pantalla no encontrada' });
  res.json(screen);
});

module.exports = router;
