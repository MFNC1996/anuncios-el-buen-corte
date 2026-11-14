// Genera app.ico a partir del logo de la carnicería y se lo inyecta al
// módulo SFX (así el .exe final no muestra el ícono genérico de 7-Zip).
// Uso: node make-icon.js <logo.png> <7zSD.sfx original> <7zSD.sfx de salida> <app.ico de salida>
const fs = require('fs');
const pngToIco = require('png-to-ico').default;
const ResEdit = require('resedit');

async function main() {
  const [, , logoPath, sfxInPath, sfxOutPath, icoOutPath] = process.argv;
  if (!logoPath || !sfxInPath || !sfxOutPath || !icoOutPath) {
    console.error('Uso: node make-icon.js <logo.png> <sfx-in> <sfx-out> <ico-out>');
    process.exit(1);
  }

  // Con un solo path (no array) png-to-ico redimensiona solo a 256/48/32/16
  // a partir de una imagen cuadrada — el logo ya es 512x512.
  const icoBuffer = await pngToIco(logoPath);
  fs.writeFileSync(icoOutPath, icoBuffer);

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(sfxInPath));
  const res = ResEdit.NtExecutableResource.from(exe);
  const iconFile = ResEdit.Data.IconFile.from(icoBuffer);

  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const { id, lang } = groups[0];
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    id,
    lang,
    iconFile.icons.map((item) => item.data)
  );

  res.outputResource(exe);
  fs.writeFileSync(sfxOutPath, Buffer.from(exe.generate()));

  console.log(`OK: ${icoOutPath} y ${sfxOutPath} generados.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
