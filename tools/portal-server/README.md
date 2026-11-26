# DELPA Portal central (servidor del VPS)

Servidor que recibe los pings de cada instalación de DELPA y sirve un **portal web de
solo lectura por negocio**, en una URL **fija**:

```
https://portal.delpagestion.com.ar/portal/<slug>
```

El `<slug>` se genera del nombre del negocio (ej. `petalo-rosa`) y lo devuelve el servidor
en la respuesta del `/ping`.

## Qué incluye
- `deploy.sh` — script **autónomo** que, corrido como root en el VPS, crea `/opt/delpa-portal/`
  con `server.js` + `package.json`, instala dependencias, configura **nginx**, saca el
  **SSL con certbot** y deja el server corriendo con **PM2**.

## Deploy (una sola vez, y de nuevo para actualizar)
En el VPS (Ubuntu 24.04, Node 20, nginx y PM2 ya instalados), como root:

```bash
# subir este folder al servidor
scp -r tools/portal-server root@206.189.193.230:/tmp/
# correr el deploy
ssh root@206.189.193.230 'bash /tmp/portal-server/deploy.sh'
```

Requisito: el DNS de `portal.delpagestion.com.ar` ya tiene que apuntar a la IP del VPS
(para que certbot pueda emitir el certificado).

Verificar: `curl -s https://portal.delpagestion.com.ar/` debe responder `DELPA Portal · OK`.

## Seguridad
- `/ping` exige el header `X-Delpa-Secret` (secreto compartido embebido en la app DELPA).
  **Si rotás el secreto, cambialo en los DOS lados**: `deploy.sh` (`PING_SECRET`) y
  `main/lib/centralPortalPing.js` (`PING_SECRET`) — y volvé a sacar un release de la app.
- El PIN de cada negocio se guarda **hasheado** (scrypt), nunca en texto plano.
- El login del portal tiene **bloqueo por intentos** (anti fuerza bruta). HTTPS vía Let's Encrypt.

## Datos
- SQLite en `/opt/delpa-portal/data.db` (tabla `nodes`, una fila por instalación, por `hwid`).
- Cada instalación de DELPA que tenga un **PIN de portal configurado** manda un ping cada
  15 min con: nombre, CUIT, código de red, sucursal, snapshot de stock, ventas del día,
  caja y versión. Sin PIN de portal, **no** manda nada.
