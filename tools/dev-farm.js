// Dev-time helper that keeps the test farm in the repo (`dev-farm/`) in sync
// with the app's data folder (Documents\Farmer Planner\<id>). NOT used at
// runtime by the app — it exists so the same test farm is available on every
// computer that clones the repo.
//
// Usage:
//   node tools/dev-farm.js install   repo -> Documents\Farmer Planner (overwrites the dev farm there)
//   node tools/dev-farm.js save      Documents\Farmer Planner -> repo (after changing the farm in the app)
//
// Absolute paths in data.json (savegame, crop/animal sources) point into the
// user's home folder. `save` stores them as-is; `install` rewrites the
// C:\Users\<name> prefix to the current home folder, so they still resolve on
// a computer with a different Windows user name.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

// Same folder as Electron's app.getPath('documents') — it may be redirected
// (e.g. to OneDrive\Dokumenty), so %USERPROFILE%\Documents is not enough.
function documentsDir() {
    try {
        const dir = execSync('powershell -NoProfile -Command "[Environment]::GetFolderPath(\'MyDocuments\')"',
            { encoding: 'utf-8' }).trim();
        if (dir) return dir;
    } catch (err) { /* fall back below */ }
    return path.join(os.homedir(), 'Documents');
}

const FARM_ID = '1791058275537';
const REPO_DIR = path.join(__dirname, '..', 'dev-farm');
const APP_DIR = path.join(documentsDir(), 'Farmer Planner', FARM_ID);

// Post-edit backups are recreated by the app; they would only bloat the repo.
const SKIP = new Set(['backups']);

function copyFarm(from, to) {
    if (!fs.existsSync(path.join(from, 'data.json'))) {
        console.error(`No farm found in ${from}`);
        process.exit(1);
    }
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true, filter: p => !SKIP.has(path.basename(p)) });
    fs.mkdirSync(path.join(to, 'backups'), { recursive: true });
}

function rewriteHomePaths(farmDir) {
    const file = path.join(farmDir, 'data.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const home = os.homedir();
    const fix = value => {
        if (typeof value === 'string') return value.replace(/^[A-Za-z]:\\Users\\[^\\]+/, home);
        if (Array.isArray(value)) return value.map(fix);
        if (value && typeof value === 'object') {
            for (const key of Object.keys(value)) value[key] = fix(value[key]);
        }
        return value;
    };
    fs.writeFileSync(file, JSON.stringify(fix(data), null, 2));
}

const command = process.argv[2];
if (command === 'install') {
    copyFarm(REPO_DIR, APP_DIR);
    rewriteHomePaths(APP_DIR);
    console.log(`Installed dev farm to ${APP_DIR}`);
} else if (command === 'save') {
    copyFarm(APP_DIR, REPO_DIR);
    fs.writeFileSync(path.join(REPO_DIR, 'backups', '.gitkeep'), '');
    console.log(`Saved dev farm to ${REPO_DIR}`);
} else {
    console.log('Usage: node tools/dev-farm.js install|save');
    process.exit(1);
}
