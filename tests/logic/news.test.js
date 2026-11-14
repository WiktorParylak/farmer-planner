// News: posts from farmerplanner.pl/news.json, drawn from blocks, never HTML.

const NEWS_POST = (extra = {}) => ({ id: 'p1', date: '2026-11-01', title: { en: 'Hello', pl: 'Cześć' }, blocks: [], ...extra });

test('news: posts are filtered by version, end date and missing fields', async () => {
    const data = { format: 1, posts: [
        NEWS_POST({ id: 'ok' }),
        NEWS_POST({ id: 'too-new', minVersion: '0.12.0' }),
        NEWS_POST({ id: 'too-old', maxVersion: '0.10.0' }),
        NEWS_POST({ id: 'ended', until: '2026-11-10' }),
        NEWS_POST({ id: '', title: { en: 'No id' } }),
        NEWS_POST({ id: 'no-title', title: { pl: '' } }),
        NEWS_POST({ id: 'later', date: '2026-11-12', accent: 'purple', size: 'huge' })
    ] };
    const posts = newsValidPosts(data, { version: '0.11.3', today: '2026-11-14', lang: 'en' });
    assert.deepStrictEqual(posts.map(p => p.id), ['later', 'ok'], 'newest first');
    assert.strictEqual(posts[0].accent, 'green', 'a colour outside the list falls back');
    assert.strictEqual(posts[0].size, 'normal');
    assert.strictEqual(newsValidPosts(data, { version: '0.11.3', today: '2026-11-14', lang: 'de' })[1].title, 'Hello', 'German falls back to English');
    assert.strictEqual(newsValidPosts(data, { version: '0.11.3', today: '2026-11-14', lang: 'pl' })[1].title, 'Cześć');
    assert.deepStrictEqual(newsValidPosts({ format: 2, posts: data.posts }), [], 'an unknown format shows nothing');
    assert.deepStrictEqual(newsValidPosts(null), []);
});

test('news: seen posts drop out, a pinned one stays until hidden', async () => {
    const posts = [{ id: 'a' }, { id: 'b', pinned: true }, { id: 'c' }];
    assert.deepStrictEqual(newsUnseen(posts, ['a', 'b'], []).map(p => p.id), ['b', 'c']);
    assert.deepStrictEqual(newsUnseen(posts, ['a', 'b'], ['b']).map(p => p.id), ['c']);
});

test('news: text is escaped, only https links are clickable', async () => {
    const html = newsBlockHtml({ type: 'text', en: '<script>alert(1)</script> [ok](https://farmerplanner.pl) [bad](javascript:alert(1)) **b**' }, 'en');
    assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;'));
    assert.ok(html.includes('data-news-url="https://farmerplanner.pl"'));
    assert.ok(!html.includes('javascript:'), html);
    assert.ok(html.includes('<strong>b</strong>'));
    assert.strictEqual(newsBlockHtml({ type: 'button', url: 'http://farmerplanner.pl', label: { en: 'x' } }, 'en'), '', 'no http buttons');
    assert.strictEqual(newsBlockHtml({ type: 'text', en: '\u00010\u0001' }, 'en').includes('undefined'), false);
});

test('news: every block type draws, images only from farmerplanner.pl/news/', async () => {
    for (const block of FT.copy(FT.fakeNews().posts[0].blocks).concat(FT.copy(FT.fakeNews().posts[1].blocks))) {
        assert.ok(newsBlockHtml(block, 'en').length > 0, block.type);
    }
    assert.strictEqual(newsBlockHtml({ type: 'something-new' }, 'en'), '');
    assert.strictEqual(newsImageUrl('img/a.jpg'), 'https://farmerplanner.pl/news/img/a.jpg');
    assert.strictEqual(newsImageUrl('https://farmerplanner.pl/news/img/a.webp'), 'https://farmerplanner.pl/news/img/a.webp');
    for (const bad of ['https://evil.example/a.jpg', 'http://farmerplanner.pl/news/a.jpg', '../a.jpg', 'img/../../a.jpg', 'img/a.svg', '/etc/a.png', 'img//a.png']) {
        assert.strictEqual(newsImageUrl(bad), null, bad);
    }
    assert.ok(newsBlockHtml({ type: 'callout', tone: 'weird', en: 'x' }, 'en').includes('news-callout--info'));
});

