# Cartelera en Samsung TV (app nativa vía Tizen)

Esta carpeta es una app Tizen mínima: solo abre, a pantalla completa, la cartelera que corre en el
servidor (`http://<IP-del-servidor>:4010/player/1`). No necesita HDMI ni mini PC — la TV la ejecuta sola.

**Importante**: todo esto requiere que tu notebook y la TV estén conectados a la **misma red wifi** (la
del local). No se puede hacer de forma remota — es depuración de bajo nivel (como ADB), no una página web
que se pueda abrir desde cualquier lado.

> **Tip**: no hace falta usar la terminal para instalar. En el panel admin (`/admin`) hay una pestaña
> **"Instalar en TV Samsung"** que hace exactamente esto mismo (empaquetar, conectar, instalar) con un
> botón y muestra el progreso en vivo — siempre que el servidor esté corriendo en un PC (Windows, Mac o
> Linux) con el SDK de Tizen instalado y conectado a la wifi del local. Esta guía y `deploy-to-tv.sh`
> quedan como respaldo manual para Mac/Linux, y el SDK es necesario instalarlo una sola vez en el PC
> nuevo antes de poder usar el botón del panel.
>
> **Si el servidor va a correr en un PC con Windows** (el caso normal cuando se instaló con el
> `Setup.exe` de `windows-installer/`): el propio panel admin (pestaña TV → TV Samsung) tiene un botón
> "Instalar herramientas de Tizen" que hace esto solo, con el instalador del SDK ya incluido adentro del
> `Setup.exe` — no hace falta descargar ni correr nada aparte. `windows-installer/instalar-tizen-studio.bat`
> queda como respaldo manual por si ese botón fallara por algún motivo.

## Qué ya quedó preparado (en este Mac)

- `config.xml`, `index.html`, `icon.png`: la app en sí (no hay que tocarlos salvo la IP del servidor).
- `deploy-to-tv.sh`: automatiza empaquetar e instalar la app en la TV con un solo comando.
- **Tizen Studio CLI ya instalado** en `~/tizen-studio` y agregado al `PATH` (`~/.zshrc`).
- **Perfil de firma "ebcorte" ya creado** (contraseña `0000`) y seteado como perfil por defecto.
- Ya probé que `tizen package -t wgt -s ebcorte` genera el `.wgt` correctamente (sin errores) — lo único
  que falta es la parte que sí necesita la red del local: conectar con la TV e instalar.

Si vas a usar **este mismo Mac** en el local, puedes saltar directo al paso 2. Si llevas **otro
computador**, repite el paso 1 ahí primero.

## El día que estés en el local, en orden:

### 1. (Solo si usas OTRO computador) Instala el SDK de Tizen y el certificado

**En Windows**: corre `windows-installer/instalar-tizen-studio.bat` (doble clic) y pasa al paso 2. Hace
lo mismo que los comandos de abajo, pero para Windows.

**En Mac/Linux**:

```bash
curl -fL -o web-cli_Tizen_Studio_6.0_macos-64.bin "https://download.tizen.org/sdk/Installer/tizen-studio_6.0/web-cli_Tizen_Studio_6.0_macos-64.bin"
chmod +x web-cli_Tizen_Studio_6.0_macos-64.bin
./web-cli_Tizen_Studio_6.0_macos-64.bin --accept-license --no-java-check "$HOME/tizen-studio"
echo 'export PATH="$HOME/tizen-studio/tools/ide/bin:$HOME/tizen-studio/tools:$PATH"' >> ~/.zshrc
# abre una terminal nueva, luego:
tizen certificate -a "El Buen Corte" -p 0000 -f ebcorte -c "CL"
tizen security-profiles add -n ebcorte -a "$HOME/tizen-studio-data/keystore/author/ebcorte.p12" -p 0000
tizen cli-config "profiles.path=$HOME/tizen-studio-data/profile/profiles.xml"
```

Verifica que haya quedado bien:

```bash
tizen version
sdb version
```

### 2. Conecta tu notebook a la wifi del local

Debe ser la misma red a la que vas a conectar la TV.

### 3. Activa el Modo Desarrollador en la TV

1. En el control remoto, ve a **Apps**.
2. Presiona el ícono de engranaje (Settings) arriba a la derecha, o usa el botón **123** del control para
   abrir un teclado numérico.
3. Escribe **12345**.
4. En el popup que aparece, activa **Developer mode**.
5. Ingresa la **IP de tu notebook** (la de la wifi del local, no la de tu casa — revisa con
   `ipconfig getifaddr en0` en Mac).
6. Acepta y reinicia la TV cuando lo pida (mantén apretado el botón de encendido del control 2 segundos).
7. Al volver a encender, debería aparecer "Developer Mode" en rojo arriba de la pantalla de Apps.

### 4. Anota la IP de la TV

En la TV: **Configuración → General → Red → Estado de la red** (o similar, varía un poco según el modelo)
para ver su dirección IP.

### 5. Asegúrate de que el servidor esté corriendo

En el PC/mini PC que va a quedar como servidor (puede ser este mismo notebook, por ahora, ya que es
"temporal"):

```bash
cd "Anuncios en pantalla"
npm start
```

Anota la IP de **esa** máquina (si es el mismo notebook con el que vas a instalar la app, es la misma IP
del paso 3).

### 6. Instala y abre la app en la TV

Lo más simple es usar el botón "Instalar en TV Samsung" del panel admin (funciona igual en Windows, Mac
o Linux). Si prefieres hacerlo a mano desde la terminal (Mac/Linux), desde esta carpeta (`tizen-app/`):

```bash
./deploy-to-tv.sh <IP-de-la-TV> <IP-del-servidor>
```

Ejemplo, si ambos son el mismo notebook en la wifi del local con IP `192.168.1.50` y la TV quedó en
`192.168.1.42`:

```bash
./deploy-to-tv.sh 192.168.1.42 192.168.1.50
```

Al final del proceso, la app queda instalada; ábrela desde el menú **Apps** de la TV (ícono "Cartelera El
Buen Corte") o déjala abierta si `tizen run` la lanzó sola.

### Problemas comunes

- **"No se encontró la TV conectada"**: revisa que el Modo Desarrollador siga activo (a veces se
  desactiva solo tras una actualización de firmware) y que la IP de la TV no haya cambiado.
- **El perfil de firma "ebcorte" no existe**: créalo una sola vez con:
  ```bash
  tizen certificate -a "El Buen Corte" -p 0000 -f ebcorte -c "CL"
  tizen security-profiles add -n ebcorte -a "$HOME/tizen-studio-data/keystore/author/ebcorte.p12" -p 0000
  ```
- **Quieres apuntar la app a otro servidor más adelante** (por ejemplo, cuando quede instalado de forma
  permanente en el PC del POS): vuelve a correr `deploy-to-tv.sh` con la nueva IP, o edita directamente
  `PLAYER_URL` en `index.html` y reinstala.
