# Cartelera digital — Carnicería El Buen Corte

Sistema para mostrar precios y promociones en la TV del local, editable desde un panel web en la misma
red wifi, sin tocar imágenes.

## 1. Instalar y correr el servidor

### Opción fácil en Windows (no necesita instalar Node ni nada a mano)

Doble clic en `CarteleraElBuenCorte-Setup.exe` (ver [`windows-installer/`](windows-installer/)) y listo —
se autoextrae e instala solo, sin pasos intermedios. Trae su propio Node.js, instala las dependencias,
crea accesos directos y deja el servidor arrancando solo con Windows. Si prefieres revisar los archivos
antes de instalar, también queda generado `CarteleraElBuenCorte-Instalador.zip` (descomprimir y correr
`INSTALAR.bat` a mano). Ver [`windows-installer/LEEME.txt`](windows-installer/LEEME.txt) para más
detalle. Para generar ambos desde el código fuente: `cd windows-installer && ./build-installer.sh`
(el `.exe` se arma concatenando el módulo SFX oficial de 7-Zip para Windows con el contenido empaquetado,
sin necesitar NSIS ni ninguna herramienta de compilación).

### Instalación manual (Mac/Linux/Windows con Node ya instalado)

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
dueño que compre si todavía no tiene TV. El panel admin (pestaña **TV**) tiene un botón que busca TVs en la
red y otro que abre la cartelera en la TV por ADB sin escribir comandos — los pasos de abajo son para la
configuración manual, o si prefieres hacerlo paso a paso.

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

### Si la TV termina siendo Samsung (Tizen)

Samsung no tiene ADB, pero sí un "Modo Desarrollador" propio por wifi. El panel admin (pestaña **TV** →
"TV Samsung") hace todo con dos botones: uno instala las herramientas de Tizen en este PC la primera vez
(viene incluido en el instalador de Windows, no hay que descargar nada aparte) y el otro empaqueta e
instala la cartelera en la TV. Todo esto tiene que hacerse en persona, conectado a la misma wifi que la
TV — es depuración de bajo nivel, no una página web que se abra desde cualquier lado. La guía manual
paso a paso (por si el botón no funciona) está en [`tizen-app/README.md`](tizen-app/README.md).

## 5. Próximos pasos (cuando se sumen más TVs)

El sistema ya está preparado para crecer sin rehacerse:
- **Varias pantallas independientes**: cada TV con su propia playlist (hoy solo existe la pantalla `1`).
- **Modo mosaico / video wall**: varias TVs juntas mostrando una sola animación repartida entre ellas,
  sincronizada, alternando con contenido independiente por pantalla.

Avísame cuando tengas las TVs adicionales listas y seguimos con esa fase.
