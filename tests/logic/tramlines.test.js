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
