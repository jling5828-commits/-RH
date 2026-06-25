const storage = require("uxp").storage;
const fs = storage.localFileSystem;

const HOST_SAFE_NAME_RE = /[/\\:*?"<>|\s]+/g;
const PRESET_NAME_MAX = 20;
const CHANNEL_NAME_MAX = 15;
const RH_APP_NAME_HEAD = 6;
const RESULT_FILE_TAG = "小梁RH";

function clippedSafeText(value, fallback, maxLen) {
    const raw = value == null ? "" : String(value).trim();
    if (!raw) return fallback;
    const cleaned = raw.replace(HOST_SAFE_NAME_RE, "_").trim();
    return (cleaned || fallback).slice(0, maxLen);
}

export function safeUploadFileName(name, fallback = "image.png") {
    const raw = String(name || fallback).trim();
    const cleaned = raw.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, "_").replace(/\s+/g, " ");
    return cleaned || fallback;
}

export function makeMultipartFile(bytes, mimeType, fileName) {
    const name = safeUploadFileName(fileName, "image.png");
    const type = String(mimeType || "application/octet-stream");
    try {
        if (typeof File === "function") {
            return { file: new File([bytes], name, { type }), name, isFile: true };
        }
    } catch (_) {
        // Blob fallback below.
    }
    return { file: new Blob([bytes], { type }), name, isFile: false };
}

export async function mapFolderEntriesWithMtime(entries) {
    return Promise.all(
        (Array.isArray(entries) ? entries : []).map(async (entry) => {
            const row = { name: entry.name, isFile: entry.isFile };
            if (!entry.isFile) return row;
            try {
                if (typeof entry.getMetadata !== "function") {
                    row.dateModifiedMs = 0;
                    return row;
                }
                const meta = await entry.getMetadata();
                const modified = meta && meta.dateModified;
                row.dateModifiedMs =
                    modified instanceof Date
                        ? modified.getTime()
                        : typeof modified === "number" && !Number.isNaN(modified)
                          ? modified
                          : 0;
            } catch (_) {
                row.dateModifiedMs = 0;
            }
            return row;
        })
    );
}

export async function resolveFolder(token) {
    try {
        return await fs.getEntryForPersistentToken(token);
    } catch (_) {
        return fs.getEntryForSessionToken(token);
    }
}

function channelPart(channel) {
    const raw = channel == null ? "" : String(channel).trim();
    if (!raw) return "-";
    try {
        if (/^https?:\/\//i.test(raw)) {
            const url = new URL(raw);
            const host = String(url.hostname || "").replace(/^www\./i, "").replace(/\./g, "-").slice(0, CHANNEL_NAME_MAX);
            return host || "api";
        }
    } catch (_) {
        // Use plain sanitizing below.
    }
    return raw.replace(HOST_SAFE_NAME_RE, "_").slice(0, CHANNEL_NAME_MAX) || "-";
}

function appNameHead(appName) {
    const raw = appName == null ? "" : String(appName).trim();
    if (!raw || raw === "-") return RESULT_FILE_TAG;
    return clippedSafeText(raw, RESULT_FILE_TAG, RH_APP_NAME_HEAD);
}

function fileNameSuffixPart(value) {
    const text = String(value || "").trim().replace(HOST_SAFE_NAME_RE, "_").replace(/[^a-zA-Z0-9_-]+/g, "_");
    return text ? `_${text.slice(0, 64)}` : "";
}

export function buildSavedImageFileName(ts, index, ext, options = {}) {
    const safeExt = String(ext || "png").replace(/^[.]+/, "") || "png";
    const suffix = `${ts}_${index}${fileNameSuffixPart(options.fileNameSuffix)}.${safeExt}`;
    if (options.runningHubAppName != null) {
        return `${appNameHead(options.runningHubAppName)}_${RESULT_FILE_TAG}_${suffix}`;
    }
    const hasParts = [options.presetName, options.channel, options.size].some((value) => value != null && String(value).trim() !== "");
    if (!hasParts) return `${RESULT_FILE_TAG}_${suffix}`;
    const preset = clippedSafeText(options.presetName, "自定义", PRESET_NAME_MAX);
    const channel = channelPart(options.channel);
    const size = clippedSafeText(options.size, "-", 8);
    return `${preset}_${channel}_${size}_${RESULT_FILE_TAG}_${suffix}`;
}

export function inferExtFromUrl(url) {
    const clean = String(url || "").split("?")[0].toLowerCase();
    if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "jpg";
    if (clean.endsWith(".webp")) return "webp";
    return "png";
}

export function inferExtFromContentType(contentType, fallbackExt) {
    const type = String(contentType || "").toLowerCase();
    if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
    if (type.includes("webp")) return "webp";
    if (type.includes("png")) return "png";
    return fallbackExt || "png";
}
