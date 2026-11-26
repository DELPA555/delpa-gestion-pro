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

## Licencias y panel admin (v1.54.0)

El servidor valida licencias por `hwid`. La app consulta `GET /license/:hwid` al arrancar
(fail-open: si el VPS no responde, usa la licencia/prueba local; nunca bloquea por falta de red).

**Panel admin** (`admin.html`): generá/activá licencias y gestioná clientes. Protegido por un
**secreto de admin** (header `X-Delpa-Admin`) **distinto** del secreto de los pings y que **NO**
está en la app ni en el código de la página pública.

- El secreto de admin lo **genera `deploy.sh`** (se guarda en `/opt/delpa-portal/.admin_secret`
  y se **imprime al final del deploy**). Copialo: lo vas a pegar en el panel.
- **Subir el panel a GitHub Pages** (repo `delpa555.github.io`):
  ```bash
  # cloná el repo del sitio si no lo tenés local, copiá el admin.html y pusheá
  git clone https://github.com/DELPA555/delpa555.github.io.git
  cp tools/portal-server/admin.html delpa555.github.io/admin.html
  cd delpa555.github.io && git add admin.html && git commit -m "admin licencias conectado al VPS" && git push
  ```
- Abrí `https://delpa555.github.io/admin.html`, pegá el **secreto de admin** y listo: ves la lista
  de clientes, activás (1/3/6/12 meses) y desactivás. El secreto queda solo en la memoria del
  navegador (sessionStorage), nunca en el código de la página.

## Datos
- SQLite en `/opt/delpa-portal/data.db` (tabla `nodes`, una fila por instalación, por `hwid`).
- Cada instalación de DELPA que tenga un **PIN de portal configurado** manda un ping cada
  15 min con: nombre, CUIT, código de red, sucursal, snapshot de stock, ventas del día,
  caja y versión. Sin PIN de portal, **no** manda nada.
