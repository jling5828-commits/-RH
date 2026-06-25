import { fetchAiAppInputs } from "./appDemo.js";
import { RH_DEFAULT_BASE_URL } from "./constants.js";
import { DEFAULT_RH_APP_BUNDLE } from "./defaultRhAppBundle.js";

export const RH_SAVED_APPS_KEY = "rh_saved_apps";
export const RH_APP_BUNDLE_SCHEMA = "xiaoliangrh.appBundle";
export const RH_DEFAULT_APP_BUNDLE_NAME = "小梁RH应用预设包";
export const RH_SAVED_APPS_BUILTIN_MERGED_KEY = "rh_saved_apps_builtin_merged_v1";
export const RH_SAVED_APPS_BUILTIN_MERGED_V2_KEY = "rh_saved_apps_builtin_merged_v2";
export const RH_SAVED_APPS_BUILTIN_MERGED_V4_KEY = "rh_saved_apps_builtin_merged_v4";
export const RH_DEFAULT_PRESET_BUNDLE_APPLIED_KEY = "rh_default_preset_bundle_applied";
export const RH_DEFAULT_APP_BUNDLE_APPLIED_KEY = "rh_default_app_bundle_applied_v3";

const APP_NAME_FALLBACK = "未命名应用";
const APP_BUNDLE_VERSION = 1;
const LOCALE_SORT = "zh-CN";
const BUILTIN_MERGE_FLAGS = Object.freeze([
    RH_SAVED_APPS_BUILTIN_MERGED_KEY,
    RH_SAVED_APPS_BUILTIN_MERGED_V2_KEY,
    RH_SAVED_APPS_BUILTIN_MERGED_V4_KEY,
]);

const RH_LEGACY_BUILTIN_WEBAPP_IDS = new Set([
    "2024785405106724865",
    "2042574131031445506",
    "2027211316242423809",
    "2025885738599981057",
    "2037068238084902913",
    "2038219588789346306",
    "1950866462321876993",
    "1991550248581603329",
    "2046794946094571522",
    "2046794551444119554",
    "2030207491971227650",
    "2018953219711438850",
    "2017658177231265794",
    "2035266859745939458",
]);

function textValue(value) {
    return typeof value === "string" ? value.trim() : "";
}

function appIdOf(app) {
    return textValue(app?.webappId ?? app?.appId);
}

function appNameOf(app) {
    return textValue(app?.name) || APP_NAME_FALLBACK;
}

function appTimestamp(app, fallback) {
    return Number(app?.addedAt || app?.createdAt || app?.updatedAt) || fallback;
}

function appSourceList(bundle) {
    if (Array.isArray(bundle?.apps)) return bundle.apps;
    if (Array.isArray(bundle)) return bundle;
    return [];
}

function isSavedAppLike(app) {
    return Boolean(app && typeof app === "object" && appIdOf(app));
}

function onlySavedApps(apps) {
    return Array.isArray(apps) ? apps.filter(isSavedAppLike) : [];
}

function normalizeRhAppBundleApps(bundle) {
    const now = Date.now();
    const ids = new Set();
    const normalized = [];

    appSourceList(bundle).forEach((app, index) => {
        if (!app || typeof app !== "object") return;
        const webappId = appIdOf(app);
        if (!webappId || ids.has(webappId)) return;
        ids.add(webappId);
        normalized.push({
            webappId,
            name: appNameOf(app),
            addedAt: appTimestamp(app, now - index),
            coverUrl: app.coverUrl,
            iconUrl: app.iconUrl,
            inputs: Array.isArray(app.inputs) ? app.inputs : undefined,
        });
    });

    return normalized;
}

export const RH_BUILTIN_APPS = Object.freeze(
    normalizeRhAppBundleApps(DEFAULT_RH_APP_BUNDLE)
);

function storageRead() {
    try {
        if (typeof localStorage === "undefined") return [];
        const raw = localStorage.getItem(RH_SAVED_APPS_KEY);
        return raw == null ? [] : onlySavedApps(JSON.parse(raw));
    } catch {
        return [];
    }
}

