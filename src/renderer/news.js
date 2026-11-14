// =============================================================
// NEWS: short posts from farmerplanner.pl/news.json, shown once at start-up
// and again from the "News" button on the start screen.
// =============================================================
// A classic <script> loaded after renderer.js (see index.html). A post is a
// list of blocks the app draws in its own style — no HTML or CSS comes from
// the file: text goes through the CHANGELOG Markdown (escaped), links and
// buttons open only https:// in the browser, images come only from
// farmerplanner.pl/news/ through a local cache, colours and sizes only from
// closed lists. Polls send one vote per install to news/vote.php.
//
// Publishing a post: see CLAUDE.md (website repo, public/news.json).

const NEWS_URL = 'https://farmerplanner.pl/news.json';
const NEWS_BASE = 'https://farmerplanner.pl/news/';
const NEWS_VOTE_URL = NEWS_BASE + 'vote.php';
const NEWS_FORMAT = 1;
const NEWS_TIMEOUT_MS = 4000;
const NEWS_IMAGE_MAX = 2 * 1024 * 1024;
const NEWS_ACCENTS = ['green', 'orange', 'blue', 'red', 'gold'];
const NEWS_TONES = ['info', 'warning', 'new'];
const NEWS_CACHE_DIR = path.join(appDataDir, 'cache', 'news');

// The network, in one place so the tests can stand in for it. The tests
// never reach farmerplanner.pl (FP_TEST_TMP is set only by npm test).
const newsNet = {
    request(url, { method = 'GET', body = null, max = NEWS_IMAGE_MAX } = {}) {
        return new Promise((resolve, reject) => {
            if (process.env.FP_TEST_TMP) { reject(new Error('No network in tests')); return; }
            let u;
            try { u = new URL(url); } catch (e) { reject(e); return; }
            if (u.protocol !== 'https:' || u.hostname !== 'farmerplanner.pl') { reject(new Error('Host not allowed')); return; }
            const req = require('https').request(u, {
                method,
                headers: { 'User-Agent': 'Farmer-Planner/' + APP_VERSION, 'Cache-Control': 'no-cache', ...(body ? { 'Content-Type': 'application/json' } : {}) },
                timeout: NEWS_TIMEOUT_MS
            }, res => {
                if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
                const chunks = [];
                let size = 0;
                res.on('data', c => { size += c.length; if (size > max) { req.destroy(new Error('Too large')); return; } chunks.push(c); });
                res.on('end', () => resolve(Buffer.concat(chunks)));
                res.on('error', reject);
            });
            req.on('timeout', () => req.destroy(new Error('Timeout')));
            req.on('error', reject);
            if (body) req.write(JSON.stringify(body));
            req.end();
        });
    },
    async json(url, opts) {
        return JSON.parse((await this.request(url, opts)).toString('utf8'));
    }
};

// --- Pure helpers (tested) ---------------------------------------------------

function newsText(value, lang) {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    const v = value[lang] || value.en;
    return typeof v === 'string' ? v : '';
}

function newsIsDate(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// Posts this version can show today, newest first, each with its title in
// the app's language (English when the post has none in it).
function newsValidPosts(data, { version = APP_VERSION, today = new Date().toISOString().slice(0, 10), lang = currentLang } = {}) {
    if (!data || data.format !== NEWS_FORMAT || !Array.isArray(data.posts)) return [];
    return data.posts.filter(p => p && typeof p === 'object'
        && typeof p.id === 'string' && p.id.trim()
        && newsText(p.title, lang).trim()
        && Array.isArray(p.blocks)
        && !(p.minVersion && compareVersions(version, p.minVersion) < 0)
        && !(p.maxVersion && compareVersions(version, p.maxVersion) > 0)
        && !(newsIsDate(p.until) && p.until < today))
        .map(p => ({
            id: p.id.trim(),
            date: newsIsDate(p.date) ? p.date : '',
            title: newsText(p.title, lang).trim(),
            accent: NEWS_ACCENTS.includes(p.accent) ? p.accent : 'green',
            size: p.size === 'large' ? 'large' : 'normal',
            pinned: p.pinned === true,
            blocks: p.blocks
        }))
        .sort((a, b) => b.date.localeCompare(a.date));
}

// Posts not seen yet: a pinned one stays until "Don't show again".
function newsUnseen(posts, seen = [], hidden = []) {
    return posts.filter(p => p.pinned ? !hidden.includes(p.id) : !seen.includes(p.id));
}

function newsSafeLink(url) {
    return typeof url === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : null;
}

// An image's address: a path under farmerplanner.pl/news/ (jpg, png, webp),
// nothing from anywhere else.
function newsImageUrl(src) {
    if (typeof src !== 'string') return null;
    const rel = src.startsWith(NEWS_BASE) ? src.slice(NEWS_BASE.length) : src;
    if (!/^[A-Za-z0-9][A-Za-z0-9_\-/.]*\.(jpe?g|png|webp)$/i.test(rel) || rel.includes('..') || rel.includes('//')) return null;
    return NEWS_BASE + rel;
}

// Markdown as in CHANGELOG.md, plus links that open in the browser
// (https only; anything else stays plain text).
function newsMarkdown(src) {
    const links = [];
    const marked = String(src || '').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
        if (!newsSafeLink(url)) return text;
        links.push({ text, url });
        return `\u0001${links.length - 1}\u0001`;
    });
    return changelogHtml(marked.split(/\r?\n/)).replace(/\u0001(\d+)\u0001/g, (m, i) => links[i]
        ? `<a href="#" class="news-link" data-news-url="${escapeHtml(links[i].url)}">${escapeHtml(links[i].text)}</a>`
        : '');
}

