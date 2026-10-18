// Wraps electron-builder's NSIS installer in Farmer Planner's own installer
// window (installer/Setup.cs + installer/Window.xaml), compiled with the C#
// compiler that ships with Windows' .NET Framework 4.8 — no SDK needed.
//
//   npm run build                         electron-builder, then this script
//   node tools/build-installer.js         wrap dist/Farmer Planner Setup <version>.exe again
//   node tools/build-installer.js --payload <setup.exe> --version 0.9.12 [--out <dir>]
//                                         wrap an already released installer (any NSIS one
//                                         from electron-builder takes /S /D=)
//
// The NSIS installer is moved to dist/payload/ and embedded; the window takes its
// place as dist/Farmer Planner Setup <version>.exe — the only file for the release.
// Fonts (Big Shoulders Display, IBM Plex, OFL) are downloaded once into build-cache/.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const CACHE = path.join(ROOT, 'build-cache');
const SRC = path.join(ROOT, 'installer');
const NET = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319';

function arg(name) {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : null;
}

function get(url, asText) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return get(res.headers.location, asText).then(resolve, reject);
            }
            if (res.statusCode !== 200) return reject(new Error(`${url}: HTTP ${res.statusCode}`));
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(asText ? Buffer.concat(chunks).toString('utf8') : Buffer.concat(chunks)));
        }).on('error', reject);
    });
}

// Our window is a .NET assembly, NSIS installers aren't: a .NET exe has a CLR
// header (PE data directory 14). Not a text search — the window embeds the
// whole payload, so its import table lies ~100 MB into the file.
function isDotNetExe(file) {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(4096);
    fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    const pe = head.readUInt32LE(0x3C);
    if (head.toString('latin1', pe, pe + 4) !== 'PE\0\0') return false;
    const opt = pe + 24;
    const dirs = opt + (head.readUInt16LE(opt) === 0x20B ? 112 : 96);
    return head.readUInt32LE(dirs + 14 * 8) !== 0;
}

function dirSize(dir) {
    let size = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        size += entry.isDirectory() ? dirSize(p) : fs.statSync(p).size;
    }
    return size;
}

