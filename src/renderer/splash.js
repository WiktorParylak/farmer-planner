// Start-up animation: the tractor from the logo drives in and uncovers FARMER,
// PLANNER drops in letter by letter, a line, the author and a glint, then the
// whole thing dissolves into the start screen. Built from Assets/Logo.svg so it
// follows the logo. Runs before renderer.js (its own scope, no globals); a
// click or a key skips it, reduced motion shortens it, and the app setting
// "Start-up animation" (farmer_planner_splash = '0') turns it off.
(function startSplash() {
    const splash = document.getElementById('splash');
    if (!splash) return;
    const nodeFs = require('fs');
    const nodePath = require('path');

    const remove = () => { if (splash.parentNode) splash.parentNode.removeChild(splash); };
    try {
        const dataDir = require('electron').ipcRenderer.sendSync('get-data-dir');
        const settingsFile = dataDir ? nodePath.join(dataDir, 'settings.json') : null;
        if (settingsFile && nodeFs.existsSync(settingsFile)
            && JSON.parse(nodeFs.readFileSync(settingsFile, 'utf-8')).farmer_planner_splash === '0') { remove(); return; }
    } catch (e) { /* no settings yet: play it */ }

    let svg;
    try {
        const text = nodeFs.readFileSync(nodePath.join(__dirname, '..', '..', 'Assets', 'Logo.svg'), 'utf-8');
        svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
        if (!svg || svg.nodeName !== 'svg') throw new Error('Logo.svg');
    } catch (e) { remove(); return; }

    // Logo.svg: three groups — FARMER, PLANNER, the tractor (body + two wheels).
    svg.querySelectorAll('style').forEach(s => s.remove());
    svg.removeAttribute('id');
    svg.setAttribute('class', 'splash-logo');
    svg.setAttribute('aria-hidden', 'true');
    const [farmer, planner, tractor] = Array.from(svg.children).filter(n => n.nodeName === 'g');
    if (!farmer || !planner || !tractor) { remove(); return; }
    farmer.setAttribute('class', 'splash-farmer');
    planner.setAttribute('class', 'splash-planner');
    Array.from(planner.children).forEach((p, i) => { p.setAttribute('class', 'splash-letter'); p.setAttribute('style', `--i:${i}`); });

    // Tractor: drive (outer) > bob and brake (inner) > body + spinning wheels + dust.
    const NS = 'http://www.w3.org/2000/svg';
    const inner = document.createElementNS(NS, 'g');
    inner.setAttribute('class', 'splash-tractor-inner');
    Array.from(tractor.children).forEach(ch => {
        if (ch.nodeName === 'g') ch.setAttribute('class', 'splash-wheel');
        inner.appendChild(ch);
    });
    // Dust puffs behind the rear wheel while it drives.
    [[318, 44, 0], [311, 40, 1], [320, 36, 2], [313, 46, 3]].forEach(([cx, cy, i]) => {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', 4);
        c.setAttribute('class', 'splash-dust');
        c.setAttribute('style', `--i:${i}`);
        tractor.appendChild(c);
    });
    tractor.appendChild(inner);
    tractor.setAttribute('class', 'splash-tractor');

    const stage = splash.querySelector('.splash-stage');
    stage.insertBefore(svg, stage.firstChild);
    splash.classList.add('is-playing');

    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let done = false;
    const finish = (fast) => {
        if (done) return;
        done = true;
        splash.classList.add(fast ? 'is-skipped' : 'is-leaving');
        setTimeout(remove, fast ? 260 : 520);
        window.removeEventListener('keydown', skip, true);
    };
    const skip = () => finish(true);
    splash.addEventListener('click', skip);
    window.addEventListener('keydown', skip, true);
    setTimeout(() => finish(false), reduced ? 700 : 3550);
})();
