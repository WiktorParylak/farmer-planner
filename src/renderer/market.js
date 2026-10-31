// Market prices from the savegame (loaded before renderer.js: constants and
// functions only). economy.xml keeps, per fill type, the price curve of the
// game's Prices screen — <history><period period="EARLY_SPRING">350</period>
// … — in money per 1000 l (FillTypeDesc: history[period] = factor × pricePerLiter).
// The same file has the great demands of the selling points. Input prices
// (SEEDS, FERTILIZER, LIME…) are there too, so seed, fertilizer and lime costs
// come from the same curve. Selling points add their own fluctuation and the
// economy difficulty its multiplier — neither is in the save, so these are the
// game's base prices.

// The game's periods in order: period 1 = EARLY_SPRING = March (FS_PERIOD_TO_MONTH).
const MARKET_PERIODS = ['EARLY_SPRING', 'MID_SPRING', 'LATE_SPRING', 'EARLY_SUMMER', 'MID_SUMMER', 'LATE_SUMMER',
    'EARLY_AUTUMN', 'MID_AUTUMN', 'LATE_AUTUMN', 'EARLY_WINTER', 'MID_WINTER', 'LATE_WINTER'];
const MARKET_MONTHS = ['MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER', 'JANUARY', 'FEBRUARY'];

// What a field takes per hectare, priced from the same curve.
const MARKET_INPUT_FILLTYPES = { seed: 'SEEDS', fertilizer: 'FERTILIZER', lime: 'LIME' };

// Green manure: worked into the soil, not sold — no price, no revenue.
const MARKET_UNSOLD_CROPS = ['Oilseedradish'];

// Crops whose harvest is sold under another fill type name.
const MARKET_CROP_FILLTYPE = { Rice: 'RICE', Ricelonggrain: 'RICELONGGRAIN', Greenrye: 'GREENRYE' };

// economy.xml of the save -> { prices: { FILLTYPE: [12 prices per 1000 l | null] },
// demands: [{ fillType, multiplier, startDay, startHour, hours, running, station }] }, or null.
function readSaveMarket(saveGamePath) {
    if (!saveGamePath) return null;
    const dir = path.dirname(saveGamePath);
    const econPath = path.join(dir, 'economy.xml');
    if (!fs.existsSync(econPath)) return null;
    try {
        const text = fs.readFileSync(econPath, 'utf-8');
        const prices = {};
        for (const m of text.matchAll(/<fillType\s+fillType="([^"]+)"[^>]*?(?<!\/)>([\s\S]*?)<\/fillType>/g)) {
            const row = MARKET_PERIODS.map(() => null);
            let any = false;
            for (const p of m[2].matchAll(/<period\s+period="([A-Z_]+)">\s*([\d.]+)\s*<\/period>/g)) {
                const i = MARKET_PERIODS.indexOf(p[1]);
                const v = parseFloat(p[2]);
                if (i >= 0 && isFinite(v)) { row[i] = v; any = true; }
            }
            if (any) prices[m[1].toUpperCase()] = row;
        }
        const stations = readMarketStationNames(dir);
        const demands = [];
        for (const m of text.matchAll(/<greatDemand\s[^>]*\/>/g)) {
            const a = name => { const mm = m[0].match(new RegExp('\\s' + name + '="([^"]*)"')); return mm ? mm[1] : ''; };
            if (a('isValid') === 'false') continue;
            demands.push({
                fillType: a('fillTypeName').toUpperCase(),
                multiplier: parseFloat(a('demandMultiplier')) || 1,
                startDay: parseInt(a('demandStartDay'), 10) || 0,
                startHour: parseInt(a('demandStartHour'), 10) || 0,
                hours: parseInt(a('demandDuration'), 10) || 0,
                running: a('isRunning') === 'true',
                station: stations[a('uniqueId')] || ''
            });
        }
        return { prices, demands };
    } catch (e) {
        console.error('readSaveMarket failed', e);
        return null;
    }
}

// Selling points by uniqueId: the name the player gave the placeable, else its
// file name made readable ("grainElevatorBig.xml" -> "Grain elevator big").
function readMarketStationNames(dir) {
    const out = {};
    const p = path.join(dir, 'placeables.xml');
    if (!fs.existsSync(p)) return out;
    try {
        const text = fs.readFileSync(p, 'utf-8');
        for (const m of text.matchAll(/<placeable\s[^>]*>/g)) {
            const id = (m[0].match(/\suniqueId="([^"]+)"/) || [])[1];
            if (!id) continue;
            const own = (m[0].match(/\sname="([^"]+)"/) || [])[1];
            const file = (m[0].match(/\sfilename="([^"]+)"/) || [])[1] || '';
            const base = file.split(/[\\/]/).pop().replace(/\.xml$/i, '');
            const words = base.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
            out[id] = plainMarketText(own || (words ? words[0].toUpperCase() + words.slice(1) : ''));
        }
    } catch (e) { /* names are optional */ }
    return out;
}

