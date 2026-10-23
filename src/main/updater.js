// In-app update: downloads the release's own installer ("Farmer Planner Setup
// X.Y.Z.exe") from GitHub into %TEMP%\Farmer Planner update and starts it with
// --update; the installer (installer/Setup.cs) backs up the app folder, runs
// NSIS and puts the old version back if anything fails.
//
// Safeguards: the file is written as .part and renamed only when its size (and
// the sha256 GitHub reports for the asset, when it does) match; no data for
// 30 s aborts a try, two more tries follow; any failure deletes the partial
// file and the app keeps running.
const { app, ipcMain } = require('electron');
const https = require('https');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');

const UPDATE_DIR = path.join(os.tmpdir(), 'Farmer Planner update');
// Only this repository's release downloads are fetched.
const DOWNLOAD_PREFIX = 'https://github.com/WiktorParylak/farmer-planner/releases/download/';
const STALL_MS = 30000;
const TRIES = 3;
const MAX_REDIRECTS = 5;

let current = null;   // { cancelled, req }

function installerPath(version) {
  return path.join(UPDATE_DIR, `Farmer Planner Setup ${version}.exe`);
}

function freeBytes(dir) {
  try {
    const s = fs.statfsSync(dir);
    return s.bavail * s.bsize;
  } catch (err) {
    return Infinity;   // unknown: don't block the update on it
  }
}

// One GET into `dest`, following GitHub's redirect to its file host.
function fetchTo(url, dest, onData, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (!/^https:\/\//i.test(url)) { reject(new Error('insecure redirect')); return; }
    const req = https.get(url, { headers: { 'User-Agent': 'Farmer-Planner/' + app.getVersion(), Accept: 'application/octet-stream' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) { reject(new Error('too many redirects')); return; }
        fetchTo(new URL(res.headers.location, url).toString(), dest, onData, redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      const out = fs.createWriteStream(dest);
      res.on('data', chunk => onData(chunk));
      res.on('error', reject);
      out.on('error', reject);
      out.on('finish', resolve);
      res.pipe(out);
    });
    req.setTimeout(STALL_MS, () => req.destroy(new Error('stalled')));
    req.on('error', reject);
    if (current) current.req = req;
  });
}

// (Allowed from source too — only starting the installer needs the installed app.)
async function download(event, { version, url, size, digest }) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) return { ok: false, reason: 'bad' };
  if (typeof url !== 'string' || !url.startsWith(DOWNLOAD_PREFIX + 'v' + version + '/')) return { ok: false, reason: 'bad' };
  const expectedSize = Number(size) || 0;
  const expectedSha = typeof digest === 'string' && /^sha256:[0-9a-f]{64}$/i.test(digest) ? digest.slice(7).toLowerCase() : null;
  if (current) return { ok: false, reason: 'busy' };

  try { fs.mkdirSync(UPDATE_DIR, { recursive: true }); } catch (err) { return { ok: false, reason: 'disk', detail: err.message }; }
  if (expectedSize && freeBytes(UPDATE_DIR) < expectedSize * 3) return { ok: false, reason: 'space' };

  const final = installerPath(version);
  const part = final + '.part';
  current = { cancelled: false, req: null };
  let lastError = null;
  try {
    for (let attempt = 1; attempt <= TRIES && !current.cancelled; attempt++) {
      const hash = crypto.createHash('sha256');
      let received = 0;
      let lastSent = 0;
      try {
        await fetchTo(url, part, chunk => {
          hash.update(chunk);
          received += chunk.length;
          const now = Date.now();
          if (now - lastSent > 100) {
            lastSent = now;
            if (!event.sender.isDestroyed()) event.sender.send('update-progress', { received, total: expectedSize });
          }
        });
        if (current.cancelled) break;
        if (expectedSize && received !== expectedSize) throw new Error(`size ${received} instead of ${expectedSize}`);
        if (expectedSha && hash.digest('hex') !== expectedSha) {
          // The whole file came, but not the right one: another try won't help.
          const err = new Error('sha256 mismatch');
          err.final = true;
          throw err;
        }
        try { fs.rmSync(final, { force: true }); } catch (e) { /* replaced below */ }
        fs.renameSync(part, final);
        return { ok: true };
      } catch (err) {
        lastError = err;
        console.warn(`Update download try ${attempt} failed:`, err.message);
        try { fs.rmSync(part, { force: true }); } catch (e) { /* nothing to clean */ }
        if (err.final) break;
      }
    }
    try { fs.rmSync(part, { force: true }); } catch (e) { /* nothing to clean */ }
    return current.cancelled ? { ok: false, reason: 'cancelled' } : { ok: false, reason: 'download', detail: lastError ? lastError.message : '' };
  } finally {
    current = null;
  }
}

// On start: no download is running, so a .part is from one that broke off
// (app closed mid-way), and an installer for this version or older has done
// its job. The installer's log stays for the "update didn't finish" notice.
function cleanUp() {
  let names = [];
  try { names = fs.readdirSync(UPDATE_DIR); } catch (err) { return; }
  const running = app.getVersion().split('.').map(Number);
  const older = v => {
    const p = v.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (p[i] !== running[i]) return p[i] < running[i];
    return true;
  };
  names.forEach(name => {
    const m = name.match(/^Farmer Planner Setup (\d+\.\d+\.\d+)\.exe$/);
    if (name.endsWith('.part') || (m && older(m[1]))) {
      try { fs.rmSync(path.join(UPDATE_DIR, name), { force: true }); } catch (err) { /* in use: next start */ }
    }
  });
}

function register() {
  cleanUp();

  // Only an installed app can update itself; from source (npm start) the
  // dialog just links to the website.
  ipcMain.handle('update-can-install', () => app.isPackaged && process.platform === 'win32');

  ipcMain.handle('update-download', download);

  ipcMain.handle('update-cancel', () => {
    if (!current) return false;
    current.cancelled = true;
    if (current.req) current.req.destroy(new Error('cancelled'));
    return true;
  });

  // Starts the downloaded installer and quits; it waits for the app to close.
  ipcMain.handle('update-install', (event, version, lang) => {
    if (!app.isPackaged) return { ok: false, reason: 'dev' };
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) return { ok: false, reason: 'bad' };
    const file = installerPath(version);
    if (!fs.existsSync(file)) return { ok: false, reason: 'missing' };
    const args = ['--update'];
    if (lang === 'en' || lang === 'pl' || lang === 'de') args.push('--lang=' + lang);
    try {
      const child = require('child_process').spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: false });
      child.unref();
    } catch (err) {
      return { ok: false, reason: 'start', detail: err.message };
    }
    setTimeout(() => app.quit(), 400);
    return { ok: true };
  });
}

module.exports = { register, UPDATE_DIR };