// Where a poll stands for this install: what it voted, and whether it's closed.
function newsPollState(block, votes = {}, today = new Date().toISOString().slice(0, 10)) {
    const voted = Array.isArray(votes[block.id]) ? votes[block.id] : null;
    return { voted, closed: newsIsDate(block.until) && block.until < today };
}

// The options a vote may carry: only the poll's own, one unless it's multi.
function newsVotePayload(block, picked) {
    const ids = (block.options || []).map(o => o && o.id).filter(id => typeof id === 'string');
    const chosen = [...new Set((picked || []).filter(id => ids.includes(id)))];
    if (!chosen.length || (!block.multi && chosen.length > 1)) return null;
    return { poll: block.id, options: chosen };
}

function newsPollHtml(block, lang, votes, results, today) {
    const options = (block.options || []).filter(o => o && typeof o.id === 'string' && newsText(o, lang));
    if (typeof block.id !== 'string' || !options.length) return '';
    const st = newsPollState(block, votes, today);
    let html = `<div class="news-poll" data-poll="${escapeHtml(block.id)}">
        <div class="news-poll-q">${escapeHtml(newsText(block.question, lang))}</div>`;
    if (!st.voted && !st.closed) {
        if (block.multi) {
            html += options.map(o => `<label class="news-poll-check"><input type="checkbox" value="${escapeHtml(o.id)}"> ${escapeHtml(newsText(o, lang))}</label>`).join('')
                + `<button type="button" class="news-btn news-btn--primary news-poll-send">${t('newsVote')}</button>`;
        } else {
            html += `<div class="news-poll-options">${options.map(o => `<button type="button" class="news-poll-option" data-option="${escapeHtml(o.id)}">${escapeHtml(newsText(o, lang))}</button>`).join('')}</div>`;
        }
        html += `<div class="news-poll-msg" hidden></div>`;
    } else {
        const counts = (results && results.options) || {};
        const total = results ? Object.values(counts).reduce((s, n) => s + (Number(n) || 0), 0) : 0;
        html += options.map(o => {
            const n = Number(counts[o.id]) || 0;
            const pct = total ? Math.round(n * 100 / total) : 0;
            const mine = st.voted && st.voted.includes(o.id);
            return `<div class="news-poll-result${mine ? ' is-mine' : ''}">
                <span class="news-poll-label">${escapeHtml(newsText(o, lang))}${mine ? ` <span class="news-poll-mine">${t('newsYourVote')}</span>` : ''}</span>
                ${results ? `<span class="news-poll-pct">${pct}%</span><span class="news-poll-bar"><span style="width:${pct}%"></span></span>` : ''}
            </div>`;
        }).join('');
        html += `<div class="news-poll-foot">${results ? t('newsVotes').replace('{n}', total) : (st.voted ? t('newsVoted') : '')}${st.closed ? ' · ' + t('newsPollClosed') : ''}</div>`;
    }
    return html + `</div>`;
}

