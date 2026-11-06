// Every text in the app exists in every language.
const keysIn = l => new Set(Object.keys(TRANSLATIONS[l]));

function usedKeys() {
    const used = new Set();
    fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && !f.startsWith('translations')).forEach(f => {
        for (const m of fs.readFileSync(path.join(__dirname, f), 'utf-8').matchAll(/(?<![\w.$])t\(\s*'([A-Za-z0-9_]+)'\s*\)/g)) used.add(m[1]);
    });
    for (const m of fs.readFileSync(path.join(__dirname, 'index.html'), 'utf-8').matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)) used.add(m[1]);
    return used;
}

APP_LANGUAGES.forEach(lang => {
    test(`translations: ${lang} has every key the app uses`, () => {
        const have = keysIn(lang);
        assert.deepStrictEqual([...usedKeys()].filter(k => !have.has(k)), []);
    });
});

test('translations: pl and de have every English key', () => {
    const en = [...keysIn('en')];
    ['pl', 'de'].forEach(lang => {
        const have = keysIn(lang);
        assert.deepStrictEqual(en.filter(k => !have.has(k)), [], lang);
    });
});

test('translations: placeholders match across languages', () => {
    const marks = s => (String(s).match(/\{[a-zA-Z]+\}/g) || []).sort().join();
    const wrong = [];
    Object.keys(TRANSLATIONS.en).forEach(k => ['pl', 'de'].forEach(lang => {
        const v = TRANSLATIONS[lang][k];
        if (typeof v === 'string' && marks(v) !== marks(TRANSLATIONS.en[k])) wrong.push(`${lang}.${k}`);
    }));
    assert.deepStrictEqual(wrong, []);
});