function storageWrite(apps) {
    try {
        localStorage.setItem(RH_SAVED_APPS_KEY, JSON.stringify(Array.isArray(apps) ? apps : []));
    } catch {
        /* ignore */
    }
}

function withBuiltinDetails(app, fallbackAddedAt) {
    return {
        webappId: app.webappId,
        name: app.name,
        addedAt: fallbackAddedAt,
        coverUrl: app.coverUrl,
        iconUrl: app.iconUrl,
        inputs: app.inputs,
    };
}

function mergeImportedApp(imported, existing) {
    return {
        ...existing,
        ...imported,
        addedAt: imported.addedAt || existing?.addedAt || Date.now(),
        coverUrl: imported.coverUrl || existing?.coverUrl,
        iconUrl: imported.iconUrl || existing?.iconUrl,
        inputs: Array.isArray(imported.inputs) ? imported.inputs : existing?.inputs,
    };
}

function builtinOrderMap() {
    return new Map(RH_BUILTIN_APPS.map((app, index) => [String(app.webappId), index]));
}

function nameSort(a, b) {
    return String(a?.name || "").localeCompare(String(b?.name || ""), LOCALE_SORT);
}

export function parseRhAppBundle(raw) {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const apps = normalizeRhAppBundleApps(parsed);
    if (!apps.length) throw new Error("没有找到可导入的 AI 应用");
    return apps;
}

export function mergeRhAppBundleKeepingLocal(prev, bundleApps) {
    const local = onlySavedApps(prev);
    const incoming = onlySavedApps(bundleApps);
    const localById = new Map(local.map((app) => [appIdOf(app), app]));
    const importedIds = new Set();
    const importedFirst = [];

    for (const app of incoming) {
        const id = appIdOf(app);
        if (!id || importedIds.has(id)) continue;
        importedIds.add(id);
        importedFirst.push(mergeImportedApp(app, localById.get(id)));
    }

    return importedFirst.concat(local.filter((app) => !importedIds.has(appIdOf(app))));
}

export function createRhAppBundle(apps, name = RH_DEFAULT_APP_BUNDLE_NAME) {
    const exportedAt = new Date().toISOString();
    const bundleName = textValue(name) || RH_DEFAULT_APP_BUNDLE_NAME;
    const normalizedApps = normalizeRhAppBundleApps(apps);
    return {
        schema: RH_APP_BUNDLE_SCHEMA,
        version: APP_BUNDLE_VERSION,
        exportedAt,
        name: bundleName,
        apps: normalizedApps.map((app, index) => ({
            id: `app-${app.addedAt || Date.now()}-${index}`,
            appId: String(app.webappId),
            name: app.name || APP_NAME_FALLBACK,
            description: "",
            inputs: Array.isArray(app.inputs) ? app.inputs : [],
            createdAt: app.addedAt || Date.now(),
            updatedAt: Date.now(),
        })),
        templates: [],
        quickEntries: [],
    };
}

export function sortRhSavedAppsByXiaoLiangRhThenName(apps) {
    const arr = onlySavedApps(apps);
    if (arr.length <= 1) return arr;

    const order = builtinOrderMap();
    const builtin = [];
    const rest = [];
    for (const app of arr) {
        (order.has(appIdOf(app)) ? builtin : rest).push(app);
    }
    builtin.sort((a, b) => order.get(appIdOf(a)) - order.get(appIdOf(b)));
    rest.sort(nameSort);
    return builtin.concat(rest);
}

export function seedRhBuiltinApps() {
    const now = Date.now();
    return RH_BUILTIN_APPS.map((app, index) => withBuiltinDetails(app, now - index));
}

export function mergeMissingRhBuiltinApps(prev) {
    const list = Array.isArray(prev) ? [...prev] : [];
    const ids = new Set(list.map((app) => appIdOf(app)));
    let injected = 0;
    const now = Date.now();

    for (const app of RH_BUILTIN_APPS) {
        const id = appIdOf(app);
        if (!id || ids.has(id)) continue;
        list.push(withBuiltinDetails(app, now - injected));
        ids.add(id);
        injected += 1;
    }

    return sortRhSavedAppsByXiaoLiangRhThenName(list);
}