// One block of a post. An unknown type (from a newer post) draws nothing.
function newsBlockHtml(block, lang, ctx = {}) {
    if (!block || typeof block !== 'object') return '';
    const img = (src, alt, cls) => {
        const url = newsImageUrl(src);
        return url ? `<img class="${cls}" data-news-img="${escapeHtml(url)}" alt="${escapeHtml(newsText(alt, lang))}">` : '';
    };
    switch (block.type) {
        case 'banner': return img(block.image, block.alt, 'news-banner');
        case 'text': {
            const s = newsText(block, lang);
            return s ? `<div class="news-text">${newsMarkdown(s)}</div>` : '';
        }
        case 'image': {
            const i = img(block.image, block.caption || block.alt, 'news-image news-zoom');
            const cap = newsText(block.caption, lang);
            return i ? `<figure class="news-figure">${i}${cap ? `<figcaption>${escapeHtml(cap)}</figcaption>` : ''}</figure>` : '';
        }
        case 'gallery': {
            const items = (Array.isArray(block.images) ? block.images : []).map(g => g && img(g.image, g.caption, 'news-thumb news-zoom')).filter(Boolean);
            return items.length ? `<div class="news-gallery">${items.join('')}</div>` : '';
        }
        case 'callout': {
            const s = newsText(block, lang);
            const tone = NEWS_TONES.includes(block.tone) ? block.tone : 'info';
            const icon = { info: 'fa-circle-info', warning: 'fa-triangle-exclamation', new: 'fa-star' }[tone];
            return s ? `<div class="news-callout news-callout--${tone}"><i class="fa-solid ${icon}" aria-hidden="true"></i><div>${newsMarkdown(s)}</div></div>` : '';
        }
        case 'poll': return newsPollHtml(block, lang, ctx.votes || {}, (ctx.results || {})[block.id], ctx.today);
        case 'button': {
            const url = newsSafeLink(block.url);
            const label = newsText(block.label, lang);
            return url && label ? `<div class="news-button-row"><button type="button" class="news-btn news-btn--${block.style === 'secondary' ? 'secondary' : 'primary'}" data-news-url="${escapeHtml(url)}">${escapeHtml(label)} <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></button></div>` : '';
        }
        case 'divider': return '<hr class="news-divider">';
        default: return '';
    }
}

function newsPostHtml(post, lang, ctx) {
    return post.blocks.map(b => newsBlockHtml(b, lang, ctx)).join('');
}

// --- Data: fetch, cache, what's been seen ------------------------------------

let newsData = null;            // the last news.json that was read (network or cache)
const newsPollResults = {};     // poll id -> { options, total } from vote.php

function newsCacheFile() { return path.join(NEWS_CACHE_DIR, 'news.json'); }

// news.json from the website, or the copy from the last time it worked.
async function loadNews() {
    try {
        const data = await newsNet.json(NEWS_URL, { max: 1024 * 1024 });
        if (!data || data.format !== NEWS_FORMAT) throw new Error('Bad news.json');
        newsData = data;
        try {
            fs.mkdirSync(NEWS_CACHE_DIR, { recursive: true });
            fs.writeFileSync(newsCacheFile(), JSON.stringify(data));
        } catch (e) { /* the cache is only a convenience */ }
        setSetting('newsFetchedAt', new Date().toISOString());
    } catch (e) {
        try { newsData = JSON.parse(fs.readFileSync(newsCacheFile(), 'utf8')); } catch (e2) { /* never fetched */ }
    }
    renderNewsBadge();
    return newsData;
}

// settings.json keeps strings: lists and the votes are stored as JSON.
function newsJson(key, fallback) {
    try {
        const v = JSON.parse(getSetting(key));
        return v && typeof v === typeof fallback && Array.isArray(v) === Array.isArray(fallback) ? v : fallback;
    } catch (e) { return fallback; }
}

function newsList(key) {
    return newsJson(key, []);
}

function newsPosts() {
    return newsValidPosts(newsData);
}

function newsUnseenPosts() {
    return newsUnseen(newsPosts(), newsList('newsSeen'), newsList('newsHidden'));
}

function markNewsSeen(ids) {
    const seen = new Set(newsList('newsSeen'));
    const before = seen.size;
    ids.forEach(id => seen.add(id));
    if (seen.size !== before) setSetting('newsSeen', JSON.stringify([...seen]));
    renderNewsBadge();
}

function isNewsAtStartEnabled() {
    return getSetting('newsAtStart') !== '0';
}

function renderNewsBadge() {
    const badge = document.getElementById('news-badge');
    if (!badge) return;
    const seen = newsList('newsSeen');
    const n = newsPosts().filter(p => !seen.includes(p.id)).length;
    badge.textContent = n;
    badge.hidden = n === 0;
}

