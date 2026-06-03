const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

const dbPath = () => path.join(app.getPath("userData"), "delpa-gestion-db.json");
const backupDir = () => path.join(app.getPath("userData"), "backups");

function ensureFiles() {
  if (!fs.existsSync(backupDir())) fs.mkdirSync(backupDir(), { recursive: true });
  if (!fs.existsSync(dbPath())) {
    fs.writeFileSync(dbPath(), JSON.stringify({
      productos: [],
      ventas: [],
      gastos: [],
      proveedores: [],
      compras: [],
      pagosProveedor: [],
      cierres: [],
      movimientos: []
    }, null, 2));
  }
}

function createBackup() {
  ensureFiles();
  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(backupDir(), `backup-${stamp}.json`);
  fs.copyFileSync(dbPath(), file);
  return file;
}

function createWindow() {
  ensureFiles();
  createBackup();

  const win = new BrowserWindow({
    width: 1450,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: "DELPA Gestión PRO",
    autoHideMenuBar: true,
    backgroundColor: "#070707",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadURL("http://localhost:3000");
}

ipcMain.handle("db:load", () => {
  ensureFiles();
  return JSON.parse(fs.readFileSync(dbPath(), "utf-8"));
});

ipcMain.handle("db:save", (event, data) => {
  ensureFiles();
  fs.writeFileSync(dbPath(), JSON.stringify(data, null, 2));
  return true;
});

ipcMain.handle("db:backup", () => {
  return createBackup();
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});