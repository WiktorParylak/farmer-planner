// Seasons: what a new season clears, archives and can take back.
const archivePath = (farm, n) => path.join(appDataDir, farm.folderName, 'seasons', `season_${n}.json`);

async function newSeason() {
    const done = runNewSeason();
    await answerDialog('confirm');
    await answerDialog('confirm');
    await done;
}

test('season: a field is cleared for the next crop', () => {
    const f = field({
        state: 'Planted', tillage: 'plowed', catchCrop: 'Oilseedradish', fertilizer: true, manure: true, weeds: 'done',
        work: [], workFor: 'x', workCleared: true, workDetected: { sow: true }, limePrev: { season: 1, ph: 1 }, cuts: [{}]
    });
    clearFieldForNewSeason(f, 0, 2, getSupplyRates());
    assert.deepStrictEqual([f.crop, f.sowingMonth, f.state, f.tillage, f.catchCrop], ['', '', 'To Plant', null, '']);
    assert.deepStrictEqual([f.fertilizer, f.manure, f.weeds, f.cuts], [false, false, null, []]);
    ['work', 'workFor', 'workCleared', 'workDetected', 'limePrev'].forEach(k => assert.strictEqual(f[k], undefined, k));
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
