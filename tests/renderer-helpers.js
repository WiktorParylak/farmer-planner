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

    return { freshView, backToPlan, test, runAll, wait, waitFor, dialogOpen, answerDialog, freshFarm, field, setInput, copy };
})();
