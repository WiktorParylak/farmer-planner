// AFC editor: a developer tool (only when IS_DEV_BUILD, i.e. `npm start`)
// that edits what each breed eats and gives in AnimalFoodCalculator's
// xmls/animals.xml, inside FS25_AnimalFoodCalculator.zip in the mods folder.
// A classic <script> after mod-manager.js; the logic is in afc-editor-core.js.
// Opened from Settings → Developer. Every saved curve is also kept in
// Documents\Farmer Planner\afc-editor\changes.json, to put back on a new
// version of the mod.
const afcCore = require('./afc-editor-core');

const afcEd = {
    zip: null,          // path of the mod zip
    version: '',
    xml: null,          // animals.xml as in the zip
    breeds: [],         // afcParseAnimals(xml)
    sel: null,          // subType shown
    filter: '',
    edits: {},          // curveId -> keys, only curves changed and not saved
    busy: false,
    message: null       // { text, error }
};

function afcEdDataPath(...parts) {
    return path.join(appDataDir, ...parts);
}
const AFC_ED_BACKUPS = () => afcEdDataPath('backups', 'afc-mod');
const AFC_ED_CHANGES = () => afcEdDataPath('afc-editor', 'changes.json');

function afcEdReadChanges() {
    try {
        const c = JSON.parse(fs.readFileSync(AFC_ED_CHANGES(), 'utf-8'));
        return c && typeof c.curves === 'object' ? c : { curves: {} };
    } catch { return { curves: {} }; }
}

function afcEdWriteChanges(changes) {
    fs.mkdirSync(path.dirname(AFC_ED_CHANGES()), { recursive: true });
    fs.writeFileSync(AFC_ED_CHANGES(), JSON.stringify(changes, null, 2), 'utf-8');
}

// The mod zip: the one picked before, else the game's mods folder (or the
// folder gameSettings.xml points the game at).
function afcEdFindZip() {
    const saved = getSetting('afcEditorZip');
    if (saved && fs.existsSync(saved)) return saved;
    const gameDir = tlGameDir();
    const dirs = [path.join(gameDir, 'mods')];
    const ov = mmCore.readOverride(gameDir);
    if (ov && ov.active && ov.directory) dirs.unshift(ov.directory);
    for (const d of dirs) {
        const zip = path.join(d, afcCore.AFC_EDITOR_MOD + '.zip');
        if (fs.existsSync(zip)) return zip;
    }
    return null;
}

function afcEdLoad(zip) {
    afcEd.zip = zip;
    afcEd.xml = null;
    afcEd.breeds = [];
    afcEd.edits = {};
    if (!zip) return;
    try {
        const r = afcCore.afcReadZip(zip);
        afcEd.xml = r.xml;
        afcEd.version = r.version;
        afcEd.breeds = afcCore.afcParseAnimals(r.xml);
    } catch (e) {
        afcEd.message = { text: t('afcEdReadError').replace('{msg}', e.message), error: true };
    }
    if (!afcEd.breeds.some(b => b.subType === afcEd.sel)) afcEd.sel = afcEd.breeds.length ? afcEd.breeds[0].subType : null;
}

function afcEdOpen() {
    if (!IS_DEV_BUILD) return;
    const view = document.getElementById('afced-view');
    if (!view) return;
    if (dashboardView) dashboardView.style.display = 'none';
    view.hidden = false;
    afcEd.message = null;
    afcEdLoad(afcEdFindZip());
    afcEdRender();
}

async function afcEdClose() {
    if (afcEd.busy) return;
    const n = afcEdChangedIds().length;
    if (n && !(await showConfirm({ title: t('afcEdTitle'), body: t('afcEdLeaveUnsaved').replace('{n}', n), danger: true }))) return;
    afcEd.edits = {};
    document.getElementById('afced-view').hidden = true;
    if (dashboardView) dashboardView.style.display = 'flex';
}

function afcEdCurve(id) {
    for (const b of afcEd.breeds) for (const c of b.curves) if (c.id === id) return c;
    return null;
}

