// AnimalFoodCalculator 1.2: its scale also covers what the animals give, its
// own animals.xml only replaces curves of breeds the game has, seasonal wool.

const AFC_TEST_XML = `<animals>
    <animal type="SHEEP">
        <subType subType="SHEEP_LANDRACE">
            <input><food><key ageMonth="0" value="10"/><key ageMonth="12" value="40"/></food></input>
            <output><pallets fillType="WOOL"><key ageMonth="0" value="0"/><key ageMonth="12" value="20"/></pallets></output>
            <sellPrice><key ageMonth="0" value="100"/></sellPrice>
        </subType>
    </animal>
    <animal type="ALPACA">
        <subType subType="ALPACA_WHITE">
            <input><food><key ageMonth="0" value="5"/></food></input>
        </subType>
    </animal>
</animals>`;

// A savegame using AFC (3 days a month, auto scale, its own curves, seasonal wool).
function afcTestSave(settings) {
    const game = path.join(tlGameDir(), 'afc-test');
    const save = path.join(game, 'savegame1');
    fs.mkdirSync(save, { recursive: true });
    fs.mkdirSync(path.join(game, 'mods', 'FS25_AnimalFoodCalculator', 'xmls'), { recursive: true });
    fs.writeFileSync(path.join(game, 'mods', 'FS25_AnimalFoodCalculator', 'xmls', 'animals.xml'), AFC_TEST_XML);
    fs.writeFileSync(path.join(save, 'careerSavegame.xml'), '<careerSavegame><settings><plannedDaysPerPeriod>3</plannedDaysPerPeriod></settings><mod modName="FS25_AnimalFoodCalculator" title="AFC" version="1.2.0.1"/></careerSavegame>');
    fs.writeFileSync(path.join(save, 'afcConsumptionScaling.xml'), `<afcConsumptionScaling version="3"><settings ${settings}/></afcConsumptionScaling>`);
    return path.join(save, 'careerSavegame.xml');
}

test('AFC: settings and seasonal wool are read from the savegame', async () => {
    const mods = readAnimalMods(afcTestSave('enabled="true" autoScaleByDays="true" customMultiplier="1.000000" mode="auto" referenceSource="custom" seasonalWoolEnabled="true"'));
    assert.ok(mods.afc && mods.afc.seasonalWool);
    assert.strictEqual(mods.afc.scale, 3);
    assert.strictEqual(mods.afc.referenceXml.length, 1);
    assert.deepStrictEqual(afcShearMonths(mods.afc, 'SHEEP_LANDRACE'), [6]);
    assert.deepStrictEqual(afcShearMonths(mods.afc, 'EWE_MOUNTAINSHEEP'), [5, 10]);
    assert.strictEqual(afcShearMonths(mods.afc, 'COW_HOLSTEIN'), null);
    const off = readAnimalMods(afcTestSave('enabled="true" autoScaleByDays="true" customMultiplier="1.000000" mode="auto" referenceSource="custom"'));
    assert.strictEqual(afcShearMonths(off.afc, 'SHEEP_LANDRACE'), null);
});

test('AFC: its own curves replace the game\'s breeds only, outputs included', async () => {
    const farm = await freshFarm();
    const before = copy(ANIMAL_NEEDS_DATA);
    try {
        const mods = readAnimalMods(afcTestSave('enabled="true" autoScaleByDays="true" customMultiplier="1.000000" mode="auto" referenceSource="custom" seasonalWoolEnabled="true"'));
        applyAfcReferenceCurves(mods.afc);
        assert.ok(!ANIMAL_NEEDS_DATA.ALPACA_WHITE, 'a breed the game doesn\'t have isn\'t added');
        const sheep = ANIMAL_NEEDS_DATA.SHEEP_LANDRACE;
        assert.strictEqual(interpolateNeedCurve(sheep.food, 12), 40);
        assert.strictEqual(interpolateNeedCurve(sheep.production.WOOL, 12), 20);
        assert.deepStrictEqual(sheep.water, before.SHEEP_LANDRACE.water, 'a curve AFC doesn\'t have stays');

        // The scale covers what the animals give, as in the game.
        ANIMAL_MODS = mods;
        const days = farm.daysPerPeriod;
        farm.daysPerPeriod = 3;
        try {
            assert.strictEqual(feedOutputScale(farm), 3);
            const out = {};
            addClusterOutput(farm, { id: 'b' }, { subType: 'SHEEP_LANDRACE', age: 12, numAnimals: 2 }, getFeedPlan(farm), out);
            assert.ok(Math.abs(out.WOOL - 20 * 2 * 3 * effOf(farm)) < 1e-9, String(out.WOOL));
            const wool = breedNormsRows(farm, 'SHEEP_LANDRACE', 12, null).rows.find(r => r.key === 'WOOL');
            assert.strictEqual(wool.perHead, 60);
            assert.deepStrictEqual(farmShearMonths(farm, 'SHEEP_LANDRACE'), [6]);
        } finally {
            farm.daysPerPeriod = days;
        }
    } finally {
        ANIMAL_NEEDS_DATA = before;
        ANIMAL_MODS = null;
    }

    // The ration's productionWeight of the barn 'b' (none -> full output).
    function effOf(f) {
        const r = resolveRation('SHEEP', getFeedPlan(f), 'b');
        return r ? r.efficiency / 100 : 1;
    }
});
