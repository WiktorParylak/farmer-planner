// Supplies: the shopping-list cards, the tabs, the organic fertilizer pick,
// and seed potatoes / sugarcane counted as their own fill type.

async function suppliesFarm(fields) {
    const farm = await freshFarm();
    farm.fields = fields;
    saveFarmData(farm, { undo: false });
    return getCurrentFarm();
}

test('supplies: potatoes and sugarcane are planted with their own fill type, not seeds', async () => {
    const farm = await suppliesFarm([
        field({ number: '1', crop: 'Wheat' }),
        field({ number: '2', crop: 'Potato' }),
        field({ number: '3', crop: 'Sugarcane' })
    ]);
    const seed = buildSuppliesSeedRows(farm, getSupplyRates());
    assert.deepStrictEqual(seed.rows.map(r => r.input), ['SEEDS', 'POTATO', 'SUGARCANE']);
    assert.ok(seed.totals.SEEDS > 0 && seed.totals.POTATO > seed.totals.SEEDS && seed.totals.SUGARCANE > 0);
    assert.ok(Math.abs(seed.total - (seed.totals.SEEDS + seed.totals.POTATO + seed.totals.SUGARCANE)) < 1e-6);
    assert.strictEqual(suppliesSeedInput('Barley'), 'SEEDS');
});

test('supplies: the cards add up each product and price it at its own fill type', async () => {
    const seed = { rows: [{ number: '1', input: 'SEEDS' }, { number: '2', input: 'POTATO' }, { number: '2', input: 'POTATO' }], totals: { SEEDS: 1000, POTATO: 20000 } };
    const fert = { rows: [{ hasPlan: true }, { hasPlan: false }], totals: { mineralLAbs: 500 } };
    const lime = { rows: [], total: 0 };
    const prices = { SEEDS: 900, POTATO: 300, FERTILIZER: 2000 };
    const s = suppliesSummary(seed, fert, lime, ft => (ft in prices ? prices[ft] : null));
    assert.deepStrictEqual(s.cards.map(c => c.key), ['seed', 'own-POTATO', 'fert', 'lime']);
    const by = k => s.cards.find(c => c.key === k);
    assert.strictEqual(by('seed').cost, 900);
    assert.strictEqual(by('own-POTATO').cost, 6000);
    assert.strictEqual(by('own-POTATO').fields, 1);
    assert.strictEqual(by('fert').cost, 1000);
    assert.strictEqual(by('fert').fields, 1);
    assert.strictEqual(by('lime').litres, 0);
    assert.strictEqual(by('lime').cost, 0);
    assert.strictEqual(s.costTotal, 7900);
    assert.ok(s.costKnown && !s.costPartial);

    const noPrice = suppliesSummary(seed, fert, lime, () => null);
    assert.ok(!noPrice.costKnown && noPrice.costPartial);
    assert.strictEqual(noPrice.costTotal, 0);
});

test('supplies: the panel opens on cards, a card switches the tab and the tab is remembered', async () => {
    await suppliesFarm([field({ number: '1', crop: 'Wheat' }), field({ number: '2', crop: 'Potato' })]);
    setSetting('suppliesTab', 'seed');
    document.querySelector('.sidebar-item[data-view="supplies"]').click();
    const body = document.getElementById('hub-panel-body');
    assert.ok(body.querySelector('.supply-card[data-supply-card="seed"]'));
    assert.ok(body.querySelector('.supply-card[data-supply-card="own-POTATO"]'), 'seed potatoes get a card');
    assert.strictEqual(body.querySelectorAll('.supply-tab-body table.supply-table').length, 2, 'seed and potatoes, each with its total');
    body.querySelector('.supply-card[data-supply-card="lime"]').click();
    assert.strictEqual(getSetting('suppliesTab'), 'lime');
    assert.ok(body.querySelector('.supply-tabs .view-tab.is-active[data-supply-tab="lime"]'));
    setSetting('suppliesTab', 'seed');
});

test('supplies: the chosen organic fertilizer is the only one in the fertilizer table', async () => {
    const farm = await suppliesFarm([field({ number: '1', crop: 'Wheat' })]);
    const rates = getSupplyRates();
    rates.fertPlan = { ...(rates.fertPlan || {}), [fertPlanKey(farm.fields[0], 0)]: { orgN: 40 } };
    saveSupplyRates(rates);
    setSetting('suppliesTab', 'fert');
    setSetting('suppliesOrganic', 'manure');
    document.querySelector('.sidebar-item[data-view="supplies"]').click();
    const body = document.getElementById('hub-panel-body');
    const head = () => [...body.querySelectorAll('.supply-tab-body thead th')].map(th => th.textContent.trim());
    const orgCell = () => body.querySelector('.supply-tab-body tbody tr td:nth-child(6)').textContent;
    assert.ok(head().includes(t('suppliesOrgManure')) && !head().includes(t('suppliesOrgSlurry')));
    const manure = orgCell();
    const mineral = body.querySelector('.supply-tab-body tbody tr td:nth-child(7)').textContent;
    body.querySelector('[data-supply-org="slurry"]').click();
    assert.strictEqual(getSetting('suppliesOrganic'), 'slurry');
    assert.ok(head().includes(t('suppliesOrgSlurry')) && !head().includes(t('suppliesOrgManure')));
    assert.notStrictEqual(orgCell(), manure, 'litres of slurry, not of manure');
    assert.strictEqual(body.querySelector('.supply-tab-body tbody tr td:nth-child(7)').textContent, mineral, 'mineral unchanged');
    setSetting('suppliesTab', 'seed');
    setSetting('suppliesOrganic', 'manure');
});

test('supplies: the margin prices seed potatoes as potatoes', async () => {
    const farm = await suppliesFarm([field({ number: '1', crop: 'Potato' })]);
    const market = { prices: { SEEDS: Array(12).fill(1000), POTATO: Array(12).fill(200) } };
    farm.month = 'MARCH';
    const c = fieldInputCostPerHa(farm, farm.fields[0], 0, 'Potato', getSupplyRates(), { ...market, inputs: { SEEDS: 1000, POTATO: 200, FERTILIZER: 0, LIME: 0 } }, {});
    const rate = fieldSeedRate('Potato', getFieldSoilMix('1', getSupplyRates()), getSupplyRates());
    assert.ok(Math.abs(c.seed - rate * 200 / 1000) < 1e-6, `${c.seed} vs ${rate * 0.2}`);
});
