// Straw in barns: which buildings have it at all, and what Manure For All adds.
const strawCow = { subType: 'COW_HOLSTEIN', numAnimals: 10, age: 24, health: 100 };

test('straw: a building uses straw with a section or the fill type', () => {
    assert.strictEqual(placeableUsesStraw('<husbandry><straw capacity="100"/></husbandry>'), true);
    assert.strictEqual(placeableUsesStraw('<storage fillTypes="MILK STRAW"/>'), true);
    assert.strictEqual(placeableUsesStraw('<storage fillTypes="LIQUIDMANURE MILK"/>'), false);
    assert.strictEqual(placeableUsesStraw('<husbandry/>'), false);
});

test('straw: the small base barns have none, other base buildings are not guessed', () => {
    assert.strictEqual(barnUsesNoStraw('data/placeables/brandless/animalHusbandries/cowBarnSmall/cowBarnSmall.xml', 'x'), true);
    assert.strictEqual(barnUsesNoStraw('data/placeables/brandless/animalHusbandries/cowBarnBig/cowBarnBig.xml', 'x'), false);
});

test('manure for all: animals without straw or manure get them from their food', () => {
    const needs = copy(DEFAULT_ANIMALS);
    needs.LLAMA = { food: [{ ageMonth: 0, value: 100 }] };
    const cow = JSON.stringify([needs.COW_HOLSTEIN.straw, needs.COW_HOLSTEIN.production.MANURE]);
    applyManureForAll(needs);
    assert.deepStrictEqual(needs.CHICKEN.straw, [{ ageMonth: 0, value: 5 }]);
    assert.deepStrictEqual(needs.CHICKEN.production.MANURE, [{ ageMonth: 0, value: 10 }]);
    assert.ok(needs.CHICKEN.production.EGG, 'what it already produced stays');
    const goatFood = needs.GOAT.food[needs.GOAT.food.length - 1].value;
    assert.strictEqual(needs.GOAT.straw[needs.GOAT.straw.length - 1].value, goatFood * 0.4);
    assert.strictEqual(needs.GOAT.production.MANURE[needs.GOAT.production.MANURE.length - 1].value, goatFood * 0.35);
    assert.deepStrictEqual([needs.LLAMA.straw[0].value, needs.LLAMA.production.MANURE[0].value], [25, 50]);
    assert.strictEqual(JSON.stringify([needs.COW_HOLSTEIN.straw, needs.COW_HOLSTEIN.production.MANURE]), cow, 'existing curves stay');
});

test('manure for all: chickens now need straw, in the barn and in the feed planner', async () => {
    const farm = await freshFarm();
    const saved = ANIMAL_NEEDS_DATA;
    const hens = { id: 'hens', clusters: [{ subType: 'CHICKEN', numAnimals: 10, age: 12, health: 100 }], food: [], production: [] };
    const planned = () => buildFeedDemand({ ...farm, animalBuildings: [hens] }, getFeedPlan(farm)).byCategory.STRAW || 0;
    try {
        ANIMAL_NEEDS_DATA = copy(DEFAULT_ANIMALS);
        assert.strictEqual(planned(), 0);
        assert.ok(!barnCareInfo(hens, false).issues.some(i => i.key === 'straw'));
        applyManureForAll(ANIMAL_NEEDS_DATA);
        assert.ok(planned() > 0);
        assert.ok(barnCareInfo(hens, true).issues.some(i => i.key === 'straw'));
    } finally {
        ANIMAL_NEEDS_DATA = saved;
    }
});

test('straw: a barn without straw gets no warning, unless Manure For All gave it some', () => {
    const issue = (building, mod) => barnCareInfo(building, mod).issues.some(i => i.key === 'straw');
    const barn = extra => ({ clusters: [strawCow], food: [], production: [], ...extra });
    assert.strictEqual(issue(barn({ noStraw: true }), false), false);
    assert.strictEqual(barnCareInfo(barn({ noStraw: true }), false).straw.daily, 0);
    assert.strictEqual(issue(barn(), false), true);
    assert.strictEqual(issue(barn({ noStraw: true }), true), true);
});
