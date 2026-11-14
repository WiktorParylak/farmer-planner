// Crop rotation: where a field is in its cycle and what comes next.
const rot = { id: 'r', steps: [{ crop: 'Canola', seasons: 1 }, { crop: 'Wheat', seasons: 1 }, { crop: 'Grass', seasons: 2 }] };
const farmWith = extra => ({ currentSeason: 3, rotations: [rot], ...extra });
const seq = lists => lists.map((crops, i) => ({ season: i + 1, crops }));
const levels = (lists, from = 0, grass = 3) => rotationSequenceWarnings(seq(lists), from, grass).map(w => w.level);

test('rotation: a step of several seasons takes several slots, and the cycle wraps', () => {
    const slots = rotationSlots(rot);
    assert.deepStrictEqual(slots.map(s => s.crop), ['Canola', 'Wheat', 'Grass', 'Grass']);
    assert.strictEqual(rotationSlotAt(rot, 4).crop, 'Canola');
    assert.strictEqual(rotationSlotAt(rot, -1).crop, 'Grass');
    assert.strictEqual(rotationSlotIndex(rot, { step: 2, stepSeason: 2 }), 3);
});

test('rotation: a field without a live cycle has none', () => {
    assert.strictEqual(fieldRotationInfo(farmWith(), field()), null);
    assert.strictEqual(fieldRotationInfo(farmWith(), field({ rotation: { id: 'gone', step: 0 } })), null);
    assert.strictEqual(fieldRotationInfo(farmWith(), field({ rotation: { id: 'r', step: 1 } })).slot.crop, 'Wheat');
});

test('rotation: the step is detected from the crop and the last seasons', () => {
    const history = { 2: [{ number: '1', crop: 'Canola' }] };
    assert.strictEqual(detectRotationSlot(rot, field({ crop: 'Wheat' }), history, 3), 1);
    const grass = { 2: [{ number: '1', crop: 'Grass' }] };
    assert.strictEqual(detectRotationSlot(rot, field({ crop: 'Grass' }), grass, 3), 3);
});

test('rotation: a new crop resets the field, the same crop keeps its tillage', () => {
    const f = field({ crop: 'Barley', state: 'Planted', tillage: 'plowed' });
    applyRotationSlot(f, { crop: 'Wheat', catchCrop: '' });
    assert.strictEqual(f.crop, 'Wheat');
    assert.strictEqual(f.state, 'To Plant');
    assert.strictEqual(f.tillage, null);
    assert.ok(CROP_CALENDAR.Wheat[f.sowingMonth], 'a month the crop can be sown in');
    const same = field({ crop: 'Wheat', state: 'Planted', tillage: 'plowed' });
    applyRotationSlot(same, { crop: 'Wheat', catchCrop: '' });
    assert.strictEqual(same.tillage, 'plowed');
});

test('rotation: grassland that carries on stays sown', () => {
    const f = field({ crop: 'Grass', sowingMonth: 'MARCH', state: 'To Plant' });
    applyRotationSlot(f, { crop: 'Grass', catchCrop: '' });
    assert.strictEqual(f.state, 'Planted');
    assert.strictEqual(f.sowingMonth, 'MARCH');
});

test('rotation: a catch crop goes in after the main harvest', () => {
    const harvest = CROP_CALENDAR.Wheat.OCTOBER;
    const month = rotationCatchSowMonth('Wheat', 'OCTOBER', 'Oilseedradish');
    assert.ok(CROP_CALENDAR.Oilseedradish[month], month + ' is in its calendar');
    const gap = (ALL_MONTHS.indexOf(month) - ALL_MONTHS.indexOf(harvest) + 12) % 12;
    assert.ok(gap >= 1, `${month} comes after the harvest in ${harvest}`);
});

test('rotation: a quick crop can follow in the month of the harvest, green cover the month after', () => {
    const saved = { Wheat: CROP_CALENDAR.Wheat, Carrot: CROP_CALENDAR.Carrot, Oilseedradish: CROP_CALENDAR.Oilseedradish };
    try {
        CROP_CALENDAR.Wheat = { OCTOBER: 'JULY' };
        CROP_CALENDAR.Carrot = { JULY: 'NOVEMBER' };
        CROP_CALENDAR.Oilseedradish = { JULY: 'OCTOBER', AUGUST: 'NOVEMBER' };
        assert.strictEqual(rotationCatchSowMonth('Wheat', 'OCTOBER', 'Carrot'), 'JULY');
        assert.strictEqual(rotationCatchSowMonth('Wheat', 'OCTOBER', 'Oilseedradish'), 'AUGUST');
    } finally {
        Object.assign(CROP_CALENDAR, saved);
    }
});

