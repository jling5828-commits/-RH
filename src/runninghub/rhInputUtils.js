const FIELD_ALIASES = {
    nodeId: ["nodeId", "node_id", "nodeid", "NodeId", "NODE_ID"],
    nodeName: ["nodeName", "node_name", "nodename", "NodeName", "NODE_NAME"],
    fieldName: ["fieldName", "field_name", "fieldname", "FieldName", "FIELD_NAME", "name", "key", "paramKey", "param_key"],
    fieldValue: ["fieldValue", "field_value", "fieldvalue", "FieldValue", "FIELD_VALUE", "value"],
    fieldData: ["fieldData", "field_data", "fielddata", "FieldData", "FIELD_DATA", "data"],
    description: ["description", "desc", "Description", "Desc", "DESCRIPTION"],
    fieldType: [
        "fieldType",
        "type",
        "inputType",
        "field_type",
        "input_type",
        "controlType",
        "widgetType",
        "fieldtype",
        "inputtype",
        "controltype",
        "widgettype",
        "FieldType",
        "Type",
        "InputType",
        "FIELD_TYPE",
        "TYPE",
        "INPUT_TYPE",
    ],
};

const LIST_TYPE_WORDS = new Set(["select", "dropdown", "enum", "list"]);
const MEDIA_TYPES = new Set(["IMAGE", "AUDIO", "VIDEO"]);
const NUMERIC_TYPES = new Set(["INT", "INTEGER", "LONG", "FLOAT", "NUMBER", "DOUBLE"]);

const OPTION_SOURCES = [
    "fieldData",
    "field_data",
    "fielddata",
    "options",
    "enums",
    "values",
    "items",
    "list",
    "data",
    "children",
    "selectOptions",
    "optionList",
    "fieldOptions",
    "candidate",
    "candidates",
    "enum",
    "choices",
    "enumValues",
];

const NUMERIC_LIMIT_KEYS = Object.freeze({
    min: ["min", "minValue", "minimum", "lowerBound", "from", "start", "min_value", "minLimit", "min_limit"],
    max: ["max", "maxValue", "maximum", "upperBound", "to", "end", "max_value", "maxLimit", "max_limit"],
    step: ["step", "stepSize", "increment", "interval", "stride", "step_value", "stepValue"],
});

const NUMERIC_RANGE_ARRAY_KEYS = ["range", "sliderRange", "valueRange", "bounds", "limit", "limits"];

const NESTED_META_KEYS = [
    "config",
    "extra",
    "schema",
    "validation",
    "rules",
    "props",
    "widget",
    "fieldSchema",
    "range",
    "number",
    "limit",
    "limits",
    "options",
    "ui",
    "constraints",
    "constraint",
    "attrs",
    "attributes",
    "meta",
    "metadata",
    "settings",
];


const OPTION_INDEX_KEYS = ["index", "fastIndex", "value", "optionValue", "enumValue", "id", "key", "code"];
const OPTION_NAME_KEYS = ["description", "descriptionCn", "descriptionCN", "descriptionEn", "name", "label", "text", "title", "displayName"];
const OPTION_META_WORDS = new Set([
    "default",
    "description",
    "descriptionen",
    "descriptioncn",
    "desc",
    "title",
    "label",
    "name",
    "placeholder",
    "required",
    "min",
    "max",
    "step",
    "type",
    "widget",
    "inputtype",
    "fieldtype",
    "multiple",
]);
const OPTION_NOISE_WORDS = new Set([
    "string",
    "text",
    "number",
    "int",
    "integer",
    "float",
    "double",
    "boolean",
    "bool",
    "object",
    "array",
    "list",
    "enum",
    "select",
    "index",
    "fastindex",
    "description",
    "descriptionen",
    "descriptioncn",
    "ignore",
    "ignored",
]);
const ROW_SCHEMA_WORDS = new Set([
    "nodeid",
    "node_id",
    "nodename",
    "node_name",
    "fieldname",
    "field_name",
    "fieldvalue",
    "field_value",
    "fielddata",
    "field_data",
    "fieldtype",
    "field_type",
    "description",
    "desc",
    "type",
    "inputtype",
    "input_type",
    "widgettype",
    "widget_type",
    "controltype",
    "control_type",
    "config",
    "extra",
    "schema",
    "webappid",
    "webapp_id",
    "appid",
    "app_id",
    "key",
    "paramkey",
    "param_key",
]);

