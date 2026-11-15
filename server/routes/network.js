const express = require('express');
const { scanForTvs } = require('../network-scan');

const router = express.Router();

router.get('/scan', async (req, res) => {
  try {
    const devices = await scanForTvs();
    res.json({ devices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
