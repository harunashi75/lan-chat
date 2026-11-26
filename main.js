const { app, BrowserWindow, ipcMain, session, desktopCapturer, dialog, Menu } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

// Keep Chromium's GPU defaults. The actual encoder is visible in video diagnostics.
const APP_ICON = path.join(__dirname,'assets','icon.png');
let mainWindow;
let pythonProcess;
let store;
let trustedOrigin;
const pendingPickers = new Map();

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
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Adresse HTTP(S) attendue');
  return url;
}

function installPermissions() {
  const ses = session.defaultSession;
  const trusted = value => {
    try { return new URL(value).origin === trustedOrigin; } catch { return false; }
  };
  ses.setPermissionCheckHandler((contents, permission, origin) =>
    contents === mainWindow?.webContents && trusted(origin) && ['media','display-capture','fullscreen'].includes(permission));
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(contents === mainWindow?.webContents && trusted(details.requestingUrl || contents.getURL()) &&
      ['media','display-capture','fullscreen'].includes(permission));
  });
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!trusted(request.securityOrigin)) { callback({}); return; }
    try {
      const sources = await desktopCapturer.getSources({types:['screen','window'],
        thumbnailSize:{width:320,height:180},fetchWindowIcons:false});
      if (!sources.length) { callback({}); return; }
      const selection = await chooseSource(sources, request.audioRequested);
      if (!selection) { callback({}); return; }
      const options = {video:selection.source};
      // Electron's documented desktop audio loopback is supported on Windows.
      // Other platforms use the system picker when it supports audio capture.
      if (selection.audio && request.audioRequested && process.platform === 'win32') options.audio = 'loopback';
      callback(options);
    } catch (error) { console.error('Capture', error); callback({}); }
  }, {useSystemPicker:true});
}

function chooseSource(sources, audioRequested) {
  return new Promise(resolve => {
    const picker = new BrowserWindow({parent:mainWindow,modal:true,width:850,height:620,
      title:'Choisir un écran ou une fenêtre',autoHideMenuBar:true,
      webPreferences:{preload:path.join(__dirname,'desktop-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    const pickerId = picker.webContents.id;
    const finish = value => {
      if (!pendingPickers.has(pickerId)) return;
      pendingPickers.delete(pickerId);
      resolve(value);
    };
    pendingPickers.set(picker.webContents.id,{sources,audioRequested,finish,picker});
    picker.on('closed', () => finish(null));
    picker.loadFile('capture-picker.html');
  });
}

ipcMain.handle('capture-sources', event => {
  const pending = pendingPickers.get(event.sender.id);
  if (!pending) return null;
  return {audioAvailable:pending.audioRequested && process.platform === 'win32',
    sources:pending.sources.map(source => ({id:source.id,name:source.name,thumbnail:source.thumbnail.toDataURL()}))};
});
ipcMain.handle('capture-select', (event, selection) => {
  const pending = pendingPickers.get(event.sender.id);
  if (!pending) return;
  const source = pending.sources.find(item => item.id === selection?.id);
  pending.finish(source ? {source,audio:selection.audio === true} : null);
  pending.picker.close();
});

// Packaged app: the frozen server shipped in resources/server. Development: .venv + server.py.
function serverCommand() {
  if (app.isPackaged) {
    const exe = process.platform === 'win32' ? 'lan-chat-server.exe' : 'lan-chat-server';
    const command = path.join(process.resourcesPath, 'server', exe);
    if (!fs.existsSync(command)) throw new Error('Serveur intégré introuvable : réinstallez LAN Chat.');
    return {command, args: [], cwd: path.dirname(command)};
  }
  const python = process.platform === 'win32'
    ? path.join(__dirname,'.venv','Scripts','python.exe')
    : path.join(__dirname,'.venv','bin','python');
  if (!fs.existsSync(python)) throw new Error('Lancez start.sh (Linux/macOS) ou start.bat (Windows) une première fois pour préparer Python.');
  return {command: python, args: [path.join(__dirname,'server.py')], cwd: __dirname};
}

async function startServer() {
  const {command, args, cwd} = serverCommand();
  const port = process.env.LAN_CHAT_PORT || '8765';
  const address = `http://localhost:${port}`;
  try {
    const response = await fetch(`${address}/config`, {signal:AbortSignal.timeout(700)});
    if (response.ok && (await response.json()).mediaTopology === 'mesh') return address;
    throw new Error('Ce port est occupé par un autre service.');
  } catch (error) { if (error.message.includes('occupé')) throw error; }
  pythonProcess = spawn(command,args,{stdio:'inherit',cwd});
  let failure;
  pythonProcess.once('error', error => { failure = error; });
  for (let attempt=0; attempt<60; attempt++) {
    if (failure || pythonProcess.exitCode !== null) throw failure || new Error('Le serveur Python s’est arrêté.');
    try {
      const response = await fetch(`${address}/config`, {signal:AbortSignal.timeout(500)});
      if (response.ok) return address;
    } catch { /* serveur pas encore prêt */ }
    await new Promise(resolve => setTimeout(resolve,200));
  }
  throw new Error('Le serveur ne répond pas.');
}

async function createMainWindow() {
  const previousWindow = mainWindow;
  const target = store.get('user_role') === 'host' ? await startServer() : validatedUrl(store.get('remote_url')).href;
  trustedOrigin = new URL(target).origin;
  mainWindow = new BrowserWindow({width:1280,height:850,title:'LAN Chat',icon:APP_ICON,autoHideMenuBar:true,
    webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  mainWindow.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  mainWindow.webContents.on('will-navigate',(event,url) => {
    if (new URL(url).origin !== trustedOrigin) event.preventDefault();
  });
  await mainWindow.loadURL(target);
  if (previousWindow && !previousWindow.isDestroyed()) previousWindow.close();
}

function createSetupWindow() {
  const win = new BrowserWindow({width:500,height:440,title:'Configuration · LAN Chat',icon:APP_ICON,autoHideMenuBar:true,
    webPreferences:{preload:path.join(__dirname,'desktop-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.loadFile('setup.html');
}

ipcMain.handle('save-role', async (event,data) => {
  if (!event.sender.getURL().startsWith('file:') || !event.sender.getURL().endsWith('/setup.html')) return {error:'Accès refusé'};
  try {
    if (!['host','client'].includes(data.role)) throw new Error('Rôle invalide');
    if (data.role === 'client') store.set('remote_url', validatedUrl(data.url).href);
    store.set('user_role',data.role);
    await createMainWindow();
    BrowserWindow.fromWebContents(event.sender)?.close();
    return {};
  } catch (error) { return {error:error.message}; }
});

app.whenReady().then(async () => {
  const {default:Store} = await import('electron-store');
  store = new Store();
  installPermissions();
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'LAN Chat',submenu:[
    {label:'Changer de salon',click:() => createSetupWindow()},
    {label:'État du GPU',click:() => dialog.showMessageBox({message:JSON.stringify(app.getGPUFeatureStatus(),null,2)})},
    {role:'quit'}
  ]}]));
  try {
    if (store.get('user_role')) await createMainWindow();
    else createSetupWindow();
  } catch (error) { dialog.showErrorBox('Démarrage impossible',error.message); createSetupWindow(); }
});
app.on('before-quit', () => {
  for (const pending of pendingPickers.values()) pending.picker.close();
  if (pythonProcess) pythonProcess.kill();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createSetupWindow(); });
