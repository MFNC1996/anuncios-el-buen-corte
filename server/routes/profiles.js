const express = require('express');
const db = require('../db');
const { broadcast } = require('../ws');

const router = express.Router();
const VALID_MODES = new Set(['independent', 'mosaic']);

function getProfiles() {
  const profiles = db.prepare('SELECT * FROM profiles ORDER BY id').all();
  const screens = db.prepare('SELECT * FROM screens ORDER BY id').all();
  return profiles.map((p) => ({ ...p, screens: screens.filter((s) => s.profile_id === p.id) }));
}

router.get('/', (req, res) => {
  res.json(getProfiles());
});

router.get('/:id', (req, res) => {
  const profile = getProfiles().find((p) => p.id === Number(req.params.id));
  if (!profile) return res.status(404).json({ error: 'Perfil no encontrado' });
  res.json(profile);
});

router.post('/', (req, res) => {
  const { name, mode } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Falta el nombre del perfil' });
  if (mode && !VALID_MODES.has(mode)) return res.status(400).json({ error: 'Modo inválido' });

  const info = db.prepare('INSERT INTO profiles (name, mode) VALUES (?, ?)').run(name.trim(), mode || 'independent');
  res.status(201).json(db.prepare('SELECT * FROM profiles WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Perfil no encontrado' });

  const { name, mode } = req.body;
  if (name !== undefined && !name.trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
  if (mode !== undefined && !VALID_MODES.has(mode)) return res.status(400).json({ error: 'Modo inválido' });

  db.prepare('UPDATE profiles SET name = ?, mode = ? WHERE id = ?').run(
    name !== undefined ? name.trim() : existing.name,
    mode !== undefined ? mode : existing.mode,
    req.params.id
  );

  broadcast('profiles:changed', {});
  res.json(db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Perfil no encontrado' });

  const profileCount = db.prepare('SELECT COUNT(*) AS c FROM profiles').get().c;
  if (profileCount <= 1) return res.status(400).json({ error: 'No se puede eliminar el único perfil' });

  const screenCount = db.prepare('SELECT COUNT(*) AS c FROM screens WHERE profile_id = ?').get(req.params.id).c;
  if (screenCount > 0) {
    return res.status(400).json({ error: 'Este perfil todavía tiene pantallas asignadas — muévelas a otro perfil primero' });
  }

  db.prepare('DELETE FROM profiles WHERE id = ?').run(req.params.id);
  broadcast('profiles:changed', {});
  res.status(204).end();
});

module.exports = router;
