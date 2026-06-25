import { readCompatLocalStorage, writeCompatLocalStorage } from "./storageKeyCompat.js";

const PRESET_PREVIEW_KEY = "xlrh_preset_preview_thumb_v1";
const PRESET_PREVIEW_EVENT = "xlrh-preset-preview-updated";
const PRESET_PREVIEW_LIMIT = 40;

function previewId(value) {
    return String(value ?? "").trim();
}

function previewThumb(value) {
    return String(value ?? "").trim();
}

function parsePreviewStore(raw) {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
        return {};
    }
}

function readPreviewStore() {
    return parsePreviewStore(readCompatLocalStorage(PRESET_PREVIEW_KEY));
}

function orderedPreviewEntries(map) {
    return Object.entries(map || {})
        .filter(([id, value]) => id && value && typeof value === "object")
        .sort((left, right) => Number(right[1].updatedAt || 0) - Number(left[1].updatedAt || 0));
}

function limitPreviewStore(map) {
    return Object.fromEntries(orderedPreviewEntries(map).slice(0, PRESET_PREVIEW_LIMIT));
}

function writePreviewStore(map) {
    try {
        writeCompatLocalStorage(PRESET_PREVIEW_KEY, JSON.stringify(limitPreviewStore(map)));
    } catch (error) {
        console.warn("[XiaoLiangRH] preset preview save failed", error);
    }
}

function notifyPreviewChanged(presetId) {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
    try {
        window.dispatchEvent(new CustomEvent(PRESET_PREVIEW_EVENT, { detail: { presetId } }));
    } catch (_) {
        // Preview thumbnails are refreshed on the next panel read if same-tab events fail.
    }
}

export function readPresetPreviewMap() {
    return readPreviewStore();
}

export function setPresetPreviewThumb(presetId, thumbDataUrl) {
    const id = previewId(presetId);
    const thumbDataUrlSafe = previewThumb(thumbDataUrl);
    if (!id || !thumbDataUrlSafe) return;
    writePreviewStore({
        ...readPreviewStore(),
        [id]: {
            thumbDataUrl: thumbDataUrlSafe,
            updatedAt: Date.now(),
        },
    });
    notifyPreviewChanged(id);
}

export function removePresetPreviewThumb(presetId) {
    const id = previewId(presetId);
    if (!id) return;
    const store = readPreviewStore();
    if (!Object.prototype.hasOwnProperty.call(store, id)) return;
    const nextStore = { ...store };
    delete nextStore[id];
    writePreviewStore(nextStore);
    notifyPreviewChanged(id);
}
