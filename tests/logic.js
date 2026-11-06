// Runs every tests/logic/*.test.js inside the app's page, prints the result.
const fs = require('fs');
const path = require('path');

module.exports = async function ({ win, js, consoleErrors }) {
    win.webContents.setBackgroundThrottling(false);
    win.hide();
    const dir = path.join(__dirname, 'logic');
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort()) {
        const source = fs.readFileSync(path.join(dir, file), 'utf-8');
        await js(`(() => {
            const assert = require('assert');
            const { test, wait, waitFor, dialogOpen, answerDialog, freshFarm, field, setInput, copy } = FT;
            ${source}
        })(); 1`);
    }
    const results = await js('FT.runAll()');
    const failed = results.filter(r => !r.ok);
    results.forEach(r => console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}`));
    failed.forEach(r => console.log(`\n--- ${r.name}\n${r.error}`));
    // A browser notice about layout timing, not an error in the app.
    const errors = [...new Set(consoleErrors)].filter(e => !/ResizeObserver loop/.test(e));
    if (errors.length) {
        console.log('\nErrors in the app console:');
        errors.forEach(e => console.log('  ' + e));
    }
    console.log(`\n${results.length - failed.length} of ${results.length} passed`);
    return failed.length || errors.length ? 1 : 0;
};
