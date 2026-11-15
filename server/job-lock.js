// Candado global compartido entre tizen.js, android.js y update.js: solo
// una operación (instalar en una TV, instalar el SDK, actualizar el
// software) puede correr a la vez en todo el servidor. Antes cada archivo
// llevaba su propio "activeJob" por separado, así que un "Actualizar ahora"
// podía dispararse mientras un deploy a una TV seguía en curso — y
// update.js reinicia el proceso entero (process.exit), matando ese deploy
// a medio camino.
let active = null; // { label: string } | null

function tryAcquire(label) {
  if (active) return false;
  active = { label };
  return true;
}

function release(label) {
  if (active && active.label === label) active = null;
}

function isBusy() {
  return active !== null;
}

function currentLabel() {
  return active ? active.label : null;
}

module.exports = { tryAcquire, release, isBusy, currentLabel };
