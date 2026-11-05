// Runs inside Electron, started by tests/run.js. The paths have to move before
// the app's main process loads, because it reads them as it starts.

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const tmp = process.env.FP_TEST_TMP;
if (!tmp) {
    console.error('Start this with: npm test');
    process.exit(3);
}
const repo = path.join(__dirname, '..');
const dataDir = path.join(tmp, 'docs', 'Farmer Planner');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(tmp, 'appdata'));
fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({
    farmer_planner_language: 'en', farmer_planner_discord_rpc: '0', farmer_planner_tutorial_done: '1',
    farmer_planner_splash: '0', farmer_planner_update_check: '0', farmer_planner_last_version: '99.0.0'
}));
app.setPath('documents', path.join(tmp, 'docs'));
app.setPath('userData', path.join(tmp, 'userdata'));
app.setPath('appData', path.join(tmp, 'appdata'));
app.getAppPath = () => repo;
require(path.join(repo, 'src', 'main', 'main.js'));

const wait = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
    let win;
    while (!(win = BrowserWindow.getAllWindows().find(w => /index\.html/.test(w.webContents.getURL())))) await wait(100);
    const js = s => win.webContents.executeJavaScript(s);
    const consoleErrors = [];
    win.webContents.on('console-message', e => { if (e.level === 'error') consoleErrors.push(e.message); });
    while (!(await js(`document.readyState === 'complete' && typeof createDevFarm === 'function'`))) await wait(100);
    await wait(1000);
    // The last line of defence for real farms: stop unless the app really
    // keeps its data in the temp folder.
    const appData = await js('appDataDir');
    if (!appData.toLowerCase().includes(path.basename(tmp).toLowerCase())) {
        console.error('Not isolated, stopping. Data folder: ' + appData);
        app.exit(3);
        return;
    }
    await js(fs.readFileSync(path.join(__dirname, 'renderer-helpers.js'), 'utf-8') + '\n1');
    const run = require(process.env.FP_TEST_MODE === 'screens' ? './screens.js' : './logic.js');
    let code = 3;
    try {
        code = await run({ win, js, wait, consoleErrors, repo });
    } catch (e) {
        console.error(e.stack || e);
    }
    app.exit(code);
});
