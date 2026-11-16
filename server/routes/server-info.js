const express = require('express');
const QRCode = require('qrcode');
const { detectServerIp } = require('../network-info');
const { asyncRoute } = require('../async-route');

const router = express.Router();

router.get('/', asyncRoute(async (req, res) => {
  const ip = detectServerIp();
  const port = process.env.PORT || 4010;
  const adminUrl = ip ? `http://${ip}:${port}/admin` : null;

  const qrDataUrl = adminUrl
    ? await QRCode.toDataURL(adminUrl, { margin: 1, width: 320, color: { dark: '#1b1b1f', light: '#ffffff' } })
    : null;

  res.json({ ip, adminUrl, qrDataUrl });
}));

module.exports = router;
