function normalizeStorageKey(key) {
    return String(key || "");
}

export function getCompatStorageKeys(key) {
    return { primary: normalizeStorageKey(key), legacy: null };
}

export function isCompatStorageKey(eventKey, expectedKey) {
    return normalizeStorageKey(eventKey) === normalizeStorageKey(expectedKey);
}

export function expandCompatStorageKeys(keys) {
    const out = new Set();
    for (const key of keys || []) {
        const normalized = normalizeStorageKey(key);
        if (normalized) out.add(normalized);
    }
    return out;
}

export function readCompatLocalStorage(key) {
    return localStorage.getItem(normalizeStorageKey(key));
}

export function writeCompatLocalStorage(key, value) {
    localStorage.setItem(normalizeStorageKey(key), value);
}

export function removeCompatLocalStorage(key) {
    localStorage.removeItem(normalizeStorageKey(key));
}

export function migrateXlrhStorageKeys() {
    return 0;
}
