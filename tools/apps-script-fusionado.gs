/**
 * DELPA Gestion PRO - Apps Script FUSIONADO
 * ------------------------------------------------------------------
 * Panel admin + licencias + telemetria (script viejo, intacto)
 *   MAS red de locales (multi-nodo por CUIT, hoja "Red").
 *
 * Pega TODO este codigo en script.google.com (reemplazando el actual),
 * guarda y publica una NUEVA version de la Web App
 * (Implementar -> Administrar implementaciones -> Editar -> Nueva version).
 * La URL /exec NO cambia si editas la implementacion existente.
 *
 * NOTA: la hoja principal (telemetria/licencias) se toma como getSheets()[0]
 * en lugar de getActiveSheet(). Es la misma hoja de siempre (la primera),
 * pero asi no se rompe cuando el script crea la hoja "Red": al insertar una
 * hoja nueva Google la marca como activa, y con getActiveSheet() la proxima
 * ejecucion escribiria la telemetria en la hoja equivocada.
 */

const SHEET_ID = '1D2m462o0_VgMUOr6d9pCEAXcq0P-Cw-5b8Q4ujq_KpM';
const ADMIN_PASSWORD = 'delpa2026';
const LICENSE_SECRET = 'DELPA2024-PRO-LICENSE-KEY-v1';
const STOCK_FILE_ID = '1V0czSGrD_kGTqKLIcrO40XihljxzDQU-';

// Hoja de la red de locales (segunda hoja del Sheet).
const RED_SHEET = 'Red';
const RED_HEADERS = ['hwid', 'cuit', 'businessName', 'branchName', 'branchType', 'version', 'stockJson', 'updatedAt'];

// Hoja principal (telemetria/licencias): SIEMPRE la primera hoja del Sheet.
function getMainSheet_() {
  return SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
}

// Hoja de la red; la crea si no existe, y deja la hoja principal como activa
// para no alterar el comportamiento del resto del script.
function getRedSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(RED_SHEET);
  if (!sh) {
    sh = ss.insertSheet(RED_SHEET);
    sh.getRange(1, 1, 1, RED_HEADERS.length).setValues([RED_HEADERS]);
    ss.setActiveSheet(ss.getSheets()[0]); // restaurar activa = principal
  } else if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, RED_HEADERS.length).setValues([RED_HEADERS]);
  }
  return sh;
}

// Upsert de un nodo en la hoja "Red" por hwid. No toca la hoja principal.
function upsertRedNode_(data) {
  const sh = getRedSheet_();
  const lastRow = sh.getLastRow();
  let rowIndex = -1;
  let existing = null;
  if (lastRow > 1) {
    const hwids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < hwids.length; i++) {
      if (String(hwids[i][0]).trim() === String(data.hardwareId).trim()) { rowIndex = i + 2; break; }
    }
  }
  if (rowIndex > 0) {
    existing = sh.getRange(rowIndex, 1, 1, RED_HEADERS.length).getValues()[0];
  }

  // Si el ping trae stockSnapshot lo guardamos; si no, conservamos el anterior.
  let stockJson;
  if (data.stockSnapshot !== undefined && data.stockSnapshot !== null) {
    stockJson = JSON.stringify(data.stockSnapshot);
  } else {
    stockJson = existing ? existing[6] : '[]';
  }

  const row = [
    String(data.hardwareId || ''),
    String(data.cuit || (existing ? existing[1] : '') || ''),
    String(data.businessName || (existing ? existing[2] : '') || ''),
    String(data.branchName || (existing ? existing[3] : '') || ''),
    String(data.branchType || (existing ? existing[4] : '') || ''),
    String(data.version || (existing ? existing[5] : '') || ''),
    stockJson,
    new Date().toISOString()
  ];

  if (rowIndex > 0) {
    sh.getRange(rowIndex, 1, 1, RED_HEADERS.length).setValues([row]);
  } else {
    sh.appendRow(row);
  }
}

function generateLicenseCode(hardwareId, months) {
  const expDate = new Date();
  expDate.setMonth(expDate.getMonth() + parseInt(months));
  const payload = hardwareId + '|' + months + '|' + expDate.toISOString().split('T')[0];
  const signature = Utilities.computeHmacSha256Signature(payload, LICENSE_SECRET);
  const hex = signature.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('').toUpperCase();
  const clean = hex.replace(/[^A-Z0-9]/g, '').substring(0, 20);
  return clean.substring(0,5) + '-' + clean.substring(5,10) + '-' + clean.substring(10,15) + '-' + clean.substring(15,20);
}

