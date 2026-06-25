import { rhInputRowKey } from "./rhInputUtils.js";

export const RH_APP_PRESETS_STORAGE_KEY = "rh_app_presets_v1";

const IMAGE_MODES = Object.freeze(new Set(["canvas", "layer", "file"]));
const FALLBACK_PRESET_NAME = "未命名";

function appKey(webappId) {
    return String(webappId || "").trim();
}

function blankDocument() {
    return { byWebappId: {} };
}

function isRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value);
}

function loadDocument() {
    try {
        const raw = localStorage.getItem(RH_APP_PRESETS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return isRecord(parsed?.byWebappId) ? { byWebappId: { ...parsed.byWebappId } } : blankDocument();
    } catch {
        return blankDocument();
    }
}

function saveDocument(doc) {
    try {
        localStorage.setItem(RH_APP_PRESETS_STORAGE_KEY, JSON.stringify(isRecord(doc) ? doc : blankDocument()));
        return true;
    } catch (error) {
        console.warn("[xiaoliang-rh preset storage] 写入失败:", error);
        return false;
    }
}

function readList(doc, webappId) {
    const key = appKey(webappId);
    if (!key) return [];
    const list = doc.byWebappId[key];
    return Array.isArray(list) ? list.filter(Boolean) : [];
}

function plainObjectCopy(value) {
    return isRecord(value) ? { ...value } : {};
}

function validImageModes(value) {
    if (!isRecord(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, mode]) => IMAGE_MODES.has(mode)));
}

function presetName(value) {
    return String(value || FALLBACK_PRESET_NAME).trim() || FALLBACK_PRESET_NAME;
}

function presetId() {
    return `u_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function presetFromPayload(payload = {}) {
    return {
        id: presetId(),
        name: presetName(payload.name),
        updatedAt: Date.now(),
        fieldValues: plainObjectCopy(payload.fieldValues),
        imageModes: validImageModes(payload.imageModes),
    };
}

function newestFirst(list) {
    return [...list].sort((left, right) => (Number(right?.updatedAt) || 0) - (Number(left?.updatedAt) || 0));
}

function editPresetList(webappId, editor) {
    const key = appKey(webappId);
    if (!key) return null;
    const doc = loadDocument();
    const list = readList(doc, key);
    const result = editor(list, doc, key);
    saveDocument(doc);
    return result;
}

export function listRhAppPresets(webappId) {
    const key = appKey(webappId);
    return key ? newestFirst(readList(loadDocument(), key)) : [];
}

export function addRhAppPreset(webappId, payload = {}) {
    return editPresetList(webappId, (list, doc, key) => {
        const preset = presetFromPayload(payload);
        doc.byWebappId[key] = [...list, preset];
        return preset;
    });
}

export function removeRhAppPreset(webappId, presetIdValue) {
    const id = String(presetIdValue || "").trim();
    if (!id) return;
    editPresetList(webappId, (list, doc, key) => {
        if (list.length) doc.byWebappId[key] = list.filter((preset) => preset?.id !== id);
        return null;
    });
}

export function updateRhAppPreset(webappId, presetIdValue, payload = {}) {
    const id = String(presetIdValue || "").trim();
    if (!id) return false;

    return Boolean(editPresetList(webappId, (list, doc, key) => {
        const index = list.findIndex((preset) => preset?.id === id);
        if (index < 0) return false;
        const next = [...list];
        next[index] = {
            ...next[index],
            updatedAt: Date.now(),
            fieldValues: plainObjectCopy(payload.fieldValues),
            imageModes: validImageModes(payload.imageModes),
        };
        doc.byWebappId[key] = next;
        return true;
    }));
}

function storedValueAllowed(row) {
    return row?.fieldType !== "IMAGE";
}

function copyStoredTextValue(targetValues, rowKey, storedValues) {
    if (Object.prototype.hasOwnProperty.call(storedValues, rowKey)) {
        targetValues[rowKey] = String(storedValues[rowKey] ?? "");
    }
}

function copyStoredImageMode(targetModes, rowKey, storedModes) {
    const mode = storedModes[rowKey];
    if (IMAGE_MODES.has(mode)) targetModes[rowKey] = mode;
}

export function mergeRhPresetApplied(currentFv, currentIm, preset, normalizedRows) {
    const fieldValues = { ...(currentFv || {}) };
    const imageModes = { ...(currentIm || {}) };
    const storedValues = plainObjectCopy(preset?.fieldValues);
    const storedModes = validImageModes(preset?.imageModes);

    for (const row of Array.isArray(normalizedRows) ? normalizedRows : []) {
        if (!isRecord(row)) continue;
        const rowKey = rhInputRowKey(row.nodeId, row.fieldName);
        if (row.fieldType === "IMAGE") {
            fieldValues[rowKey] = "";
            copyStoredImageMode(imageModes, rowKey, storedModes);
        } else if (storedValueAllowed(row)) {
            copyStoredTextValue(fieldValues, rowKey, storedValues);
        }
    }

    return { fieldValues, imageModes };
}
