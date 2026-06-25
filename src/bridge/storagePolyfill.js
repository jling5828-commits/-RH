import { createPersistentStorage } from "./persistentStorage.js";

const PROBE_KEY = "__xlrh_storage_probe__";

function hasWorkingLocalStorage(win) {
    try {
        const storage = win?.localStorage;
        if (!storage) return false;
        storage.setItem(PROBE_KEY, "1");
        storage.removeItem(PROBE_KEY);
        return true;
    } catch {
        return false;
    }
}

function canTalkToHost(win) {
    return typeof win?.uxpHost?.postMessage === "function";
}

function attachStorage(win, storage) {
    try {
        Object.defineProperty(win, "localStorage", {
            configurable: true,
            enumerable: true,
            value: storage,
            writable: false,
        });
    } catch {
        win.localStorage = storage;
    }
}

function markStorageMode(win, bridgeReady) {
    win.__xlrh_usingPersistentStorage = true;
    win.__xlrh_storageBridgeReady = bridgeReady;
}

(function installXlrhStorageFallback() {
    if (typeof window === "undefined") return;

    const bridgeReady = canTalkToHost(window);
    if (!bridgeReady && hasWorkingLocalStorage(window)) return;

    attachStorage(window, createPersistentStorage());
    markStorageMode(window, bridgeReady);
    console.info(`[storagePolyfill] 小梁RH persistent localStorage enabled (protocol=${window.location?.protocol || "unknown"})`);
})();
