const { WebSocketServer } = require('ws');

let wss = null;

function initWs(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  // ws reenvia los errores de listen() del server (ej. EADDRINUSE mientras se
  // reinicia por una actualizacion, ver server/routes/update.js) como un
  // evento 'error' propio de WebSocketServer. Sin un listener aca, Node mata
  // el proceso entero por "unhandled 'error' event" antes de que el reintento
  // de server/index.js llegue a actuar.
  wss.on('error', () => {});

  wss.on('connection', (socket) => {
    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((socket) => {
      if (!socket.isAlive) return socket.terminate();
      socket.isAlive = false;
      socket.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

function broadcast(event, payload) {
  if (!wss) return;
  const message = JSON.stringify({ event, payload });
  wss.clients.forEach((socket) => {
    if (socket.readyState === socket.OPEN) socket.send(message);
  });
}

module.exports = { initWs, broadcast };
