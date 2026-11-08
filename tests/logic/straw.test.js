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

test('straw: a barn without straw gets no warning, unless Manure For All gave it some', () => {
    const issue = (building, mod) => barnCareInfo(building, mod).issues.some(i => i.key === 'straw');
    const barn = extra => ({ clusters: [strawCow], food: [], production: [], ...extra });
    assert.strictEqual(issue(barn({ noStraw: true }), false), false);
    assert.strictEqual(barnCareInfo(barn({ noStraw: true }), false).straw.daily, 0);
    assert.strictEqual(issue(barn(), false), true);
    assert.strictEqual(issue(barn({ noStraw: true }), true), true);
});
