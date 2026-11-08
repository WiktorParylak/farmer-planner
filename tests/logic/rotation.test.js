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
