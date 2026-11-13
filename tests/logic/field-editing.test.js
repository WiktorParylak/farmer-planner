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

test('editing: the crop tab is grouped, and state and tillage are switches', async () => {
    await freshFarm();
    const idx = idxOf('2');
    openFieldModal(idx, 'crop');
    const heads = Array.from(document.querySelectorAll('#field-modal-body .field-view-section > h4')).map(h => h.textContent);
    [t('fieldViewCrop'), t('thCatchCrop'), t('rotTitle')].forEach(h => assert.ok(heads.includes(h), h));
    assert.ok(!document.querySelector('select.field-view-state, select.field-view-tillage'));
    const press = async (cls, value) => {
        document.querySelector(`.${cls}[data-value="${value}"]`).click();
        await wait(60);
        return getCurrentFarm().fields[idx];
    };
    assert.strictEqual((await press('field-view-state', 'Planted')).state, 'Planted');
    assert.ok(document.querySelector('.field-view-state[data-value="Planted"]').classList.contains('is-active'));
    assert.strictEqual((await press('field-view-state', 'To Plant')).state, 'To Plant');
    assert.strictEqual((await press('field-view-state', 'To Plant')).state, 'To Plant', 'the active state stays');
    assert.strictEqual((await press('field-view-tillage', 'plowed')).tillage, 'plowed');
    assert.strictEqual((await press('field-view-tillage', 'noTill')).tillage, 'noTill');
    assert.strictEqual((await press('field-view-tillage', 'noTill')).tillage, null, 'the active tillage clears');
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

test('editing: a change right after opening a farm can still be undone', async () => {
    // As freshFarm, but changing a field before the rotation check 900 ms in.
    document.querySelectorAll('.modal').forEach(m => { m.style.display = 'none'; });
    removeDevFarm();
    createDevFarm();
    openPlanner(DEV_FARM_ID);
    clearFarmUndo();
    const farm = getCurrentFarm();
    farm.rotationFillKey = null;
    const idx = idxOf('2');
    const area = farm.fields[idx].area;
    farm.fields[idx].area = '9';
    saveFarmData(farm);
    assert.strictEqual(farmUndoStack.length, 1);
    await wait(1300);
    assert.ok(getCurrentFarm().rotationFillKey, 'the rotation check ran');
    assert.ok(farmUndoStack.length >= 1, 'the change is still there to undo');
    while (farmUndoStack.length) undoLastFarmChange();
    assert.strictEqual(getCurrentFarm().fields[idx].area, area);
    hideUndoToast();
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


// The edit card has no state, tillage or lime: they go through the save as
// they were, and the bulk bar's buttons still set them.
async function editAndSave(between) {
    document.getElementById('edit-season-btn').click();
    await wait(200);
    if (between) await between();
    document.getElementById('edit-season-btn').click();
    await wait(300);
    assert.strictEqual(isEditMode, false);
}

const byId = id => getCurrentFarm().fields.find(f => f.id === id);
const cardOf = id => [...document.querySelectorAll('#fields-body tr.field-edit-tr')].find(r => JSON.parse(r.dataset.extra || '{}').id === id);

test('editing: the card has no state, tillage or lime, and saving keeps them', async () => {
    const farm = await freshFarm();
    const f = farm.fields[0];
    Object.assign(f, { state: 'Planted', tillage: 'noTill', limeAppliedSeason: farm.currentSeason || 1, limePh: 0.6 });
    saveFarmData(farm, { undo: false });
    await editAndSave(async () => {
        const body = document.getElementById('fields-body');
        assert.strictEqual(body.querySelector('.field-state, .tillage-switch-option, .treatment-chip--lime'), null);
    });
    const g = byId(f.id);
    assert.deepStrictEqual([g.state, g.tillage, g.limeAppliedSeason, g.limePh], ['Planted', 'noTill', farm.currentSeason || 1, 0.6]);
});

test('editing: a new card starts not sown, without tillage or lime', async () => {
    await freshFarm();
    const before = getCurrentFarm().fields.length;
    await editAndSave(async () => {
        document.querySelector('#fields-body .add-row-trigger').click();
        await wait(100);
        const cards = document.querySelectorAll('#fields-body tr.field-edit-tr');
        const card = cards[cards.length - 1];
        card.querySelector('.field-number').value = '77';
        card.querySelector('.field-area').value = '2';
    });
    const added = getCurrentFarm().fields.find(x => x.number === '77');
    assert.ok(added && getCurrentFarm().fields.length === before + 1);
    assert.deepStrictEqual([added.state, added.tillage, added.limeAppliedSeason, added.limePh], ['To Plant', null, null, null]);
});

test('editing: the bulk bar sets sown and tillage on the selected cards only', async () => {
    const farm = await freshFarm();
    const [a, b, c] = farm.fields.slice(0, 3).map(x => ({ id: x.id, state: x.state, tillage: x.tillage }));
    await editAndSave(async () => {
        [a, b].forEach(x => { const box = cardOf(x.id).querySelector('.edit-bulk-check'); box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); });
        document.querySelector('[data-ebulk="sown"]').click();
        document.querySelector('[data-ebulk="noTill"]').click();
        await wait(50);
        assert.ok(autoSyncToast.textContent.includes(t('tillageNoTill')), 'the toast says what was set');
    });
    [a, b].forEach(x => assert.deepStrictEqual([byId(x.id).state, byId(x.id).tillage], ['Planted', 'noTill'], 'field ' + x.id));
    assert.deepStrictEqual([byId(c.id).state, byId(c.id).tillage], [c.state, c.tillage], 'an unselected field keeps its own');
});