// Text from the save goes into the UI's HTML.
function plainMarketText(s) {
    return String(s || '').replace(/[<>"'`]/g, '');
}

// Read again only when economy.xml changes (every panel render asks).
let marketCache = { key: null, data: null };
function getFarmMarket(farm) {
    // The developer test farm has no save; it brings its own prices (dev-farm.js).
    if (farm && farm.devMarket) return farm.devMarket;
    if (!farm || !farm.saveGamePath) return null;
    let key = null;
    try { key = farm.saveGamePath + ':' + fs.statSync(path.join(path.dirname(farm.saveGamePath), 'economy.xml')).mtimeMs; }
    catch (e) { return null; }
    if (marketCache.key !== key) marketCache = { key, data: readSaveMarket(farm.saveGamePath) };
    return marketCache.data;
}

// Index of a month in the game's period order (March = 0), or -1.
function marketPeriodIndex(month) {
    return MARKET_MONTHS.indexOf(String(month || '').toUpperCase());
}

// The fill type a crop is sold as, if the save prices it.
function marketCropFillType(market, crop) {
    if (!market || !crop || MARKET_UNSOLD_CROPS.includes(crop)) return null;
    const direct = MARKET_CROP_FILLTYPE[crop];
    if (direct && market.prices[direct]) return direct;
    const collapsed = String(crop).replace(/[_\s]+/g, '').toUpperCase();
    return market.prices[collapsed] ? collapsed : null;
}

// Price per 1000 l of a fill type in a month (default: the farm's month), or null.
function marketPrice(market, fillType, month) {
    const row = market && fillType ? market.prices[fillType] : null;
    const i = marketPeriodIndex(month);
    if (!row || i < 0) return null;
    return row[i];
}

// { now, min, max, best (month), bestIdx, change (best vs now, 0..) } of a fill type.
function marketPriceSummary(market, fillType, month) {
    const row = market && fillType ? market.prices[fillType] : null;
    if (!row) return null;
    const vals = row.filter(v => v !== null);
    if (!vals.length) return null;
    const max = Math.max(...vals), min = Math.min(...vals);
    const bestIdx = row.indexOf(max);
    const now = marketPrice(market, fillType, month);
    return { now, min, max, bestIdx, best: MARKET_MONTHS[bestIdx], change: now ? max / now - 1 : null };
}

// Input costs of one crop on one field, per hectare: seed (its seed rate),
// mineral fertilizer (what the nitrogen plan still needs, at the farm's N per
// litre) and lime when the field needs liming this season. null parts when
// the save has no price.
function fieldInputCostPerHa(farm, field, idx, crop, rates, market, limeLitresByField) {
    const soilMix = getFieldSoilMix(fertPlanSoilKey(field, idx), rates);
    const price = ft => marketPrice(market, ft, farm && farm.month);
    const seedPrice = price(MARKET_INPUT_FILLTYPES.seed);
    const fertPrice = price(MARKET_INPUT_FILLTYPES.fertilizer);
    const limePrice = price(MARKET_INPUT_FILLTYPES.lime);
    const seedRate = fieldSeedRate(crop, soilMix, rates);
    const area = parseFloat(field.area) || 0;
    const plan = area > 0 ? computeFieldFertPlan(fertPlanKey(field, idx), fertPlanSoilKey(field, idx), crop, area, rates) : null;
    const key = (field.number || '').toString().trim();
    const limeL = limeLitresByField && key && limeLitresByField[key] ? limeLitresByField[key].litres / (limeLitresByField[key].area || area || 1) : 0;
    const seed = seedPrice !== null && seedRate !== null ? seedRate * seedPrice / 1000 : null;
    const fertilizer = fertPrice !== null && plan ? plan.mineralLitres * fertPrice / 1000 : null;
    const lime = limePrice !== null ? limeL * limePrice / 1000 : null;
    return { seed, fertilizer, lime, total: [seed, fertilizer, lime].reduce((s, v) => s + (v || 0), 0), known: seed !== null && fertilizer !== null };
}

// Lime litres per field number this season, from the Supplies lime rows.
function marketLimeByField(farm, rates) {
    const out = {};
    buildSuppliesLimeRows(farm, rates).rows.forEach(r => {
        const buffer = 1 + (parseFloat(rates.bufferPct) || 0) / 100;
        out[r.number] = { litres: r.buffered / buffer, area: r.area };
    });
    return out;
}

// Per crop of the season: price now, revenue of its predicted yield, input
// costs and gross margin per hectare (seed, mineral fertilizer, lime — no
// machines, fuel or wages). yieldRows: buildYieldForecastRows(...).rows.
function buildCropMarginRows(farm, fields, rates, yieldRows) {
    const market = getFarmMarket(farm);
    if (!market) return null;
    const limeByField = marketLimeByField(farm, rates);
    const costs = {};
    (fields || []).forEach((f, i) => {
        const area = parseFloat(f.area) || 0;
        if (area <= 0) return;
        [f.crop, f.catchCrop].filter(Boolean).forEach(crop => {
            const c = fieldInputCostPerHa(farm, f, i, crop, rates, market, crop === f.crop ? limeByField : null);
            const e = costs[crop] || (costs[crop] = { area: 0, cost: 0, known: true });
            e.area += area;
            e.cost += c.total * area;
            if (!c.known) e.known = false;
        });
    });
    const byCrop = {};
    yieldRows.forEach(r => {
        const fillType = marketCropFillType(market, r.crop);
        const summary = fillType ? marketPriceSummary(market, fillType, farm.month) : null;
        const price = summary ? summary.now : null;
        const revenue = price !== null && r.known ? r.litres * price / 1000 : null;
        const c = costs[r.crop] || { area: r.area, cost: 0, known: false };
        const costPerHa = c.area > 0 ? c.cost / c.area : null;
        const marginPerHa = revenue !== null && r.area > 0 ? (revenue - c.cost) / r.area : null;
        byCrop[r.crop] = { fillType, summary, price, revenue, costPerHa, costKnown: c.known, marginPerHa };
    });
    return { market, byCrop };
}

// Great demands still to come or running, soonest first, with hours from now.
// gameDay / dayMinutes: the save's currentDay and time of day (minutes).
function marketUpcomingDemands(market, gameDay, dayMinutes) {
    if (!market || !gameDay) return [];
    const nowH = gameDay * 24 + (dayMinutes || 0) / 60;
    return market.demands.map(d => {
        const startH = d.startDay * 24 + d.startHour;
        return { ...d, inHours: startH - nowH, endsInHours: startH + d.hours - nowH };
    }).filter(d => d.endsInHours > 0).sort((a, b) => a.inHours - b.inHours);
}

// ---------- Views (used by the Yields and prices panel) ----------

// 12-period price line, March to February, with this month and the best month marked.
function marketSparklineSvg(row, nowIdx, bestIdx) {
    const W = 132, H = 30, pad = 4;
    const vals = row.filter(v => v !== null);
    if (vals.length < 2) return '';
    const min = Math.min(...vals), max = Math.max(...vals);
    const span = max - min || 1;
    const x = i => pad + i * (W - 2 * pad) / (row.length - 1);
    const y = v => H - pad - (v - min) / span * (H - 2 * pad);
    let d = '', pen = false;
    row.forEach((v, i) => {
        if (v === null) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
        pen = true;
    });
    const dot = (i, cls) => i >= 0 && row[i] !== null ? `<circle class="${cls}" cx="${x(i).toFixed(1)}" cy="${y(row[i]).toFixed(1)}" r="3"/>` : '';
    return `<svg class="market-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
        <path class="market-spark-line" d="${d.trim()}"/>${dot(bestIdx, 'market-spark-best')}${dot(nowIdx, 'market-spark-now')}</svg>`;
}

function marketShortMonth(month) {
    return translateMonth(month).slice(0, 3);
}

// "Prices this year": the farm's crops, then what it buys for them.
function marketPricesCardHtml(farm, market, yieldRows) {
    const nowIdx = marketPeriodIndex(farm.month);
    const rowHtml = (label, fillType) => {
        const s = marketPriceSummary(market, fillType, farm.month);
        if (!s) return '';
        const up = s.change !== null && s.change > 0.005;
        const best = s.bestIdx === nowIdx
            ? `<span class="market-badge market-badge--now">${t('marketBestNow')}</span>`
            : `${marketShortMonth(s.best)}${up ? ` <span class="market-badge">+${Math.round(s.change * 100)}%</span>` : ''}`;
        return `<tr><td>${label}</td>
            <td class="market-spark-cell">${marketSparklineSvg(market.prices[fillType], nowIdx, s.bestIdx)}</td>
            <td>${s.now !== null ? finMoney(s.now) : '–'}</td>
            <td>${finMoney(s.min)} – ${finMoney(s.max)}</td>
            <td>${best}</td></tr>`;
    };
    const crops = yieldRows.map(r => [translateCropName(r.crop), marketCropFillType(market, r.crop)]).filter(([, ft]) => ft);
    const seen = new Set();
    const cropRows = crops.filter(([, ft]) => !seen.has(ft) && seen.add(ft)).map(([label, ft]) => rowHtml(label, ft)).join('');
    const inputRows = Object.values(MARKET_INPUT_FILLTYPES).map(ft => rowHtml(formatFillType(ft), ft)).join('');
    if (!cropRows && !inputRows) return '';
    const head = `<thead><tr><th>${t('marketColProduct')}</th><th>${t('marketColYear')}</th><th>${t('marketColNow')}</th><th>${t('marketColRange')}</th><th>${t('marketColBest')}</th></tr></thead>`;
    return `<section class="fin-card market-card">
        <div class="fin-card-head"><h4>${t('marketPricesTitle')}</h4>
            <div class="chart-legend fin-legend"><span class="fin-legend-item"><span class="market-key market-key--now"></span>${t('marketKeyNow')}</span><span class="fin-legend-item"><span class="market-key market-key--best"></span>${t('marketKeyBest')}</span></div></div>
        <table class="data-table supply-table market-table">${head}
            <tbody>${cropRows}${inputRows ? `<tr class="market-group-row"><td colspan="5">${t('marketInputsGroup')}</td></tr>${inputRows}` : ''}</tbody></table>
        <p class="hub-panel-note">${t('marketPricesNote')}</p>
    </section>`;
}

// "2 d 4 h" / "5 h"
function marketHoursText(h) {
    const total = Math.max(0, Math.round(h));
    const d = Math.floor(total / 24), rest = total % 24;
    if (!d) return t('marketHours').replace('{h}', rest);
    return t('marketDaysHours').replace('{d}', d).replace('{h}', rest);
}

// Great demands of the selling points: running ones, then the next ones; the
// farm's crops first.
function marketDemandsCardHtml(farm, market) {
    const list = marketUpcomingDemands(market, farm.gameDay, farm.dayMinutes);
    if (!list.length) return '';
    const farmTypes = new Set((farm.fields || []).flatMap(f => [f.crop, f.catchCrop]).filter(Boolean).map(c => marketCropFillType(market, c)).filter(Boolean));
    const nameOf = ft => {
        const crop = AVAILABLE_CROPS.find(c => marketCropFillType(market, c) === ft);
        return crop ? translateCropName(crop) : formatFillType(ft);
    };
    const sorted = list.slice().sort((a, b) => (farmTypes.has(b.fillType) - farmTypes.has(a.fillType)) || (a.inHours - b.inHours));
    const items = sorted.slice(0, 8).map(d => {
        const live = d.inHours <= 0;
        const when = live ? t('marketDemandRunning').replace('{t}', marketHoursText(d.endsInHours))
            : t('marketDemandStarts').replace('{t}', marketHoursText(d.inHours)).replace('{h}', d.hours);
        return `<li class="market-demand${live ? ' is-live' : ''}${farmTypes.has(d.fillType) ? ' is-own' : ''}">
            <span class="market-demand-name">${escapeHtml(nameOf(d.fillType))}</span>
            <span class="market-badge${live ? ' market-badge--now' : ''}">+${Math.round((d.multiplier - 1) * 100)}%</span>
            <span class="market-demand-when">${escapeHtml(when)}</span>
            ${d.station ? `<span class="market-demand-station">${escapeHtml(d.station)}</span>` : ''}
        </li>`;
    }).join('');
    return `<section class="fin-card market-card">
        <div class="fin-card-head"><h4>${t('marketDemandsTitle')}</h4></div>
        <ul class="market-demands">${items}</ul>
    </section>`;
}

// "≈ 1 234 €" under a Supplies total: litres of a fill type at this month's price.
function marketCostHtml(farm, fillType, litres) {
    const price = marketPrice(getFarmMarket(farm), fillType, farm && farm.month);
    if (price === null || !(litres > 0)) return '';
    return `<span class="supply-sub supply-cost">≈ ${finMoney(litres * price / 1000)}</span>`;
}
