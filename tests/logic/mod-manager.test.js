// Mod manager: libraries, problems, savegame comparison, gameSettings.xml,
// file operations, FSG import, DDS icons. Everything runs on folders made here,
// next to the test's data folder.
const mmT = require('./mod-library-core');
const { decodeDds: mmTDecode } = require('./dds');
const mmRoot = path.join(path.dirname(appDataDir), 'mm-test');

// A stored (uncompressed) zip: { 'modDesc.xml': '<…>' } -> Buffer.
function mmZip(files) {
    const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcTable[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    const locals = [], centrals = [];
    let offset = 0;
    Object.entries(files).forEach(([name, data]) => {
        const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const nameBuf = Buffer.from(name);
        const head = Buffer.alloc(30);
        head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(10, 4);
        head.writeUInt32LE(crc(body), 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(body.length, 22);
        head.writeUInt16LE(nameBuf.length, 26);
        const cen = Buffer.alloc(46);
        cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(10, 4); cen.writeUInt16LE(10, 6);
        cen.writeUInt32LE(crc(body), 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(body.length, 24);
        cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
        locals.push(head, nameBuf, body);
        centrals.push(cen, nameBuf);
        offset += 30 + nameBuf.length + body.length;
    });
    const cd = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
    end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, end]);
}

function mmModDesc(version, extra = '', q = '"') {
    return `<?xml version="1.0" encoding="utf-8" standalone="no"?>
<modDesc descVersion=${q}97${q}>
    <author>Tester</author>
    <version>${version}</version>
    <title><en>Good tractor</en><pl>Dobry traktor</pl></title>
    <description><en><![CDATA[A tractor & more]]></en></description>
    <iconFilename>icon.png</iconFilename>
    <multiplayer supported="true"/>${extra}
</modDesc>`;
}

// One 4x4 DXT1 block, every pixel colour 0 (red).
function mmDxt1Red() {
    const head = Buffer.alloc(128);
    head.write('DDS ', 0, 'latin1');
    head.writeUInt32LE(124, 4); head.writeUInt32LE(4, 12); head.writeUInt32LE(4, 16);
    head.writeUInt32LE(32, 76); head.writeUInt32LE(0x4, 80); head.write('DXT1', 84, 'latin1');
    const block = Buffer.alloc(8);
    block.writeUInt16LE(0xF800, 0); block.writeUInt16LE(0x001F, 2); block.writeUInt32LE(0, 4);
    return Buffer.concat([head, block]);
}

function mmFixture() {
    fs.rmSync(mmRoot, { recursive: true, force: true });
    const lib = path.join(mmRoot, 'libA');
    fs.mkdirSync(path.join(lib, 'FS25_Unzipped'), { recursive: true });
    fs.writeFileSync(path.join(lib, 'FS25_Good.zip'), mmZip({ 'modDesc.xml': mmModDesc('1.0.0.0'), 'icon.dds': mmDxt1Red() }));
    fs.writeFileSync(path.join(lib, 'FS25_Good (1).zip'), mmZip({ 'modDesc.xml': mmModDesc('1.0.0.0') }));
    fs.writeFileSync(path.join(lib, 'Bad Name.zip'), mmZip({ 'modDesc.xml': mmModDesc('2.0') }));
    fs.writeFileSync(path.join(lib, 'FS25_Pack.zip'), mmZip({ 'FS25_A.zip': 'x', 'FS25_B.zip': 'y' }));
    fs.writeFileSync(path.join(lib, 'FS25_Broken.zip'), 'not a zip at all');
    fs.writeFileSync(path.join(lib, 'readme.txt'), 'ignored');
    fs.writeFileSync(path.join(lib, 'FS25_Unzipped', 'modDesc.xml'), mmModDesc('1.2.0.0').replace(' descVersion="97"', ''));
    fs.mkdirSync(path.join(mmRoot, 'libB'));
    return lib;
}

test('mod manager: DXT1 icons decode to the right colours', () => {
    const img = mmTDecode(mmDxt1Red());
    assert.ok(img, 'decoded');
    assert.strictEqual(img.width, 4);
    assert.deepStrictEqual([...img.data.slice(0, 4)], [255, 0, 0, 255]);
    assert.strictEqual(mmTDecode(Buffer.from('nope')), null);
});

test('mod manager: a library scan reads modDesc and finds what is wrong', async () => {
    const lib = mmFixture();
    const { mods } = await mmT.scanLibrary(lib);
    const by = name => mods.find(m => m.file === name);
    assert.strictEqual(mods.length, 6, 'zips and folders only: ' + mods.map(m => m.file).join(', '));
    const good = by('FS25_Good.zip');
    assert.strictEqual(good.title.pl, 'Dobry traktor');
    assert.strictEqual(good.description.en, 'A tractor & more');
    assert.strictEqual(good.version, '1.0.0.0');
    assert.strictEqual(good.author, 'Tester');
    assert.strictEqual(good.multiplayer, true);
    assert.deepStrictEqual(good.problems, ['duplicate']);
    assert.deepStrictEqual(by('FS25_Good (1).zip').problems, ['copyName', 'duplicate']);
    assert.strictEqual(by('FS25_Good (1).zip').suggestedName, 'FS25_Good');
    assert.deepStrictEqual(by('Bad Name.zip').problems, ['badName']);
    assert.strictEqual(by('Bad Name.zip').suggestedName, 'Bad_Name');
    assert.ok(by('FS25_Pack.zip').problems.includes('pack'));
    assert.ok(by('FS25_Broken.zip').problems.includes('corrupt'));
    assert.deepStrictEqual(by('FS25_Unzipped').problems, ['noDescVersion'], 'an unzipped (edited) mod is not a problem in itself');
    // A zip next to the player's edited folder of the same mod.
    fs.writeFileSync(path.join(lib, 'FS25_Unzipped.zip'), mmZip({ 'modDesc.xml': mmModDesc('1.0.0.0') }));
    const both = (await mmT.scanLibrary(lib)).mods;
    assert.deepStrictEqual(both.find(m => m.file === 'FS25_Unzipped.zip').problems, ['zipAndFolder']);
    assert.ok(both.find(m => m.file === 'FS25_Unzipped').problems.includes('zipAndFolder'));
    fs.unlinkSync(path.join(lib, 'FS25_Unzipped.zip'));
    fs.writeFileSync(path.join(lib, 'FS25_Quotes.zip'), mmZip({ 'modDesc.xml': mmModDesc('1.0.0.0', '', "'") }));
    const quotes = (await mmT.scanLibrary(lib)).mods.find(m => m.file === 'FS25_Quotes.zip');
    assert.strictEqual(quotes.descVersion, 97, "descVersion='97' in single quotes counts");
    const icon = mmT.readModIcon(good);
    assert.ok(icon && icon.toString('latin1', 0, 4) === 'DDS ', 'icon.png in modDesc is found as icon.dds');
});

test('mod manager: names the game will not load get a fixed name', () => {
    assert.strictEqual(mmT.suggestModName('FS25_Tractor (2)'), 'FS25_Tractor');
    assert.strictEqual(mmT.suggestModName('FS25_Tractor - Copy'), 'FS25_Tractor');
    assert.strictEqual(mmT.suggestModName('FS25 Big-Tractor'), 'FS25_BigTractor');
    assert.strictEqual(mmT.suggestModName('25_Tractor'), 'FS25_25_Tractor');
    assert.ok(mmT.VALID_MOD_NAME.test('FS25_Ok_2'));
    assert.ok(!mmT.VALID_MOD_NAME.test('2FS25'));
});

test('mod manager: a library compared with a save', async () => {
    const lib = mmFixture();
    const save = path.join(mmRoot, 'careerSavegame.xml');
    fs.writeFileSync(save, `<careerSavegame><mod modName="FS25_Good" title="Good tractor" version="1.0.0.1" required="true"/>
        <mod modName="FS25_Missing" title="Missing one" version="1.0.0.0" required="true"/>
        <mod modName="pdlc_highlandsFishingPack" title="DLC" version="1.0.0.0" required="true"/></careerSavegame>`);
    const { mods } = await mmT.scanLibrary(lib);
    const r = mmT.compareWithSave(mods, mmT.readSaveMods(save));
    assert.deepStrictEqual(r.missing.map(m => m.name), ['FS25_Missing'], 'DLCs are not missing mods');
    assert.deepStrictEqual(r.versionDiff.map(d => d.mod.file), ['FS25_Good.zip']);
    assert.ok(r.unused.some(m => m.file === 'FS25_Unzipped'));
    assert.ok(!r.unused.some(m => m.file === 'FS25_Good.zip'));
});

test('mod manager: activating a library changes only the override in gameSettings.xml', () => {
    fs.rmSync(mmRoot, { recursive: true, force: true });
    const game = path.join(mmRoot, 'game');
    const backups = path.join(mmRoot, 'backups');
    fs.mkdirSync(game, { recursive: true });
    const original = '<?xml version="1.0" encoding="utf-8" standalone="no"?>\r\n<gameSettings revision="2">\r\n    <volume music="0.5"/>\r\n    <modsDirectoryOverride active="false" directory="C:/Temp"/>\r\n    <player name="Tester"/>\r\n</gameSettings>\r\n';
    const file = path.join(game, 'gameSettings.xml');
    fs.writeFileSync(file, original);

    const backup = mmT.setOverride(game, 'D:/Mods/Solek & co', backups);
    assert.strictEqual(fs.readFileSync(backup, 'utf-8'), original, 'the copy is the file as it was');
    const after = fs.readFileSync(file, 'utf-8');
    assert.strictEqual(after, original.replace('active="false" directory="C:/Temp"', 'active="true" directory="D:/Mods/Solek &amp; co"'));
    assert.deepStrictEqual(mmT.readOverride(game), { active: true, directory: 'D:/Mods/Solek & co' });

    mmT.setOverride(game, null, backups);
    assert.deepStrictEqual(mmT.readOverride(game), { active: false, directory: 'D:/Mods/Solek & co' });
    for (let i = 0; i < 6; i++) mmT.setOverride(game, 'D:/Mods/' + i, backups);
    assert.strictEqual(fs.readdirSync(backups).length, 5, 'five copies kept');
    assert.ok(!fs.existsSync(file + '.fp-tmp'));

    // A file without the tag gets one, the rest stays.
    fs.writeFileSync(file, '<gameSettings>\n    <volume music="0.5"/>\n</gameSettings>\n');
    mmT.setOverride(game, 'E:/Lib', backups);
    assert.strictEqual(fs.readFileSync(file, 'utf-8'), '<gameSettings>\n    <volume music="0.5"/>\n    <modsDirectoryOverride active="true" directory="E:/Lib"/>\n</gameSettings>\n');
});

test('mod manager: mods copy, move and rename between libraries', async () => {
    const lib = mmFixture();
    const libB = path.join(mmRoot, 'libB');
    const src = path.join(lib, 'FS25_Good.zip');
    const size = fs.statSync(src).size;
    let last = 0;
    await mmT.copyMod(src, libB, null, done => { last = done; });
    assert.strictEqual(fs.statSync(path.join(libB, 'FS25_Good.zip')).size, size);
    assert.strictEqual(last, size, 'progress reaches the end');
    assert.ok(fs.existsSync(src), 'a copy leaves the original');

    await mmT.copyMod(path.join(lib, 'FS25_Unzipped'), libB);
    assert.ok(fs.existsSync(path.join(libB, 'FS25_Unzipped', 'modDesc.xml')), 'folders copy too');

    const trashed = [];
    await mmT.moveMod(path.join(lib, 'Bad Name.zip'), libB, null, async p => trashed.push(p));
    assert.ok(fs.existsSync(path.join(libB, 'Bad Name.zip')) && !fs.existsSync(path.join(lib, 'Bad Name.zip')));
    assert.deepStrictEqual(trashed, [], 'a move on one drive is a rename');

    const { mods } = await mmT.scanLibrary(libB);
    const bad = mods.find(m => m.file === 'Bad Name.zip');
    mmT.renameMod(bad, bad.suggestedName);
    assert.ok(fs.existsSync(path.join(libB, 'Bad_Name.zip')));
    assert.throws(() => mmT.renameMod(mods.find(m => m.file === 'FS25_Good.zip'), 'bad name'), e => e.code === 'MM_BAD_NAME');
});

function mmFakeTrash() {
    const list = [];
    const trash = async p => {
        list.push(p);
        const bin = path.join(mmRoot, 'bin');
        fs.mkdirSync(bin, { recursive: true });
        fs.renameSync(p, path.join(bin, String(list.length)));
    };
    return { list, trash };
}

test('mod manager: a folder zips and unzips back byte for byte, the original goes to the bin', async () => {
    const lib = mmFixture();
    const folder = path.join(lib, 'FS25_Packed');
    const blob = require('crypto').randomBytes(200000);
    fs.mkdirSync(path.join(folder, 'maps', 'żółw'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'modDesc.xml'), mmModDesc('1.5.0.0'));
    fs.writeFileSync(path.join(folder, 'maps', 'żółw', 'data.bin'), blob);
    fs.writeFileSync(path.join(folder, 'empty.txt'), '');
    const { list, trash } = mmFakeTrash();
    let last = [0, 1];
    await mmT.packMod(mmT.readModEntry(lib, 'FS25_Packed'), trash, (a, b) => { last = [a, b]; });
    assert.strictEqual(last[0], last[1], 'progress reaches the end');
    const zipped = mmT.readModEntry(lib, 'FS25_Packed.zip');
    assert.deepStrictEqual([zipped.hasModDesc, zipped.corrupt, zipped.version], [true, false, '1.5.0.0']);
    assert.ok(!fs.existsSync(folder) && !fs.existsSync(path.join(lib, 'FS25_Packed.zip.fp-new')));
    assert.deepStrictEqual(list, [folder]);

    await mmT.unpackMod(zipped, trash);
    assert.ok(fs.readFileSync(path.join(folder, 'maps', 'żółw', 'data.bin')).equals(blob));
    assert.strictEqual(fs.readFileSync(path.join(folder, 'modDesc.xml'), 'utf-8'), mmModDesc('1.5.0.0'));
    assert.strictEqual(fs.statSync(path.join(folder, 'empty.txt')).size, 0);
    assert.ok(!fs.existsSync(zipped.path) && !fs.existsSync(folder + '.fp-new'));
    assert.strictEqual(list.length, 2);
});

test('mod manager: a zip with a file leaving its folder is refused', async () => {
    const lib = mmFixture();
    const file = path.join(lib, 'FS25_Evil.zip');
    fs.writeFileSync(file, mmZip({ 'modDesc.xml': mmModDesc('1.0.0.0'), '../evil.txt': 'x' }));
    const { list, trash } = mmFakeTrash();
    await assert.rejects(mmT.unpackMod(mmT.readModEntry(lib, 'FS25_Evil.zip'), trash), e => e.code === 'MM_ZIP_BAD');
    assert.ok(fs.existsSync(file) && !fs.existsSync(path.join(lib, 'evil.txt')) && !fs.existsSync(path.join(lib, 'FS25_Evil.fp-new')));
    assert.deepStrictEqual(list, []);
});

test('mod manager: a damaged zip stays as it was and leaves nothing behind', async () => {
    const lib = mmFixture();
    const file = path.join(lib, 'FS25_Bent.zip');
    const body = 'MARKER'.repeat(50);
    const zip = mmZip({ 'modDesc.xml': mmModDesc('1.0.0.0'), 'data.txt': body });
    zip[zip.indexOf(body) + 10] ^= 0xFF;
    fs.writeFileSync(file, zip);
    const { list, trash } = mmFakeTrash();
    await assert.rejects(mmT.unpackMod(mmT.readModEntry(lib, 'FS25_Bent.zip'), trash), e => e.code === 'MM_ZIP_CHECK');
    assert.ok(fs.readFileSync(file).equals(zip) && !fs.existsSync(path.join(lib, 'FS25_Bent.fp-new')));
    assert.deepStrictEqual(list, []);
});

test('mod manager: zipping refuses a name already taken', async () => {
    const lib = mmFixture();
    fs.writeFileSync(path.join(lib, 'FS25_Unzipped.zip'), mmZip({ 'modDesc.xml': mmModDesc('1.0.0.0') }));
    const { list, trash } = mmFakeTrash();
    await assert.rejects(mmT.packMod(mmT.readModEntry(lib, 'FS25_Unzipped'), trash), e => e.code === 'MM_EXISTS');
    await assert.rejects(mmT.unpackMod(mmT.readModEntry(lib, 'FS25_Unzipped.zip'), trash), e => e.code === 'MM_EXISTS');
    assert.deepStrictEqual(list, []);
});

test('mod manager: a row offers unzip for a zip, zip for a folder, nothing for a broken zip', () => {
    const lib = mmFixture();
    const icon = file => {
        const box = document.createElement('div');
        box.innerHTML = mmModRowHtml(mmT.readModEntry(lib, file));
        const b = box.querySelector('[data-mm="zip-toggle"]');
        return b ? b.querySelector('i').className : null;
    };
    assert.ok(icon('FS25_Good.zip').includes('fa-box-open'));
    assert.ok(icon('FS25_Unzipped').includes('fa-file-zipper'));
    assert.strictEqual(icon('FS25_Broken.zip'), null);
});

test('mod manager: zips to add are checked first', () => {
    const lib = mmFixture();
    assert.deepStrictEqual([
        mmT.checkModZip(path.join(lib, 'FS25_Good.zip')).ok,
        mmT.checkModZip(path.join(lib, 'FS25_Good (1).zip')).rename,
        mmT.checkModZip(path.join(lib, 'FS25_Pack.zip')).reason,
        mmT.checkModZip(path.join(lib, 'FS25_Broken.zip')).reason
    ], [true, 'FS25_Good', 'pack', 'corrupt']);
});

test('mod manager: FSG Mod Assistant collections are imported once, without duplicates', () => {
    const lib = mmFixture();
    const libB = path.join(mmRoot, 'libB');
    const fs22 = path.join(mmRoot, 'fs22');
    fs.mkdirSync(fs22);
    const app = path.join(mmRoot, 'appdata', 'FSModAssistant');
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(app, 'config.json'), JSON.stringify({ modFolders: [lib, libB, fs22, path.join(mmRoot, 'gone')] }));
    const md5 = s => require('crypto').createHash('md5').update(s).digest('hex');
    fs.writeFileSync(path.join(app, 'col_notes.json'), JSON.stringify({
        ['col_' + md5(lib)]: { notes_notes: 'Solek farm', notes_version: 25 },
        ['col_' + md5(fs22)]: { notes_version: 22 }
    }));
    const found = mmT.readFsgCollections(path.join(mmRoot, 'appdata'));
    assert.deepStrictEqual(found.map(c => [c.name, c.notes, c.game]), [['libA', 'Solek farm', 25], ['libB', '', 25], ['fs22', '', 22]]);
    const libs = [{ id: 'x', name: 'Mine', dir: libB }];
    assert.strictEqual(mmT.addLibraries(libs, found.filter(c => c.game === 25)), 1);
    assert.strictEqual(mmT.addLibraries(libs, found.filter(c => c.game === 25)), 0);
    assert.deepStrictEqual(libs.map(l => l.name), ['Mine', 'libA']);
});