function doOptions(e) {
  return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    const sheet = getMainSheet_();
    const data = JSON.parse(e.postData.contents);
    const now = new Date();
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Hardware ID','Negocio','Estado Licencia','Dias Restantes','Version','Ultima Vez','Ultima Venta']);
    }
    const values = sheet.getDataRange().getValues();
    let found = false;
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === data.hardwareId) {
        sheet.getRange(i+1,1,1,7).setValues([[data.hardwareId, data.businessName||'Sin nombre', data.licenseStatus||'trial', data.daysLeft||0, data.version||'1.0', now, data.lastSale||'']]);
        found = true; break;
      }
    }
    if (!found) sheet.appendRow([data.hardwareId, data.businessName||'Sin nombre', data.licenseStatus||'trial', data.daysLeft||0, data.version||'1.0', now, data.lastSale||'']);

    // --- Red de locales: si el ping trae CUIT, guardamos tambien en la hoja "Red".
    // Envuelto en su propio try para que un error de red NUNCA rompa la telemetria.
    try {
      if (data.hardwareId && String(data.cuit || '').trim()) {
        upsertRedNode_(data);
      }
    } catch(errRed) { /* ignorar: la telemetria ya se guardo */ }

    return ContentService.createTextOutput(JSON.stringify({ok:true})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  const cb = e.parameter.callback;
  function respond(data) {
    const json = JSON.stringify(data);
    if (cb) return ContentService.createTextOutput(cb + '(' + json + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
    return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
  }
  if (e.parameter.action === 'getStock') {
    try {
      const fileId = e.parameter.fileId || STOCK_FILE_ID;
      const file = DriveApp.getFileById(fileId);
      const content = file.getBlob().getDataAsString();
      if (cb) return ContentService.createTextOutput(cb + '(' + content + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
      return ContentService.createTextOutput(content).setMimeType(ContentService.MimeType.JSON);
    } catch(err) {
      return respond({error: err.message});
    }
  }

  // --- Red de locales: stock unificado de todos los nodos con el mismo CUIT.
  // Sin contrasena (lo consume cada instalacion cliente).
  if (e.parameter.action === 'getNetwork') {
    try {
      const cuit = String(e.parameter.cuit || '').trim();
      if (!cuit) return respond({ok:false, error:'cuit requerido'});
      const sh = getRedSheet_();
      const lastRow = sh.getLastRow();
      const nodes = [];
      if (lastRow > 1) {
        const rows = sh.getRange(2, 1, lastRow - 1, RED_HEADERS.length).getValues();
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          if (String(r[1]).trim() !== cuit) continue; // columna cuit
          let stock = [];
          try { stock = JSON.parse(r[6] || '[]'); } catch(_) { stock = []; }
          nodes.push({
            hwid: String(r[0]),
            branchName: String(r[3] || r[2] || ''),
            branchType: String(r[4] || ''),
            version: String(r[5] || ''),
            updatedAt: String(r[7] || ''),
            stock: stock
          });
        }
      }
      return respond({ok:true, cuit: cuit, nodes: nodes});
    } catch(err) {
      return respond({ok:false, error: err.message});
    }
  }

  if (e.parameter.pass !== ADMIN_PASSWORD) {
    return respond({error: 'No autorizado'});
  }
  if (e.parameter.action === 'generateLicense') {
    const hardwareId = e.parameter.hardwareId;
    const months = parseInt(e.parameter.months) || 1;
    if (!hardwareId) return respond({error: 'Falta hardwareId'});
    const code = generateLicenseCode(hardwareId, months);
    const expDate = new Date();
    expDate.setMonth(expDate.getMonth() + months);
    const sheet = getMainSheet_();
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (values[i][0] === hardwareId) {
        sheet.getRange(i+1,8).setValue(code);
        sheet.getRange(i+1,9).setValue(expDate.toLocaleDateString('es-AR'));
        break;
      }
    }
    return respond({ok:true, code, expires: expDate.toLocaleDateString('es-AR'), months});
  }
  try {
    const sheet = getMainSheet_();
    const values = sheet.getDataRange().getValues();
    if (values.length <= 1) return respond({clients:[],total:0,activos:0,vencidos:0,porVencer:0});
    const clients = [];
    for (let i = 1; i < values.length; i++) {
      if (!values[i][0]) continue;
      const daysLeft = parseInt(values[i][3]) || 0;
      const lastSeen = values[i][5] ? new Date(values[i][5]).toLocaleString('es-AR') : 'Nunca';
      clients.push({
        hardwareId: values[i][0],
        businessName: values[i][1],
        licenseStatus: values[i][2],
        daysLeft,
        version: values[i][4],
        lastSeen,
        lastSale: values[i][6],
        alert: daysLeft<=0 ? 'vencido' : daysLeft<=7 ? 'vence_pronto' : 'ok'
      });
    }
    clients.sort((a,b) => a.daysLeft - b.daysLeft);
    return respond({
      clients,
      total: clients.length,
      activos: clients.filter(c=>c.daysLeft>0).length,
      vencidos: clients.filter(c=>c.daysLeft<=0).length,
      porVencer: clients.filter(c=>c.daysLeft>0&&c.daysLeft<=7).length
    });
  } catch(err) {
    return respond({error: err.message});
  }
}

function enviarAlertas() {
  const sheet = getMainSheet_();
  const values = sheet.getDataRange().getValues();
  const porVencer = [];
  for (let i = 1; i < values.length; i++) {
    const days = parseInt(values[i][3]) || 0;
    if (days > 0 && days <= 7) porVencer.push({negocio: values[i][1], days, hardwareId: values[i][0]});
  }
  if (porVencer.length === 0) return;
  let body = '<h2>Clientes con licencia por vencer</h2><table border="1"><tr><th>Negocio</th><th>Dias restantes</th><th>Hardware ID</th></tr>';
  porVencer.forEach(c => { body += '<tr><td>' + c.negocio + '</td><td style="color:red"><b>' + c.days + '</b></td><td>' + c.hardwareId + '</td></tr>'; });
  body += '</table>';
  MailApp.sendEmail({to:'delpa555@gmail.com', subject:'DELPA - Licencias por vencer (' + porVencer.length + ' clientes)', htmlBody: body});
}