// The curve as it is now in the editor (edited or as in the file).
function afcEdKeys(curve) {
    return afcEd.edits[curve.id] || curve.keys;
}

function afcEdChangedIds() {
    return Object.keys(afcEd.edits).filter(id => {
        const c = afcEdCurve(id);
        return c && !afcCore.afcSameKeys(afcCore.afcCleanKeys(afcEd.edits[id]), c.keys);
    });
}

function afcEdSetKeys(curve, keys) {
    afcEd.edits[curve.id] = keys;
    if (afcCore.afcSameKeys(afcCore.afcCleanKeys(keys), curve.keys) && keys.length === curve.keys.length) delete afcEd.edits[curve.id];
}

// The base game's curve for the same breed and fill type, to compare with.
const AFC_ED_OUTPUT_TAGS = { milk: 'MILK', manure: 'MANURE', liquidmanure: 'LIQUIDMANURE' };
function afcEdFillType(curve) {
    return curve.fillType || AFC_ED_OUTPUT_TAGS[curve.tag.toLowerCase()] || curve.tag.toUpperCase();
}
function afcEdBaseKeys(subType, curve) {
    const d = DEFAULT_ANIMALS[subType];
    if (!d) return null;
    if (curve.group === 'input') return d[curve.tag] || null;
    return (d.production || {})[afcEdFillType(curve)] || null;
}
function afcEdCurveLabel(curve) {
    if (curve.group === 'input' && afcCore.AFC_EDITOR_INPUTS.includes(curve.tag)) return t('breedNorm_' + curve.tag);
    return formatFillType(afcEdFillType(curve));
}

// ---------- render ----------
function afcEdRender() {
    afcEdRenderSide();
    afcEdRenderMain();
}

