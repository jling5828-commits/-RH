import { readCompatLocalStorage } from "./storageKeyCompat.js";

export const PLACE_EDGE_FEATHER_CHANGED = "xlrh-place-edge-feather-changed";

const EDGE_FEATHER_KEY = "xlrh_place_edge_feather_enabled";
const KEEP_SELECTION_KEY = "xlrh_place_keep_selection";

function readBooleanPreference(key, fallback = true) {
    try {
        const stored = readCompatLocalStorage(key);
        if (stored == null || stored === "") return fallback;
        return stored !== "false";
    } catch (_) {
        return fallback;
    }
}

export function readPlaceEdgeFeatherEnabledFromStorage() {
    return readBooleanPreference(EDGE_FEATHER_KEY, false);
}

export function readPlaceKeepSelectionFromStorage() {
    return readBooleanPreference(KEEP_SELECTION_KEY, true);
}

function makeFeatherEventDetail(detail) {
    if (!detail || typeof detail !== "object") return {};
    const out = {};
    if ("enabled" in detail) out.enabled = !!detail.enabled;
    if ("keepSelection" in detail) out.keepSelection = !!detail.keepSelection;
    return out;
}

export function notifyPlaceEdgeFeatherChanged(detail) {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return false;
    try {
        window.dispatchEvent(new CustomEvent(PLACE_EDGE_FEATHER_CHANGED, { detail: makeFeatherEventDetail(detail) }));
        return true;
    } catch (error) {
        console.warn("[xiaoliang-rh] place feather change event failed:", error);
        return false;
    }
}

export function getPlaceEdgeFeatherOptsFromStorage() {
    const placeEdgeFeatherAuto = readPlaceEdgeFeatherEnabledFromStorage();
    const placeKeepSelection = readPlaceKeepSelectionFromStorage();
    return {
        placeEdgeFeatherAuto,
        placeEdgeFeatherSubcanvasOnly: true,
        placeKeepSelection,
    };
}
