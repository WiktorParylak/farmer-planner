// Builds the app icon from the tractor in Assets/Logo.svg: amber body, white
// wheels and a thin dark outline, so the white wheels still show on a light
// taskbar. Writes Assets/Icon.svg and Assets/Logo.ico (PNG at 256 px, 32-bit
// bitmaps below it, like the icon it replaced).
//
// Run with Electron, which draws the SVG:
//   node_modules/electron/dist/electron.exe tools/generate-app-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SIZES = [256, 128, 64, 48, 32, 16];
const BODY = '#c97a2b', WHEEL = '#ffffff', OUTLINE = '#16261d';
const OUTLINE_WIDTH = 1.6; // in the logo's units

// In the page: the tractor's bounds and the size's pixels (RGBA) and PNG.
const PAGE_SCRIPT = `
window.tractorBox = (inner) => {
    document.body.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 398.97 97.49" width="399" height="98"><g id="t">' + inner + '</g></svg>';
    const b = document.getElementById('t').getBBox();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
};
window.drawIcon = async (svg, size) => {
    const img = new Image();
    await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = 'data:image/svg+xml;base64,' + btoa(svg); });
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, size, size);
    return { rgba: Array.from(g.getImageData(0, 0, size, size).data), png: c.toDataURL('image/png').split(',')[1] };
};
1`;

function tractorPaths() {
    const svg = fs.readFileSync(path.join(ROOT, 'Assets', 'Logo.svg'), 'utf8').replace(/\r\n/g, '\n');
    const groups = svg.split('\n  <g>\n');
    if (groups.length !== 4) throw new Error('Logo.svg: expected three top-level groups');
    const lines = groups[3].split('\n');
    const body = lines.filter(l => l.startsWith('    <path')).map(l => l.match(/ d="([^"]+)"/)[1]);
    const wheels = lines.filter(l => l.startsWith('      <path')).map(l => l.match(/ d="([^"]+)"/)[1]);
    if (body.length !== 1 || wheels.length !== 4) throw new Error('Logo.svg: unexpected tractor paths');
    return { body, wheels };
}

function iconSvg({ body, wheels }, box) {
    const side = Math.max(box.width, box.height) + OUTLINE_WIDTH * 2;
    const x = box.x + box.width / 2 - side / 2, y = box.y + box.height / 2 - side / 2;
    const all = [...body, ...wheels];
    const f = n => +n.toFixed(2);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x)} ${f(y)} ${f(side)} ${f(side)}">\n`
        + `  <g fill="${OUTLINE}" stroke="${OUTLINE}" stroke-width="${OUTLINE_WIDTH}" stroke-linejoin="round">\n${all.map(d => `    <path d="${d}"/>`).join('\n')}\n  </g>\n`
        + `  <g fill="${BODY}">\n${body.map(d => `    <path d="${d}"/>`).join('\n')}\n  </g>\n`
        + `  <g fill="${WHEEL}">\n${wheels.map(d => `    <path d="${d}"/>`).join('\n')}\n  </g>\n`
        + `</svg>\n`;
}

// 32-bit DIB for an .ico entry: BGRA rows bottom-up, then the 1-bit AND mask.
function dibFromRgba(rgba, size) {
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0);
    header.writeInt32LE(size, 4);
    header.writeInt32LE(size * 2, 8);
    header.writeUInt16LE(1, 12);
    header.writeUInt16LE(32, 14);
    const pixels = Buffer.alloc(size * size * 4);
    const maskRow = Math.ceil(size / 32) * 4;
    const mask = Buffer.alloc(maskRow * size);
    for (let y = 0; y < size; y++) {
        const row = size - 1 - y;
        for (let x = 0; x < size; x++) {
            const from = (y * size + x) * 4, to = (row * size + x) * 4;
            pixels[to] = rgba[from + 2];
            pixels[to + 1] = rgba[from + 1];
            pixels[to + 2] = rgba[from];
            pixels[to + 3] = rgba[from + 3];
            if (rgba[from + 3] === 0) mask[row * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
        }
    }
    return Buffer.concat([header, pixels, mask]);
}

function buildIco(entries) {
    const dir = Buffer.alloc(6 + entries.length * 16);
    dir.writeUInt16LE(1, 2);
    dir.writeUInt16LE(entries.length, 4);
    let offset = dir.length;
    entries.forEach((e, i) => {
        const o = 6 + i * 16;
        dir[o] = e.size === 256 ? 0 : e.size;
        dir[o + 1] = e.size === 256 ? 0 : e.size;
        dir.writeUInt16LE(1, o + 4);
        dir.writeUInt16LE(32, o + 6);
        dir.writeUInt32LE(e.data.length, o + 8);
        dir.writeUInt32LE(offset, o + 12);
        offset += e.data.length;
    });
    return Buffer.concat([dir, ...entries.map(e => e.data)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
    try {
        const win = new BrowserWindow({ show: false });
        await win.loadURL('data:text/html,<!doctype html><body></body>');
        await win.webContents.executeJavaScript(PAGE_SCRIPT);
        const paths = tractorPaths();
        const inner = [...paths.body, ...paths.wheels].map(d => `<path d="${d}"/>`).join('');
        const box = await win.webContents.executeJavaScript(`tractorBox(${JSON.stringify(inner)})`);
        const svg = iconSvg(paths, box);
        fs.writeFileSync(path.join(ROOT, 'Assets', 'Icon.svg'), svg);
        const entries = [];
        for (const size of SIZES) {
            const { rgba, png } = await win.webContents.executeJavaScript(`drawIcon(${JSON.stringify(svg)}, ${size})`);
            entries.push({ size, data: size === 256 ? Buffer.from(png, 'base64') : dibFromRgba(rgba, size) });
        }
        fs.writeFileSync(path.join(ROOT, 'Assets', 'Logo.ico'), buildIco(entries));
        console.log('Wrote Assets/Icon.svg and Assets/Logo.ico');
        app.exit(0);
    } catch (err) {
        console.error(err);
        app.exit(1);
    }
});
