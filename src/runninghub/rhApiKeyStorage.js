export const RH_API_KEY_STORAGE_KEY = "rh_api_key";
export const RH_API_KEY_CONSUMER_STORAGE_KEY = "rh_api_key_consumer";
export const RH_API_KEY_ENTERPRISE_STORAGE_KEY = "rh_api_key_enterprise";
export const RH_API_KEY_MODE_STORAGE_KEY = "rh_api_key_mode";
export const RH_API_KEY_CHANGED_EVENT = "xlrh-rh-api-key-changed";

export const RH_API_KEY_MODE_CONSUMER = "consumer";
export const RH_API_KEY_MODE_ENTERPRISE = "enterprise";

const SINGLE_KEY_FALLBACK_KEYS = ["mj_ttapi_key"];

function readLocalStorage(key) {
    try {
        return localStorage.getItem(key) || "";
    } catch (_) {
        return "";
    }
}

function writeLocalStorage(key, value) {
    try {
        const next = String(value || "").trim();
        if (next) localStorage.setItem(key, next);
        else localStorage.removeItem(key);
    } catch (_) {
        /* storage writes are best-effort inside UXP webviews */
    }
}

function normalizeRhApiKeyMode(mode) {
    return mode === RH_API_KEY_MODE_CONSUMER ? RH_API_KEY_MODE_CONSUMER : RH_API_KEY_MODE_ENTERPRISE;
}

function broadcastApiKeyChange() {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
    try {
        window.dispatchEvent(new CustomEvent(RH_API_KEY_CHANGED_EVENT));
    } catch (_) {
        /* ignore event failures */
    }
}

function firstStoredKey(keys) {
    for (const key of keys) {
        const value = String(readLocalStorage(key) || "").trim();
        if (value) return value;
    }
    return "";
}

function ensureSplitApiKeyStorage() {
    const consumer = String(readLocalStorage(RH_API_KEY_CONSUMER_STORAGE_KEY) || "").trim();
    const enterprise = String(readLocalStorage(RH_API_KEY_ENTERPRISE_STORAGE_KEY) || "").trim();
    if (consumer || enterprise) return;

    const migrated = firstStoredKey([RH_API_KEY_STORAGE_KEY, ...SINGLE_KEY_FALLBACK_KEYS]);
    if (!migrated) return;

    writeLocalStorage(RH_API_KEY_ENTERPRISE_STORAGE_KEY, migrated);
    writeLocalStorage(RH_API_KEY_MODE_STORAGE_KEY, RH_API_KEY_MODE_ENTERPRISE);
    writeLocalStorage(RH_API_KEY_STORAGE_KEY, migrated);
}

export function readRhApiKeyMode() {
    ensureSplitApiKeyStorage();
    return normalizeRhApiKeyMode(readLocalStorage(RH_API_KEY_MODE_STORAGE_KEY));
}

export function readRhApiKeys() {
    ensureSplitApiKeyStorage();
    return {
        consumer: String(readLocalStorage(RH_API_KEY_CONSUMER_STORAGE_KEY) || "").trim(),
        enterprise: String(readLocalStorage(RH_API_KEY_ENTERPRISE_STORAGE_KEY) || "").trim(),
    };
}

export function readRhApiKey() {
    const mode = readRhApiKeyMode();
    const keys = readRhApiKeys();
    const activeKey = mode === RH_API_KEY_MODE_CONSUMER ? keys.consumer : keys.enterprise;
    writeLocalStorage(RH_API_KEY_STORAGE_KEY, activeKey);
    return activeKey;
}

export function persistRhApiKey(key) {
    persistRhApiKeyForMode(readRhApiKeyMode(), key);
}

export function persistRhApiKeyForMode(mode, key) {
    const normalizedMode = normalizeRhApiKeyMode(mode);
    const storageKey = normalizedMode === RH_API_KEY_MODE_CONSUMER
        ? RH_API_KEY_CONSUMER_STORAGE_KEY
        : RH_API_KEY_ENTERPRISE_STORAGE_KEY;
    const next = String(key || "").trim();
    writeLocalStorage(storageKey, next);
    if (readRhApiKeyMode() === normalizedMode) writeLocalStorage(RH_API_KEY_STORAGE_KEY, next);
    broadcastApiKeyChange();
}

export function persistRhApiKeyMode(mode) {
    const normalizedMode = normalizeRhApiKeyMode(mode);
    writeLocalStorage(RH_API_KEY_MODE_STORAGE_KEY, normalizedMode);
    const keys = readRhApiKeys();
    const activeKey = normalizedMode === RH_API_KEY_MODE_CONSUMER ? keys.consumer : keys.enterprise;
    writeLocalStorage(RH_API_KEY_STORAGE_KEY, activeKey);
    broadcastApiKeyChange();
}
