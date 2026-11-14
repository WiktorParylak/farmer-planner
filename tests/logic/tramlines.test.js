// Tramline editor: what shows where the brush is.

test('tramlines: a brush too big for a cursor is drawn as a ring over the map', () => {
    const ring = document.getElementById('tl-brush-ring');
    const before = tlMouse;
    try {
        tlMouse = [100, 80];
        tlUpdateBrushRing(TL_CURSOR_MAX + 80, true);
        assert.strictEqual(ring.hidden, false);
        assert.deepStrictEqual([ring.style.width, ring.style.left, ring.style.top], [`${TL_CURSOR_MAX + 80}px`, '100px', '80px']);
        assert.ok(ring.classList.contains('is-erase'));
        tlUpdateBrushRing(40, false);
        assert.strictEqual(ring.hidden, true, 'a small brush is the cursor itself');
        tlMouse = null;
        tlUpdateBrushRing(TL_CURSOR_MAX + 80, false);
        assert.strictEqual(ring.hidden, true, 'no ring with the mouse off the map');
    } finally {
        tlMouse = before;
        tlUpdateBrushRing(0, false);
    }
});

// Outlines of the fields from the soil: a grid of labels, one string per row.
const tlGrid = rows => {
    const dim = rows.length, labels = new Uint16Array(dim * dim);
    rows.forEach((r, y) => [...r].forEach((c, x) => { labels[y * dim + x] = +c; }));
    return [labels, dim];
};
const tlOutlines = (rows, cell = 1) => tlCore.traceLabelOutlines(...tlGrid(rows), cell);

test('tramlines: a rectangle field has a four-point outline, in map pixels', () => {
    assert.deepStrictEqual(tlOutlines(['0000', '0110', '0110', '0000'], 2).get(1), [[[2, 2], [6, 2], [6, 6], [2, 6]]]);
});

test('tramlines: an L-shaped field keeps its inner corner', () => {
    const rows = ['11111100', '11111100', '11111100', '11100000', '11100000', '11100000', '00000000', '00000000'];
    assert.deepStrictEqual(tlOutlines(rows).get(1), [[[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]]]);
});

test('tramlines: a field with a hole has two rings, neighbours have their own', () => {
    const holed = tlOutlines(['1111', '1001', '1001', '1111']).get(1);
    assert.strictEqual(holed.length, 2);
    const two = tlOutlines(['1122', '1122', '0000', '0000']);
    assert.deepStrictEqual([two.get(1), two.get(2)], [[[[0, 0], [2, 0], [2, 2], [0, 2]]], [[[2, 0], [4, 0], [4, 2], [2, 2]]]]);
});

test('tramlines: a slanted staircase edge becomes a straight line', () => {
    const rows = [];
    for (let y = 0; y < 40; y++) rows.push(Array.from({ length: 40 }, (_, x) => (x > y / 2 ? '1' : '0')).join(''));
    const rings = tlOutlines(rows).get(1);
    assert.strictEqual(rings.length, 1);
    assert.ok(rings[0].length <= 5, `${rings[0].length} points`);
});

test('tramlines: fields are picked by their outline, there is no "Fields from the map" any more', () => {
    const html = tlCutHtml({ dir: 'x', name: 'x', title: 'x' });
    assert.ok(!html.includes('tl-detect-map'));
    assert.ok(html.includes('tl-detect-ground'));
});
