// AFC editor (developer tool): changes curves of AFC's animals.xml inside
// the mod's zip, touching nothing else.

const AFC_ED_XML = [
    '<?xml version=\'1.0\' encoding=\'utf-8\'?>',
    '<animals>',
    '    <!-- <animal type="FAKE"><subType subType="NOT_A_BREED"/></animal> -->',
    '    <animal type="COW">',
    '        <subType subType="COW_HOLSTEIN">',
    '            <input>',
    '                <food>',
    '                    <key ageMonth="0" value="10" />',
    '                    <key ageMonth="12" value="50.5" />',
    '                </food>',
    '                <water>',
    '                    <key ageMonth="0" value="20"/>',
    '                </water>',
    '            </input>',
    '            <output>',
    '                <milk fillType="MILK">',
    '                    <key ageMonth="24" value="300" />',
    '                </milk>',
    '            </output>',
    '            <sellPrice><key ageMonth="0" value="1000" /></sellPrice>',
    '        </subType>',
    '    </animal>',
    '</animals>',
    ''
].join('\r\n');

async function afcEdTestZip() {
    const src = path.join(tlGameDir(), 'afc-ed-src');
    fs.rmSync(src, { recursive: true, force: true });
    fs.mkdirSync(path.join(src, 'xmls'), { recursive: true });
    fs.mkdirSync(path.join(src, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(src, 'modDesc.xml'), '<modDesc><version>1.2.0.1</version></modDesc>');
    fs.writeFileSync(path.join(src, 'xmls', 'animals.xml'), AFC_ED_XML);
    fs.writeFileSync(path.join(src, 'scripts', 'AnimalFoodCalculator.lua'), '-- lua\n'.repeat(500));
    const mods = path.join(tlGameDir(), 'afc-ed-mods');
    fs.mkdirSync(mods, { recursive: true });
    const zip = path.join(mods, 'FS25_AnimalFoodCalculator.zip');
    fs.rmSync(zip, { force: true });
    await mmCore.writeFolderZip(src, ['modDesc.xml', 'scripts/AnimalFoodCalculator.lua', 'xmls/animals.xml'], zip, () => {});
    return zip;
}

test('AFC editor: reads the breeds\' curves, not comments or prices', () => {
    const breeds = afcCore.afcParseAnimals(AFC_ED_XML);
    assert.deepStrictEqual(breeds.map(b => b.subType), ['COW_HOLSTEIN']);
    assert.deepStrictEqual(breeds[0].curves.map(c => c.id), ['COW_HOLSTEIN|input|food|', 'COW_HOLSTEIN|input|water|', 'COW_HOLSTEIN|output|milk|MILK']);
    assert.deepStrictEqual(breeds[0].curves[0].keys, [{ ageMonth: 0, value: 10 }, { ageMonth: 12, value: 50.5 }]);
});

test('AFC editor: a changed curve rewrites only its own keys, in the file\'s layout', () => {
    const r = afcCore.afcApplyEdits(AFC_ED_XML, {
        'COW_HOLSTEIN|input|food|': [{ ageMonth: 12, value: 60 }, { ageMonth: 0, value: 10 }, { ageMonth: 6, value: 30.123456 }],
        'COW_HOLSTEIN|input|water|': [{ ageMonth: 0, value: 20 }],
        'COW_NOPE|input|food|': [{ ageMonth: 0, value: 1 }]
    });
    assert.deepStrictEqual(r.changed, ['COW_HOLSTEIN|input|food|']);
    assert.deepStrictEqual(r.skipped, ['COW_NOPE|input|food|']);
    const want = AFC_ED_XML.replace(
        '                    <key ageMonth="12" value="50.5" />\r\n',
        '                    <key ageMonth="6" value="30.1235" />\r\n                    <key ageMonth="12" value="60" />\r\n');
    assert.strictEqual(r.xml, want);
    // Without a change, the file is the same, byte for byte.
    assert.strictEqual(afcCore.afcApplyEdits(AFC_ED_XML, {}).xml, AFC_ED_XML);
});

test('AFC editor: saving into the zip keeps the other files and a backup', async () => {
    const zip = await afcEdTestZip();
    const backups = path.join(tlGameDir(), 'afc-ed-backups');
    fs.rmSync(backups, { recursive: true, force: true });
    const before = afcCore.afcReadZip(zip);
    assert.strictEqual(before.version, '1.2.0.1');
    const r = afcCore.afcApplyEdits(before.xml, { 'COW_HOLSTEIN|output|milk|MILK': [{ ageMonth: 24, value: 450 }] });
    const backup = await afcCore.afcSaveZip(zip, r.xml, backups);
    assert.ok(fs.existsSync(backup));
    assert.strictEqual(afcCore.afcReadZip(backup).xml, AFC_ED_XML, 'the backup is the old zip');
    const after = afcCore.afcReadZip(zip);
    assert.strictEqual(after.xml, r.xml);
    const lua = modFiles.readModFile(path.dirname(zip), '$moddir$FS25_AnimalFoodCalculator/scripts/AnimalFoodCalculator.lua');
    assert.strictEqual(lua.toString(), '-- lua\n'.repeat(500));
    assert.ok(!fs.existsSync(zip + '.fp-new') && !fs.existsSync(zip + '.fp-edit'), 'nothing left behind');

    // A restore puts the old zip back; five backups at most.
    afcCore.afcRestoreZip(zip, backup, backups);
    assert.strictEqual(afcCore.afcReadZip(zip).xml, AFC_ED_XML);
    for (let i = 0; i < 6; i++) await afcCore.afcSaveZip(zip, r.xml, backups);
    assert.strictEqual(afcCore.afcBackupList(backups).length, 5);
});

test('AFC editor: a curve edited in the view counts as a change until it\'s back', async () => {
    const zip = await afcEdTestZip();
    setSetting('afcEditorZip', zip);
    assert.strictEqual(document.getElementById('afced-open-btn').hidden, !IS_DEV_BUILD);
    afcEdOpen();
    try {
        assert.ok(!document.getElementById('afced-view').hidden);
        assert.ok(document.querySelector('#afced-side .afced-breed[data-sub="COW_HOLSTEIN"]'));
        const card = document.querySelector('#afced-main [data-curve="COW_HOLSTEIN|input|food|"]');
        card.querySelector('.afced-mult-x').value = '2';
        card.querySelector('[data-act="mult"]').click();
        assert.deepStrictEqual(afcEdChangedIds(), ['COW_HOLSTEIN|input|food|']);
        assert.deepStrictEqual(afcEdKeys(afcEdCurve('COW_HOLSTEIN|input|food|')).map(k => k.value), [20, 101]);
        document.querySelector('#afced-main [data-curve="COW_HOLSTEIN|input|food|"] [data-act="reset"]').click();
        assert.deepStrictEqual(afcEdChangedIds(), []);
    } finally {
        afcEd.edits = {};
        await afcEdClose();
        setSetting('afcEditorZip', null);
    }
    assert.ok(document.getElementById('afced-view').hidden);
});
