export const RESULT_WORKBENCH_RUNNINGHUB = "runninghub";
export const RESULT_WORKBENCH_COMFY = "comfy";
export const RESULT_WORKBENCH_FORGE = "forge";
export const RESULT_FOLDER_STORAGE_CHANGED = "xlrh-result-folder-storage-changed";
export const RESULT_FOLDER_OVERRIDE_NONE = "__xlrh_no_folder__";

const TOKEN_KEYS = Object.freeze({
    global: "resultFolderToken",
    overridePrefix: "resultFolderTokenOverride:",
    rhCustomEnabled: "runninghubResultFolderCustomEnabled",
    rhCacheMigration: "runninghubImageCacheDefaultMigration:20260612",
});

const RESULT_FOLDER_STORE = {
    get(key) {
        try {
            return localStorage.getItem(key);
        } catch (_) {
            return null;
        }
    },
    set(key, value) {
        localStorage.setItem(key, value);
    },
    remove(key) {
        localStorage.removeItem(key);
    },
    keys() {
        const keys = [];
        try {
            for (let index = 0; index < localStorage.length; index += 1) {
                const key = localStorage.key(index);
                if (key) keys.push(key);
            }
        } catch (_) {
            // UXP storage can fail during early panel boot; callers treat this as no keys.
        }
        return keys;
    },
};

function overrideKeyFor(workbenchId) {
    return `${TOKEN_KEYS.overridePrefix}${workbenchId}`;
}

function isRunningHubWorkbench(workbenchId) {
    return workbenchId === RESULT_WORKBENCH_RUNNINGHUB;
}

function isOptOutToken(value) {
    return value === RESULT_FOLDER_OVERRIDE_NONE;
}

function dispatchFolderTokenChange() {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
    try {
        window.dispatchEvent(new CustomEvent(RESULT_FOLDER_STORAGE_CHANGED));
    } catch (_) {
        // Same-tab sync is best effort; the next refresh still reads storage directly.
    }
}

function removeOverrideSilently(workbenchId) {
    if (!workbenchId) return;
    RESULT_FOLDER_STORE.remove(overrideKeyFor(workbenchId));
}

function runningHubHasUserFolder() {
    return RESULT_FOLDER_STORE.get(TOKEN_KEYS.rhCustomEnabled) === "1";
}

function resetImplicitRunningHubFolder() {
    removeOverrideSilently(RESULT_WORKBENCH_RUNNINGHUB);
    RESULT_FOLDER_STORE.remove(TOKEN_KEYS.rhCustomEnabled);
}

function normalizeOverrideToken(workbenchId) {
    if (!workbenchId) return null;
    if (isRunningHubWorkbench(workbenchId) && !runningHubHasUserFolder()) {
        resetImplicitRunningHubFolder();
        return null;
    }
    const value = RESULT_FOLDER_STORE.get(overrideKeyFor(workbenchId));
    if (!value || isOptOutToken(value)) return null;
    return value;
}

export function migrateRunningHubResultFolderToImageCacheDefault() {
    try {
        if (RESULT_FOLDER_STORE.get(TOKEN_KEYS.rhCacheMigration) === "1") return false;
        resetImplicitRunningHubFolder();
        RESULT_FOLDER_STORE.set(TOKEN_KEYS.rhCacheMigration, "1");
        dispatchFolderTokenChange();
        return true;
    } catch (_) {
        return false;
    }
}

export function getGlobalResultFolderToken() {
    return RESULT_FOLDER_STORE.get(TOKEN_KEYS.global);
}

export function setGlobalResultFolderToken(token, originatingWorkbenchId) {
    try {
        RESULT_FOLDER_STORE.set(TOKEN_KEYS.global, token);
        if (originatingWorkbenchId) removeOverrideSilently(originatingWorkbenchId);
        dispatchFolderTokenChange();
    } catch (error) {
        console.warn("[xiaoliang-rh] set result folder failed:", error);
    }
}

export function getOverrideResultFolderToken(workbenchId) {
    try {
        return normalizeOverrideToken(workbenchId);
    } catch (_) {
        return null;
    }
}

export function isWorkbenchFolderOptOut(workbenchId) {
    if (!workbenchId) return false;
    try {
        return isOptOutToken(RESULT_FOLDER_STORE.get(overrideKeyFor(workbenchId)));
    } catch (_) {
        return false;
    }
}

export function hasWorkbenchFolderOverride(workbenchId) {
    return Boolean(getOverrideResultFolderToken(workbenchId));
}

export function setOverrideResultFolderToken(workbenchId, token) {
    if (!workbenchId) return;
    try {
        if (isRunningHubWorkbench(workbenchId)) RESULT_FOLDER_STORE.set(TOKEN_KEYS.rhCustomEnabled, "1");
        RESULT_FOLDER_STORE.set(overrideKeyFor(workbenchId), token);
        dispatchFolderTokenChange();
    } catch (error) {
        console.warn("[xiaoliang-rh] set workbench result folder failed:", error);
    }
}

export function clearOverrideResultFolderToken(workbenchId) {
    if (!workbenchId) return;
    try {
        removeOverrideSilently(workbenchId);
        if (isRunningHubWorkbench(workbenchId)) RESULT_FOLDER_STORE.remove(TOKEN_KEYS.rhCustomEnabled);
        dispatchFolderTokenChange();
    } catch (_) {
        // Ignore storage failures; UI will reread the current value on next refresh.
    }
}

export function clearAllResultFolderOverrides() {
    try {
        RESULT_FOLDER_STORE.keys()
            .filter((key) => key.startsWith(TOKEN_KEYS.overridePrefix))
            .forEach((key) => RESULT_FOLDER_STORE.remove(key));
        dispatchFolderTokenChange();
    } catch (_) {
        // Ignore storage failures; this utility is best effort.
    }
}

export function getEffectiveResultFolderToken(workbenchId) {
    if (!workbenchId) return getGlobalResultFolderToken();
    try {
        if (isRunningHubWorkbench(workbenchId) && !runningHubHasUserFolder()) {
            resetImplicitRunningHubFolder();
            return null;
        }
        const override = RESULT_FOLDER_STORE.get(overrideKeyFor(workbenchId));
        if (isOptOutToken(override)) return null;
        if (override) return override;
    } catch (_) {
        // Fall through to global behavior below.
    }
    return isRunningHubWorkbench(workbenchId) ? null : getGlobalResultFolderToken();
}

export function setWorkbenchFolderOptOut(workbenchId) {
    if (!workbenchId) return;
    try {
        if (isRunningHubWorkbench(workbenchId)) RESULT_FOLDER_STORE.remove(TOKEN_KEYS.rhCustomEnabled);
        RESULT_FOLDER_STORE.set(overrideKeyFor(workbenchId), RESULT_FOLDER_OVERRIDE_NONE);
        dispatchFolderTokenChange();
    } catch (error) {
        console.warn("[xiaoliang-rh] opt out result folder failed:", error);
    }
}

export function clearGlobalResultFolderToken() {
    try {
        RESULT_FOLDER_STORE.remove(TOKEN_KEYS.global);
        dispatchFolderTokenChange();
    } catch (_) {
        // Ignore storage failures.
    }
}
