const express = require('express');
const { scanForTvs } = require('../network-scan');

const router = express.Router();

// El panel tiene dos botones "Buscar TVs en la red" (uno en Samsung, otro en
// Android) que llaman a este mismo endpoint — si alguien aprieta los dos
// rápido, comparten el escaneo en curso en vez de disparar dos barridos
// completos de la subred en paralelo.
let inFlightScan = null;

router.get('/scan', async (req, res) => {
  try {
    if (!inFlightScan) {
      inFlightScan = scanForTvs().finally(() => {
        inFlightScan = null;
      });
    }
    const devices = await inFlightScan;
    res.json({ devices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
