const express = require('express');
const QRCode = require('qrcode');
const db = require('../db');
const { broadcast } = require('../ws');
const { asyncRoute } = require('../async-route');

const router = express.Router();

async function buildSettingsResponse(row) {
  let hours = [];
  try {
    hours = JSON.parse(row.hours_json || '[]');
  } catch (err) {
    hours = [];
  }

  let whatsapp_qr_data_url = null;
  if (row.whatsapp_group_url && row.whatsapp_group_url.trim()) {
    whatsapp_qr_data_url = await QRCode.toDataURL(row.whatsapp_group_url.trim(), {
      margin: 1,
      width: 320,
      color: { dark: '#1b1b1f', light: '#ffffff' },
    });
  }

  return {
    instagram: row.instagram,
    facebook: row.facebook,
    whatsapp_display: row.whatsapp_display,
    whatsapp_group_url: row.whatsapp_group_url,
    hours,
    whatsapp_qr_data_url,
    background_image_path: row.background_image_path,
    background_overlay_opacity: row.background_overlay_opacity,
  };
}

router.get('/', asyncRoute(async (req, res) => {
  const row = db.prepare('SELECT * FROM business_info WHERE id = 1').get();
  if (!row) return res.status(404).json({ error: 'Sin configuración' });
  res.json(await buildSettingsResponse(row));
}));

router.put('/', asyncRoute(async (req, res) => {
  const existing = db.prepare('SELECT * FROM business_info WHERE id = 1').get();
  if (!existing) return res.status(404).json({ error: 'Sin configuración' });

  const { instagram, facebook, whatsapp_display, whatsapp_group_url, hours, background_overlay_opacity } = req.body;

  db.prepare(
    `UPDATE business_info
     SET instagram = ?, facebook = ?, whatsapp_display = ?, whatsapp_group_url = ?, hours_json = ?,
         background_overlay_opacity = ?
     WHERE id = 1`
  ).run(
    instagram ?? existing.instagram,
    facebook ?? existing.facebook,
    whatsapp_display ?? existing.whatsapp_display,
    whatsapp_group_url ?? existing.whatsapp_group_url,
    hours !== undefined ? JSON.stringify(hours) : existing.hours_json,
    background_overlay_opacity ?? existing.background_overlay_opacity
  );

  broadcast('content:changed', { entity: 'settings' });
  const updated = db.prepare('SELECT * FROM business_info WHERE id = 1').get();
  res.json(await buildSettingsResponse(updated));
}));

module.exports = router;