test('mod manager: ModHub versions are compared number by number', () => {
    assert.strictEqual(mmT.compareVersions('1.0.0.10', '1.0.0.9'), 1);
    assert.strictEqual(mmT.compareVersions('1.0', '1.0.0.0'), 0);
    assert.strictEqual(mmT.compareVersions('1.0.0.0', '1.0.0.1'), -1);
    const hub = { mods: { FS25_Good: '123' }, version: { 123: '1.1.0.0' } };
    const info = mmT.modHubInfo({ name: 'FS25_Good', version: '1.0.0.0' }, hub);
    assert.deepStrictEqual([info.newer, info.latest, info.url], [true, '1.1.0.0', 'https://www.farming-simulator.com/mod.php?mod_id=123']);
    assert.strictEqual(mmT.modHubInfo({ name: 'FS25_Other', version: '1' }, hub), null);
});

test('mod manager: an update from ModHub replaces the old version, and only with the same mod', async () => {
    const lib = mmFixture();
    const downloads = path.join(mmRoot, 'downloads');
    fs.mkdirSync(downloads);
    const since = Date.now();
    assert.strictEqual(mmT.findDownloadedZip(downloads, 'FS25_Good', since), null, 'nothing yet');
    fs.writeFileSync(path.join(downloads, 'FS25_Good (1).zip'), 'half a file');
    assert.strictEqual(mmT.findDownloadedZip(downloads, 'FS25_Good', since), null, 'an unfinished zip is not taken');
    fs.writeFileSync(path.join(downloads, 'FS25_Good (1).zip'), mmZip({ 'modDesc.xml': mmModDesc('1.1.0.0') }));
    const found = mmT.findDownloadedZip(downloads, 'FS25_Good', since);
    assert.ok(found && found.path.endsWith('FS25_Good (1).zip'), 'the browser\'s "(1)" name is found');

    // The old version is an unzipped folder: it goes to the bin, the zip takes its place.
    const { mods } = await mmT.scanLibrary(lib);
    const old = mods.find(m => m.file === 'FS25_Unzipped');
    fs.writeFileSync(path.join(downloads, 'FS25_Unzipped.zip'), mmZip({ 'modDesc.xml': mmModDesc('1.3.0.0') }));
    const trashed = [];
    const trash = async p => { trashed.push(path.basename(p)); fs.rmSync(p, { recursive: true, force: true }); };
    const r = await mmT.replaceModWithZip(old, path.join(downloads, 'FS25_Unzipped.zip'), trash);
    assert.strictEqual(r.version, '1.3.0.0');
    assert.deepStrictEqual(trashed, ['FS25_Unzipped']);
    assert.ok(fs.existsSync(path.join(lib, 'FS25_Unzipped.zip')) && !fs.existsSync(path.join(lib, 'FS25_Unzipped')));
    assert.ok(fs.existsSync(path.join(downloads, 'FS25_Unzipped.zip')), 'the download stays where the browser put it');
    assert.ok(!fs.readdirSync(lib).some(f => f.endsWith('.fp-new')), 'no leftovers');

    // An older or broken zip replaces nothing.
    const good = mods.find(m => m.file === 'FS25_Good.zip');
    fs.writeFileSync(path.join(downloads, 'older.zip'), mmZip({ 'modDesc.xml': mmModDesc('0.9.0.0') }));
    await assert.rejects(mmT.replaceModWithZip(good, path.join(downloads, 'older.zip'), trash), e => e.code === 'MM_HUB_MISMATCH');
    await assert.rejects(mmT.replaceModWithZip(good, path.join(lib, 'FS25_Broken.zip'), trash), e => e.code === 'MM_HUB_MISMATCH');
    assert.ok(fs.existsSync(good.path), 'the old one is still there');
});

