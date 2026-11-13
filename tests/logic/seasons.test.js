// Seasons: what a new season clears, archives and can take back.
const archivePath = (farm, n) => path.join(appDataDir, farm.folderName, 'seasons', `season_${n}.json`);

async function newSeason() {
    const done = runNewSeason();
    await answerDialog('confirm');
    await answerDialog('confirm');
    await done;
}

test('timeline: only the bars of this season\'s plan open the field window', () => {
    const f = field({ state: 'Planted' });
    const source = { season: 3, generated: false };
    const bars = [
        { crop: 'Wheat', sowingMonth: 'OCTOBER', from: 0, to: 3, lane: 0 },
        { crop: 'Barley', sowingMonth: 'OCTOBER', from: 12, to: 15, lane: 0, source },
        { crop: 'Oilseedradish', sowingMonth: 'AUGUST', from: 16, to: 18, lane: 1, source }
    ];
    const box = document.createElement('div');
    box.innerHTML = timelineTrackHtml(bars, f, 0, 0, false, 24);
    assert.strictEqual(box.querySelectorAll('button.timeline-bar').length, 1);
    assert.strictEqual(box.querySelectorAll('span.timeline-bar').length, 2);
});

test('season: a field is cleared for the next crop', () => {
    const f = field({
        state: 'Planted', tillage: 'plowed', catchCrop: 'Oilseedradish', fertilizer: true, manure: true, weeds: 'done',
        work: [], workFor: 'x', workCleared: true, workDetected: { sow: true }, limePrev: { season: 1, ph: 1 }, cuts: [{}], deepTilled: true
    });
    clearFieldForNewSeason(f, 0, 2, getSupplyRates());
    assert.deepStrictEqual([f.crop, f.sowingMonth, f.state, f.tillage, f.catchCrop], ['', '', 'To Plant', null, '']);
    assert.deepStrictEqual([f.fertilizer, f.manure, f.weeds, f.cuts], [false, false, null, []]);
    ['work', 'workFor', 'workCleared', 'workDetected', 'limePrev', 'deepTilled'].forEach(k => assert.strictEqual(f[k], undefined, k));
});

test('season: grassland keeps its crop, this season\'s work is cleared', () => {
    const f = field({ crop: 'Grass', sowingMonth: 'MARCH', state: 'To Plant', tillage: 'noTill', fertilizer: true, cuts: [{}] });
    clearFieldForNewSeason(f, 0, 2, getSupplyRates());
    assert.deepStrictEqual([f.crop, f.sowingMonth, f.state, f.tillage], ['Grass', 'MARCH', 'Planted', 'noTill']);
    assert.deepStrictEqual([f.fertilizer, f.cuts], [false, []]);
});

test('season: a harvest lowers the pH, a crop that takes no lime does not', () => {
    const f = field({ limeAppliedSeason: 1, limePh: 0.9 });
    clearFieldForNewSeason(f, 0, 2, getSupplyRates());
    assert.ok(f.limePh < 0.9, 'lowered to ' + f.limePh);
    const g = field({ crop: 'Grass', limeAppliedSeason: 1, limePh: 0.9 });
    clearFieldForNewSeason(g, 0, 2, getSupplyRates());
    assert.strictEqual(g.limePh, 0.9);
});

test('season: an unlimed field stays unknown instead of getting a pH', () => {
    const f = field();
    clearFieldForNewSeason(f, 0, 2, getSupplyRates());
    assert.strictEqual(f.limePh, null);
});

test('season: a plan by season number becomes a plan by step', () => {
    const f = field({ planAhead: [{ season: 5, crop: 'Oat' }, { step: 3, crop: 'Rye' }, { season: 3, crop: 'Old' }] });
    normalizePlanAhead(f, 3);
    assert.deepStrictEqual(f.planAhead, [{ crop: 'Oat', step: 2 }, { step: 3, crop: 'Rye' }]);
});

test('season: cancelling a new season changes nothing', async () => {
    const farm = await freshFarm();
    const before = copy(farm);
    const done = runNewSeason();
    await answerDialog('cancel');
    await done;
    assert.deepStrictEqual(copy(getCurrentFarm()), before);
    assert.strictEqual(fs.existsSync(archivePath(farm, farm.currentSeason)), false);
});

