// `npm run test:screens`: every main screen of the test farm, in every language,
// photographed and checked for what a person would call broken. The pictures
// and an index.html to look through them go to test-output/screens/.
const fs = require('fs');
const path = require('path');

const SIZES = [[1600, 900], [1280, 720]];

// Opens one screen at a time. Runs in the page; every step starts from the plan.
const VIEWS = {
    'start-screen': `exitBtn.click()`,
    'plan': ``,
    'plan-timeline': `document.querySelector('#fields-view-switch [data-view="timeline"]').click()`,
    'plan-edit': `document.getElementById('edit-season-btn').click()`,
    'plan-crops-list': `document.getElementById('crops-toggle').click()`,
    'field-crop': `openFieldModal(0, 'crop')`,
    'field-work': `openFieldModal(0, 'work')`,
    'field-soil': `openFieldModal(0, 'soil')`,
    'field-history': `openFieldModal(0, 'history')`,
    'field-shared-leased': `openFieldModal(getCurrentFarm().fields.findIndex(f => f.lease), 'crop')`,
    'field-work-catch': `openFieldModal(getCurrentFarm().fields.findIndex(f => f.catchCrop), 'work')`,
    'work-window-catch': `openWorkModal(getCurrentFarm().fields.findIndex(f => f.catchCrop))`,
    'work-window': `openWorkModal(0)`,
    'rotation': `document.querySelector('.sidebar-item[data-view="rotation"]').click()`,
    'yields-prices': `document.querySelector('.sidebar-item[data-view="yieldforecast"]').click()`,
    'yields-prices-past': `document.querySelector('.sidebar-item[data-view="yieldforecast"]').click(); document.querySelector('.yield-season-arrow[data-season]').click()`,
    'notes': `document.querySelector('.sidebar-item[data-view="notes"]').click()`,
    'animals': `document.querySelector('.sidebar-item[data-view="animals"]').click()`,
    'breed-norms': `document.querySelector('.sidebar-item[data-view="breednorms"]').click()`,
    'feed-plan': `document.querySelector('.sidebar-item[data-view="feedplan"]').click()`,
    'feed-plan-mixer': `document.querySelector('.sidebar-item[data-view="feedplan"]').click(); (document.querySelector('#hub-panel-body .mixer') || document.querySelector('#hub-panel-body .feed-ing-grid')).scrollIntoView({ block: 'start' })`,
    'feed-plan-bottom': `document.querySelector('.sidebar-item[data-view="feedplan"]').click(); (() => { const d = document.querySelector('#hub-panel-body .feed-settings'); d.open = true; setTimeout(() => document.querySelector('#hub-panel-body .feed-notes').scrollIntoView({ block: 'end' }), 50); })()`,
    'storage': `document.querySelector('.sidebar-item[data-view="storage"]').click()`,
    'supplies': `setSetting('suppliesTab', 'seed'); document.querySelector('.sidebar-item[data-view="supplies"]').click()`,
    'supplies-fertilizer': `setSetting('suppliesTab', 'fert'); document.querySelector('.sidebar-item[data-view="supplies"]').click()`,
    'finance': `document.querySelector('.sidebar-item[data-view="finance"]').click()`,
    'season-summary': `document.querySelector('.sidebar-item[data-view="seasonsummary"]').click()`,
    'field-soil-list': `showPlannerView('fieldsoil')`,
    'settings': `document.getElementById('settings-btn').click()`,
    'news-badge': `FT.fakeNews(); setSetting('newsSeen', '[]'); renderNewsBadge(); exitBtn.click()`,
    'news': `FT.fakeNews(); setSetting('newsSeen', '[]'); exitBtn.click(); setTimeout(() => document.getElementById('news-btn').click(), 100)`,
    'news-poll': `FT.fakeNews(); setSetting('newsVotes', JSON.stringify({ 'test-next': ['a'] })); exitBtn.click(); setTimeout(() => showNewsWindow([newsPosts()[1]]), 100)`,
    'mod-manager': `FT.fakeMods(); mm.tab = 'mods'; exitBtn.click(); setTimeout(() => document.getElementById('modmanager-btn').click(), 100)`,
    'mod-manager-compare': `FT.fakeMods(); FT.fakeSave(); mm.tab = 'compare'; exitBtn.click(); setTimeout(() => document.getElementById('modmanager-btn').click(), 100)`
};