// Without a recognised browser user agent Google Fonts answers with whole TTF
// files (not woff2 subsets) — the format WPF can load.
async function fonts() {
    const dir = path.join(CACHE, 'fonts');
    fs.mkdirSync(dir, { recursive: true });
    const wanted = [
        ['Big Shoulders Display', 800, 'font-big-shoulders-display-800.ttf'],
        ['IBM Plex Sans', 400, 'font-ibm-plex-sans-400.ttf'],
        ['IBM Plex Sans', 600, 'font-ibm-plex-sans-600.ttf'],
        ['IBM Plex Mono', 600, 'font-ibm-plex-mono-600.ttf']
    ];
    const files = [];
    for (const [family, weight, file] of wanted) {
        const target = path.join(dir, file);
        if (!fs.existsSync(target)) {
            try {
                const css = await get(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${weight}`, true);
                const url = (css.match(/src:\s*url\(([^)]+\.ttf)\)/) || [])[1];
                if (!url) throw new Error('no TTF in the CSS');
                fs.writeFileSync(target, await get(url));
                console.log(`  font ${family} ${weight}`);
            } catch (err) {
                console.warn(`  font ${family} ${weight} skipped (${err.message}) — the window falls back to system fonts`);
                continue;
            }
        }
        files.push(target);
    }
    return files;
}

// Assets/Logo.svg (white paths, no transforms) as XAML paths for the window.
function logoXaml() {
    const svg = fs.readFileSync(path.join(ROOT, 'Assets', 'Logo.svg'), 'utf8');
    return [...svg.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)]
        .map(m => `<Path Fill="White" Data="F1 ${m[1]}"/>`)
        .join('\n                            ');
}

function csc(out, extraArgs) {
    const cscExe = path.join(NET, 'csc.exe');
    if (!fs.existsSync(cscExe)) throw new Error(`C# compiler not found: ${cscExe} (.NET Framework 4.8 is part of Windows 10/11)`);
    const args = [
        '/nologo', '/target:winexe', '/optimize+', '/platform:anycpu', `/out:${out}`,
        `/lib:${NET}`, `/lib:${path.join(NET, 'WPF')}`,
        '/reference:PresentationCore.dll', '/reference:PresentationFramework.dll', '/reference:WindowsBase.dll',
        '/reference:System.Xaml.dll', '/reference:System.Core.dll',
        `/win32icon:${path.join(ROOT, 'Assets', 'Logo.ico')}`,
        `/win32manifest:${path.join(SRC, 'app.manifest')}`,
        ...extraArgs,
        path.join(SRC, 'Setup.cs')
    ];
    execFileSync(cscExe, args, { stdio: 'inherit' });
}

(async () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const version = arg('--version') || pkg.version;
    const outDir = arg('--out') || DIST;
    const setupName = `Farmer Planner Setup ${version}.exe`;

    // The NSIS installer to embed.
    let payload = arg('--payload');
    let appSize = null;
    if (payload) {
        // A released installer: guess the unpacked size from the compressed one.
        appSize = Math.round(fs.statSync(payload).size * 3.5);
    } else {
        const built = path.join(DIST, setupName);
        payload = path.join(DIST, 'payload', `Farmer Planner Payload ${version}.exe`);
        // A fresh electron-builder run leaves its NSIS installer under the setup
        // name; a second run of this script finds the window there (a .NET exe)
        // and reuses the payload moved aside the first time.
        if (fs.existsSync(built) && !isDotNetExe(built)) {
            fs.mkdirSync(path.dirname(payload), { recursive: true });
            fs.renameSync(built, payload);
        }
        if (!fs.existsSync(payload)) throw new Error(`No NSIS installer for ${version}: run electron-builder first, or pass --payload.`);
        const unpacked = path.join(DIST, 'win-unpacked');
        if (fs.existsSync(unpacked)) appSize = dirSize(unpacked);
    }
    if (isDotNetExe(payload)) throw new Error(`${payload} is already a Farmer Planner window, not an NSIS installer — run npm run build again.`);
    console.log(`Wrapping ${path.relative(ROOT, payload)} (${version})`);

    fs.mkdirSync(CACHE, { recursive: true });
    const work = path.join(CACHE, 'work');
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });

    const xaml = path.join(work, 'Window.xaml');
    fs.writeFileSync(xaml, fs.readFileSync(path.join(SRC, 'Window.xaml'), 'utf8').split('{{LOGO}}').join(logoXaml()));
    const meta = path.join(work, 'meta.txt');
    fs.writeFileSync(meta, `version=${version}\nappSize=${appSize || ''}\n`);

    const shared = [
        `/resource:${xaml},Window.xaml`,
        `/resource:${meta},meta.txt`,
        `/resource:${path.join(ROOT, 'Assets', 'Logo.ico')},icon.ico`,
        ...(await fonts()).map(f => `/resource:${f},${path.basename(f)}`)
    ];

    const uninstaller = path.join(work, 'uninstall.exe');
    csc(uninstaller, ['/define:UNINSTALLER', ...shared]);

    fs.mkdirSync(outDir, { recursive: true });
    const setup = path.join(outDir, setupName);
    csc(setup, [...shared, `/resource:${uninstaller},uninstall.exe`, `/resource:${payload},payload.exe`]);
    const mb = n => (n / 1024 / 1024).toFixed(1) + ' MB';
    console.log(`Built ${path.relative(ROOT, setup)} (${mb(fs.statSync(setup).size)}, app ${appSize ? mb(appSize) : 'size unknown'})`);
})().catch(err => {
    console.error(err.message || err);
    process.exit(1);
});