function withCatchCalendars(fn) {
    const names = ['Wheat', 'Carrot', 'Oilseedradish', 'Clover', 'Buckwheat'];
    const saved = names.map(n => CROP_CALENDAR[n]);
    try {
        CROP_CALENDAR.Wheat = { OCTOBER: 'JULY' };
        CROP_CALENDAR.Carrot = { JULY: 'NOVEMBER' };
        CROP_CALENDAR.Oilseedradish = { AUGUST: 'NOVEMBER' };
        CROP_CALENDAR.Clover = { JULY: 'SEPTEMBER' };
        CROP_CALENDAR.Buckwheat = { JULY: 'AUGUST' };
        return fn();
    } finally {
        names.forEach((n, i) => { CROP_CALENDAR[n] = saved[i]; });
    }
}

test('rotation: a catch crop keeps the field until it has come off', () => withCatchCalendars(() => {
    const f = extra => field({ state: 'Planted', catchCrop: 'Carrot', catchSowingMonth: 'JULY', ...extra });
    ['JULY', 'OCTOBER', 'NOVEMBER'].forEach(m => assert.strictEqual(fieldCatchStillOn(f(), m, null), true, m));
    assert.strictEqual(fieldCatchStillOn(f(), 'DECEMBER', null), false);
    assert.strictEqual(fieldCatchStillOn(f({ catchCrop: 'Oilseedradish', catchSowingMonth: 'AUGUST' }), 'JULY', null), true, 'not sown yet');
    assert.strictEqual(fieldCatchStillOn(f({ catchCrop: 'Clover' }), 'SEPTEMBER', null), true);
    assert.strictEqual(fieldCatchStillOn(f({ catchCrop: 'Carrot', catchSowingMonth: 'JUNE' }), 'JULY', null), false, 'sown before the harvest');
    assert.strictEqual(fieldCatchStillOn(field({ state: 'Planted' }), 'JULY', null), false, 'no catch crop');
}));

test('rotation: with the save, a catch crop gone from the field frees it from its harvest month', () => withCatchCalendars(() => {
    const f = field({ state: 'Planted', catchCrop: 'Carrot', catchSowingMonth: 'JULY' });
    const id = gameFieldIds(f)[0];
    assert.strictEqual(fieldCatchStillOn(f, 'NOVEMBER', { [id]: { sown: false } }), false);
    assert.strictEqual(fieldCatchStillOn(f, 'OCTOBER', { [id]: { sown: false } }), true, 'before its harvest it may just not be sown yet');
}));

test('rotation: a new season leaves a field with its catch crop still to come off', () => withCatchCalendars(() => {
    const plain = field({ state: 'Planted' });
    const withCatch = field({ number: '2', state: 'Planted', catchCrop: 'Carrot', catchSowingMonth: 'JULY' });
    const catchDone = field({ number: '3', state: 'Planted', catchCrop: 'Buckwheat', catchSowingMonth: 'JULY' });
    const farm = { month: 'AUGUST', currentSeason: 1, fields: [plain, withCatch, catchDone] };
    assert.deepStrictEqual(seasonEndFinishIndexes(farm), [0]);
    assert.deepStrictEqual(seasonEndFinishIndexes({ ...farm, month: 'SEPTEMBER' }), [0, 2]);
}));

test('rotation: once its catch crop is off, a field kept past the sowing month can move on', () => withCatchCalendars(() => {
    const f = field({ state: 'Planted', catchCrop: 'Carrot', catchSowingMonth: 'JULY' });
    const empty = { [gameFieldIds(f)[0]]: { sown: false } };
    assert.strictEqual(fieldHarvestState(f, 'DECEMBER', empty, false), 'harvested');
    assert.strictEqual(fieldCatchStillOn(f, 'DECEMBER', empty), false);
    assert.strictEqual(fieldHarvestState(field({ state: 'Planted' }), 'DECEMBER', empty, false), 'growing', 'without a catch crop nothing changes');
}));