test('season: a new season archives what came off and leaves what still grows', async () => {
    const farm = await freshFarm();
    const season = farm.currentSeason;
    const moving = seasonEndFinishIndexes(farm).map(i => farm.fields[i]);
    const cameOff = [...(farm.finishedCrops || []), ...moving.filter(f => f.crop)].map(f => f.number).sort();
    const staying = farm.fields.filter(f => !moving.includes(f) && f.crop).map(f => f.number + f.crop);
    assert.ok(moving.length && staying.length, 'the test farm should have both');
    await newSeason();
    const now = getCurrentFarm();
    assert.strictEqual(now.currentSeason, season + 1);
    const archive = JSON.parse(fs.readFileSync(archivePath(farm, season), 'utf-8'));
    assert.deepStrictEqual(archive.fields.map(f => f.number).sort(), cameOff);
    staying.forEach(k => assert.ok(now.fields.some(f => f.number + f.crop === k), k + ' stays on its field'));
    assert.deepStrictEqual(now.finishedCrops, []);
});

test('season: taking a new season back restores everything', async () => {
    const farm = await freshFarm();
    const before = copy(farm);
    await newSeason();
    assert.ok(readUndoSeason(getCurrentFarm()));
    const done = undoLastNewSeason();
    await answerDialog('confirm');
    await answerDialog('confirm');
    await done;
    const now = getCurrentFarm();
    assert.strictEqual(now.currentSeason, before.currentSeason);
    assert.deepStrictEqual(copy(now.fields), before.fields);
    assert.strictEqual(fs.existsSync(archivePath(farm, before.currentSeason)), false);
    assert.strictEqual(readUndoSeason(now), null);
});

test('season: an older archive under the same number is kept, not overwritten', async () => {
    const farm = await freshFarm();
    const file = archivePath(farm, farm.currentSeason);
    fs.writeFileSync(file, '{"old":true}');
    await newSeason();
    const kept = fs.readdirSync(path.dirname(file)).filter(n => n.startsWith(`season_${farm.currentSeason}_replaced_`));
    assert.strictEqual(kept.length, 1);
    assert.strictEqual(fs.readFileSync(path.join(path.dirname(file), kept[0]), 'utf-8'), '{"old":true}');
});

test('season: an undo left from another season is not offered', async () => {
    const farm = await freshFarm();
    fs.writeFileSync(undoSeasonPath(farm), JSON.stringify({ season: farm.currentSeason + 5, fields: [] }));
    assert.strictEqual(readUndoSeason(farm), null);
});

test('season: a season runs July to June across two game years', () => {
    assert.strictEqual(seasonStartYearOf(6, 'AUGUST'), 6);
    assert.strictEqual(seasonStartYearOf(6, 'JULY'), 6);
    assert.strictEqual(seasonStartYearOf(6, 'FEBRUARY'), 6);
    assert.strictEqual(seasonStartYearOf(7, 'MARCH'), 6);
    assert.strictEqual(seasonStartYearOf(7, 'JUNE'), 6);
    assert.strictEqual(seasonStartYearOf(1, 'MARCH'), 1, 'a game\'s first spring belongs to the first season');
    assert.strictEqual(seasonStartYearOf(0, 'MAY'), null);
});

test('season: a new season is due in July, not when the game year turns in March', () => {
    const farm = { saveGamePath: path.join(appDataDir, 'no-save', 'careerSavegame.xml'), seasonStartYear: 6, yearNumber: 7, month: 'MARCH' };
    assert.strictEqual(seasonEndInfo(farm).ready, false, 'March of the next game year');
    farm.month = 'JUNE';
    assert.strictEqual(seasonEndInfo(farm).ready, false, 'June');
    farm.month = 'JULY';
    assert.strictEqual(seasonEndInfo(farm).ready, true, 'July');
});

test('season: a farm from before 0.11.1 counts its season from now, without asking for a new one', () => {
    const farm = { yearNumber: 7, month: 'APRIL', seasonStartedGameYear: 6 };
    assert.strictEqual(farmSeasonStartYear(farm), 6);
    farm.saveGamePath = path.join(appDataDir, 'no-save', 'careerSavegame.xml');
    assert.strictEqual(seasonEndInfo(farm).ready, false);
});

test('season: a new season keeps the year it began in, started early it is the next one', async () => {
    const farm = await freshFarm();
    const start = farm.seasonStartYear;
    farm.month = 'MAY';   // before July: the season still running began the July before
    saveFarmData(farm, { undo: false });
    await newSeason();
    const now = getCurrentFarm();
    assert.strictEqual(now.seasonStartYear, start + 1);
    const archive = JSON.parse(fs.readFileSync(archivePath(farm, farm.currentSeason), 'utf-8'));
    assert.strictEqual(archive.seasonStartYear, start);
    const done = undoLastNewSeason();
    await answerDialog('confirm');
    await answerDialog('confirm');
    await done;
    assert.strictEqual(getCurrentFarm().seasonStartYear, start);
});

