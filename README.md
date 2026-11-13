# Cartelera digital — Carnicería El Buen Corte

Sistema para mostrar precios y promociones en la TV del local, editable desde un panel web en la misma
red wifi, sin tocar imágenes.

## 1. Instalar y correr el servidor

Necesitas tener [Node.js](https://nodejs.org) instalado (versión 18 o superior) en el PC/mini PC que va a
actuar como servidor (puede ser el mismo mini PC conectado a la TV, u otro PC en la misma red).

```bash
cd "Anuncios en pantalla"
npm install
npm start
```

Vas a ver algo como:

```
Servidor de cartelera escuchando en el puerto 4010
Panel admin:  http://localhost:4010/admin
Pantalla TV:  http://localhost:4010/player/1
```

## 2. Encontrar la IP del servidor en la red local

En el PC donde corre el servidor:

- **Windows**: abre `cmd` y escribe `ipconfig`, busca "Dirección IPv4" (ej: `192.168.1.50`).
- **Mac**: `Preferencias del Sistema → Red`, o en Terminal: `ipconfig getifaddr en0`.

Esa IP es la que vas a usar desde cualquier otro dispositivo de la misma wifi.

## 3. Panel de administración (cambiar precios, fotos y orden)

Desde cualquier navegador conectado a la misma wifi:

```
http://<IP-del-servidor>:4010/admin
```

Ahí puedes:
- Editar nombre, precio, unidad y foto de cada producto (pestaña **Productos**).
- Agregar o eliminar categorías y productos.
- Definir el orden de los carteles, qué plantilla usa cada uno (Grilla / Lista / Destacado / Portada /
  Horario / Redes / QR WhatsApp) y qué animación de transición (Desvanecer / Deslizar / Zoom / Cortina)
  (pestaña **Orden en pantalla**).
- Cargar tu Instagram, Facebook, el link de tu grupo de WhatsApp y tu horario de atención (pestaña
  **Datos del local**) — estos datos alimentan los carteles de "Síguenos en redes", "Horario de atención"
  y el QR de WhatsApp (el QR se genera solo a partir del link, no hace falta subir ninguna imagen).
- Ver una vista previa en vivo de la pantalla en la esquina inferior derecha, sin salir del panel.

Los cambios se reflejan en la TV al instante, sin recargar nada.

## 4. Conectar la TV

### Opción recomendada: Android TV / Google TV / Fire TV Stick (por wifi, sin cables)

Si la TV es Android TV, Google TV, o usas un Fire TV Stick/Cube, no necesitas mini PC ni cable HDMI: la
propia TV se conecta sola por wifi al servidor. Esta es la opción más simple y la que conviene pedirle al
dueño que compre si todavía no tiene TV.

1. **Instala "Fully Kiosk Browser"** (app gratuita hecha justo para esto — pantallas que muestran una sola
   web a pantalla completa, sin que nadie pueda salir de ahí):
   - **Android TV / Google TV**: búscala e instálala directo desde la Play Store de la TV.
   - **Fire TV Stick**: Amazon no la tiene en su tienda, hay que instalarla por ADB (ver más abajo).

2. **Configúrala** (dentro de la app, en sus ajustes):
   - **Start URL**: `http://<IP-del-servidor>:4010/player/1`
   - **Settings → Device Management → Launch on Boot**: `Yes` (antes debes ir a Ajustes de la TV → Apps →
     Fully Kiosk Browser y activarle el permiso "Modify system settings", si no, esta opción no aparece)
   - **Keep Screen On**: activado
   - **Fullscreen Mode**: activado — **Show Action Bar** y **Show Address Bar**: desactivados

   Con eso, la TV enciende, abre la app sola y queda mostrando la cartelera sin barra de navegador ni nada.

3. **Instalar Fully Kiosk Browser en un Fire TV Stick (ADB, por wifi, sin cable)**:
   - En el Fire TV: `Ajustes → My Fire TV (o Device & Software) → About`, selecciona el nombre del
     dispositivo y presiona el botón central del control 7 veces (activa "Opciones de desarrollador").
   - `Ajustes → My Fire TV → Developer Options`: activa **ADB Debugging** y **Apps from Unknown Sources**.
   - Anota la IP del Fire TV: `Ajustes → My Fire TV → About → Network`.
   - Desde tu PC (con [Android Platform Tools](https://developer.android.com/tools/releases/platform-tools)
     instalado):
     ```bash
     adb connect <IP-del-Fire-TV>:5555
     adb install FullyKioskBrowser.apk
     ```
   - Acepta en la TV el aviso de "permitir depuración" cuando aparezca.

   Esta misma conexión ADB es la que usan las herramientas para sacarle apps de publicidad/bloatware a un
   Fire TV (`adb shell pm uninstall -k --user 0 <nombre-del-paquete>`) — solo se usa una vez para instalar
   o limpiar cosas, no se queda conectada de forma permanente; después la TV habla con el servidor solo
   por wifi normal.

### Alternativa: mini PC / Raspberry Pi por HDMI

Si prefieres o ya tienes un mini PC/Raspberry Pi, conéctalo a la TV por HDMI, instala un navegador
Chromium/Chrome y configúralo para que arranque automáticamente en modo kiosko apuntando a:

```
http://<IP-del-servidor>:4010/player/1
```

**Raspberry Pi OS** — crear/editar `~/.config/autostart/cartelera.desktop`:

```ini
[Desktop Entry]
Type=Application
Name=Cartelera
Exec=chromium-browser --kiosk --noerrdialogs --disable-infobars --incognito http://<IP-del-servidor>:4010/player/1
X-GNOME-Autostart-enabled=true
```

**Windows (mini PC)** — crear un acceso directo en la carpeta de inicio
(`shell:startup`) apuntando a:

```
chrome.exe --kiosk --noerrdialogs --disable-infobars http://<IP-del-servidor>:4010/player/1
```

Para salir del modo kiosko en cualquier momento: `Alt+F4` (Windows) o `Alt+F4`/`Ctrl+W` (Raspberry Pi OS).

### Si la TV termina siendo Samsung (Tizen) o LG (webOS)

Estas no tienen ADB ni nada parecido. Samsung sí tiene un "Modo Desarrollador" propio (por wifi, con el
SDK gratuito Tizen Studio) que permite instalar la cartelera como una app que arranca sola en la TV, pero
es bastante más trabajo de configurar que Android TV/Fire TV. Si llegan a comprar una Samsung igual,
dime y armamos ese camino — por ahora, para no complicarnos, lo mejor es Android TV/Google TV/Fire TV.

Para la TV Samsung que ya tienen y quieren probar mientras tanto: dejé todo listo en
[`tizen-app/`](tizen-app/README.md) — la app empaquetada, un script (`deploy-to-tv.sh`) que instala todo
con un solo comando, y la guía paso a paso para el día que estés conectado a la misma wifi que la TV
(tiene que ser en persona o con alguien ahí — esto no se puede hacer en remoto, es depuración de bajo
nivel, no una página web).

## 5. Próximos pasos (cuando se sumen más TVs)

El sistema ya está preparado para crecer sin rehacerse:
- **Varias pantallas independientes**: cada TV con su propia playlist (hoy solo existe la pantalla `1`).
- **Modo mosaico / video wall**: varias TVs juntas mostrando una sola animación repartida entre ellas,
  sincronizada, alternando con contenido independiente por pantalla.

Avísame cuando tengas las TVs adicionales listas y seguimos con esa fase.