test('rotation: the generator\'s plan goes first and its later crops move up', () => {
    const f = field({
        crop: '', rotation: { id: 'r', step: 0 },
        nextCrop: { crop: 'Barley', sowingMonth: 'SEPTEMBER' },
        planAhead: [{ step: 2, crop: 'Oat', sowingMonth: 'MARCH' }, { step: 3, crop: 'Rye', sowingMonth: 'SEPTEMBER' }]
    });
    assert.strictEqual(advanceFieldPlan(farmWith(), f, true, 'AUGUST'), true);
    assert.strictEqual(f.crop, 'Barley');
    assert.strictEqual(f.nextCrop.crop, 'Oat');
    assert.deepStrictEqual(f.planAhead.map(e => [e.step, e.crop]), [[2, 'Rye']]);
    assert.strictEqual(f.rotation.step, 1, 'the cycle moves on too');
});

test('rotation: without fill the cycle moves on but no crop goes on', () => {
    const f = field({ crop: '', rotation: { id: 'r', step: 0 } });
    assert.strictEqual(advanceFieldPlan(farmWith(), f, false, 'AUGUST'), false);
    assert.strictEqual(f.crop, '');
    assert.strictEqual(f.rotation.step, 1);
    const g = field({ crop: '', rotation: { id: 'r', step: 0 } });
    assert.strictEqual(advanceFieldPlan(farmWith(), g, true, 'AUGUST'), true);
    assert.strictEqual(g.crop, 'Wheat');
});

test('rotation: finishing a crop can be taken back, whole', async () => {
    const farm = await freshFarm();
    const idx = farm.fields.findIndex(f => f.number === '1');
    const key = fertPlanKey(farm.fields[idx], idx);
    farm.supplyRates = { ...(farm.supplyRates || {}), fertPlan: { ...((farm.supplyRates || {}).fertPlan || {}), [key]: { existingN: 40 } } };
    const before = copy(farm.fields[idx]);
    const finished = (farm.finishedCrops || []).length;
    finishFieldCrop(farm, idx, true);
    assert.notStrictEqual(farm.fields[idx].crop, before.crop);
    assert.strictEqual(farm.finishedCrops.at(-1).crop, before.crop);
    assert.strictEqual(farm.supplyRates.fertPlan[key], undefined);
    assert.strictEqual(undoFieldFinish(farm, idx), true);
    assert.deepStrictEqual(copy(farm.fields[idx]), before);
    assert.deepStrictEqual(farm.supplyRates.fertPlan[key], { existingN: 40 });
    assert.strictEqual(farm.finishedCrops.length, finished);
});

test('rotation: a season moves grassland on, not crops still on the field', () => {
    const farm = { currentSeason: 1, month: 'OCTOBER', fields: [field({ crop: 'Grass', sowingMonth: 'MARCH', state: 'Planted' }), field({ state: 'To Plant' })] };
    assert.deepStrictEqual(seasonEndFinishIndexes(farm), [0]);
});

test('rotation: warnings for repeats, cereals, break crops and long grassland', () => {
    assert.deepStrictEqual(levels([['Canola'], ['Canola']]), ['yellow']);
    assert.deepStrictEqual(levels([['Grass'], ['Grass']]), []);
    assert.ok(levels([['Wheat'], ['Barley'], ['Oat']]).includes('red'));
    assert.deepStrictEqual(levels([['Wheat'], ['Barley'], ['Canola']]), []);
    assert.ok(levels([['Canola'], ['Wheat'], ['Canola']]).includes('red'));
    assert.deepStrictEqual(levels([['Canola'], ['Wheat'], ['Barley'], ['Canola']]), []);
    assert.deepStrictEqual(levels([['Grass'], ['Grass'], ['Grass']], 0, 2), ['yellow']);
});

test('rotation: the past cannot be changed, so it does not warn', () => {
    assert.deepStrictEqual(levels([['Canola'], ['Canola'], ['Wheat']], 2), []);
});

test('rotation: a crop other than the cycle\'s is off cycle', () => {
    const farm = farmWith({ currentSeason: 1 });
    const on = fieldRotationScore(farm, field({ crop: 'Canola', rotation: { id: 'r', step: 0 } }), {});
    assert.strictEqual(on.offCycle, false);
    const off = fieldRotationScore(farm, field({ crop: 'Barley', rotation: { id: 'r', step: 0 } }), {});
    assert.strictEqual(off.offCycle, true);
    assert.ok(off.level !== 'green' && off.level !== '');
});

test('rotation: a good cycle has no warnings, a bad one does', () => {
    const good = { steps: [{ crop: 'Canola' }, { crop: 'Wheat' }, { crop: 'Barley' }, { crop: 'Maize' }] };
    assert.deepStrictEqual(rotationCycleWarnings(good, 3), []);
    assert.ok(rotationCycleWarnings({ steps: [{ crop: 'Wheat' }, { crop: 'Barley' }, { crop: 'Oat' }] }, 3).length > 0);
});

