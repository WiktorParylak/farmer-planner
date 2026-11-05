// Changing a field, in its window and in Edit: nothing may get lost on the way.
const idxOf = number => getCurrentFarm().fields.findIndex(f => f.number === number);
const rowsOf = number => getCurrentFarm().fields.filter(f => f.number === number).length;
const soil = () => getCurrentFarm().supplyRates.fieldSoil;

async function withSoil(values) {
    const farm = await freshFarm();
    farm.supplyRates = farm.supplyRates || {};
    farm.supplyRates.fieldSoil = { ...(farm.supplyRates.fieldSoil || {}), ...values };
    saveFarmData(farm, { undo: false });
}

test('editing: decimals are read with a comma or a dot, nonsense is refused', () => {
    assert.strictEqual(parseDecimal('4,5'), 4.5);
    assert.strictEqual(parseDecimal('4.5'), 4.5);
    assert.strictEqual(parseDecimal('1 234,5'), 1234.5);
    assert.strictEqual(parseDecimal('1.234,5'), 1234.5);
    assert.ok(isNaN(parseDecimal('abc')));
    assert.ok(isNaN(parseDecimal('')));
});

test('editing: saving Edit without changes loses nothing on any field', async () => {
    const before = copy((await freshFarm()).fields);
    document.getElementById('edit-season-btn').click();
    await wait(200);
    document.getElementById('edit-season-btn').click();
    await wait(300);
    assert.strictEqual(isEditMode, false);
    const after = getCurrentFarm().fields;
    assert.strictEqual(after.length, before.length);
    before.forEach((f, i) => {
        const g = after[i];
        assert.strictEqual(parseFloat(g.area), parseFloat(f.area), f.number + ' area');
        // Formatting of the area and an empty lease are the only allowed differences.
        const strip = o => { const { area, lease, ...rest } = copy(o); return lease ? { ...rest, lease } : rest; };
        assert.deepStrictEqual(strip(g), strip(f), 'field ' + f.number);
    });
});

test('editing: a new number takes the soil and name along', async () => {
    await withSoil({ 2: { loam: 77 } });
    const farm = getCurrentFarm();
    farm.fieldNames = { ...(farm.fieldNames || {}), 2: 'Named' };
    saveFarmData(farm, { undo: false });
    const idx = idxOf('2');
    openFieldModal(idx);
    await setInput('.field-view-number', '42');
    await wait(100);
    const now = getCurrentFarm();
    assert.strictEqual(now.fields[idx].number, '42');
    assert.deepStrictEqual(soil()['42'], { loam: 77 });
    assert.strictEqual(soil()['2'], undefined);
    assert.strictEqual(now.fieldNames['42'], 'Named');
    assert.strictEqual(now.fieldNames['2'], undefined);
});

test('editing: an empty number is refused, the old one stays', async () => {
    await freshFarm();
    const idx = idxOf('2');
    openFieldModal(idx);
    await setInput('.field-view-number', '   ');
    await answerDialog('confirm');
    assert.strictEqual(getCurrentFarm().fields[idx].number, '2');
    assert.strictEqual(document.querySelector('.field-view-number').value, '2');
});

test('editing: a number already taken asks first, and cancelling changes nothing', async () => {
    await withSoil({ 1: { loam: 11 }, 2: { loam: 22 } });
    const idx = idxOf('2');
    openFieldModal(idx);
    await setInput('.field-view-number', '1');
    await answerDialog('cancel');
    await wait(60);
    assert.strictEqual(getCurrentFarm().fields[idx].number, '2');
    assert.deepStrictEqual(soil()['2'], { loam: 22 });
    assert.strictEqual(document.querySelector('.field-view-number').value, '2');
});

test('editing: joining a taken number keeps that field\'s soil', async () => {
    await withSoil({ 1: { loam: 11 }, 2: { loam: 22 } });
    openFieldModal(idxOf('2'));
    await setInput('.field-view-number', '1');
    await answerDialog('confirm');
    await wait(60);
    assert.strictEqual(rowsOf('1'), 2);
    assert.deepStrictEqual(soil()['1'], { loam: 11 });
    assert.ok(document.querySelector('.field-view-size'), 'a shared field shows its whole size');
});

test('editing: one row leaving a shared field leaves the soil for the other', async () => {
    await withSoil({ 5: { loam: 55 } });
    openFieldModal(idxOf('5'));
    await setInput('.field-view-number', '55');
    await wait(100);
    assert.strictEqual(rowsOf('5'), 1);
    assert.deepStrictEqual(soil()['5'], { loam: 55 });
    assert.deepStrictEqual(soil()['55'], { loam: 55 });
});

test('editing: a typed area overrides the game\'s, a wrong one is refused', async () => {
    await freshFarm();
    const idx = idxOf('2');
    openFieldModal(idx);
    await setInput('.field-view-area', '4,5');
    assert.strictEqual(getCurrentFarm().fields[idx].area, '4.5');
    assert.strictEqual(getCurrentFarm().fields[idx].areaSource, 'manual');
    for (const bad of ['abc', '-3']) {
        await setInput('.field-view-area', bad);
        assert.strictEqual(getCurrentFarm().fields[idx].area, '4.5', bad);
        assert.strictEqual(document.querySelector('.field-view-area').value, '4.5', bad);
    }
});

test('editing: a lease can be set up and removed in the field window', async () => {
    await freshFarm();
    const idx = idxOf('2');
    openFieldModal(idx);
    await setInput('.field-view-lease', true);
    await setInput('.field-view-lease-seasons', '3');
    await setInput('.field-view-lease-then', 'buy');
    const lease = getCurrentFarm().fields[idx].lease;
    assert.deepStrictEqual([lease.seasons, lease.then], [3, 'buy']);
    await setInput('.field-view-lease', false);
    assert.strictEqual(getCurrentFarm().fields[idx].lease, null);
});

test('editing: undo takes every change back, one at a time', async () => {
    const before = copy((await freshFarm()).fields);
    const idx = idxOf('2');
    openFieldModal(idx);
    await setInput('.field-view-area', '9');
    await wait(450);
    await setInput('.field-view-number', '42');
    await wait(450);
    assert.strictEqual(farmUndoStack.length, 2);
    undoLastFarmChange();
    assert.strictEqual(getCurrentFarm().fields[idx].number, '2');
    assert.strictEqual(getCurrentFarm().fields[idx].area, '9');
    undoLastFarmChange();
    assert.deepStrictEqual(copy(getCurrentFarm().fields), before);
    assert.strictEqual(document.querySelector('.field-view-number').value, '2');
});

test('editing: opening panels is not a change', async () => {
    await freshFarm();
    for (const view of ['finance', 'animals', 'supplies', 'rotation', 'storage', 'yieldforecast', 'feedplan', 'notes', 'seasonsummary', 'plan']) {
        document.querySelector(`.sidebar-item[data-view="${view}"]`).click();
        await wait(60);
    }
    assert.strictEqual(farmUndoStack.length, 0);
});

test('editing: the field window keeps its tab after a change and opens where asked', async () => {
    await freshFarm();
    openFieldModal(0, 'soil');
    const active = () => document.querySelector('.field-view-tab.is-active').dataset.tab;
    assert.strictEqual(active(), 'soil');
    await setInput('.field-view-soil[data-soil="loam"]', '55');
    assert.strictEqual(active(), 'soil');
    assert.ok(document.querySelector('.field-view-pane[data-pane="crop"]').hidden);
    openFieldModal(0);
    assert.strictEqual(active(), 'crop');
});
