// `npm start`. On the main computer the work in progress lives in a git
// worktree under .claude/worktrees/ (checked out on the newest dev/vX.Y.Z
// branch) while the main checkout sits on `main`. Started from the main
// checkout, this runs the worktree with the newest version branch instead;
// without a worktree (e.g. the second computer) it's just `electron .`.

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const root = path.join(__dirname, '..');

function branchOf(dir) {
    try {
        return execFileSync('git', ['-C', dir, 'branch', '--show-current'], { encoding: 'utf-8' }).trim();
    } catch (e) {
        return '';
    }
}

// "dev/v0.9.10" -> [0, 9, 10]; anything else -> null
function versionOf(branch) {
    const m = branch.match(/^dev\/v(\d+)\.(\d+)\.(\d+)$/);
    return m ? m.slice(1).map(Number) : null;
}

function newer(a, b) {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
    return false;
}

function pickTarget() {
    const insideWorktree = path.resolve(root).split(path.sep).includes('worktrees');
    const worktrees = path.join(root, '.claude', 'worktrees');
    if (insideWorktree || !fs.existsSync(worktrees)) return root;
    let best = null;
    for (const name of fs.readdirSync(worktrees)) {
        const dir = path.join(worktrees, name);
        if (!fs.existsSync(path.join(dir, 'package.json'))) continue;
        const branch = branchOf(dir);
        const version = versionOf(branch);
        if (version && (!best || newer(version, best.version))) best = { dir, branch, version };
    }
    if (!best) return root;
    console.log(`[start] ${best.branch} from ${path.relative(root, best.dir)}`);
    return best.dir;
}

const target = pickTarget();
// The target's own Electron when it has node_modules, else this checkout's.
let electronBin;
try {
    electronBin = require(require.resolve('electron', { paths: [target] }));
} catch (e) {
    electronBin = require('electron');
}
const child = spawn(electronBin, [target], { stdio: 'inherit' });
child.on('close', code => process.exit(code || 0));
