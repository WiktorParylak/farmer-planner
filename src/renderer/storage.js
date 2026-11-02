// Storage and productions: everything the farm holds and makes, not only what
// animals eat. Read from the save at each sync (read-only) into farm.storage:
//   { places: [{ id, name, kind, fills: { FILLTYPE: litres }, state }],
//     totals: { FILLTYPE: { silo, bunker, heap, bale, pallet } } }
// Barns keep their own storage in the Animals view and productions below.
// A manure heap's level isn't in the save (no node in any local save, only
// manureToDrop / manureToPick), so a heap without nodes reads as unknown, not empty.
// Loaded before renderer.js: only constants and functions at the top level.

// The game's own bunker silo states: filling, covered, fermented, opened.
const STORAGE_BUNKER_STATES = ['fill', 'closed', 'fermented', 'drain'];
const STORAGE_SOURCES = ['silo', 'bunker', 'heap', 'bale', 'pallet'];

function readFarmStorageFromSave(saveFolder, modsDirs) {
    const places = [];
    const totals = {};
    const add = (fillType, source, litres) => {
        if (!fillType || !(litres > 0)) return;
        const key = String(fillType).toUpperCase();
        const e = totals[key] || (totals[key] = {});
        e[source] = (e[source] || 0) + litres;
    };
    const parse = name => {
        const p = path.join(saveFolder, name);
        if (!fs.existsSync(p)) return null;
        const doc = new DOMParser().parseFromString(fs.readFileSync(p, 'utf-8'), 'text/xml');
        return doc.querySelector('parsererror') ? null : doc;
    };
    const nameCache = {};
    const placeName = filename => {
        if (filename in nameCache) return nameCache[filename];
        let name = '';
        try {
            const bytes = modFiles.readModFile(modsDirs, filename);
            const def = bytes ? new DOMParser().parseFromString(bytes.toString('utf8'), 'text/xml') : null;
            const el = def && !def.querySelector('parsererror') ? def.querySelector('storeData > name') : null;
            name = el ? plainModText((el.querySelector('en') || el).textContent.trim()) : '';
        } catch (e) { /* the file name will do */ }
        if (!name || name.startsWith('$')) name = plainModText(filename.replace(/\\/g, '/').split('/').pop().replace(/\.xml$/i, ''));
        return (nameCache[filename] = name);
    };

    const placeables = parse('placeables.xml');
    if (placeables) {
        placeables.querySelectorAll(`placeable[farmId="${SAVE_FARM_ID}"]`).forEach(pl => {
            if (pl.querySelector(':scope > husbandry')) return;
            const bunker = pl.querySelector(':scope > bunkerSilo');
            const heap = pl.querySelector(':scope > manureHeap');
            const silo = pl.querySelector(':scope > silo, :scope > siloExtension');
            const shed = pl.querySelector(':scope > objectStorage');
            if (!bunker && !heap && !silo && !shed) return;
            const fills = {};
            const put = (fillType, source, litres) => {
                if (!fillType || !(litres > 0)) return;
                const key = String(fillType).toUpperCase();
                fills[key] = (fills[key] || 0) + litres;
                add(key, source, litres);
            };
            let kind = 'silo', state = null;
            if (bunker) {
                kind = 'bunker';
                state = STORAGE_BUNKER_STATES[parseInt(bunker.getAttribute('state'), 10)] || null;
                // Chaff until it has fermented, silage from then on.
                put(state === 'fill' || state === 'closed' ? 'CHAFF' : 'SILAGE', 'bunker', parseFloat(bunker.getAttribute('fillLevel')));
            } else if (heap) {
                kind = 'heap';
                heap.querySelectorAll('node[fillType]').forEach(n => put(n.getAttribute('fillType'), 'heap', parseFloat(n.getAttribute('fillLevel'))));
            } else if (silo) {
                silo.querySelectorAll('node[fillType]').forEach(n => put(n.getAttribute('fillType'), 'silo', parseFloat(n.getAttribute('fillLevel'))));
            } else {
                kind = 'shed';
            }
            if (shed) {
                shed.querySelectorAll('object').forEach(o => put(o.getAttribute('fillType'), 'bale', parseFloat(o.getAttribute('fillLevel'))));
            }
            places.push({ id: pl.getAttribute('uniqueId') || String(places.length), name: placeName(pl.getAttribute('filename') || ''), kind, fills, state });
        });
    }
    const items = parse('items.xml');
    if (items) {
        items.querySelectorAll(`item[className="Bale"][farmId="${SAVE_FARM_ID}"]`).forEach(b =>
            add(b.getAttribute('fillType'), 'bale', parseFloat(b.getAttribute('fillLevel'))));
    }
    const vehicles = parse('vehicles.xml');
    if (vehicles) {
        vehicles.querySelectorAll(`vehicle[farmId="${SAVE_FARM_ID}"]`).forEach(v => {
            if (!v.querySelector(':scope > pallet')) return;
            v.querySelectorAll(':scope > fillUnit > unit[fillType]').forEach(u =>
                add(u.getAttribute('fillType'), 'pallet', parseFloat(u.getAttribute('fillLevel'))));
        });
    }
    return { places, totals };
}

