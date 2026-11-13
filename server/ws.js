const { WebSocketServer } = require('ws');

let wss = null;

function initWs(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

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
