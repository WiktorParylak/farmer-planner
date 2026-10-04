const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const DiscordPresence = require('./discord-presence');

// Discord "application" id for Rich Presence. Create one (free) at
// https://discord.com/developers/applications — the app name shown on the
// profile is the application's name, and you can upload a 512x512 art asset
// there named "logo" to get the game icon (see largeImageKey in renderer.js).
// Leave as-is / empty to disable the integration entirely.
const DISCORD_CLIENT_ID = process.env.FARMER_PLANNER_DISCORD_ID || '1546951675217182821';

const discordPresence = new DiscordPresence(DISCORD_CLIENT_ID);

// --- Where the user's farms live ---------------------------------------------
// Kept under Documents\Farmer Planner (not AppData) so people can find, copy
// and sync their data without digging through hidden folders. Resolved once the
// app is ready; the renderer asks for it via the synchronous 'get-data-dir'
// IPC below.
let dataDir = null;

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(from, to);
    else if (!fs.existsSync(to)) fs.copyFileSync(from, to);
  }
}

function resolveDataDir() {
  dataDir = path.join(app.getPath('documents'), 'Farmer Planner');
  try {
    fs.mkdirSync(dataDir, { recursive: true });

    // One-time migration from the old %APPDATA%\FarmerPlanner location. We copy
    // (not move) and leave a marker so the old folder stays as a safety net and
    // the migration never runs twice.
    const legacyDir = path.join(app.getPath('appData'), 'FarmerPlanner');
    const migratedMarker = path.join(dataDir, '.migrated-from-appdata');
    if (fs.existsSync(legacyDir) && !fs.existsSync(migratedMarker)) {
      copyDirRecursive(legacyDir, dataDir);
      fs.writeFileSync(migratedMarker, new Date().toISOString(), 'utf-8');
      console.log('Migrated farm data from', legacyDir, 'to', dataDir);
    }
  } catch (err) {
    console.error('Could not prepare data directory:', err);
  }
}

// Renderer resolves its data folder through this at startup (synchronous so the
// rest of renderer.js can stay simple).
ipcMain.on('get-data-dir', (event) => {
  event.returnValue = dataDir;
});

ipcMain.on('get-app-version', (event) => {
  event.returnValue = app.getVersion();
});

// Update popup -> release page in the browser. Only this repo's releases.
ipcMain.handle('open-release-page', (event, url) => {
  if (typeof url === 'string' && url.startsWith('https://github.com/WiktorParylak/farmer-planner/releases/')) {
    return shell.openExternal(url);
  }
  return null;
});

// Where we remember the window's last size/position/maximized state.
const stateFilePath = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  const defaults = { width: 1920, height: 1080, x: undefined, y: undefined, isMaximized: false };
  try {
    if (fs.existsSync(stateFilePath)) {
      const saved = JSON.parse(fs.readFileSync(stateFilePath, 'utf-8'));
      return { ...defaults, ...saved };
    }
  } catch (err) {
    console.error('Could not read saved window state, using defaults:', err);
  }
  return defaults;
}

function saveWindowState(win) {
  try {
    if (!win || win.isDestroyed()) return;
    const isMaximized = win.isMaximized();
    // getNormalBounds() gives the un-maximized size, so restoring later
    // doesn't leave you stuck at full-screen dimensions.
    const bounds = isMaximized ? win.getNormalBounds() : win.getBounds();

    fs.writeFileSync(stateFilePath, JSON.stringify({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized
    }, null, 2), 'utf-8');
  } catch (err) {
    console.error('Could not save window state:', err);
  }
}

function createWindow() {
  const state = loadWindowState();

  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#16261D',
    icon: path.join(__dirname, '..', '..', 'Assets', 'Logo.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  if (state.isMaximized) win.maximize();

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Debounce saving while the user is actively dragging/resizing.
  let saveTimeout = null;
  const scheduleSave = () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveWindowState(win), 400);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('close', () => saveWindowState(win));

  // Let the custom titlebar button swap its icon between "maximize" / "restore".
  win.on('maximize', () => win.webContents.send('window-maximized-change', true));
  win.on('unmaximize', () => win.webContents.send('window-maximized-change', false));

  ipcMain.on('window-minimize', () => win.minimize());
  ipcMain.on('window-maximize-toggle', () => {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window-close', () => win.close());

  // Native save/open dialogs — used for exporting/importing farm backups.
  ipcMain.handle('show-save-dialog', (event, options) => dialog.showSaveDialog(win, options));
  ipcMain.handle('show-open-dialog', (event, options) => dialog.showOpenDialog(win, options));
}

// --- Discord Rich Presence bridge ---
// The renderer knows what the user is doing (which farm, how many fields); it
// pushes a plain activity object here and the main process talks to Discord.
ipcMain.on('discord-presence:set', (event, activity) => {
  discordPresence.setActivity(activity);
});
ipcMain.on('discord-presence:clear', () => {
  discordPresence.clearActivity();
});

app.whenReady().then(() => {
  resolveDataDir();
  createWindow();
  discordPresence.connect();
});

app.on('before-quit', () => discordPresence.destroy());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