// feedFillTypeName alone would keep "Seeds" as a crop name before trying the product names.
function storageFillName(fillType, production) {
    const dict = PRODUCTION_FILLTYPE_TRANSLATIONS[currentLang];
    return (dict && dict[fillType]) || feedFillTypeName(fillType, production);
}

function storageLitres(v) {
    return `${Math.round(v).toLocaleString(FIN_LOCALE())} l`;
}

function storageTotalsHtml(totals) {
    const types = Object.keys(totals).map(ft => {
        const sum = STORAGE_SOURCES.reduce((s, k) => s + (totals[ft][k] || 0), 0);
        return { ft, sum };
    }).filter(x => x.sum > 0).sort((a, b) => b.sum - a.sum);
    if (!types.length) return `<p class="hub-panel-note">${t('storageNothing')}</p>`;
    const used = STORAGE_SOURCES.filter(k => types.some(x => totals[x.ft][k] > 0));
    const cell = v => (v > 0 ? storageLitres(v) : '–');
    return `<table class="data-table supply-table storage-table"><thead><tr>
            <th>${t('storageColFill')}</th>${used.map(k => `<th>${t('storageSource_' + k)}</th>`).join('')}<th>${t('suppliesTotal')}</th>
        </tr></thead><tbody>${types.map(x => `<tr>
            <td>${escapeHtml(storageFillName(x.ft))}</td>${used.map(k => `<td>${cell(totals[x.ft][k])}</td>`).join('')}<td><strong>${storageLitres(x.sum)}</strong></td>
        </tr>`).join('')}</tbody></table>`;
}