test('season: the timeline runs July to June, a spring sowing stays in the season', async () => {
    const farm = await freshFarm();
    farm.month = 'AUGUST';
    const soy = field({ crop: 'Soybean', sowingMonth: 'APRIL' });
    const canola = field({ number: '2', crop: 'Canola', sowingMonth: 'AUGUST' });
    const [soyBar] = timelinePlanBars(farm, soy, 36, timelineMonthPos('AUGUST'), 'AUGUST', false);
    const [canolaBar] = timelinePlanBars(farm, canola, 36, timelineMonthPos('AUGUST'), 'AUGUST', false);
    assert.strictEqual(timelineMonthPos('JULY'), 0);
    assert.ok(soyBar.from >= 0 && soyBar.from < 12, 'soy in April is in this season, at ' + soyBar.from);
    assert.ok(canolaBar.from < soyBar.from, 'canola in August comes first');
});

test('season: the timeline heads each season with its game years', async () => {
    const farm = await freshFarm();
    setSetting('fieldsView', 'timeline');
    fieldsViewMode = null;
    renderSeasonView();
    const heads = [...document.querySelectorAll('#fields-timeline th.timeline-year')].map(th => th.textContent.trim());
    setSetting('fieldsView', 'table');
    fieldsViewMode = null;
    renderSeasonView();
    const s = farm.currentSeason, y = farm.seasonStartYear;
    assert.ok(heads[0].includes(`${t('season')} ${s}`) && heads[0].includes(`${y}/${y + 1}`), heads[0]);
    assert.ok(heads[1].includes(`${t('season')} ${s + 1}`) && heads[1].includes(`${y + 1}/${y + 2}`), heads[1]);
});

test('season: a new season keeps the prices of its last month, its moisture and its rates', async () => {
    const farm = await freshFarm();
    const season = farm.currentSeason;
    await newSeason();
    const archive = JSON.parse(fs.readFileSync(archivePath(farm, season), 'utf-8'));
    const i = MARKET_MONTHS.indexOf(farm.month);
    assert.strictEqual(archive.market.month, farm.month);
    Object.entries(archive.market.prices).forEach(([ft, p]) => assert.strictEqual(p, farm.devMarket.prices[ft][i], ft));
    assert.ok(Object.keys(archive.market.prices).length > 0, 'its crops are priced');
    assert.strictEqual(archive.market.inputs.SEEDS, farm.devMarket.prices.SEEDS[i]);
    assert.ok(archive.supplyRates && typeof archive.supplyRates.crops === 'object');
    assert.strictEqual(archive.moisture, null, 'no moisture mod on the test farm');
});

// "Yields and prices" for one season, drawn into a detached panel.
function yieldPanel(season) {
    const title = document.createElement('h2'), body = document.createElement('div');
    renderYieldForecastPanel(title, body, null, season);
    return body;
}

test('yields: a past season shows the prices it ended with, not today\'s', async () => {
    const farm = await freshFarm();
    const season = farm.currentSeason;
    await newSeason();
    const now = getCurrentFarm();
    const snap = JSON.parse(fs.readFileSync(archivePath(farm, season), 'utf-8')).market;
    const before = yieldPanel(season).querySelector('.yield-table').innerHTML;
    // Prices change after the season: the past one keeps its own.
    Object.values(now.devMarket.prices).forEach(row => row.forEach((v, k) => { row[k] = v * 3; }));
    const body = yieldPanel(season);
    assert.strictEqual(body.querySelector('.yield-table').innerHTML, before);
    assert.ok(body.querySelector('.yield-table thead').textContent.includes(translateMonth(snap.month)), 'the header names the month');
    assert.ok(!body.querySelector('.market-spark'), 'no price curve for a past season');
});

test('yields: a season archived without prices is counted at today\'s, and says so', async () => {
    const farm = await freshFarm();
    const body = yieldPanel(1);
    assert.ok(body.querySelector('.yield-margin'), 'margin columns are there');
    assert.ok(body.textContent.includes(t('yieldPastTodayPrices').replace('{n}', 1)));
    assert.ok(body.querySelector('.yield-table thead').textContent.includes('≈'));
    const two = yieldPanel(farm.currentSeason - 1);
    assert.ok(!two.textContent.includes(t('yieldPastTodayPrices').replace('{n}', farm.currentSeason - 1)), 'season 2 kept its prices');
});
