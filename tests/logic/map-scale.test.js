// Map scaling: which layer files it can read.

const msCoreT = require('./map-scale-core');

// A 256 × 256 GRLE of one value, with the given bytes per pixel.
function msGrle(bpp) {
    const head = Buffer.alloc(21);
    head.write('GRLE', 0, 'latin1');
    head.writeUInt16LE(1, 4);
    head.writeUInt16LE(1, 6);
    head.writeUInt16LE(1, 10);
    head[13] = bpp;
    const run = 256 * 256 - 2;
    const body = [7, 7];
    for (let c = run; c >= 255; c -= 255) body.push(255);
    body.push(run % 255);
    head.writeUInt32LE(body.length, 17);
    return Buffer.concat([head, Buffer.from(body)]);
}

test('map scale: an 8-bit GRLE is read, a 16-bit one is an unknown format, not a broken run', async () => {
    assert.deepStrictEqual(msCoreT.info('infoLayer_farmlands.grle', msGrle(1)), { w: 256, h: 256, channels: 8 });
    assert.throws(() => msCoreT.info('infoLayer_farmland.grle', msGrle(2)), e => e.code === 'MS_BAD_FILE');
    const out = path.join(require('os').tmpdir(), `fp-ms-test-${process.pid}.grle`);
    try {
        const h = await msCoreT.scale('infoLayer_farmlands.grle', msGrle(1), out, 2, () => {});
        assert.strictEqual(await msCoreT.hashFile('infoLayer_farmlands.grle', fs.readFileSync(out)), h);
        assert.deepStrictEqual(msCoreT.info('infoLayer_farmlands.grle', fs.readFileSync(out)), { w: 512, h: 512, channels: 8 });
    } finally { fs.rmSync(out, { force: true }); }
});
