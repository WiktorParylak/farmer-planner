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
    assert.strictEqual(steps(before, OCT)[0], 'sowCatch');
    assert.strictEqual(catchCropComesFirst(after), false);
    assert.strictEqual(steps(after, OCT).at(-1), 'harvestWrap');
});

test('work: a catch crop gets its own part, starting with its sowing', () => {
    const harvest = CROP_CALENDAR.Wheat.OCTOBER;
    const at = n => ALL_MONTHS[(ALL_MONTHS.indexOf(harvest) + n + 12) % 12];
    [field({ catchCrop: 'Oilseedradish', catchSowingMonth: at(-1) }), field({ catchCrop: 'Oilseedradish', catchSowingMonth: at(1) })].forEach(f => {
        const list = suggestedWork(f, 0, OCT);
        const catchPart = list.filter(w => w.part === 'catch').map(w => w.step);
        assert.deepStrictEqual(catchPart, ['sowCatch', 'fertilize', 'mow', 'bale', 'harvestWrap']);
        // One block each: the parts never interleave.
        const changes = list.filter((w, i) => i && (w.part || '') !== (list[i - 1].part || '')).length;
        assert.strictEqual(changes, 1);
        assert.ok(list.some(w => w.step === 'sow' && !w.part));
    });
    assert.ok(suggestedWork(field(), 0, OCT).every(w => !w.part), 'no catch crop, no parts');
});

test('work: a catch crop grown for itself is harvested, forage is mown', () => {
    const part = crop => suggestedWork(field({ catchCrop: crop, catchSowingMonth: 'AUGUST' }), 0, OCT).filter(w => w.part === 'catch').map(w => w.step);
    assert.deepStrictEqual(part('Carrot'), ['sowCatch', 'fertilize', 'harvest']);
    assert.deepStrictEqual(part('Clover'), ['sowCatch', 'fertilize', 'mow', 'bale', 'harvestWrap']);
});

test('work: a catch crop\'s harvest is due in its own window', () => {
    const saved = { Wheat: CROP_CALENDAR.Wheat, Carrot: CROP_CALENDAR.Carrot };
    try {
        CROP_CALENDAR.Wheat = { OCTOBER: 'JULY' };
        CROP_CALENDAR.Carrot = { JULY: 'NOVEMBER' };
        const f = field({ state: 'Planted', catchCrop: 'Carrot', catchSowingMonth: 'JULY' });
        assert.strictEqual(fieldJobDue(f, 'harvest', 'NOVEMBER', 'catch'), true);
        assert.strictEqual(fieldJobDue(f, 'harvest', 'JULY', 'catch'), false);
        assert.strictEqual(fieldJobDue(f, 'harvest', 'JULY'), true);
    } finally {
        Object.assign(CROP_CALENDAR, saved);
    }
});

test('work: the new catch crops are on the menu and stay main crops in the generator', async () => {
    await freshFarm();
    assert.ok(isCatchCropChoice('Carrot') && !isCatchOnlyCrop('Carrot'));
    assert.ok(cropOptionsHtml('', '-', true).includes('value="Carrot"'));
    assert.ok(genCropPool({ excluded: [] }).includes('Carrot'));
    assert.ok(!genCropPool({ excluded: [] }).includes('Oilseedradish'));
});

test('work: with a catch crop the list has a heading per crop and says whose sowing it is', () => {
    const f = field({ catchCrop: 'Oilseedradish', catchSowingMonth: 'AUGUST' });
    const list = suggestedWork(f, 0, OCT);
    const html = workListItemsHtml(f, list, w => `<li>${workStepLabel(f, w)}</li>`);
    const box = document.createElement('ul');
    box.innerHTML = html;
    const heads = [...box.querySelectorAll('.work-part-head')].map(li => li.textContent);
    assert.deepStrictEqual(heads, [
        t('workPartMain').replace('{crop}', translateCropName('Wheat')),
        t('workPartCatch').replace('{crop}', translateCropName('Oilseedradish'))
    ]);
    assert.ok(box.textContent.includes(t('work_sowMain')) && box.textContent.includes(t('work_sowCatch')));
    assert.strictEqual(workStepLabel(field(), { step: 'sow' }), t('work_sow'));
    const own = [{ step: 'sow', done: false }, { step: 'mow', done: false }];
    assert.ok(!workListItemsHtml(f, own, () => '<li></li>').includes('work-part-head'), 'an older list has no headings');
});

test('work: sowing the catch crop leaves the field state alone and waits for its month', () => {
    const f = field({ catchCrop: 'Oilseedradish', catchSowingMonth: 'AUGUST' });
    const work = suggestedWork(f, 0, OCT);
    const i = work.findIndex(w => w.step === 'sowCatch');
    setWorkStepDone(work, i, true, f, OCT);
    assert.strictEqual(f.state, 'To Plant');
    assert.strictEqual(withSowFromState(f, work)[i].done, true);
    assert.strictEqual(fieldJobDue(f, 'sowCatch', 'JULY'), false);
    assert.strictEqual(fieldJobDue(f, 'sowCatch', 'AUGUST'), true);
    assert.strictEqual(fieldJobDue(f, 'sowCatch', 'SEPTEMBER'), true);
});

test('work: a step moved past a heading joins that part, a new one goes at the end of its part', () => {
    const f = field({ catchCrop: 'Oilseedradish', catchSowingMonth: 'AUGUST' });
    const work = [{ step: 'sow', done: false }, { step: 'weeds', done: false }, { step: 'sowCatch', done: false, part: 'catch' }, { step: 'mow', done: false, part: 'catch' }];
    moveWorkStep(work, 2, -1);
    assert.deepStrictEqual(work.map(w => w.step + (w.part ? '*' : '')), ['sow', 'weeds', 'sowCatch', 'mow*']);
    moveWorkStep(work, 0, 1);
    assert.deepStrictEqual(work.map(w => w.step + (w.part ? '*' : '')), ['weeds', 'sow', 'sowCatch', 'mow*']);
    moveWorkStep(work, 3, -1);
    assert.deepStrictEqual(work.map(w => w.step + (w.part ? '*' : '')), ['weeds', 'sow', 'sowCatch', 'mow']);
    const list = [{ step: 'sow', done: false }, { step: 'mow', done: false, part: 'catch' }];
    addWorkStep(list, 'fertilize', '', f);
    addWorkStep(list, 'bale', 'catch', f);
    assert.deepStrictEqual(list.map(w => w.step + (w.part ? '*' : '')), ['sow', 'fertilize', 'mow*', 'bale*']);
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
