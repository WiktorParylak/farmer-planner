// "Fields from game": which fields are the player's, and what the summary says.
// FS25 numbers each field after the farmland it lies on, so a field is owned
// when the farmland with its number belongs to the player's farm.

function fakeSave(files) {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fp-save-'));
    Object.entries(files).forEach(([name, text]) => fs.writeFileSync(path.join(dir, name), text));
    return path.join(dir, 'careerSavegame.xml');
}

// Two farms; farm 1 owns farmlands 1, 2 and 9 (no field on 9), farm 2 owns 3.
const MP_SAVE = {
    'careerSavegame.xml': '<careerSavegame><settings><mapId>MapUS</mapId></settings></careerSavegame>',
    'farms.xml': '<farms><farm farmId="1" name="Neighbour" money="1000"/><farm farmId="2" name="Mine" money="2000"/></farms>',
    'farmland.xml': '<farmlands><farmland id="1" farmId="1"/><farmland id="2" farmId="1"/><farmland id="3" farmId="2"/><farmland id="9" farmId="1"/><farmland id="10" farmId="0"/></farmlands>',
    'fields.xml': '<fields>' + [1, 2, 3, 4, 5].map(id => `<field id="${id}" plannedFruit="FALLOW" fruitType="WHEAT" growthState="3" groundType="SOWN"/>`).join('') + '</fields>'
};

test('fields from game: owned fields follow the chosen farm, and the map count is every field', () => {
    const farm = { saveGamePath: fakeSave(MP_SAVE) };
    let r = readSaveFields(farm, { saved: true });
    assert.deepStrictEqual(r.fields.map(f => f.id), ['1', '2'], 'farm 1 by default; farmland 9 has no field');
    assert.strictEqual(r.mapFieldCount, 5);
    farm.gameFarmId = '2';
    r = readSaveFields(farm, { saved: true });
    assert.deepStrictEqual(r.fields.map(f => f.id), ['3']);
});

test('fields from game: a save with several farms asks which one is yours, once', async () => {
    const farm = { saveGamePath: fakeSave(MP_SAVE) };
    const asked = confirmGameFarm(farm);
    await FT.waitFor(FT.dialogOpen, 'the farm question');
    const pick = document.getElementById('game-farm-ask');
    assert.deepStrictEqual([...pick.options].map(o => o.value), ['1', '2']);
    pick.value = '2';
    document.getElementById('app-dialog-confirm').click();
    assert.strictEqual(await asked, true);
    await FT.wait(400);
    assert.strictEqual(farm.gameFarmId, '2');
    assert.strictEqual(farm.gameFarmConfirmed, true);
    assert.strictEqual(await confirmGameFarm(farm), true, 'not asked again');
    assert.strictEqual(FT.dialogOpen(), false);
    assert.strictEqual(gameFarmNameOf(farm), 'Mine (#2)');
    useSaveFarm(getCurrentFarm());
});

test('fields from game: cancelling the farm question adds nothing', async () => {
    const farm = { saveGamePath: fakeSave(MP_SAVE) };
    const asked = confirmGameFarm(farm);
    await FT.answerDialog('cancel');
    assert.strictEqual(await asked, false);
    await FT.wait(400);
    assert.strictEqual(farm.gameFarmConfirmed, undefined);
    useSaveFarm(getCurrentFarm());
});

test('fields from game: a single-farm save asks nothing', async () => {
    const one = { ...MP_SAVE, 'farms.xml': '<farms><farm farmId="1" name="Solo" money="5"/></farms>' };
    const farm = { saveGamePath: fakeSave(one) };
    assert.strictEqual(await confirmGameFarm(farm), true);
    assert.strictEqual(FT.dialogOpen(), false);
    assert.strictEqual(gameFarmNameOf(farm), '');
});

test('fields from game: the summary says how many fields are yours and why there is no area', () => {
    const msg = loadFieldsMessage({ own: 14, all: 186, added: 14, areas: 0, sown: 0, keptManual: 0, farmName: 'Mine (#2)', noPf: true });
    assert.ok(msg.includes(t('loadFieldsOwned').replace('{own}', 14).replace('{all}', 186)), msg);
    assert.ok(msg.includes('Mine (#2)'), msg);
    assert.ok(msg.includes(t('loadFieldsNoPfArea')), msg);
    const plain = loadFieldsMessage({ own: 3, all: 10, added: 1, areas: 1, sown: 0, keptManual: 0, farmName: '', noPf: false });
    assert.ok(!plain.includes(t('loadFieldsNoPfArea')));
    assert.ok(!plain.includes(t('loadFieldsFarm').split('{farm}')[0]));
});