function storagePlacesHtml(places) {
    if (!places.length) return `<p class="hub-panel-note">${t('storageNoPlaces')}</p>`;
    const order = { silo: 0, bunker: 1, heap: 2, shed: 3 };
    const rows = places.slice().sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name)).map(p => {
        const fills = Object.keys(p.fills).sort((a, b) => p.fills[b] - p.fills[a]).map(ft => `${escapeHtml(storageFillName(ft))} ${storageLitres(p.fills[ft])}`);
        const state = p.kind === 'bunker' && p.state && fills.length ? ` <span class="storage-state">${escapeHtml(t('storageBunker_' + p.state))}</span>` : '';
        return `<tr><td>${escapeHtml(p.name)}${state}</td><td>${escapeHtml(t('storageKind_' + p.kind))}</td>
            <td class="storage-fills">${fills.length ? fills.join('<br>') : `<span class="storage-empty">${t(p.kind === 'heap' ? 'storageHeapNotSaved' : 'storageEmpty')}</span>`}</td></tr>`;
    }).join('');
    return `<table class="data-table supply-table storage-table storage-table--places"><thead><tr>
        <th>${t('storageColPlace')}</th><th>${t('storageColKind')}</th><th>${t('storageColContents')}</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

// One production: each line's input and output per in-game month, its cost and
// whether it runs. A cost the mod's file doesn't give shows as unknown.
const STORAGE_CLOSED_SETTING = 'storageClosedProductions';

function storageClosedProductions() {
    try { return new Set(JSON.parse(getSetting(STORAGE_CLOSED_SETTING) || '[]')); }
    catch (e) { return new Set(); }
}

function storageProductionKey(p) {
    return String(p.id || p.name || '');
}

function storageProductionHtml(p, closed) {
    const fill = ft => storageFillName(ft, p);
    const per = (list, r) => list.map(i => `${escapeHtml(fill(i.fillType))} ${storageLitres(i.amount * r.cyclesPerMonth)}`).join('<br>') || '–';
    const lines = p.recipes.map(r => `<tr class="${r.enabled ? '' : 'is-off'}">
            <td>${t(r.enabled ? 'storageLineOn' : 'storageLineOff')}</td>
            <td>${per(r.inputs, r)}</td><td>${per(r.outputs, r)}</td>
            <td>${typeof r.costPerMonth === 'number' ? finMoney(r.costPerMonth) : '–'}</td>
        </tr>`).join('');
    const on = p.recipes.filter(r => r.enabled);
    const cost = on.reduce((s, r) => s + (r.costPerMonth || 0), 0);
    const stock = Object.keys(p.stock || {}).sort((a, b) => p.stock[b] - p.stock[a]).map(ft => `${escapeHtml(fill(ft))} ${storageLitres(p.stock[ft])}`).join(' · ');
    const title = (p.nameTitles && (p.nameTitles[currentLang] || p.nameTitles.en)) || p.name;
    const key = storageProductionKey(p);
    return `<details class="storage-production" data-storage-key="${escapeHtml(key)}"${closed.has(key) ? '' : ' open'}>
        <summary class="storage-production-head">
            <i class="fa-solid fa-chevron-right storage-production-chevron" aria-hidden="true"></i>
            <h4>${escapeHtml(plainModText(title))}</h4>
            <span class="storage-production-sum">${on.length ? escapeHtml(t('storageLinesOn').replace('{n}', on.length).replace('{all}', p.recipes.length)) + (cost > 0 ? ' · ' + escapeHtml(t('storageCostMonth').replace('{v}', finMoney(cost))) : '') : escapeHtml(t('storageNoLinesOn'))}</span>
        </summary>
        <table class="data-table supply-table storage-table"><thead><tr>
            <th>${t('storageColLine')}</th><th>${t('storageColIn')}</th><th>${t('storageColOut')}</th><th>${t('storageColCost')}</th>
        </tr></thead><tbody>${lines}</tbody></table>
        ${stock ? `<p class="hub-panel-note storage-stock">${escapeHtml(t('storageInStock'))}: ${stock}</p>` : ''}
    </details>`;
}

function renderStoragePanel(titleEl, bodyEl) {
    titleEl.textContent = t('hubStorage');
    const farm = getCurrentFarm();
    const storage = farm && farm.storage;
    const productions = (farm && farm.productions) || [];
    if (!storage && !productions.length) {
        bodyEl.innerHTML = `<p class="hub-panel-note">${t(farm && farm.saveGamePath ? 'storageNothing' : 'storageNoSave')}</p>`;
        return;
    }
    const closed = storageClosedProductions();
    let html = `<p class="supply-intro">${t('storageIntro')}</p>`;
    if (storage) {
        html += `<h3 class="hub-panel-subtitle">${t('storageTotalsTitle')}</h3>${storageTotalsHtml(storage.totals || {})}`;
        html += `<h3 class="hub-panel-subtitle">${t('storagePlacesTitle')}</h3>${storagePlacesHtml(storage.places || [])}`;
    }
    html += `<h3 class="hub-panel-subtitle">${t('storageProductionsTitle')}</h3>`;
    html += productions.length ? productions.map(x => storageProductionHtml(x, closed)).join('') : `<p class="hub-panel-note">${t('storageNoProductions')}</p>`;
    bodyEl.innerHTML = html;
    bodyEl.querySelectorAll('details.storage-production').forEach(d => d.addEventListener('toggle', () => {
        const now = storageClosedProductions();
        if (d.open) now.delete(d.dataset.storageKey); else now.add(d.dataset.storageKey);
        setSetting(STORAGE_CLOSED_SETTING, JSON.stringify([...now]));
    }));
}
