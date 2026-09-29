// Animal mods that change how much the herds eat, read from the savegame and
// the mods themselves so the feed planner matches what the game really does.
//
// Base game: animals.xml food/straw values are per month ("one 24-hour day
// per month" — environment.timeAdjustment spreads them over however many
// days a month has), so monthly consumption doesn't depend on days/month.
//
// FS25_AnimalFoodCalculator (AFC), settings in <savegame>/afcConsumptionScaling.xml:
//   scale = enabled ? (autoScaleByDays ? daysPerPeriod : 1) * customMultiplier : 1
//   (AFCConsumptionScaling:getScaleFactor; modes vanilla/auto/manual/hybrid),
//   applied to food, water and straw. Its referenceSource picks whose
//   animals.xml curves the barns follow: custom = AFC's own xmls/animals.xml,
//   animalpackage = FS25_AnimalPackage_vanillaEdition's, basegame = the
//   game's, map / effective = whatever the game loaded.
//
// FS25_EnhancedAnimalSystem (EAS): a cluster that has given birth eats
//   food x <lactation><key month=monthsSinceLastBirth+1 food=…> from the mod's
//   xmls/<species>.xml (EAS_AnimalCluster.getLactationFoodFactor).
const fs = require('fs');
const path = require('path');
const { openMod, findModsDir } = require('./savegame-soil');

const AFC_MOD = 'FS25_AnimalFoodCalculator';
const EAS_MOD = 'FS25_EnhancedAnimalSystem';
const ANIMAL_PACKAGE_MOD = 'FS25_AnimalPackage_vanillaEdition';
const ANIMAL_PACKAGE_XMLS = ['xmls/animals/cow.xml', 'xmls/animals/pig.xml', 'xmls/animals/sheep.xml', 'xmls/animals/horse.xml', 'xmls/animals/chicken.xml'];

function attr(tag, name) {
    const m = tag.match(new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"'));
    return m ? m[1] : null;
}

function readText(mod, rel) {
    const b = mod.read(rel);
    return b ? b.toString('utf-8') : null;
}

// EAS lactation tables per animal type ("COW"), from the mod's xmls/*.xml.
function readEasLactation(mod) {
    const byType = {};
    mod.list('xmls/').filter(n => n.endsWith('.xml')).forEach(rel => {
        const xml = readText(mod, rel);
        if (!xml) return;
        for (const am of xml.matchAll(/<animal\b([^>]*)>([\s\S]*?)<\/animal>/g)) {
            const type = (attr(am[1], 'type') || '').toUpperCase();
            const lact = (am[2].match(/<lactation>([\s\S]*?)<\/lactation>/) || [])[1];
            if (!type || !lact) continue;
            const table = {};
            for (const k of lact.matchAll(/<key\b[^>]*>/g)) {
                const month = parseInt(attr(k[0], 'month'), 10);
                const food = parseFloat(attr(k[0], 'food'));
                if (!isNaN(month) && !isNaN(food)) table[month] = food;
            }
            if (Object.keys(table).length) byType[type] = table;
        }
    });
    return byType;
}

// -> { daysPerPeriod, afc: null | {...}, eas: null | {...} }
function readAnimalMods(careerSavegamePath) {
    const out = { daysPerPeriod: 1, afc: null, eas: null };
    if (!careerSavegamePath || !fs.existsSync(careerSavegamePath)) return out;
    const saveDir = path.dirname(careerSavegamePath);
    let career = '';
    try { career = fs.readFileSync(careerSavegamePath, 'utf-8'); } catch { return out; }
    const days = parseInt((career.match(/<plannedDaysPerPeriod>(\d+)</) || [])[1], 10);
    if (days > 0) out.daysPerPeriod = days;
    const active = new Set([...career.matchAll(/<mod\b[^>]*\bmodName="([^"]+)"/g)].map(m => m[1]));
    const modsDir = findModsDir(path.dirname(saveDir));

    if (active.has(AFC_MOD)) {
        const afc = { enabled: false, autoScaleByDays: false, customMultiplier: 1, mode: 'vanilla', referenceSource: 'effective', referenceXml: [] };
        try {
            const s = fs.readFileSync(path.join(saveDir, 'afcConsumptionScaling.xml'), 'utf-8');
            const tag = (s.match(/<settings\b[^>]*>/) || [''])[0];
            afc.enabled = attr(tag, 'enabled') === 'true';
            afc.autoScaleByDays = attr(tag, 'autoScaleByDays') === 'true';
            const mult = parseFloat(attr(tag, 'customMultiplier'));
            afc.customMultiplier = isNaN(mult) ? 1 : Math.min(100, Math.max(0, mult));
            afc.mode = (attr(tag, 'mode') || 'vanilla').toLowerCase();
            afc.referenceSource = (attr(tag, 'referenceSource') || 'effective').toLowerCase();
        } catch { /* no settings file yet — AFC defaults (off) */ }
        afc.scale = afc.enabled ? (afc.autoScaleByDays ? out.daysPerPeriod : 1) * afc.customMultiplier : 1;

        // Curves the barns follow under AFC's reference source.
        const refSrc = afc.referenceSource;
        let refMod = null;
        try {
            if (refSrc === 'custom') {
                refMod = openMod(modsDir, AFC_MOD);
                const xml = refMod && readText(refMod, 'xmls/animals.xml');
                if (xml) afc.referenceXml.push(xml);
            } else if (refSrc === 'animalpackage') {
                refMod = openMod(modsDir, ANIMAL_PACKAGE_MOD);
                if (refMod) ANIMAL_PACKAGE_XMLS.forEach(rel => { const xml = readText(refMod, rel); if (xml) afc.referenceXml.push(xml); });
            }
        } catch (e) { console.warn('AFC reference curves unreadable', e); }
        finally { if (refMod) refMod.close(); }
        out.afc = afc;
    }

    if (active.has(EAS_MOD)) {
        let mod = null;
        try {
            mod = openMod(modsDir, EAS_MOD);
            if (mod) out.eas = { lactation: readEasLactation(mod) };
        } catch (e) { console.warn('EAS lactation data unreadable', e); }
        finally { if (mod) mod.close(); }
    }
    return out;
}

// EAS food factor for one cluster (1 when EAS isn't in play or it hasn't calved).
function easFoodFactor(eas, animalType, cluster) {
    if (!eas || !cluster || !cluster.hadABirth) return 1;
    const table = eas.lactation[String(animalType || '').toUpperCase()];
    if (!table) return 1;
    const f = table[(parseInt(cluster.monthsSinceLastBirth, 10) || 0) + 1];
    return typeof f === 'number' ? f : 1;
}

module.exports = { readAnimalMods, easFoodFactor };