test('news: a poll knows the vote and the end date, and sends only its own options', async () => {
    const poll = { id: 'q', until: '2026-11-20', options: [{ id: 'a', en: 'A' }, { id: 'b', en: 'B' }] };
    assert.deepStrictEqual(newsPollState(poll, {}, '2026-11-14'), { voted: null, closed: false });
    assert.deepStrictEqual(newsPollState(poll, { q: ['a'] }, '2026-11-14'), { voted: ['a'], closed: false });
    assert.strictEqual(newsPollState(poll, {}, '2026-11-21').closed, true);
    assert.deepStrictEqual(newsVotePayload(poll, ['a']), { poll: 'q', options: ['a'] });
    assert.strictEqual(newsVotePayload(poll, ['zzz']), null);
    assert.strictEqual(newsVotePayload(poll, ['a', 'b']), null, 'one option unless multi');
    assert.deepStrictEqual(newsVotePayload({ ...poll, multi: true }, ['a', 'b', 'zzz']), { poll: 'q', options: ['a', 'b'] });
    assert.ok(newsBlockHtml({ type: 'poll', ...poll }, 'en', { votes: {}, today: '2026-11-14' }).includes('news-poll-option'));
    assert.ok(newsBlockHtml({ type: 'poll', ...poll }, 'en', { votes: { q: ['b'] }, results: { q: { options: { a: 1, b: 3 } } }, today: '2026-11-14' }).includes('75%'));
});

test('news: the window shows unseen posts once and marks them seen; the button shows them all', async () => {
    setSetting('newsSeen', '[]');
    setSetting('newsHidden', '[]');
    setSetting('newsAtStart', '1');
    FT.fakeNews();
    await loadNews();
    assert.strictEqual(document.getElementById('news-badge').textContent, '2');
    const shown = showNewsAtStart(Promise.resolve());
    await waitFor(() => document.getElementById('news-modal').style.display === 'flex', 'the news window');
    assert.strictEqual(document.getElementById('news-title').textContent, 'Winter on the farm');
    await waitFor(() => document.querySelector('#news-body img.news-banner[src^="file:"]'), 'the banner from the cache');
    document.getElementById('news-next').click();
    assert.strictEqual(document.getElementById('news-title').textContent, 'What next?');
    document.getElementById('news-close').click();
    await shown;
    assert.deepStrictEqual(newsList('newsSeen').sort(), ['test-poll', 'test-welcome']);
    assert.strictEqual(document.getElementById('news-badge').hidden, true);
    assert.strictEqual(newsUnseenPosts().length, 0, 'not shown at the next start');
    await wait(400);
});

test('news: a vote goes out once with the install id and shows the results', async () => {
    setSetting('newsVotes', '{}');
    FT.fakeNews();
    FT.newsVotesSent.length = 0;
    const shown = showNewsWindow([newsPosts()[1]]);
    await waitFor(() => document.querySelector('#news-body .news-poll-option'), 'the poll');
    document.querySelector('#news-body .news-poll-option[data-option="b"]').click();
    await waitFor(() => document.querySelector('#news-body .news-poll-result.is-mine'), 'the results');
    assert.strictEqual(FT.newsVotesSent.length, 1);
    assert.deepStrictEqual(FT.newsVotesSent[0].options, ['b']);
    assert.ok(/^[0-9a-f-]{36}$/.test(FT.newsVotesSent[0].install));
    assert.deepStrictEqual(newsJson('newsVotes', {})['test-next'], ['b']);
    assert.ok(document.querySelector('#news-body .news-poll-pct'));
    document.getElementById('news-close').click();
    await shown;
    await wait(400);
});

test('news: with "show at start" off nothing opens', async () => {
    setSetting('newsSeen', '[]');
    setSetting('newsAtStart', '0');
    FT.fakeNews();
    await showNewsAtStart(Promise.resolve());
    assert.notStrictEqual(document.getElementById('news-modal').style.display, 'flex');
    setSetting('newsAtStart', '1');
    setSetting('newsSeen', JSON.stringify(['test-welcome', 'test-poll']));
});

test('news: the diagnostic file has the news settings but not the install id', async () => {
    newsInstallId();
    setSetting('newsFetchedAt', '2026-11-14T10:00:00.000Z');
    const s = appSettingsForDiagnostics();
    assert.strictEqual(s.newsInstallId, undefined);
    assert.strictEqual(s.newsFetchedAt, '2026-11-14T10:00:00.000Z');
    assert.ok('newsSeen' in s);
});
