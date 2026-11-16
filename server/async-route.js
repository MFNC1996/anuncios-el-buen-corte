// Express 4 no atrapa solo por ser "async" un handler que rechaza su promesa
// (eso lo resuelve recien Express 5) — sin este wrapper, un error adentro
// (ej. QRCode.toDataURL fallando con una URL rara) deja la request colgada
// para siempre en vez de responder 500, y antes de la red de seguridad de
// process.on('unhandledRejection') en server/index.js directamente tiraba
// abajo todo el servidor.
function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncRoute };
