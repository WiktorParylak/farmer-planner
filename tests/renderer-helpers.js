// Loaded into the app's page, next to its own scripts (same global scope).
window.FT = (() => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const tests = [];

    function waitFor(check, what, ms = 4000) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            (function poll() {
                const value = check();
                if (value) return resolve(value);
                if (Date.now() - start > ms) return reject(new Error('Timed out waiting for ' + what));
                setTimeout(poll, 20);
            })();
        });
    }

    const dialogOpen = () => document.getElementById('app-dialog').style.display === 'flex';

    // Waits for the app's dialog, presses a button, returns the text it showed.
    async function answerDialog(button = 'confirm') {
        await waitFor(dialogOpen, 'a dialog');
        const text = document.getElementById('app-dialog-title').textContent + ' / ' + document.getElementById('app-dialog-body').textContent;
        document.getElementById('app-dialog-' + button).click();
        await wait(60);
        return text;
    }

    // The test farm from scratch, open on the plan, nothing to undo.
    async function freshFarm() {
        document.querySelectorAll('.modal').forEach(m => { m.style.display = 'none'; });
        if (isEditMode) setEditModeUi(false);
        removeDevFarm();
        createDevFarm();
        openPlanner(DEV_FARM_ID);
        // Past the save a farm makes 900 ms after opening (maybeFillFromRotation).
        await wait(1100);
        clearFarmUndo();
        hideUndoToast();
        return getCurrentFarm();
    }

    function field(extra) {
        return {
            number: '1', area: '5.00', crop: 'Wheat', sowingMonth: 'OCTOBER', state: 'To Plant', tillage: null,
            rolling: false, catchCrop: '', catchSowingMonth: '', limeAppliedSeason: null, limePh: null,
            cuts: [], manure: false, fertilizer: false, ...extra
        };
    }

    // Types into a control the way a person does: the value, then its change event.
    async function setInput(selector, value) {
        const el = document.querySelector(selector);
        if (!el) throw new Error('Nothing on screen for ' + selector);
        if (el.type === 'checkbox') el.checked = value;
        else el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        await wait(40);
    }

    // A few unzipped mods in the test game folder, for the mod manager's picture.
    function fakeMods() {
        const dir = path.join(tlGameDir(), 'mods');
        [['FS25_FrontLoader', 'Front loader', '1.2.0.0'], ['FS25_Seeder (1)', 'Seeder', '1.0.0.0'], ['FS25_BigTrailer', 'Big trailer', '2.0.1.0']].forEach(([name, title, version]) => {
            fs.mkdirSync(path.join(dir, name), { recursive: true });
            fs.writeFileSync(path.join(dir, name, 'modDesc.xml'), `<modDesc descVersion="97"><author>Green Valley</author><version>${version}</version><title><en>${title}</en></title></modDesc>`);
        });
    }

    // A savegame in the test game folder that uses one of fakeMods' mods.
    function fakeSave() {
        const dir = path.join(tlGameDir(), 'savegame1');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'careerSavegame.xml'), '<careerSavegame><settings><savegameName>Green Valley</savegameName></settings><mod modName="FS25_FrontLoader" title="Front loader" version="1.2.0.0"/><mod modName="FS25_Sprayer" title="Sprayer" version="1.0.0.0"/></careerSavegame>');
    }

    // Two posts in place of farmerplanner.pl: one with every kind of block,
    // one with a poll. The network answers from here (images: a screenshot
    // from docs/, votes: counted in memory).
    const NEWS_SAMPLE = {
        format: 1,
        posts: [
            {
                id: 'test-welcome', date: '2026-11-20', accent: 'orange', size: 'large',
                title: { en: 'Winter on the farm', pl: 'Zima na farmie', de: 'Winter auf dem Hof' },
                blocks: [
                    { type: 'banner', image: 'img/test-banner.png', alt: { en: 'The plan' } },
                    { type: 'text', en: 'A short post with **bold** text and a [link](https://farmerplanner.pl).\n\n- one\n- two', pl: 'Krótki wpis z **pogrubieniem** i [linkiem](https://farmerplanner.pl).\n\n- jeden\n- dwa', de: 'Ein kurzer Beitrag mit **fett** und einem [Link](https://farmerplanner.pl).\n\n- eins\n- zwei' },
                    { type: 'callout', tone: 'new', en: 'Something new is coming.', pl: 'Nadchodzi coś nowego.', de: 'Etwas Neues kommt.' },
                    { type: 'gallery', images: [{ image: 'img/test-banner.png' }, { image: 'img/test-banner.png' }, { image: 'img/test-banner.png' }] },
                    { type: 'divider' },
                    { type: 'button', url: 'https://farmerplanner.pl', label: { en: 'Open the website', pl: 'Otwórz stronę', de: 'Webseite öffnen' } }
                ]
            },
            {
                id: 'test-poll', date: '2026-11-10', accent: 'blue',
                title: { en: 'What next?', pl: 'Co dalej?', de: 'Was als Nächstes?' },
                blocks: [
                    { type: 'text', en: 'Pick one.', pl: 'Wybierz jedno.', de: 'Wähle eins.' },
                    { type: 'poll', id: 'test-next', question: { en: 'Which feature?', pl: 'Która funkcja?', de: 'Welche Funktion?' },
                      options: [{ id: 'a', en: 'Dedicated servers', pl: 'Serwery dedykowane', de: 'Dedizierte Server' }, { id: 'b', en: 'Mobile', pl: 'Telefon', de: 'Handy' }] }
                ]
            }
        ]
    };
    const newsVotesSent = [];
    function fakeNews() {
        const counts = { a: 12, b: 5 };
        newsNet.request = async (url, opts = {}) => {
            if (url === NEWS_URL) return Buffer.from(JSON.stringify(NEWS_SAMPLE));
            if (url.startsWith(NEWS_VOTE_URL)) {
                if (opts.method === 'POST') { newsVotesSent.push(opts.body); opts.body.options.forEach(o => { counts[o] = (counts[o] || 0) + 1; }); }
                return Buffer.from(JSON.stringify({ options: counts, closed: false }));
            }
            if (url.startsWith(NEWS_BASE)) return fs.readFileSync(path.join(process.cwd(), 'docs', 'screenshot-plan.png'));
            throw new Error('Not in the test: ' + url);
        };
        newsData = NEWS_SAMPLE;
        return NEWS_SAMPLE;
    }

    function copy(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function test(name, fn) {
        tests.push({ name, fn });
    }

    async function runAll() {
        const results = [];
        for (const { name, fn } of tests) {
            try {
                await fn();
                results.push({ name, ok: true });
            } catch (e) {
                results.push({ name, ok: false, error: e.message || String(e) });
            }
        }
        return results;
    }

    // Screen review: one screen, then back to the plan with nothing left open.
    async function freshView(open) {
        if (open) (0, eval)(open);
    }

    async function backToPlan() {
        if (!document.getElementById('modmanager-view').hidden) mmClose();
        document.querySelectorAll('.modal').forEach(m => { m.style.display = 'none'; });
        if (isEditMode) {
            document.getElementById('cancel-edit-btn').click();
            await wait(150);
        }
        // Messages that would cover the header in the next picture.
        hideUndoToast();
        autoSyncToast.classList.remove('is-visible');
        autoSyncToast.hidden = true;
        if (plannerView.style.display === 'none') openPlanner(DEV_FARM_ID);
        document.querySelector('.sidebar-item[data-view="plan"]').click();
        await wait(150);
        const table = document.querySelector('#fields-view-switch [data-view="table"]');
        if (table.getAttribute('aria-pressed') !== 'true') table.click();
        const list = document.querySelector('.planner-crops');
        if (list.classList.contains('is-crops-open')) document.getElementById('crops-toggle').click();
        await wait(100);
    }

    return { fakeNews, newsVotesSent, fakeMods, fakeSave, freshView, backToPlan, test, runAll, wait, waitFor, dialogOpen, answerDialog, freshFarm, field, setInput, copy };
})();