function newsInstallId() {
    let id = getSetting('newsInstallId');
    if (typeof id !== 'string' || id.length < 16) {
        id = require('crypto').randomUUID();
        setSetting('newsInstallId', id);
    }
    return id;
}

// --- Images: downloaded once into the cache, shown from there ---------------

function newsImageCachePath(url) {
    return path.join(NEWS_CACHE_DIR, 'img', url.slice(NEWS_BASE.length).replace(/[\\/]/g, '__'));
}

async function newsImageFile(url) {
    const file = newsImageCachePath(url);
    if (fs.existsSync(file)) return file;
    const buf = await newsNet.request(url, { max: NEWS_IMAGE_MAX });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    return file;
}

function newsLoadImages(root) {
    root.querySelectorAll('img[data-news-img]').forEach(async el => {
        try {
            const file = await newsImageFile(el.dataset.newsImg);
            el.src = require('url').pathToFileURL(file).href;
        } catch (e) {
            el.classList.add('is-missing');
        }
    });
}

// --- The window ----------------------------------------------------------------

let newsView = null;   // { posts, index, resolve }

function renderNewsPost() {
    const modal = document.getElementById('news-modal');
    const { posts, index } = newsView;
    const post = posts[index];
    const content = modal.querySelector('.news-content');
    NEWS_ACCENTS.forEach(a => content.classList.toggle('news-accent--' + a, post.accent === a));
    content.classList.toggle('news-content--large', post.size === 'large');
    document.getElementById('news-title').textContent = post.title;
    document.getElementById('news-date').textContent = post.date ? formatNewsDate(post.date) : '';
    const body = document.getElementById('news-body');
    body.innerHTML = newsPostHtml(post, currentLang, { votes: newsJson('newsVotes', {}), results: newsPollResults });
    body.scrollTop = 0;
    newsLoadImages(body);
    newsFetchPollResults(post);
    document.getElementById('news-pager').textContent = posts.length > 1 ? t('newsOf').replace('{i}', index + 1).replace('{n}', posts.length) : '';
    document.getElementById('news-prev').hidden = index === 0;
    document.getElementById('news-next').hidden = index >= posts.length - 1;
    document.getElementById('news-hide').hidden = !post.pinned || newsList('newsHidden').includes(post.id);
    if (!post.pinned) markNewsSeen([post.id]);
}

