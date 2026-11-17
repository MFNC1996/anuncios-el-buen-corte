const { spawn, execFile } = require('child_process');

// En Windows, spawn(cmd, args, {shell:true}) arma el comando final como
// [cmd, ...args].join(' ') SIN encomillar nada antes de pasárselo a cmd.exe.
// Si cmd o cualquier argumento trae un espacio (ej. una carpeta de usuario
// de Windows como "C:\Users\Juan Perez\...", nada raro en una PC de un
// local), cmd.exe vuelve a partir el comando justo en ese espacio y todo
// falla — el mismo problema que tenía "npm.cmd" sin shell:true, reaparecido
// por no encomillar. Esta función encomilla lo que haga falta antes de
// construir el comando.
function quoteForWindowsShell(value) {
  const str = String(value);
  if (!/[\s"]/.test(str)) return str;
  return `"${str.replace(/"/g, '\\"')}"`;
}

const isWindows = process.platform === 'win32';

// Spawnea de forma segura en Windows y Mac/Linux por igual: en Windows usa
// shell:true (necesario para poder ejecutar .bat/.cmd como npm.cmd o
// tizen.bat directamente) y encomilla cmd/args para que las rutas con
// espacios no rompan el comando.
function spawnSafe(cmd, args = [], options = {}) {
  if (!isWindows) return spawn(cmd, args, options);
  return spawn(quoteForWindowsShell(cmd), args.map(quoteForWindowsShell), { ...options, shell: true });
}

function execFileSafe(cmd, args = [], options = {}, callback) {
  if (!isWindows) return execFile(cmd, args, options, callback);
  return execFile(
    quoteForWindowsShell(cmd),
    args.map(quoteForWindowsShell),
    { ...options, shell: true },
    callback
  );
}

// child.kill() de spawnSafe en Windows solo mata el cmd.exe envoltorio (por
// shell:true) — el proceso real (tizen.bat → java.exe, npm.cmd → node.exe,
// etc.) queda huérfano corriendo de fondo, a veces con archivos abiertos que
// hacen fallar el siguiente intento con un EBUSY/EPERM que no tiene nada que
// ver con la causa real. "taskkill /T" mata todo el árbol de procesos bajo
// ese PID, no solo el de arriba.
function killTree(child) {
  if (!child || !child.pid) return;
  if (!isWindows) {
    child.kill();
    return;
  }
  execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {
    // Si ya había terminado solo, taskkill devuelve error — no hay nada
    // más que hacer en ese caso.
  });
}

module.exports = { spawnSafe, execFileSafe, killTree };
