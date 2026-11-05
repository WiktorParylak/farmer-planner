// `npm test` / `npm run test:screens`. Starts the real app in Electron with its
// documents and app data folders moved to a new temp folder, so real farms and
// settings are never touched, and removes that folder afterwards. Also stops a
// run that hangs: without this parent nothing would end it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const mode = process.argv[2] === 'screens' ? 'screens' : 'logic';
const LIMIT_MS = mode === 'screens' ? 20 * 60000 : 5 * 60000;
const electron = require('electron');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-test-'));

const env = { ...process.env, FP_TEST_TMP: tmp, FP_TEST_MODE: mode };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [path.join(__dirname, 'electron-main.js')], { env, stdio: ['ignore', 'inherit', 'pipe'] });
let stderr = '';
child.stderr.on('data', d => { stderr += d; });

const timer = setTimeout(() => {
    console.error(`\nStopped: the run took over ${LIMIT_MS / 60000} minutes.`);
    child.kill();
}, LIMIT_MS);

child.on('exit', code => {
    clearTimeout(timer);
    // Exit code 0 or 1 is a finished run. Anything else: the output says why.
    if (code !== 0 && code !== 1) console.error(stderr);
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
    catch (e) { console.error('Could not remove ' + tmp); }
    process.exit(code === null ? 2 : code);
});