export function appendMissingRhBuiltinApps(prev) {
    const list = onlySavedApps(prev).slice();
    const ids = new Set(list.map((app) => appIdOf(app)));
    let injected = 0;
    const now = Date.now();

    for (const app of RH_BUILTIN_APPS) {
        const id = appIdOf(app);
        if (!id || ids.has(id)) continue;
        list.push(withBuiltinDetails(app, now - injected));
        ids.add(id);
        injected += 1;
    }

    return list;
}

export function applyDefaultRhAppBundle(prev) {
    const current = onlySavedApps(prev).filter((app) => !RH_LEGACY_BUILTIN_WEBAPP_IDS.has(appIdOf(app)));
    return mergeMissingRhBuiltinApps(current);
}

export function syncRhBuiltinMigrationsToLocalStorage() {
    try {
        if (typeof localStorage === "undefined") return;
        for (const flag of BUILTIN_MERGE_FLAGS) {
            if (localStorage.getItem(flag)) continue;
            storageWrite(mergeMissingRhBuiltinApps(storageRead()));
            localStorage.setItem(flag, "1");
        }
        if (!localStorage.getItem(RH_DEFAULT_PRESET_BUNDLE_APPLIED_KEY)) {
            storageWrite(applyDefaultRhAppBundle(storageRead()));
            localStorage.setItem(RH_DEFAULT_PRESET_BUNDLE_APPLIED_KEY, "1");
        }
        storageWrite(applyDefaultRhAppBundle(storageRead()));
        localStorage.setItem(RH_DEFAULT_APP_BUNDLE_APPLIED_KEY, "1");
    } catch {
        /* ignore */
    }
}

export function computeAddOrUpdate(prev, webappId, name, coverUrl, iconUrl, inputs) {
    const id = textValue(webappId);
    if (!id) return prev;
    const current = Array.isArray(prev) ? prev : [];
    const index = current.findIndex((app) => appIdOf(app) === id);
    const existing = index >= 0 ? current[index] : undefined;
    const item = {
        webappId: id,
        name: textValue(name) || APP_NAME_FALLBACK,
        addedAt: existing?.addedAt ?? Date.now(),
        coverUrl: coverUrl || existing?.coverUrl,
        iconUrl: iconUrl || existing?.iconUrl,
        inputs: Array.isArray(inputs) ? inputs : existing?.inputs,
    };
    if (index < 0) return current.concat(item);
    const next = current.slice();
    next[index] = item;
    return next;
}

export function computeRemove(prev, webappId) {
    const id = textValue(webappId);
    if (!id) return prev || [];
    return (prev || []).filter((app) => appIdOf(app) !== id);
}

export function getAll() {
    return storageRead();
}

export function savedAppsNeedsNameSyncFromApi(apps) {
    return Array.isArray(apps)
        ? apps.some((app) => {
              const name = textValue(app?.name);
              return !name || /^默认AI应用/.test(name);
          })
        : false;
}

export async function refreshRhSavedAppNamesFromApi(apiKeyTrim, savedApps, setSavedApps) {
    const key = textValue(apiKeyTrim);
    if (!key || typeof setSavedApps !== "function") return { ok: 0, fail: 0, coverOk: 0, iconOk: 0 };

    const ids = [...new Set(onlySavedApps(savedApps).map(appIdOf).filter(Boolean))];
    let next = Array.isArray(savedApps) ? savedApps.slice() : [];
    let ok = 0;
    let fail = 0;
    let coverOk = 0;
    let iconOk = 0;

    for (const id of ids) {
        try {
            const definition = await fetchAiAppInputs(RH_DEFAULT_BASE_URL, key, id, { skipCache: true });
            const name = textValue(definition?.name) || APP_NAME_FALLBACK;
            if (definition?.coverUrl) coverOk += 1;
            if (definition?.iconUrl) iconOk += 1;
            next = computeAddOrUpdate(next, id, name, definition?.coverUrl, definition?.iconUrl);
            ok += 1;
        } catch {
            fail += 1;
        }
    }

    setSavedApps((prev) => mergeRhAppBundleKeepingLocal(prev, next));
    return { ok, fail, coverOk, iconOk };
}