function formatNewsDate(iso) {
    const d = new Date(iso + 'T12:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString(FIN_LOCALE(), { day: 'numeric', month: 'long', year: 'numeric' });
}

// Results of the polls in a post that this install voted in, or that closed.
function newsFetchPollResults(post) {
    const votes = newsJson('newsVotes', {});
    post.blocks.filter(b => b && b.type === 'poll' && typeof b.id === 'string').forEach(async b => {
        const st = newsPollState(b, votes);
        if (!st.voted && !st.closed) return;
        try {
            const r = await newsNet.json(NEWS_VOTE_URL + '?poll=' + encodeURIComponent(b.id), { max: 64 * 1024 });
            if (!r || typeof r.options !== 'object') return;
            newsPollResults[b.id] = r;
            if (newsView && newsView.posts[newsView.index] === post) rerenderNewsPoll(b);
        } catch (e) { /* offline: the vote is shown without the counts */ }
    });
}

function rerenderNewsPoll(block) {
    const el = [...document.querySelectorAll('#news-body .news-poll')].find(p => p.dataset.poll === block.id);
    if (!el) return;
    el.outerHTML = newsPollHtml(block, currentLang, newsJson('newsVotes', {}), newsPollResults[block.id]);
}

async function sendNewsVote(pollEl, picked) {
    const post = newsView && newsView.posts[newsView.index];
    const block = post && post.blocks.find(b => b && b.type === 'poll' && b.id === pollEl.dataset.poll);
    const payload = block && newsVotePayload(block, picked);
    if (!payload) return;
    const msg = pollEl.querySelector('.news-poll-msg');
    pollEl.querySelectorAll('button, input').forEach(b => { b.disabled = true; });
    try {
        const r = await newsNet.json(NEWS_VOTE_URL, { method: 'POST', body: { ...payload, install: newsInstallId() }, max: 64 * 1024 });
        if (r && typeof r.options === 'object') newsPollResults[block.id] = r;
        // vote.php answers with the vote it keeps (an earlier one if this install already voted).
        const mine = r && Array.isArray(r.voted) && r.voted.length ? r.voted : payload.options;
        const votes = { ...newsJson('newsVotes', {}), [block.id]: mine };
        setSetting('newsVotes', JSON.stringify(votes));
        rerenderNewsPoll(block);
    } catch (e) {
        pollEl.querySelectorAll('button, input').forEach(b => { b.disabled = false; });
        if (msg) { msg.textContent = t('newsVoteFailed'); msg.hidden = false; }
    }
}

function openNewsLightbox(src, alt) {
    const box = document.getElementById('news-lightbox');
    const img = box.querySelector('img');
    img.src = src;
    img.alt = alt || '';
    box.hidden = false;
}

function closeNewsLightbox() {
    document.getElementById('news-lightbox').hidden = true;
}

// Shows posts one at a time; resolves when the window closes.
function showNewsWindow(posts) {
    const modal = document.getElementById('news-modal');
    if (!modal || !posts.length) return Promise.resolve(false);
    return new Promise(resolve => {
        newsView = { posts, index: 0, resolve };
        closeNewsLightbox();
        renderNewsPost();
        openModal(modal);
        document.getElementById('news-close').focus();
    });
}

function closeNewsWindow() {
    if (!newsView) return;
    const { resolve } = newsView;
    newsView = null;
    closeModal(document.getElementById('news-modal'));
    renderNewsBadge();
    resolve(true);
}

// At start-up, after "What's new": the posts not seen yet, unless turned off.
async function showNewsAtStart(loading) {
    if (!isNewsAtStartEnabled()) return;
    await loading;
    const posts = newsUnseenPosts();
    if (posts.length) await showNewsWindow(posts);
}

(function wireNews() {
    const modal = document.getElementById('news-modal');
    if (!modal) return;
    const step = d => { if (!newsView) return; newsView.index = Math.max(0, Math.min(newsView.posts.length - 1, newsView.index + d)); renderNewsPost(); };
    document.getElementById('news-next').addEventListener('click', () => step(1));
    document.getElementById('news-prev').addEventListener('click', () => step(-1));
    document.getElementById('news-close').addEventListener('click', closeNewsWindow);
    document.getElementById('news-hide').addEventListener('click', () => {
        const post = newsView && newsView.posts[newsView.index];
        if (!post) return;
        setSetting('newsHidden', JSON.stringify([...new Set([...newsList('newsHidden'), post.id])]));
        markNewsSeen([post.id]);
        if (newsView.index < newsView.posts.length - 1) step(1);
        else closeNewsWindow();
    });
    modal.addEventListener('mousedown', e => { if (e.target === modal) closeNewsWindow(); });
    document.addEventListener('keydown', e => {
        if (!newsView || e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        if (!document.getElementById('news-lightbox').hidden) closeNewsLightbox();
        else closeNewsWindow();
    }, true);
    document.getElementById('news-lightbox').addEventListener('click', closeNewsLightbox);
    document.getElementById('news-body').addEventListener('click', e => {
        const link = e.target.closest('[data-news-url]');
        if (link) {
            e.preventDefault();
            const url = newsSafeLink(link.dataset.newsUrl);
            if (url) require('electron').shell.openExternal(url);
            return;
        }
        const zoom = e.target.closest('img.news-zoom');
        if (zoom && zoom.src) { openNewsLightbox(zoom.src, zoom.alt); return; }
        const opt = e.target.closest('.news-poll-option');
        if (opt) { sendNewsVote(opt.closest('.news-poll'), [opt.dataset.option]); return; }
        const send = e.target.closest('.news-poll-send');
        if (send) {
            const poll = send.closest('.news-poll');
            sendNewsVote(poll, [...poll.querySelectorAll('input[type="checkbox"]:checked')].map(i => i.value));
        }
    });

    const btn = document.getElementById('news-btn');
    if (btn) btn.addEventListener('click', async () => {
        if (!newsData) await loadNews();
        const posts = newsPosts();
        if (!posts.length) { await showNotice(t('newsTitle'), t('newsEmpty')); return; }
        // Unseen first, then the rest, each newest first.
        const unseen = newsUnseen(posts, newsList('newsSeen'), []);
        await showNewsWindow([...unseen, ...posts.filter(p => !unseen.includes(p))]);
    });

    const toggle = document.getElementById('news-start-toggle');
    if (toggle) toggle.addEventListener('change', () => setSetting('newsAtStart', toggle.checked ? '1' : '0'));
})();