test('mod manager: the view lists the game folder and a new library', async () => {
    const gameDir = tlGameDir();
    fs.mkdirSync(path.join(gameDir, 'mods'), { recursive: true });
    fs.writeFileSync(path.join(gameDir, 'mods', 'FS25_Good.zip'), mmZip({ 'modDesc.xml': mmModDesc('1.0.0.0'), 'icon.dds': mmDxt1Red() }));
    fs.writeFileSync(path.join(gameDir, 'mods', 'Bad Name.zip'), mmZip({ 'modDesc.xml': mmModDesc('1.0.0.0') }));
    exitBtn.click();
    await wait(200);
    document.getElementById('modmanager-btn').click();
    await waitFor(() => document.querySelectorAll('#mm-main .mm-mod').length === 2, 'two mods listed');
    await waitFor(() => document.querySelector('#mm-main .mm-icon img'), 'an icon');
    assert.ok(document.querySelector('.mm-lib.is-picked .mm-badge.is-active'), 'the game folder is active without an override');
    document.querySelector('[data-mm="tab"][data-tab="problems"]').click();
    assert.strictEqual(document.querySelectorAll('#mm-main .mm-problem').length, 1);

    document.querySelector('[data-mm="new"]').click();
    await waitFor(dialogOpen, 'the new library window');
    document.getElementById('mm-f-name').value = 'Test library';
    document.getElementById('app-dialog-confirm').click();
    await waitFor(() => document.querySelectorAll('.mm-lib').length === 2, 'the new library');
    const libs = mmT.readLibraries(appDataDir);
    assert.strictEqual(libs.length, 1);
    assert.ok(fs.existsSync(libs[0].dir), 'its folder is made');

    document.getElementById('mm-back').click();
    fs.rmSync(path.join(gameDir, 'mods'), { recursive: true, force: true });
    fs.rmSync(mmRoot, { recursive: true, force: true });
    mm.libs = []; mmSaveLibraries(); mm.sel = 'default';
    // The tests after this one expect a farm open, as freshFarm leaves it.
    await freshFarm();
});
