import { readCompatLocalStorage, writeCompatLocalStorage } from "./storageKeyCompat.js";

export const AUTO_RETURN_KEY = "rh_auto_return_enabled";
export const LEGACY_AUTO_PLACE_KEY = "xlrh_auto_place";
export const CONCURRENT_RETURN_GROUP_KEY = "xlrh_concurrent_return_group_enabled";
export const SUCCESS_SOUND_KEY = "rh_success_sound_file";
export const FAIL_SOUND_KEY = "rh_fail_sound_file";

function readStored(key, fallback) {
    const raw = readCompatLocalStorage(key);
    if (raw == null || raw === "") return fallback;
    try {
        return JSON.parse(raw);
    } catch (_) {
        return raw;
    }
}

function readBoolean(key, fallback = true) {
    const value = readStored(key, fallback);
    if (typeof value === "boolean") return value;
    if (typeof value === "string") return value.trim().toLowerCase() !== "false";
    return value == null ? fallback : Boolean(value);
}

function readText(key, fallback = "") {
    const value = readStored(key, fallback);
    return typeof value === "string" && value.trim() ? value : fallback;
}

export function readAutoReturnEnabled(fallback = true) {
    if (readCompatLocalStorage(AUTO_RETURN_KEY) != null) return readBoolean(AUTO_RETURN_KEY, fallback);
    if (readCompatLocalStorage(LEGACY_AUTO_PLACE_KEY) != null) return readBoolean(LEGACY_AUTO_PLACE_KEY, fallback);
    return fallback;
}

export function writeAutoReturnEnabled(enabled) {
    const value = Boolean(enabled);
    writeCompatLocalStorage(AUTO_RETURN_KEY, JSON.stringify(value));
    writeCompatLocalStorage(LEGACY_AUTO_PLACE_KEY, String(value));
}

export function readConcurrentReturnGroupEnabled(fallback = true) {
    return readBoolean(CONCURRENT_RETURN_GROUP_KEY, fallback);
}

export function writeConcurrentReturnGroupEnabled(enabled) {
    writeCompatLocalStorage(CONCURRENT_RETURN_GROUP_KEY, JSON.stringify(!!enabled));
}

export function writeSoundMuted(enabled) {
    writeCompatLocalStorage("xlrh_sound_muted", JSON.stringify(!!enabled));
}

export function readSuccessSoundFile(fallback = "") {
    return readText(SUCCESS_SOUND_KEY, fallback);
}

export function readFailSoundFile(fallback = "") {
    return readText(FAIL_SOUND_KEY, fallback);
}
