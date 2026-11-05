// The work list: what a field is told to do next.
const steps = (f, farm) => suggestedWork(f, 0, farm).map(w => w.step);
const OCT = { month: 'OCTOBER', currentSeason: 1 };
const AUG = { month: 'AUGUST', currentSeason: 1 };

test('work: a field to sow this month gets the seedbed, sowing, then care', () => {
    assert.deepStrictEqual(steps(field(), OCT), ['cultivate', 'sow', 'fertilize', 'weeds']);
});

test('work: a ploughed field is ploughed instead and has no weeds step', () => {
    assert.deepStrictEqual(steps(field({ tillage: 'plowed' }), OCT), ['plow', 'sow', 'fertilize']);
});

test('work: a sown field only has what comes after sowing', () => {
    assert.deepStrictEqual(steps(field({ state: 'Planted' }), OCT), ['fertilize', 'weeds']);
});

test('work: lime is suggested ahead of sowing, unless the field is limed', () => {
    assert.ok(steps(field(), AUG).includes('lime'));
    assert.ok(!steps(field({ limeAppliedSeason: 1, limePh: 1 }), AUG).includes('lime'));
});

test('work: the plough the game requires comes first, then stones before sowing', () => {
    assert.deepStrictEqual(steps(field({ plowRequired: true, stones: 0.1 }), OCT), ['plow', 'cultivate', 'stones', 'sow', 'fertilize', 'weeds']);
});

test('work: mechanics switched off in the game get no step', () => {
    const farm = { ...AUG, gameRules: { stones: false, weeds: false, lime: false } };
    assert.deepStrictEqual(steps(field({ stones: 0.1 }), farm), ['cultivate', 'sow', 'fertilize']);
});

test('work: joined game fields are merged once', () => {
    assert.strictEqual(steps(field({ number: '10-11' }), OCT)[0], 'merge');
    assert.ok(!steps(field({ number: '10-11' }), { ...OCT, mergedFields: { '10-11': true } }).includes('merge'));
    assert.ok(!steps(field({ number: '10' }), OCT).includes('merge'));
});

test('work: a catch crop sown before the harvest comes first, after it comes last', () => {
    const harvest = CROP_CALENDAR.Wheat.OCTOBER;
    const at = n => ALL_MONTHS[(ALL_MONTHS.indexOf(harvest) + n + 12) % 12];
    const before = field({ catchCrop: 'Oilseedradish', catchSowingMonth: at(-1) });
    const after = field({ catchCrop: 'Oilseedradish', catchSowingMonth: at(1) });
    assert.strictEqual(catchCropComesFirst(before), true);
    assert.strictEqual(steps(before, OCT)[0], 'fertilize');
    assert.strictEqual(catchCropComesFirst(after), false);
    assert.strictEqual(steps(after, OCT).at(-1), 'harvestWrap');
});

test('work: a list of your own only counts for the crops it was made for', () => {
    const f = field({ work: [{ step: 'sow', done: false }] });
    f.workFor = workCropsKey(f);
    assert.deepStrictEqual(fieldWork(f), f.work);
    f.crop = 'Barley';
    assert.strictEqual(fieldWork(f), null);
});

test('work: another crop keeps ground work already done, and nothing else', () => {
    const f = field({ work: [{ step: 'cultivate', done: true }, { step: 'fertilize', done: true }] });
    f.workFor = workCropsKey(f);
    f.crop = 'Barley';
    const list = suggestedWork(f, 0, OCT);
    assert.strictEqual(list.find(w => w.step === 'cultivate').done, true);
    assert.strictEqual(list.find(w => w.step === 'fertilize').done, false);
});

test('work: a list emptied on purpose stays empty, an old empty one does not', () => {
    const f = field({ work: [{ step: 'sow', done: false }] });
    changeFieldWork(OCT, f, 0, work => work.splice(0, work.length));
    assert.strictEqual(f.workCleared, true);
    assert.deepStrictEqual(fieldWork(f), []);
    delete f.workCleared;
    assert.strictEqual(fieldWork(f), null);
});

test('work: sowing is done exactly when the field is sown', () => {
    assert.strictEqual(withSowFromState(field(), [{ step: 'sow', done: true }])[0].done, false);
    assert.strictEqual(withSowFromState(field({ state: 'Planted' }), [{ step: 'sow', done: false }])[0].done, true);
});

test('work: the save ticks as many steps as it found', () => {
    const f = field({ workDetected: { fertilize: 1, cultivate: true } });
    const out = withSowFromState(f, [{ step: 'fertilize', done: false }, { step: 'fertilize', done: false }, { step: 'cultivate', done: false }]);
    assert.deepStrictEqual(out.map(w => w.done), [true, false, true]);
});

test('work: unticking by hand forgets what the save said', () => {
    const f = field({ workDetected: { fertilize: 2, cultivate: true } });
    forgetDetectedStep(f, 'fertilize');
    assert.strictEqual(f.workDetected.fertilize, 1);
    forgetDetectedStep(f, 'fertilize');
    forgetDetectedStep(f, 'cultivate');
    assert.strictEqual(f.workDetected, undefined);
});

test('work: ground work starts the month before sowing, sowing waits for its month', () => {
    const f = field();
    assert.strictEqual(fieldJobDue(f, 'cultivate', 'SEPTEMBER'), true);
    assert.strictEqual(fieldJobDue(f, 'cultivate', 'JULY'), false);
    assert.strictEqual(fieldJobDue(f, 'sow', 'JULY'), false);
    assert.strictEqual(fieldJobDue(f, 'sow', 'OCTOBER'), true);
    assert.strictEqual(fieldJobDue(field({ state: 'Planted' }), 'fertilize', 'JULY'), true);
});

test('work: the table and What to do today agree on every field', async () => {
    const farm = await freshFarm();
    const listed = new Set(Object.values(todayFieldGroups(farm)).flat().map(i => i.idx));
    const badges = [...document.querySelectorAll('#fields-body .work-open--badge')];
    assert.ok(badges.length > 0, 'the test farm should show jobs');
    badges.forEach(b => {
        const idx = +b.dataset.idx, later = !!b.querySelector('.badge--job-later');
        assert.strictEqual(listed.has(idx), !later, `field ${farm.fields[idx].number}: ${b.textContent.trim()}`);
    });
});
