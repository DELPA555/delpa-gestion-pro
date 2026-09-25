// Guías paso a paso para usuarios sin conocimientos técnicos.
// Cada paso: { icon, title, body, warn?, tip?, action? }

export const EMAIL_GUIDE = {
  headerIcon: '📧',
  title: 'Cómo configurar tu Gmail en DELPA',
  subtitle: 'Seguí estos pasos. No necesitás saber de informática.',
  finishLabel: '✅ Entendido, voy a configurarlo',
  steps: [
    {
      icon: '🌐',
      title: 'Abrí la configuración de Google',
      body: 'En tu celular o computadora, abrí Chrome (o cualquier navegador) y entrá a:\n\nmyaccount.google.com\n\nTenés que estar con la cuenta de Gmail que querés usar para que DELPA te mande los informes.',
    },
    {
      icon: '🔒',
      title: "Hacé click en 'Seguridad'",
      body: "En el menú de la izquierda vas a ver varias opciones. Buscá la que dice 'Seguridad' y hacé click ahí.",
    },
    {
      icon: '📱',
      title: 'Activá la verificación en 2 pasos',
      body: "Buscá donde dice 'Verificación en 2 pasos'. Si dice 'Desactivada', hacé click y seguí los pasos que te pide Google para activarla.",
      warn: 'Este paso es obligatorio. Sin la verificación en 2 pasos, Google no te deja crear la contraseña para DELPA.',
    },
    {
      icon: '🔑',
      title: "Buscá 'Contraseñas de aplicaciones'",
      body: "Dentro de la misma sección de Seguridad, buscá donde dice 'Contraseñas de aplicaciones'.",
      tip: 'Si no aparece, entrá directamente escribiendo en el navegador: myaccount.google.com/apppasswords',
    },
    {
      icon: '✏️',
      title: 'Creá la contraseña para DELPA',
      body: "Va a aparecer un campo que dice 'Nombre de la app' o 'Seleccionar app'. Elegí 'Otra (nombre personalizado)' y escribí: DELPA\n\nDespués hacé click en el botón 'Crear' o 'Generar'.",
    },
    {
      icon: '📋',
      title: 'Copiá las 16 letras que aparecen',
      body: 'Google te va a mostrar una contraseña de 16 letras y números, en grupos de 4. Por ejemplo: xxxx xxxx xxxx xxxx',
      warn: 'Copiá esas 16 letras AHORA. Google solo las muestra una vez. Si cerrás la pantalla sin copiarlas, tenés que generar una nueva.',
    },
    {
      icon: '💻',
      title: 'Pegá las letras en DELPA',
      body: "Volvé a DELPA → Configuración → Email.\n\n• En 'Usuario Gmail' escribí tu dirección de Gmail.\n• En 'Contraseña de aplicación' pegá las 16 letras que copiaste (sin espacios).\n• En 'Email destinatario' poné la dirección donde querés recibir los resúmenes.\n\nDespués hacé click en 'Guardar'.",
    },
    {
      icon: '✅',
      title: 'Probá que funcione',
      body: "Hacé click en el botón 'Probar envío'. Si todo salió bien, vas a recibir un email de prueba en tu casilla en unos segundos.",
      tip: 'Si no llega, revisá que las 16 letras estén bien pegadas, sin espacios al principio ni al final.',
    },
  ],
}

export const AFIP_GUIDE = {
  headerIcon: '🧾',
  title: 'Cómo conectar DELPA con AFIP',
  subtitle: 'Para emitir facturas electrónicas. La parte técnica la hacemos nosotros — vos solo seguí estos pasos.',
  finishLabel: '✅ Entendido',
  steps: [
    {
      icon: '🔑',
      title: 'Necesitás Clave Fiscal nivel 3 en AFIP',
      body: 'Antes de empezar, verificá que podés entrar a afip.gob.ar con tu Clave Fiscal.\n\nSi no tenés Clave Fiscal, o es de nivel 1 o 2, tenés que subirla a nivel 3. Se hace desde el cajero automático de tu banco, o yendo a una agencia de AFIP con tu DNI.',
      tip: 'Si nunca lo hiciste, pedile a tu contador que te ayude con este paso.',
    },
    {
      icon: '📞',
      title: 'Avisanos que querés facturar',
      body: 'La parte técnica (el certificado y la conexión con AFIP) la configura DELPA por vos. No tenés que generar ni subir ningún archivo.\n\nEscribinos por WhatsApp al 11 3857-4444 y coordinamos la activación de la facturación para tu negocio. Te guiamos en el momento.',
      tip: 'Es un trámite que se hace una sola vez. Después las facturas salen solas.',
    },
    {
      icon: '🗂️',
      title: 'Tené a mano estos datos',
      body: 'Cuando nos escribas, tené a mano:\n\n• Tu CUIT\n• El punto de venta habilitado en AFIP (normalmente 1 o 2)\n• Tu régimen: Monotributo o Responsable Inscripto\n• Si sos Monotributo, tu categoría (A, B, C...). Si sos Responsable Inscripto, la alícuota de IVA (21%, 10,5% o 27%).',
      tip: 'Si no sabés tu punto de venta o tu categoría, tu contador los tiene.',
    },
    {
      icon: '⚙️',
      title: 'Cargá tus datos en DELPA',
      body: 'Una vez activada la conexión, completá acá en Configuración → AFIP:\n\n• Ambiente: dejá "Testing" para hacer pruebas, o "Producción" para facturar de verdad.\n• Punto de venta: el número habilitado en AFIP.\n• Régimen fiscal: Monotributo o Responsable Inscripto (y la categoría o alícuota).\n\nDespués hacé click en "Guardar configuración AFIP".',
    },
    {
      icon: '✅',
      title: 'Probá que la conexión funcione',
      body: 'Hacé click en el botón "Probar conexión".\n\nSi todo está bien, arriba vas a ver "Autenticado con AFIP" en verde.',
      warn: 'Si aparece un error, revisá que el punto de venta y el régimen sean correctos. Si sigue fallando, llamanos al 11 3857-4444 y lo resolvemos con vos.',
    },
    {
      icon: '🎉',
      title: '¡Ya podés facturar con AFIP!',
      body: 'A partir de ahora, cuando hagas una venta y toques el botón "FACTURAR", DELPA se conecta con AFIP y genera la factura electrónica con CAE automáticamente.\n\nNo necesitás hacer nada más — funciona solo.',
    },
  ],
}
