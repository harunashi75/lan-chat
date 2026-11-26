// Electron main process: windows, menu and app lifecycle.
// Screen capture lives in electron/capture.js and the embedded server in electron/server.js.
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('node:path');
const { startServer, stopServer } = require('./electron/server');
const { installCapture, closePendingPickers } = require('./electron/capture');

const APP_ICON = path.join(__dirname, 'assets', 'icon.png');
const SECURE_WEB_PREFERENCES = { contextIsolation: true, nodeIntegration: false, sandbox: true };

let mainWindow;
let store;
let trustedOrigin;

// Report renderer/GPU failures separately from an ordinary window closure.
app.on('child-process-gone', (_event, details) => {
  if (details.reason !== 'clean-exit') console.error('[Processus Electron arrêté]', details);
});
app.on('web-contents-created', (_event, contents) => {
  contents.on('render-process-gone', (_event, details) => {
    console.error('[Rendu Electron arrêté]', details);
  });
});
app.on('will-quit', () => console.info('[LAN Chat] Fermeture de l’application.'));

function validatedUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Adresse HTTP(S) attendue');
  }
  return url;
}

// ---- Windows ---------------------------------------------------------------

async function createMainWindow() {
  const previousWindow = mainWindow;
  const target = store.get('user_role') === 'host'
    ? await startServer()
    : validatedUrl(store.get('remote_url')).href;
  trustedOrigin = new URL(target).origin;

  mainWindow = new BrowserWindow({
    width: 1280, height: 850, title: 'LAN Chat', icon: APP_ICON, autoHideMenuBar: true,
    webPreferences: SECURE_WEB_PREFERENCES
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== trustedOrigin) event.preventDefault();
  });
  await mainWindow.loadURL(target);
  if (previousWindow && !previousWindow.isDestroyed()) previousWindow.close();
}

function createSetupWindow() {
  const win = new BrowserWindow({
    width: 500, height: 440, title: 'Configuration · LAN Chat', icon: APP_ICON, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'desktop-preload.js'), ...SECURE_WEB_PREFERENCES }
  });
  win.loadFile('setup.html');
}

// Host or client choice from the setup window. Refused for any other page.
ipcMain.handle('save-role', async (event, data) => {
  const url = event.sender.getURL();
  if (!url.startsWith('file:') || !url.endsWith('/setup.html')) return { error: 'Accès refusé' };
  try {
    if (!['host', 'client'].includes(data.role)) throw new Error('Rôle invalide');
    if (data.role === 'client') store.set('remote_url', validatedUrl(data.url).href);
    store.set('user_role', data.role);
    await createMainWindow();
    BrowserWindow.fromWebContents(event.sender)?.close();
    return {};
  } catch (error) {
    return { error: error.message };
  }
});

// ---- Lifecycle -------------------------------------------------------------

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: 'LAN Chat',
    submenu: [
      { label: 'Changer de salon', click: () => createSetupWindow() },
      {
        label: 'État du GPU',
        click: () => dialog.showMessageBox({ message: JSON.stringify(app.getGPUFeatureStatus(), null, 2) })
      },
      { role: 'quit' }
    ]
  }]));
}

app.whenReady().then(async () => {
  const { default: Store } = await import('electron-store'); // ESM-only package
  store = new Store();
  installCapture({ getMainWindow: () => mainWindow, getTrustedOrigin: () => trustedOrigin });
  buildMenu();
  try {
    if (store.get('user_role')) await createMainWindow();
    else createSetupWindow();
  } catch (error) {
    dialog.showErrorBox('Démarrage impossible', error.message);
    createSetupWindow();
  }
});

app.on('before-quit', () => {
  closePendingPickers();
  stopServer();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createSetupWindow(); });