test('rotation: filling from the rotation asks by default, a farm\'s own choice stays', () => {
    assert.strictEqual(rotationFillMode({}), 'ask');
    assert.strictEqual(rotationFillMode({ rotationAutoFill: 'auto' }), 'auto');
    assert.strictEqual(rotationFillMode({ rotationAutoFill: 'off' }), 'off');
});

test('rotation: adjusting planned crops skips sown fields, fallow steps and fields that fit', () => {
    const fallowRot = { id: 'f', steps: [{ crop: '' }, { crop: 'Wheat' }] };
    const farm = { currentSeason: 1, month: 'AUGUST', rotations: [rot, fallowRot], fields: [
        field({ number: '1', crop: 'Barley', rotation: { id: 'r', step: 0 } }),
        field({ number: '2', crop: 'Barley', state: 'Planted', rotation: { id: 'r', step: 0 } }),
        field({ number: '3', crop: 'Canola', rotation: { id: 'r', step: 0 } }),
        field({ number: '4', crop: 'Barley', rotation: { id: 'f', step: 0 } }),
        field({ number: '5', crop: 'Barley' })
    ] };
    const changes = rotationMatchPlan(farm);
    assert.deepStrictEqual(changes.map(c => [c.number, c.from, c.to]), [['1', 'Barley', 'Canola']]);
    applyRotationMatch(farm, changes);
    assert.strictEqual(farm.fields[0].crop, 'Canola');
    assert.strictEqual(farm.fields[0].state, 'To Plant');
    assert.strictEqual(farm.fields[1].crop, 'Barley', 'a sown field stays');
    assert.strictEqual(rotationMatchPlan(farm).length, 0);
});

test('rotation: planned fields get the cycle that fits best, at their crop\'s step', () => {
    const wheatFirst = { id: 'w', name: 'W', steps: [{ crop: 'Wheat' }, { crop: 'Barley' }] };
    const farm = { currentSeason: 1, rotations: [wheatFirst, rot], fields: [
        field({ number: '1', crop: 'Grass', nextCrop: { crop: 'Maize' } }),
        field({ number: '2', crop: 'Wheat' }),
        field({ number: '3', crop: 'Potato' }),
        field({ number: '4', crop: 'Canola', rotation: { id: 'r', step: 0 } }),
        field({ number: '5', crop: '' })
    ] };
    const { changes, noCycle } = rotationAssignPlan(farm);
    assert.deepStrictEqual(changes.map(c => [c.number, c.rotId, c.step]), [['1', 'r', 2], ['2', 'w', 0]], 'a tie goes to the cycle higher in the list');
    assert.deepStrictEqual(noCycle.map(c => c.number), ['3']);
    applyRotationAssign(farm, changes);
    assert.strictEqual(fieldRotationInfo(farm, farm.fields[0]).slot.crop, 'Grass');
    assert.strictEqual(farm.fields[0].crop, 'Grass', 'the crop stays');
    assert.strictEqual(farm.fields[0].nextCrop, undefined, 'the generator\'s plan goes');
    assert.strictEqual(fieldRotationInfo(farm, farm.fields[1]).rot.id, 'w');
});

test('rotation: a cycle for a field with another crop asks whether to adjust it', async () => {
    const farm = await freshFarm();
    const idx = farm.fields.findIndex(f => f.number === '7');
    const f = farm.fields[idx];
    assert.strictEqual(f.crop, 'Potato');
    // Keep: the cycle is set, the crop stays.
    let done = setFieldCycle(farm, f, 'rot_dev_canola');
    assert.ok((await answerDialog('cancel')).includes('7'));
    await done;
    assert.strictEqual(farm.fields[idx].crop, 'Potato');
    assert.strictEqual(farm.fields[idx].rotation.id, 'rot_dev_canola');
    await wait(400);
    // Adjust: the step's crop goes on.
    done = setFieldCycle(farm, farm.fields[idx], 'rot_dev_canola');
    await answerDialog('confirm');
    await done;
    const want = fieldRotationInfo(farm, farm.fields[idx]).slot.crop;
    assert.strictEqual(farm.fields[idx].crop, want);
    await wait(400);
    // ask: false never asks.
    farm.fields[idx].crop = 'Potato';
    await setFieldCycle(farm, farm.fields[idx], 'rot_dev_norfolk', { ask: false });
    assert.ok(!dialogOpen(), 'no question');
    assert.strictEqual(farm.fields[idx].crop, 'Potato');
});
