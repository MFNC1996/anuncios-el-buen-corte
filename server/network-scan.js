const os = require('os');
const net = require('net');

function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function intToIp(n) {
  return [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.');
}

// Direcciones a probar: toda la subred de la interfaz de red local del
// servidor (normalmente un /24 de router hogareño/de local comercial). Si la
// máscara da una subred enorme (red corporativa, VPN, etc.) se limita al
// /24 alrededor de la propia IP para no intentar miles de conexiones.
function hostsToScan() {
  const nets = os.networkInterfaces();
  for (const ifaceList of Object.values(nets)) {
    for (const iface of ifaceList) {
      if (iface.family !== 'IPv4' || iface.internal) continue;

      const ipInt = ipToInt(iface.address);
      const maskInt = ipToInt(iface.netmask);
      const networkInt = ipInt & maskInt;
      const broadcastInt = networkInt | (~maskInt >>> 0);
      const hostCount = broadcastInt - networkInt - 1;

      if (hostCount > 0 && hostCount <= 1024) {
        const ips = [];
        for (let i = networkInt + 1; i < broadcastInt; i++) ips.push(intToIp(i));
        return ips;
      }

      const base = ipInt & 0xffffff00; // tratar como /24 alrededor de nuestra IP
      return Array.from({ length: 254 }, (_, i) => intToIp(base + i + 1));
    }
  }
  return [];
}

function checkPort(ip, port, timeoutMs = 350) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, ip);
  });
}

// Escanea la red local buscando TVs: puerto 26101 (sdb de Tizen, Samsung) y
// 5555 (adb, Android TV/Google TV/Fire TV Stick con depuración activada).
async function scanForTvs() {
  const ips = hostsToScan();
  const found = [];
  const concurrency = 40;
  let idx = 0;

  async function worker() {
    while (idx < ips.length) {
      const ip = ips[idx++];
      const [samsung, android] = await Promise.all([checkPort(ip, 26101), checkPort(ip, 5555)]);
      if (samsung) found.push({ ip, type: 'samsung' });
      else if (android) found.push({ ip, type: 'android' });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, ips.length) }, worker));
  return found;
}

module.exports = { scanForTvs };
