// Breed norms: a view of its own in the sidebar, no longer folded into Animals.

test('breed norms: the view opens from the sidebar, the Animals panel no longer has it', async () => {
    await freshFarm();
    document.querySelector('.sidebar-item[data-view="animals"]').click();
    assert.ok(!document.querySelector('#hub-panel-body .breed-norms'));
    document.querySelector('.sidebar-item[data-view="breednorms"]').click();
    assert.strictEqual(currentPlannerView, 'breednorms');
    assert.ok(document.querySelector('#hub-panel-body .breed-norms .breed-curve'), 'the chart is drawn');
    assert.ok(document.querySelector('#hub-panel-body .breed-norms-table tbody tr'), 'and the figures');
});

test('breed norms: the figures follow the breed\'s curves, for one head and the herd', async () => {
    const farm = await freshFarm();
    const { own } = breedNormsBreeds(farm);
    assert.ok(own.length, 'the test farm has animals');
    const st = own[0];
    const def = ANIMAL_NEEDS_DATA[st];
    const { rows, scale } = breedNormsRows(farm, st, 30, null);
    const food = rows.find(r => r.key === 'food');
    assert.ok(Math.abs(food.perHead - interpolateNeedCurve(def.food, 30) * scale) < 1e-9);
    assert.ok(rows.filter(r => r.out).length === Object.keys(def.production || {}).length);
});

test('breed norms: a click on the chart sets the age', async () => {
    await freshFarm();
    openBreedNorms(breedNormsBreeds(getCurrentFarm()).own[0], 10);
    await wait(50);
    const svg = document.querySelector('#hub-panel-body .breed-curve');
    const r = svg.getBoundingClientRect();
    const max = parseFloat(svg.dataset.maxAge);
    svg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + 10 }));
    window.dispatchEvent(new PointerEvent('pointerup'));
    assert.ok(Math.abs(breedNormsState.age - max / 2) <= 1, `${breedNormsState.age} of ${max}`);
    assert.strictEqual(+document.querySelector('#hub-panel-body .breed-norms-age').value, breedNormsState.age);
});

test('breed norms: a year counts the herd growing older month by month', async () => {
    const farm = await freshFarm();
    const st = breedNormsBreeds(farm).own.find(b => { const c = (ANIMAL_NEEDS_DATA[b] || {}).food; return c && interpolateNeedCurve(c, 13) > interpolateNeedCurve(c, 2); });
    assert.ok(st, 'a growing breed on the test farm');
    const { rows } = breedNormsYear(farm, st, 2, null);
    const food = rows.find(r => r.key === 'food');
    let sum = 0;
    for (let m = 0; m < 12; m++) sum += breedNormsRows(farm, st, 2 + m, null).rows.find(r => r.key === 'food').perHead;
    assert.ok(Math.abs(food.year - sum) < 1e-9, `${food.year} vs ${sum}`);
    assert.ok(food.year > food.perHead * 12, 'young animals eat more as they grow');
    openBreedNorms(st, 2);
    const head = [...document.querySelectorAll('#hub-panel-body .breed-norms-table thead th')].map(th => th.textContent);
    assert.strictEqual(head.length, 4, head.join(' | '));
    assert.ok(document.querySelector('#hub-panel-body .breed-curve-year'), 'the year is shaded on the chart');
});
