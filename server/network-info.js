const os = require('os');

function detectServerIp() {
  const nets = os.networkInterfaces();
  for (const ifaceList of Object.values(nets)) {
    for (const net of ifaceList) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

module.exports = { detectServerIp };
