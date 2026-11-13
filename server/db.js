const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'signage.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'kg',
    photo_path TEXT,
    order_index INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS playlist_slides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL DEFAULT 0,
    category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    template_key TEXT NOT NULL DEFAULT 'grid',
    animation_key TEXT NOT NULL DEFAULT 'fade',
    duration_seconds INTEGER NOT NULL DEFAULT 8
  );

  CREATE TABLE IF NOT EXISTS screens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    active_playlist_id INTEGER REFERENCES playlists(id) ON DELETE SET NULL,
    group_id INTEGER,
    position_row INTEGER,
    position_col INTEGER
  );

  CREATE TABLE IF NOT EXISTS business_info (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    instagram TEXT NOT NULL DEFAULT '',
    facebook TEXT NOT NULL DEFAULT '',
    whatsapp_display TEXT NOT NULL DEFAULT '',
    whatsapp_group_url TEXT NOT NULL DEFAULT '',
    hours_json TEXT NOT NULL DEFAULT '[]',
    background_image_path TEXT,
    background_overlay_opacity INTEGER NOT NULL DEFAULT 80
  );
`);

// Migración suave: agrega columnas nuevas a bases de datos creadas antes de
// que existieran (CREATE TABLE IF NOT EXISTS no las agrega solo). Se revisa
// el esquema real (PRAGMA table_info) en vez de comparar el texto del error
// de ALTER TABLE, que depende de la versión/locale de SQLite y además
// forzaría una excepción en cada arranque incluso cuando ya está migrado.
const businessInfoColumns = new Set(db.prepare('PRAGMA table_info(business_info)').all().map((c) => c.name));
[
  ['background_image_path', 'background_image_path TEXT'],
  ['background_overlay_opacity', 'background_overlay_opacity INTEGER NOT NULL DEFAULT 80'],
].forEach(([column, def]) => {
  if (!businessInfoColumns.has(column)) db.exec(`ALTER TABLE business_info ADD COLUMN ${def}`);
});

function seedIfEmpty() {
  const categoryCount = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  if (categoryCount > 0) return;

  const seedPath = path.join(__dirname, '..', 'seed', 'carniceria-seed.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  const insertCategory = db.prepare(
    'INSERT INTO categories (name, order_index) VALUES (?, ?)'
  );
  const insertItem = db.prepare(
    'INSERT INTO items (category_id, name, price, unit, order_index) VALUES (?, ?, ?, ?, ?)'
  );

  const insertAll = db.transaction((categories) => {
    categories.forEach((cat, catIndex) => {
      const info = insertCategory.run(cat.name, catIndex);
      const categoryId = info.lastInsertRowid;
      cat.items.forEach((item, itemIndex) => {
        insertItem.run(categoryId, item.name, item.price, item.unit, itemIndex);
      });
    });
  });
  insertAll(seed.categories);

  const covers = db.prepare('SELECT id FROM categories ORDER BY order_index').all();
  const insertPlaylist = db.prepare('INSERT INTO playlists (name) VALUES (?)');
  const playlistId = insertPlaylist.run('Playlist principal').lastInsertRowid;

  const insertSlide = db.prepare(`
    INSERT INTO playlist_slides (playlist_id, order_index, category_id, template_key, animation_key, duration_seconds)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertSlides = db.transaction(() => {
    insertSlide.run(playlistId, 0, null, 'portada', 'fade', 6);
    let order = 1;
    covers.forEach((cat, index) => {
      const template = index % 3 === 0 ? 'grid' : index % 3 === 1 ? 'lista' : 'destacado';
      const animation = ['fade', 'slide', 'zoom', 'cortina'][index % 4];
      insertSlide.run(playlistId, order++, cat.id, template, animation, 8);
    });
    insertSlide.run(playlistId, order++, null, 'horario', 'slide', 7);
    insertSlide.run(playlistId, order++, null, 'redes', 'fade', 7);
    insertSlide.run(playlistId, order++, null, 'qr', 'zoom', 8);
  });
  insertSlides();

  const insertScreen = db.prepare(
    'INSERT INTO screens (name, active_playlist_id) VALUES (?, ?)'
  );
  insertScreen.run('TV Mostrador', playlistId);

  const defaultHours = JSON.stringify([
    { day: 'Lunes', open: '09:00', close: '20:00', closed: false },
    { day: 'Martes', open: '09:00', close: '20:00', closed: false },
    { day: 'Miércoles', open: '09:00', close: '20:00', closed: false },
    { day: 'Jueves', open: '09:00', close: '20:00', closed: false },
    { day: 'Viernes', open: '09:00', close: '20:00', closed: false },
    { day: 'Sábado', open: '09:00', close: '18:00', closed: false },
    { day: 'Domingo', open: '', close: '', closed: true },
  ]);

  db.prepare(
    `INSERT INTO business_info (id, instagram, facebook, whatsapp_display, whatsapp_group_url, hours_json)
     VALUES (1, ?, ?, ?, ?, ?)`
  ).run('@elbuencorteloncoche', 'Carnicería El Buen Corte', '', '', defaultHours);
}

seedIfEmpty();

module.exports = db;
