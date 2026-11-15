const os = require('os');
const net = require('net');

function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function intToIp(n) {
  return [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.');
}

// Nombres de interfaces que casi seguro NO son la red wifi/ethernet real del
// local: VPNs, máquinas virtuales, Docker/WSL, loopback. En una PC Windows
// con alguna de estas instaladas, os.networkInterfaces() puede listarlas
// antes que el adaptador físico real — sin este filtro el escaneo revisaría
// esa red virtual en silencio y nunca encontraría ninguna TV.
const VIRTUAL_IFACE_RE = /virtual|vmware|virtualbox|hyper-v|vethernet|loopback|docker|wsl|tailscale|zerotier|\btap\b|\btun\b|\bvpn\b/i;

function candidateInterfaces() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const [name, ifaceList] of Object.entries(nets)) {
    for (const iface of ifaceList) {
      if (iface.family === 'IPv4' && !iface.internal) candidates.push({ name, iface });
    }
  }
  return candidates;
}

function rangeForInterface(iface) {
  const ipInt = ipToInt(iface.address);
  const maskInt = ipToInt(iface.netmask);
  const networkInt = ipInt & maskInt;
  const broadcastInt = networkInt | (~maskInt >>> 0);
  const hostCount = broadcastInt - networkInt - 1;

  // Subred normal de router hogareño/de local comercial (hasta un /24): se
  // escanea completa. Si es mucho más grande (red corporativa, /16, etc.) se
  // limita a un /24 alrededor de la propia IP para no intentar miles de
  // conexiones de una.
  if (hostCount > 0 && hostCount <= 254) {
    const ips = [];
    for (let i = networkInt + 1; i < broadcastInt; i++) ips.push(intToIp(i));
    return ips;
  }
  const base = ipInt & 0xffffff00;
  return Array.from({ length: 254 }, (_, i) => intToIp(base + i + 1));
}

// Direcciones a probar: toda la subred de la interfaz de red "real" del
// servidor. Prefiere interfaces que no parezcan virtuales/VPN; si todas lo
// parecen (poco probable, pero mejor no devolver una lista vacía), usa la
// primera disponible igual.
function hostsToScan() {
  const candidates = candidateInterfaces();
  const physical = candidates.filter((c) => !VIRTUAL_IFACE_RE.test(c.name));
  const chosen = (physical.length ? physical : candidates)[0];
  return chosen ? rangeForInterface(chosen.iface) : [];
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
