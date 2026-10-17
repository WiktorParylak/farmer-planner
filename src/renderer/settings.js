// =============================================================
// App settings file
// =============================================================
// Language, Discord, update check, tutorial progress and table sorting live in
// <data folder>\settings.json (Documents\Farmer Planner), next to the farms —
// so they're in the user's own backups and move with the farms to another
// computer. Values are strings, the same as they were in localStorage.
// Settings kept in the farm itself (auto-sync, currency…) are not here.

const fs = require('fs');
const path = require('path');

// localStorage keys moved into the file on first start (then removed there).
const LEGACY_KEY = /^farmer_planner_(?!supply_rates$)|^(fieldsSort|cropsSort)$/;

function createSettings(dataDir, storage) {
    const file = path.join(dataDir, 'settings.json');
    let values = {};

    const write = () => {
        try { fs.writeFileSync(file, JSON.stringify(values, null, 2), 'utf-8'); }
        catch (err) { console.error('Could not write settings.json', err); }
    };

    if (fs.existsSync(file)) {
        try {
            const read = JSON.parse(fs.readFileSync(file, 'utf-8'));
            if (read && typeof read === 'object' && !Array.isArray(read)) values = read;
        } catch (err) {
            console.error('settings.json is unreadable, starting from defaults', err);
        }
    } else if (storage) {
        // One-time migration from localStorage.
        try {
            const keys = [];
            for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                if (LEGACY_KEY.test(key)) keys.push(key);
            }
            keys.forEach(key => { values[key] = storage.getItem(key); });
            write();
            if (fs.existsSync(file)) keys.forEach(key => storage.removeItem(key));
        } catch (err) {
            console.error('Could not move the settings out of localStorage', err);
        }
    }

    return {
        // null when not set, like localStorage.getItem
        get(key) {
            return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
        },
        set(key, value) {
            const str = String(value);
            if (values[key] === str) return;
            values[key] = str;
            write();
        },
        all() {
            return Object.assign({}, values);
        }
    };
}

module.exports = { createSettings };