export const RH_NUMERIC_FIELD_DATA_NORMALIZE_BASELINE = "20260615-xlrh-input-normalizer-v2";

function isPlainRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function trimString(value) {
    return value == null ? "" : String(value).trim();
}

function firstPresent(record, keys) {
    if (!isPlainRecord(record)) return undefined;
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(record, key) && record[key] != null) {
            return record[key];
        }
    }
    return undefined;
}

function firstText(record, keys) {
    const value = firstPresent(record, keys);
    return trimString(value);
}

function safeJsonParse(text) {
    if (typeof text !== "string") return undefined;
    const body = text.trim();
    if (!body || !/^[\[{"']/.test(body)) return undefined;
    try {
        return JSON.parse(body);
    } catch (_) {
        return undefined;
    }
}

function unwrapJsonText(value) {
    if (typeof value !== "string") return value;
    const parsed = safeJsonParse(value);
    return parsed === undefined ? value : parsed;
}

function toFieldType(rawType) {
    const raw = trimString(rawType);
    if (!raw) return "STRING";
    const lower = raw.toLowerCase();
    return LIST_TYPE_WORDS.has(lower) ? "LIST" : raw.toUpperCase();
}

function optionSourceFromRecord(record) {
    if (!isPlainRecord(record)) return undefined;
    for (const key of OPTION_SOURCES) {
        const value = record[key];
        if (value !== undefined && value !== null && value !== "") return value;
    }
    for (const groupKey of ["config", "extra", "schema"]) {
        const nested = unwrapJsonText(record[groupKey]);
        if (!isPlainRecord(nested)) continue;
        const found = optionSourceFromRecord(nested);
        if (found !== undefined && found !== null && found !== "") return found;
    }
    return undefined;
}

function primitiveOptionArray(value) {
    return Array.isArray(value) && value.some((item) => item != null) && value.every((item) => item == null || ["string", "number", "boolean"].includes(typeof item));
}

function unwrapOptionTuple(value) {
    if (!Array.isArray(value) || value.length === 0) return value;
    return primitiveOptionArray(value[0]) ? value[0] : value;
}

function pickObjectText(record, keys) {
    for (const key of keys) {
        const value = record[key];
        if (["string", "number", "boolean"].includes(typeof value)) {
            const text = trimString(value);
            if (text) return text;
        }
    }
    return "";
}

function pushUniqueOption(out, seen, entry) {
    const index = trimString(entry?.index);
    const name = trimString(entry?.name || index);
    if (!index && !name) return;
    const stableIndex = index || name;
    const marker = stableIndex.toLowerCase();
    if (!marker || seen.has(marker) || OPTION_NOISE_WORDS.has(marker)) return;
    seen.add(marker);
    const next = { index: stableIndex, name: name || stableIndex };
    const desc = trimString(entry?.description);
    if (desc && desc !== next.name) next.description = desc;
    out.push(next);
}

function mapEntryToOption(item) {
    if (item == null) return null;
    if (["string", "number", "boolean"].includes(typeof item)) {
        const text = String(item);
        return { index: text, name: text };
    }
    if (!isPlainRecord(item)) return null;
    const index = pickObjectText(item, OPTION_INDEX_KEYS);
    const name = pickObjectText(item, OPTION_NAME_KEYS) || index;
    const descParts = [item.descriptionEn, item.descriptionCn, item.descriptionCN]
        .map(trimString)
        .filter(Boolean);
    return {
        index: index || name,
        name: name || index,
        description: trimString(item.description) || (descParts.length ? descParts.join(" / ") : undefined),
    };
}

function objectMapLooksLikeOptions(record) {
    const keys = Object.keys(record || {});
    if (keys.length < 2 || keys.length > 80) return false;
    return keys.some((key) => !ROW_SCHEMA_WORDS.has(key.toLowerCase()) && !OPTION_META_WORDS.has(key.toLowerCase()));
}

function parseOptionsCore(value, depth, out, seen) {
    if (depth > 8 || value == null) return;
    const raw = unwrapOptionTuple(unwrapJsonText(value));

    if (typeof raw === "string") {
        const split = raw.includes("|") || raw.includes(",") || raw.includes("\n") ? raw.split(/[|,\r\n]+/) : [];
        if (split.length > 1) {
            split.map(trimString).filter(Boolean).forEach((text) => pushUniqueOption(out, seen, { index: text, name: text }));
        }
        return;
    }

    if (["number", "boolean"].includes(typeof raw)) {
        const text = String(raw);
        pushUniqueOption(out, seen, { index: text, name: text });
        return;
    }

    if (Array.isArray(raw)) {
        for (const item of raw) {
            if (Array.isArray(item) && !primitiveOptionArray(item)) {
                parseOptionsCore(item, depth + 1, out, seen);
                continue;
            }
            if (Array.isArray(item)) {
                item.forEach((part) => parseOptionsCore(part, depth + 1, out, seen));
                continue;
            }
            const entry = mapEntryToOption(item);
            if (entry) pushUniqueOption(out, seen, entry);
        }
        return;
    }

    if (!isPlainRecord(raw)) return;

    for (const key of OPTION_SOURCES) {
        if (raw[key] !== undefined && raw[key] !== null && raw[key] !== "") {
            parseOptionsCore(raw[key], depth + 1, out, seen);
        }
    }

    const direct = mapEntryToOption(raw);
    if (direct) pushUniqueOption(out, seen, direct);

    if (objectMapLooksLikeOptions(raw)) {
        for (const key of Object.keys(raw)) {
            const lower = key.toLowerCase();
            if (ROW_SCHEMA_WORDS.has(lower) || OPTION_META_WORDS.has(lower)) continue;
            const valueForKey = raw[key];
            if (isPlainRecord(valueForKey)) {
                const nested = mapEntryToOption({ key, ...valueForKey });
                if (nested) pushUniqueOption(out, seen, nested);
            } else if (["string", "number", "boolean"].includes(typeof valueForKey)) {
                pushUniqueOption(out, seen, { index: key, name: String(valueForKey) || key });
            } else {
                pushUniqueOption(out, seen, { index: key, name: key });
            }
        }
    }
}

function sanitizeOptions(options) {
    const out = [];
    const seen = new Set();
    for (const item of options || []) {
        const index = trimString(item?.index);
        const name = trimString(item?.name || index);
        const marker = index.toLowerCase();
        if (!index || seen.has(marker)) continue;
        if (OPTION_META_WORDS.has(marker) || OPTION_NOISE_WORDS.has(marker)) continue;
        if (/^(?:fast)?index$/i.test(index)) continue;
        seen.add(marker);
        const next = { index, name: name || index };
        const description = trimString(item?.description);
        if (description) next.description = description;
        out.push(next);
    }
    return out;
}

export function inferRhListOptionsFromHintText(fieldData, hintText) {
    const text = stringifyLoose(fieldData);
    if (!text) return [];
    const hint = trimString(hintText).toLowerCase();
    const wantsRatio = /aspect|ratio|比例/.test(hint);
    const wantsResolution = /resolution|size|分辨率|尺寸/.test(hint);
    if (!wantsRatio && !wantsResolution) return [];

    const values = [];
    const seen = new Set();
    const add = (value) => {
        const textValue = trimString(value);
        const marker = textValue.toLowerCase();
        if (!marker || seen.has(marker)) return;
        seen.add(marker);
        values.push(textValue);
    };

    if (wantsRatio) {
        if (/\bauto\b/i.test(text) || /自动/.test(text)) add("auto");
        (text.match(/\b\d{1,2}\s*:\s*\d{1,2}\b/g) || []).forEach((ratio) => add(ratio.replace(/\s+/g, "")));
    }

    if (wantsResolution) {
        (text.match(/\b\d+(?:\.\d+)?k\b/gi) || []).forEach((size) => add(size.toLowerCase()));
        (text.match(/\b\d{3,5}\s*[xX]\s*\d{3,5}\b/g) || []).forEach((size) => add(size.replace(/\s+/g, "").toLowerCase()));
    }

    return sanitizeOptions(values.map((value) => ({ index: value, name: value }))).slice(0, 40);
}

export function rhInputRowKey(nodeId, fieldName) {
    return `${String(nodeId)}::${String(fieldName)}`;
}

export function parseRhListOptions(fieldData) {
    const out = [];
    parseOptionsCore(fieldData, 0, out, new Set());
    return sanitizeOptions(out);
}

function stringifyLoose(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value);
    } catch (_) {
        return String(value);
    }
}

export function isRhNumericFieldTypeUpper(fieldType) {
    return NUMERIC_TYPES.has(trimString(fieldType).toUpperCase());
}

function parseFiniteNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    if (typeof value !== "string") return undefined;
    const normalized = value.trim().replace(/,/g, ".");
    if (!normalized) return undefined;
    const n = Number.parseFloat(normalized);
    return Number.isFinite(n) ? n : undefined;
}

function copyNumericLimits(target, source, depth = 0) {
    if (depth > 7 || !isPlainRecord(source)) return;
    for (const key of NUMERIC_RANGE_ARRAY_KEYS) {
        const range = unwrapJsonText(source[key]);
        if (!Array.isArray(range)) continue;
        const min = parseFiniteNumber(range[0]);
        const max = parseFiniteNumber(range[1]);
        const step = parseFiniteNumber(range[2]);
        if (target.min === undefined && min !== undefined) target.min = min;
        if (target.max === undefined && max !== undefined) target.max = max;
        if (target.step === undefined && step !== undefined) target.step = step;
    }
    for (const [canonical, keys] of Object.entries(NUMERIC_LIMIT_KEYS)) {
        if (target[canonical] !== undefined) continue;
        for (const key of keys) {
            if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
            const parsed = parseFiniteNumber(source[key]);
            if (parsed !== undefined) {
                target[canonical] = parsed;
                break;
            }
        }
    }
    for (const key of NESTED_META_KEYS) {
        const nested = unwrapJsonText(source[key]);
        if (isPlainRecord(nested)) copyNumericLimits(target, nested, depth + 1);
    }
}

function mergeNumericFieldData(record, fieldData) {
    const limits = {};
    const decodedFieldData = unwrapJsonText(fieldData);
    if (isPlainRecord(decodedFieldData)) copyNumericLimits(limits, decodedFieldData);
    copyNumericLimits(limits, record);
    if (Object.keys(limits).length === 0) return fieldData;
    if (isPlainRecord(decodedFieldData)) return { ...decodedFieldData, ...limits };
    return { ...limits };
}

function inferFieldData(record, fieldType) {
    if (fieldType === "LIST") return optionSourceFromRecord(record);
    return firstPresent(record, FIELD_ALIASES.fieldData) ?? null;
}

function resolveListData(record, initialData) {
    if (parseRhListOptions(initialData).length > 0) return initialData;
    const fromRecord = optionSourceFromRecord(record);
    if (parseRhListOptions(fromRecord).length > 0) return fromRecord;
    const hint = `${firstText(record, FIELD_ALIASES.description)} ${firstText(record, FIELD_ALIASES.nodeName)} ${firstText(record, FIELD_ALIASES.fieldName)}`;
    const inferred = inferRhListOptionsFromHintText(initialData ?? fromRecord ?? record, hint);
    return inferred.length > 0 ? inferred : initialData;
}

export function normalizeRhInputRow(raw) {
    if (!isPlainRecord(raw)) return null;
    const nodeId = firstText(raw, FIELD_ALIASES.nodeId);
    const fieldName = firstText(raw, FIELD_ALIASES.fieldName);
    if (!nodeId || !fieldName) return null;

    let fieldType = toFieldType(firstPresent(raw, FIELD_ALIASES.fieldType));
    let fieldData = inferFieldData(raw, fieldType);

    if (fieldType === "STRING") {
        const optionCandidate = optionSourceFromRecord(raw);
        if (parseRhListOptions(optionCandidate).length > 0) {
            fieldType = "LIST";
            fieldData = optionCandidate;
        }
    }

    if (fieldType === "LIST") {
        fieldData = resolveListData(raw, fieldData);
    } else if (isRhNumericFieldTypeUpper(fieldType)) {
        fieldData = mergeNumericFieldData(raw, fieldData);
    }

    return {
        nodeId,
        fieldName,
        fieldType,
        fieldValue: trimString(firstPresent(raw, FIELD_ALIASES.fieldValue)),
        fieldData,
        nodeName: firstText(raw, FIELD_ALIASES.nodeName),
        description: firstText(raw, FIELD_ALIASES.description),
    };
}

export function normalizeRhInputList(inputs) {
    if (!Array.isArray(inputs)) return [];
    return inputs.map(normalizeRhInputRow).filter(Boolean);
}

function isMediaFieldType(fieldType) {
    return MEDIA_TYPES.has(trimString(fieldType).toUpperCase());
}

function textValueForRow(row, fieldValues) {
    const key = rhInputRowKey(row.nodeId, row.fieldName);
    return Object.prototype.hasOwnProperty.call(fieldValues || {}, key) ? fieldValues[key] : row.fieldValue;
}

function uploadFromPending(row, pendingUploads) {
    const key = rhInputRowKey(row.nodeId, row.fieldName);
    const pending = pendingUploads?.[key];
    if (!pending || typeof pending !== "object") return null;
    const fileName = trimString(pending.fileName);
    if (!fileName) return null;
    const base = {
        nodeId: row.nodeId,
        fieldName: row.fieldName,
        fileName,
        mimeType: pending.mimeType || (row.fieldType === "IMAGE" ? "image/png" : "application/octet-stream"),
    };
    if (trimString(pending.uploadSessionId)) {
        return { ...base, uploadSessionId: trimString(pending.uploadSessionId) };
    }
    if (trimString(pending.base64)) {
        return { ...base, fileBase64: pending.base64 };
    }
    return null;
}

function emptyNodeInfo(row) {
    return { nodeId: row.nodeId, fieldName: row.fieldName, fieldValue: "" };
}

function readNumericLimit(fieldData, canonical) {
    const data = unwrapJsonText(fieldData);
    if (!isPlainRecord(data)) return undefined;
    const limits = {};
    copyNumericLimits(limits, data);
    if (limits[canonical] !== undefined) return limits[canonical];
    return undefined;
}

function clampNumericValueForRow(row, value) {
    if (!isRhNumericFieldTypeUpper(row?.fieldType)) return value;
    const text = trimString(value);
    if (!text) return value;
    let next = parseFiniteNumber(text);
    if (next === undefined) return value;
    if (/^(INT|INTEGER|LONG)$/.test(trimString(row.fieldType).toUpperCase())) next = Math.round(next);
    const min = readNumericLimit(row.fieldData, "min");
    const max = readNumericLimit(row.fieldData, "max");
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    return next;
}

export function buildRhRunPayload(rows, fieldValues, pendingUploads) {
    const nodeInfoList = [];
    const uploads = [];

    for (const row of Array.isArray(rows) ? rows : []) {
        if (!row) continue;
        const fieldType = trimString(row.fieldType).toUpperCase();

        if (isMediaFieldType(fieldType)) {
            const upload = uploadFromPending(row, pendingUploads || {});
            if (upload) {
                nodeInfoList.push(emptyNodeInfo(row));
                uploads.push(upload);
                continue;
            }
            const value = trimString(textValueForRow(row, fieldValues || {}));
            const canUseRemote = fieldType !== "IMAGE" && value && !value.startsWith("data:");
            nodeInfoList.push(canUseRemote ? { nodeId: row.nodeId, fieldName: row.fieldName, fieldValue: value } : emptyNodeInfo(row));
            continue;
        }

        const value = clampNumericValueForRow(row, textValueForRow(row, fieldValues || {}));
        const entry = {
            nodeId: row.nodeId,
            fieldName: row.fieldName,
            fieldValue: String(value ?? ""),
        };
        if (fieldType === "LIST" && row.fieldData !== undefined) {
            entry.fieldData = typeof row.fieldData === "string" ? row.fieldData : JSON.stringify(row.fieldData);
        }
        nodeInfoList.push(entry);
    }

    return { nodeInfoList, uploads };
}

function rowLabel(row) {
    return row?.nodeName || row?.fieldName || "media";
}

export function validateRhMediaReady(rows, fieldValues, pendingUploads, imageModes = {}) {
    const list = Array.isArray(rows) ? rows : [];
    for (const row of list) {
        const fieldType = trimString(row?.fieldType).toUpperCase();
        if (!row || !isMediaFieldType(fieldType)) continue;
        const key = rhInputRowKey(row.nodeId, row.fieldName);
        if (trimString(pendingUploads?.[key]?.base64) || trimString(pendingUploads?.[key]?.uploadSessionId)) continue;

        if (fieldType === "IMAGE") {
            continue;
        }

        const existing = trimString(textValueForRow(row, fieldValues || {}));
        if (existing && !existing.startsWith("data:")) continue;
        return { ok: false, message: `请先上传文件：${rowLabel(row)}（${row.fieldName}）` };
    }
    return { ok: true };
}

export function validateRhImageUploadPayloadReady(rows, pendingUploads) {
    const imageRows = (Array.isArray(rows) ? rows : []).filter((row) => row && row.fieldType === "IMAGE");
    for (let index = 0; index < imageRows.length; index += 1) {
        const row = imageRows[index];
        const key = rhInputRowKey(row.nodeId, row.fieldName);
        const pending = pendingUploads?.[key] || {};
        const fileName = trimString(pending.fileName);
        const hasPayload = !!trimString(pending.uploadSessionId) || !!trimString(pending.base64);
        if (index > 0 && !fileName && !hasPayload) continue;
        if (fileName && hasPayload) continue;
        return { ok: false, message: `图片上传数据不完整：${rowLabel(row)}（${row.fieldName}）` };
    }
    return { ok: true };
}

function uploadSourceMarker(upload) {
    const session = trimString(upload?.uploadSessionId);
    if (session) return `session:${session}`;
    const base64 = trimString(upload?.fileBase64);
    return base64 ? `base64:${base64.length}:${base64.slice(0, 32)}` : "";
}

export function validateRhImageSlotUploadMappings(rows, uploads) {
    const imageKeys = [];
    const imageKeySet = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
        if (!row || row.fieldType !== "IMAGE") continue;
        const key = rhInputRowKey(row.nodeId, row.fieldName);
        if (imageKeySet.has(key)) return { ok: false, message: `图像槽位重复：${key}` };
        imageKeySet.add(key);
        imageKeys.push(key);
    }

    const mainImageKey = imageKeys[0] || "";
    if (!mainImageKey) return { ok: true };
    if (!Array.isArray(uploads) || uploads.length === 0) return { ok: false, message: "图1缺少上传项" };

    const seenTargets = new Set();
    const seenSources = new Set();
    for (const upload of uploads) {
        if (!upload) continue;
        const target = rhInputRowKey(upload.nodeId, upload.fieldName);
        if (!imageKeySet.has(target)) continue;
        if (seenTargets.has(target)) return { ok: false, message: `图像槽位重复映射：${target}` };
        seenTargets.add(target);

        const source = uploadSourceMarker(upload);
        if (!source) return { ok: false, message: `图像槽位缺少上传数据：${target}` };
        if (seenSources.has(source)) return { ok: false, message: `检测到同一图像被复用到多个槽位：${target}` };
        seenSources.add(source);
    }

    if (!seenTargets.has(mainImageKey)) return { ok: false, message: `图1未绑定上传项：${mainImageKey}` };
    return { ok: true };
}
