# DELPA Gestión PRO — Herramientas de licencias

## Modelo de licencia: suscripción mensual

El código de activación incluye la **fecha de vencimiento** codificada internamente. Al vencer, el programa muestra un período de gracia de 3 días y luego bloquea el acceso hasta recibir un nuevo código.

### Formato del código

```
XXXXX-XXXXX-XXXXX-XXXXX  (20 caracteres hexadecimales)
│           │
│           └── 12 chars: firma HMAC vinculada al Hardware ID
└───────────── 8 chars: fecha de vencimiento (YYYYMMDD en hex)
```

---

## generate-license.js

### Modo interactivo

```
node tools/generate-license.js
```

Menú con opciones:
1. **Generar licencia** — pide HW ID, cantidad de meses (1/3/6/12), nombre del cliente
2. **Ver historial** — muestra las últimas 20 licencias del log
3. **Verificar código** — valida un código contra un HW ID
4. Salir

### Modo directo (scripting/automatización)

```
node tools/generate-license.js <HARDWARE_ID> <MESES> [NOMBRE_CLIENTE]
```

Ejemplos:
```bash
# 1 mes
node tools/generate-license.js A1B2C3D4E5F6 1 "Juan Pérez"

# 3 meses
node tools/generate-license.js A1B2C3D4E5F6 3 "Local El Centro"

# 12 meses sin nombre
node tools/generate-license.js A1B2C3D4E5F6 12
```

### Log de licencias

Cada licencia generada se registra en `tools/licenses-log.txt` con: fecha de generación, HW ID, cliente, meses, fecha de vencimiento y código.

---

## check-license.js

Verifica si un código es válido para un Hardware ID y muestra la fecha de vencimiento.

```
node tools/check-license.js <HARDWARE_ID> <LICENSE_CODE>
```

**Códigos de salida:**
- `0` → válida y vigente
- `1` → inválida (firma incorrecta)
- `2` → válida pero vencida

Ejemplo:
```
node tools/check-license.js A1B2C3D4E5F6 01401D6F-4F7A2B9C-1E3D5A7B
```

---

## Comportamiento del sistema en el cliente

| Estado | Días desde vencimiento | Acción |
|--------|----------------------|--------|
| Activa | — | Normal |
| Advertencia | -7 a 0 días restantes | Banner amarillo + email automático |
| Urgente | ≤ 3 días restantes | Banner rojo + badge en TitleBar |
| Gracia | 0–3 días vencida | Banner rojo, acceso permitido, email automático |
| Bloqueada | > 3 días vencida | Pantalla de activación |

---

## Cómo obtener el Hardware ID del cliente

En la aplicación DELPA Gestión PRO:  
**Configuración → Licencia → Hardware ID de esta PC**

El cliente envía ese ID, el operador genera el código y se lo devuelve.
