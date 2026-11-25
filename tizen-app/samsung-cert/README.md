# Certificado de firma Samsung (ligado a una TV específica)

Las Smart TV Samsung reales (a diferencia del emulador) exigen que la app esté firmada
con un certificado **de Samsung** que incluya el DUID (ID único) de la TV destino — un
certificado genérico creado con `tizen certificate` nunca instala en hardware real, por
más que el empaquetado y el resto del flujo funcionen sin error.

- `author.p12` / `distributor.p12`: el par de certificados generados una sola vez con la
  herramienta **Certificate Manager** de Samsung (dentro de Tizen Studio), iniciando
  sesión con la cuenta Samsung del negocio (`mfnc1996@gmail.com`) y agregando el DUID de
  la TV del mostrador del local (`MTCNLQ72NZER6`).
- Contraseña de ambos: `Ebcorte2026` (hardcodeada en `server/routes/tizen.js`, igual que
  el `0000` que ya se usaba para el certificado genérico — no es una contraseña de
  cuenta, solo protege estos dos archivos de firma).

El código (`ensureCertificateAndProfile` en `server/routes/tizen.js`) registra estos
mismos archivos como el perfil de firma en cualquier PC donde se instale la app — así no
hay que repetir el proceso de Certificate Manager + login en cada PC nuevo.

## Si se agrega una TV nueva (DUID distinto)

Este certificado **solo instala en la TV cuyo DUID fue agregado al generarlo**. Para una
segunda TV hace falta:

1. Sacar su DUID: en la TV, **Menú → Soporte → Contactar a Samsung → ID único del
   dispositivo** (o **Menú → Soporte → Acerca de esta TV → ID de dispositivo único**).
2. Abrir el Certificate Manager de Tizen Studio (en cualquier PC con el SDK instalado:
   `tizen-studio/tools/certificate-manager/certificate-manager.app` en Mac, o el
   ejecutable equivalente en Windows) y **editar este mismo perfil** (no crear uno
   nuevo) agregando el DUID nuevo a la lista de dispositivos del certificado
   distribuidor — un mismo certificado puede cubrir varias TVs a la vez.
3. Reemplazar `distributor.p12` en esta carpeta por el que resulte, y volver a empaquetar
   el instalador.
