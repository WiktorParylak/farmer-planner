// What's new after an update: which changelog sections the window shows.

test('whats new: an update shows the versions since the last one run', () => {
    assert.deepStrictEqual(whatsNewSections('0.10.0', '0.11.0', null).map(s => s.version), ['0.11.0', '0.10.1']);
    assert.deepStrictEqual(whatsNewSections(null, '0.11.0', null).map(s => s.version), ['0.11.0']);
});

test('whats new: a hotfix shows the version it fixes, then its own changes', () => {
    const fromBase = whatsNewSections('0.11.0', '0.11.1', '0.11.0');
    assert.deepStrictEqual(fromBase.map(s => s.version), ['0.11.0', '0.11.1']);
    assert.deepStrictEqual(fromBase.map(s => !!s.hotfix), [false, true]);
    assert.deepStrictEqual(whatsNewSections('0.10.1', '0.11.1', '0.11.0').map(s => s.version), ['0.11.0', '0.11.1']);
    assert.deepStrictEqual(whatsNewSections(null, '0.11.1', '0.11.0').map(s => s.version), ['0.11.0', '0.11.1']);
    assert.strictEqual(whatsNewVersionLabel('0.11.1', true), t('whatsNewHotfix').replace('{v}', '0.11.1'));
});

test('whats new: a hotfix mark left in the next version does nothing', () => {
    assert.strictEqual(hotfixBaseFor('0.11.1', '0.11.0'), '0.11.0');
    assert.strictEqual(hotfixBaseFor('0.12.0', '0.11.0'), null);
    assert.strictEqual(hotfixBaseFor('0.11.0', '0.11.0'), null);
    assert.strictEqual(hotfixBaseFor('0.11.1', undefined), null);
});