// What's wrong on the screen as it is now. Runs in the page.
const CHECK = `(() => {
    const issues = [];
    const text = document.body.innerText;
    for (const [re, what] of [[/\\bundefined\\b/, 'the word undefined'], [/\\bNaN\\b/, 'the word NaN'], [/\\[object Object\\]/, '[object Object]'], [/\\{[a-zA-Z]+\\}/, 'an unfilled {placeholder}']]) {
        const m = text.match(re);
        if (m) issues.push(what + ' in: ' + text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\\s+/g, ' '));
    }
    // A translation key shown as text, or as a tooltip: t() falls back to the key.
    const isKey = s => /^[a-z]+[A-Z_][A-Za-z0-9_]*$/.test(s) && !(s in TRANSLATIONS.en);
    const shown = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const s = walker.currentNode.textContent.trim();
        if (isKey(s) && walker.currentNode.parentElement.closest('script, style') === null && shown(walker.currentNode.parentElement)) issues.push('a raw key on screen: ' + s);
    }
    const allKeys = new Set(Object.keys(TRANSLATIONS.en));
    document.querySelectorAll('[title]').forEach(el => {
        const s = el.getAttribute('title').trim();
        if (shown(el) && /^[a-z]+[A-Z][A-Za-z0-9_]*$/.test(s) && !allKeys.has(s)) issues.push('a raw key as a tooltip: ' + s);
    });
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) issues.push('the page scrolls sideways by ' + (root.scrollWidth - root.clientWidth) + ' px');
    document.querySelectorAll('.modal').forEach(m => {
        if (m.style.display !== 'flex') return;
        const c = m.querySelector('.modal-content, .app-dialog-content');
        if (c && c.scrollWidth > c.clientWidth + 1) issues.push('window #' + m.id + ' scrolls sideways by ' + (c.scrollWidth - c.clientWidth) + ' px');
    });
    // Controls past the window edge, unless they sit in something that scrolls.
    const scrolls = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return true; } return false; };
    const seen = new Set();
    document.querySelectorAll('button, input, select, a').forEach(el => {
        if (!shown(el) || scrolls(el)) return;
        const r = el.getBoundingClientRect();
        const label = (el.textContent || el.className || el.id || el.tagName).trim().slice(0, 40);
        if ((r.right > innerWidth + 1 || r.left < -1) && !seen.has(label)) { seen.add(label); issues.push('past the window edge: ' + label); }
    });
    // Text cut off inside a button or a tab.
    const cut = new Set();
    document.querySelectorAll('button, th, .badge').forEach(el => {
        if (!shown(el) || el.scrollWidth <= el.clientWidth + 1 || !el.clientWidth) return;
        if (getComputedStyle(el).overflowX !== 'hidden') return;
        cut.add(el.textContent.trim().slice(0, 50));
    });
    return { issues, cut: [...cut].filter(Boolean) };
})()`;

module.exports = async function ({ win, js, wait, consoleErrors, repo }) {
    const outDir = path.join(repo, 'test-output', 'screens');
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    win.show();
    win.setResizable(true);
    const shots = [];
    let lastFrame = null;
    const languages = await js('APP_LANGUAGES');
    for (const lang of languages) {
        // The dev farm's names follow the language it was built in.
        await js(`applyLanguage(${JSON.stringify(lang)}); FT.freshFarm().then(() => 1)`);
        await wait(1000);
        for (const [w, h] of SIZES) {
            // One language at the small size keeps the run short: Polish, the one
            // the app is developed in. The others run at the main size.
            if (w !== SIZES[0][0] && lang !== 'pl') continue;
            win.setContentSize(w, h);
            await wait(300);
            for (const name of Object.keys(VIEWS)) {
                consoleErrors.length = 0;
                const fieldsBefore = await js('JSON.stringify(getCurrentFarm().fields)');
                await js(`FT.freshView(${JSON.stringify(VIEWS[name])})`);
                await wait(250);
                const { issues, cut } = await js(CHECK);
                // Looking at a screen must not change the farm.
                if (await js('getCurrentFarm() && JSON.stringify(getCurrentFarm().fields)') !== fieldsBefore && name !== 'start-screen' && !name.startsWith('mod-manager') && !name.startsWith('news')) issues.push('opening it changed the fields');
                consoleErrors.filter(e => !/ResizeObserver loop/.test(e)).forEach(e => issues.push('console error: ' + e));
                // The first capture after a change can return the frame before it.
                // Two painted frames first (capped, a hidden page paints none).
                win.webContents.invalidate();
                await js(`Promise.race([new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))), new Promise(r => setTimeout(() => r(0), 1000))])`);
                await wait(250);
                await win.webContents.capturePage();
                const file = `${lang}-${w}x${h}-${name}.jpg`;
                // A frame the same as the last screen's is the old one still: wait for the new.
                let image = await win.webContents.capturePage();
                for (let k = 0; k < 8 && lastFrame && image.toBitmap().equals(lastFrame); k++) {
                    win.webContents.invalidate();
                    await wait(300);
                    image = await win.webContents.capturePage();
                }
                lastFrame = image.toBitmap();
                fs.writeFileSync(path.join(outDir, file), image.toJPEG(78));
                shots.push({ name, lang, size: `${w}x${h}`, file, issues, cut });
                await js(`FT.backToPlan()`);
            }
        }
    }
    const rows = shots.map(s => `<figure class="${s.issues.length ? 'bad' : ''}"><a href="${s.file}"><img loading="lazy" src="${s.file}"></a>
        <figcaption><b>${s.lang} ${s.size} ${s.name}</b>${[...s.issues, ...s.cut.map(c => 'text cut off: ' + c)].map(i => `<div>${i.replace(/</g, '&lt;')}</div>`).join('')}</figcaption></figure>`).join('\n');
    fs.writeFileSync(path.join(outDir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Farmer Planner screens</title>
<style>body{font:14px sans-serif;margin:16px;background:#222;color:#eee}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:12px}
figure{margin:0;background:#333;padding:8px}figure.bad{outline:3px solid #e55}img{width:100%;display:block}figcaption div{color:#fb8;margin-top:4px}</style>
<h1>${shots.length} screens</h1><main>${rows}</main>`);
    const bad = shots.filter(s => s.issues.length);
    bad.forEach(s => s.issues.forEach(i => console.log(` FAIL  ${s.lang} ${s.size} ${s.name}: ${i}`)));
    const cut = [...new Set(shots.flatMap(s => s.cut.map(c => `${s.lang}: ${c}`)))];
    if (cut.length) console.log(`\nText cut off, worth a look (${cut.length}):\n` + cut.map(c => '  ' + c).join('\n'));
    console.log(`\n${shots.length} screens, ${bad.length} with problems. Look through them: test-output/screens/index.html`);
    return bad.length ? 1 : 0;
};