function afcEdRenderSide() {
    const side = document.getElementById('afced-side');
    if (!side) return;
    const changed = new Set(afcEdChangedIds().map(id => id.split('|')[0]));
    const nChanged = afcEdChangedIds().length;
    const mine = Object.keys(afcEdReadChanges().curves).length;
    const backups = afcCore.afcBackupList(AFC_ED_BACKUPS());
    const q = afcEd.filter.trim().toLowerCase();
    const byType = {};
    afcEd.breeds.forEach(b => {
        const name = String(formatAnimalName(b.subType));
        if (q && !b.subType.toLowerCase().includes(q) && !name.toLowerCase().includes(q)) return;
        (byType[b.type] = byType[b.type] || []).push({ b, name });
    });
    const dis = afcEd.busy ? 'disabled' : '';
    side.innerHTML = `
        <p class="settings-hint">${escapeHtml(t('afcEdDevOnly'))}</p>
        <div class="afced-zip">
            <strong>${escapeHtml(t('afcEdZip'))}</strong>
            <span class="afced-path">${afcEd.zip ? escapeHtml(afcEd.zip) : escapeHtml(t('afcEdNoZip'))}</span>
            ${afcEd.version ? `<span class="afced-meta">${escapeHtml(t('afcEdVersion').replace('{v}', afcEd.version))}</span>` : ''}
            <button type="button" class="settings-btn" data-act="zip" ${dis}>${escapeHtml(t('afcEdChooseZip'))}</button>
        </div>
        ${afcEd.message ? `<p class="afced-msg ${afcEd.message.error ? 'is-error' : ''}" role="status">${escapeHtml(afcEd.message.text)}</p>` : ''}
        <div class="tl-row">
            <button type="button" class="settings-btn is-active" data-act="save" ${nChanged && !afcEd.busy ? '' : 'disabled'}>${escapeHtml(t('afcEdSave').replace('{n}', nChanged))}</button>
            <button type="button" class="settings-btn" data-act="discard" ${nChanged && !afcEd.busy ? '' : 'disabled'}>${escapeHtml(t('afcEdDiscard'))}</button>
        </div>
        <input type="text" class="afced-filter" placeholder="${escapeHtml(t('afcEdFilter'))}" value="${escapeHtml(afcEd.filter)}">
        <div class="afced-breeds">
            ${Object.keys(byType).map(type => `<div class="afced-type">${escapeHtml(formatAnimalName(type))}</div>` + byType[type].map(({ b, name }) => `
                <button type="button" class="afced-breed ${b.subType === afcEd.sel ? 'is-active' : ''}" data-sub="${escapeHtml(b.subType)}">
                    <span>${escapeHtml(name)}</span><small>${escapeHtml(b.subType)}</small>${changed.has(b.subType) ? '<i class="fa-solid fa-circle afced-dot" aria-hidden="true"></i>' : ''}
                </button>`).join('')).join('')}
        </div>
        <div class="afced-box">
            <strong>${escapeHtml(t('afcEdMyChanges'))}</strong>
            <p class="settings-hint">${escapeHtml(t('afcEdMyChangesHint'))}</p>
            <div class="tl-row">
                <button type="button" class="settings-btn" data-act="mine" ${mine && afcEd.xml && !afcEd.busy ? '' : 'disabled'}>${escapeHtml(t('afcEdApplyMine').replace('{n}', mine))}</button>
                <button type="button" class="settings-btn" data-act="export" ${mine ? '' : 'disabled'}>${escapeHtml(t('afcEdExport'))}</button>
                <button type="button" class="settings-btn" data-act="import" ${afcEd.xml && !afcEd.busy ? '' : 'disabled'}>${escapeHtml(t('afcEdImport'))}</button>
            </div>
        </div>
        <div class="afced-box">
            <strong>${escapeHtml(t('afcEdBackups'))}</strong>
            ${backups.length ? `<div class="tl-row">
                <select class="afced-backup">${backups.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(path.basename(f))}</option>`).join('')}</select>
                <button type="button" class="settings-btn" data-act="restore" ${afcEd.zip && !afcEd.busy ? '' : 'disabled'}>${escapeHtml(t('afcEdRestore'))}</button>
            </div>` : `<p class="settings-hint">${escapeHtml(t('afcEdNoBackups'))}</p>`}
        </div>`;
}

function afcEdNum(v) {
    return afcCore.afcCleanKeys([{ ageMonth: 0, value: v }]).length ? String(Math.round(v * 10000) / 10000) : '';
}

// The curve now (line), as in the mod (dashed) and in the base game (dotted).
function afcEdChartHtml(now, file, base) {
    const all = [now, file, base || []].flat();
    if (!all.length) return '';
    const W = 420, H = 120, P = 6;
    const maxA = Math.max(12, ...all.map(k => k.ageMonth)) * 1.1;
    const maxV = Math.max(1e-9, ...all.map(k => k.value)) * 1.1;
    const pts = keys => {
        if (!keys || !keys.length) return '';
        const ext = [...keys, { ageMonth: maxA, value: keys[keys.length - 1].value }];
        return ext.map(k => `${(P + k.ageMonth / maxA * (W - 2 * P)).toFixed(1)},${(H - P - k.value / maxV * (H - 2 * P)).toFixed(1)}`).join(' ');
    };
    return `<svg class="afced-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        ${base ? `<polyline class="afced-line-base" points="${pts(base)}"/>` : ''}
        <polyline class="afced-line-file" points="${pts(file)}"/>
        <polyline class="afced-line-now" points="${pts(now)}"/>
    </svg>`;
}

function afcEdCurveHtml(subType, curve) {
    const keys = afcEdKeys(curve);
    const base = afcEdBaseKeys(subType, curve);
    const fileAt = age => { const k = curve.keys.find(x => x.ageMonth === age); return k ? afcEdNum(k.value) : '–'; };
    const baseAt = age => base && base.length ? afcEdNum(interpolateNeedCurve(base, age)) : '–';
    const edited = !!afcEd.edits[curve.id];
    const id = escapeHtml(curve.id);
    return `<section class="afced-curve ${edited ? 'is-edited' : ''}" data-curve="${id}">
        <header class="afced-curve-head">
            <h3>${escapeHtml(afcEdCurveLabel(curve))}${curve.fillType ? ` <small>${escapeHtml(curve.tag)} · ${escapeHtml(curve.fillType)}</small>` : ` <small>${escapeHtml(curve.tag)}</small>`}</h3>
            <span class="afced-mult">${escapeHtml(t('afcEdMultiply'))}
                <input type="number" class="afced-mult-x" min="0" step="0.05" value="1" data-k="${id}|mult">
                <button type="button" class="settings-btn" data-act="mult">${escapeHtml(t('afcEdApply'))}</button></span>
            <button type="button" class="settings-btn" data-act="reset" ${edited ? '' : 'disabled'}>${escapeHtml(t('afcEdResetCurve'))}</button>
        </header>
        ${afcEdChartHtml(keys, curve.keys, base)}
        <table class="data-table afced-table"><thead><tr>
            <th>${escapeHtml(t('afcEdAge'))}</th><th>${escapeHtml(t('afcEdValue'))}</th>
            <th>${escapeHtml(t('afcEdInFile'))}</th><th>${escapeHtml(t('afcEdBase'))}</th><th></th>
        </tr></thead><tbody>
            ${keys.map((k, i) => `<tr>
                <td><input type="number" min="0" step="1" class="afced-in" data-row="${i}" data-field="ageMonth" data-k="${id}|${i}|a" value="${afcEdNum(k.ageMonth)}"></td>
                <td><input type="number" min="0" step="any" class="afced-in" data-row="${i}" data-field="value" data-k="${id}|${i}|v" value="${afcEdNum(k.value)}"></td>
                <td class="afced-ref">${fileAt(k.ageMonth)}</td>
                <td class="afced-ref">${baseAt(k.ageMonth)}</td>
                <td><button type="button" class="afced-del" data-act="del" data-row="${i}" title="${escapeHtml(t('afcEdRemovePoint'))}" aria-label="${escapeHtml(t('afcEdRemovePoint'))}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></td>
            </tr>`).join('')}
        </tbody></table>
        <button type="button" class="settings-btn" data-act="add">${escapeHtml(t('afcEdAddPoint'))}</button>
    </section>`;
}

function afcEdRenderMain() {
    const main = document.getElementById('afced-main');
    if (!main) return;
    const focused = document.activeElement && main.contains(document.activeElement) ? document.activeElement.dataset.k : null;
    const breed = afcEd.breeds.find(b => b.subType === afcEd.sel);
    if (!breed) {
        main.innerHTML = `<p class="hub-panel-note">${escapeHtml(afcEd.zip ? t('afcEdNoBreeds') : t('afcEdNoZip'))}</p>`;
        return;
    }
    const group = g => breed.curves.filter(c => c.group === g).map(c => afcEdCurveHtml(breed.subType, c)).join('');
    main.innerHTML = `<h2 class="afced-title">${escapeHtml(formatAnimalName(breed.subType))} <small>${escapeHtml(breed.subType)}</small></h2>
        <p class="settings-hint">${escapeHtml(t('afcEdLegend'))}</p>
        ${breed.curves.some(c => c.group === 'input') ? `<h3 class="afced-group">${escapeHtml(t('afcEdIntake'))}</h3><div class="afced-grid">${group('input')}</div>` : ''}
        ${breed.curves.some(c => c.group === 'output') ? `<h3 class="afced-group">${escapeHtml(t('afcEdOutput'))}</h3><div class="afced-grid">${group('output')}</div>` : ''}`;
    if (focused) {
        const el = [...main.querySelectorAll('[data-k]')].find(e => e.dataset.k === focused);
        if (el) el.focus();
    }
}

// ---------- actions ----------
function afcEdOnMainChange(e) {
    const input = e.target.closest('.afced-in');
    if (!input) return;
    const curve = afcEdCurve(input.closest('[data-curve]').dataset.curve);
    const keys = afcEdKeys(curve).map(k => ({ ...k }));
    const v = parseFloat(input.value);
    const row = keys[+input.dataset.row];
    if (!row || !(v >= 0)) { afcEdRenderMain(); return; }
    row[input.dataset.field] = v;
    // Ages stay in order; two points at one age become one.
    afcEdSetKeys(curve, input.dataset.field === 'ageMonth' ? afcCore.afcCleanKeys(keys) : keys);
    afcEdRender();
}

function afcEdOnMainClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const curve = afcEdCurve(btn.closest('[data-curve]').dataset.curve);
    const keys = afcEdKeys(curve).map(k => ({ ...k }));
    if (btn.dataset.act === 'del') {
        keys.splice(+btn.dataset.row, 1);
        afcEdSetKeys(curve, keys);
    } else if (btn.dataset.act === 'add') {
        const last = keys[keys.length - 1];
        keys.push({ ageMonth: last ? last.ageMonth + 12 : 0, value: last ? last.value : 0 });
        afcEdSetKeys(curve, keys);
    } else if (btn.dataset.act === 'mult') {
        const x = parseFloat(btn.parentElement.querySelector('.afced-mult-x').value);
        if (!(x >= 0)) return;
        afcEdSetKeys(curve, keys.map(k => ({ ageMonth: k.ageMonth, value: Math.round(k.value * x * 10000) / 10000 })));
    } else if (btn.dataset.act === 'reset') {
        delete afcEd.edits[curve.id];
    } else return;
    afcEdRender();
}

async function afcEdOnSideClick(e) {
    const breedBtn = e.target.closest('.afced-breed');
    if (breedBtn) {
        afcEd.sel = breedBtn.dataset.sub;
        afcEdRender();
        document.getElementById('afced-main').scrollTop = 0;
        return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn || afcEd.busy) return;
    const act = btn.dataset.act;
    if (act === 'zip') await afcEdChooseZip();
    else if (act === 'save') await afcEdSave();
    else if (act === 'discard') { afcEd.edits = {}; afcEd.message = null; }
    else if (act === 'mine') afcEdApplyChanges(afcEdReadChanges().curves);
    else if (act === 'export') await afcEdExport();
    else if (act === 'import') await afcEdImport();
    else if (act === 'restore') await afcEdRestore(document.querySelector('#afced-side .afced-backup').value);
    afcEdRender();
}

async function afcEdChooseZip() {
    const n = afcEdChangedIds().length;
    if (n && !(await showConfirm({ title: t('afcEdTitle'), body: t('afcEdLeaveUnsaved').replace('{n}', n), danger: true }))) return;
    const res = await ipcRenderer.invoke('show-open-dialog', {
        properties: ['openFile'],
        defaultPath: afcEd.zip || path.join(tlGameDir(), 'mods'),
        filters: [{ name: 'ZIP', extensions: ['zip'] }]
    });
    if (!res || res.canceled || !res.filePaths.length) return;
    setSetting('afcEditorZip', res.filePaths[0]);
    afcEd.message = null;
    afcEdLoad(res.filePaths[0]);
}

// Puts saved or imported curves into the editor (not into the zip yet).
function afcEdApplyChanges(curves) {
    let n = 0, skipped = 0;
    Object.keys(curves || {}).forEach(id => {
        const c = afcEdCurve(id);
        if (!c) { skipped++; return; }
        afcEdSetKeys(c, afcCore.afcCleanKeys(curves[id]));
        n++;
    });
    afcEd.message = { text: t('afcEdApplied').replace('{n}', n).replace('{s}', skipped), error: false };
}

// The game holds the mod's zip while it runs.
async function afcEdGameClosed() {
    if (!(await tlGameRunning())) return true;
    await showNotice(t('afcEdTitle'), t('afcEdGameRunning'), true);
    return false;
}

async function afcEdSave() {
    const ids = afcEdChangedIds();
    if (!ids.length || !afcEd.zip) return;
    if (!(await afcEdGameClosed())) return;
    const ok = await showConfirm({
        title: t('afcEdSaveConfirmTitle'),
        body: t('afcEdSaveConfirm').replace('{n}', ids.length).replace('{zip}', afcEd.zip).replace('{dir}', AFC_ED_BACKUPS())
    });
    if (!ok) return;
    const edits = {};
    ids.forEach(id => { edits[id] = afcEd.edits[id]; });
    afcEd.busy = true;
    afcEdRender();
    try {
        const r = afcCore.afcApplyEdits(afcEd.xml, edits);
        const backup = await afcCore.afcSaveZip(afcEd.zip, r.xml, AFC_ED_BACKUPS());
        const changes = afcEdReadChanges();
        r.changed.forEach(id => { changes.curves[id] = afcCore.afcCleanKeys(edits[id]); });
        changes.mod = afcCore.AFC_EDITOR_MOD;
        changes.version = afcEd.version;
        changes.updated = new Date().toISOString();
        afcEdWriteChanges(changes);
        afcEdLoad(afcEd.zip);
        afcEd.message = { text: t('afcEdSaved').replace('{n}', r.changed.length).replace('{file}', path.basename(backup)), error: false };
    } catch (e) {
        console.error('AFC editor: save failed', e);
        afcEd.message = { text: t('afcEdError').replace('{msg}', e.message), error: true };
    } finally {
        afcEd.busy = false;
    }
}

async function afcEdExport() {
    const res = await ipcRenderer.invoke('show-save-dialog', {
        defaultPath: 'afc-editor-changes.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (!res || res.canceled || !res.filePath) return;
    fs.writeFileSync(res.filePath, JSON.stringify(afcEdReadChanges(), null, 2), 'utf-8');
}

async function afcEdImport() {
    const res = await ipcRenderer.invoke('show-open-dialog', {
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (!res || res.canceled || !res.filePaths.length) return;
    let curves = null;
    try { curves = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf-8')).curves; } catch { /* below */ }
    if (!curves || typeof curves !== 'object') {
        afcEd.message = { text: t('afcEdImportBad'), error: true };
        return;
    }
    afcEdApplyChanges(curves);
}

async function afcEdRestore(backup) {
    if (!backup || !afcEd.zip) return;
    const n = afcEdChangedIds().length;
    const body = t('afcEdRestoreConfirm').replace('{file}', path.basename(backup)) + (n ? '\n\n' + t('afcEdLeaveUnsaved').replace('{n}', n) : '');
    if (!(await showConfirm({ title: t('afcEdBackups'), body, danger: true }))) return;
    if (!(await afcEdGameClosed())) return;
    try {
        const current = afcCore.afcRestoreZip(afcEd.zip, backup, AFC_ED_BACKUPS());
        afcEdLoad(afcEd.zip);
        afcEd.message = { text: t('afcEdRestored').replace('{file}', current ? path.basename(current) : '–'), error: false };
    } catch (e) {
        console.error('AFC editor: restore failed', e);
        afcEd.message = { text: t('afcEdError').replace('{msg}', e.message), error: true };
    }
}

(function initAfcEditor() {
    const open = document.getElementById('afced-open-btn');
    if (open) {
        open.hidden = !IS_DEV_BUILD;
        open.addEventListener('click', () => {
            closeModal(document.getElementById('app-settings-modal'));
            afcEdOpen();
        });
    }
    const back = document.getElementById('afced-back');
    if (back) back.addEventListener('click', afcEdClose);
    const side = document.getElementById('afced-side');
    if (side) {
        side.addEventListener('click', afcEdOnSideClick);
        side.addEventListener('input', e => {
            if (!e.target.classList.contains('afced-filter')) return;
            afcEd.filter = e.target.value;
            const pos = e.target.selectionStart;
            afcEdRenderSide();
            const f = side.querySelector('.afced-filter');
            f.focus();
            f.setSelectionRange(pos, pos);
        });
    }
    const main = document.getElementById('afced-main');
    if (main) {
        main.addEventListener('change', afcEdOnMainChange);
        main.addEventListener('click', afcEdOnMainClick);
    }
})();
