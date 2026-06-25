import { readCompatLocalStorage, writeCompatLocalStorage } from "./storageKeyCompat.js";

const STORAGE_KEY = "xlrh_upload_image_config";
const JPEG_DEFAULT_QUALITY = 85;
const PNG_DEFAULT_COMPRESSION = 6;

export const FORMAT_OPTIONS = Object.freeze([
    Object.freeze({ id: "png", label: "PNG", desc: "无损，适合透明、线稿" }),
    Object.freeze({ id: "jpeg", label: "JPEG", desc: "有损压缩，体积更小" }),
]);

export const UPLOAD_CONFIG_DEFAULTS = Object.freeze({
    format: "png",
    jpegQuality: JPEG_DEFAULT_QUALITY,
    pngCompression: PNG_DEFAULT_COMPRESSION,
});

const FORMAT_IDS = new Set(FORMAT_OPTIONS.map((item) => item.id));

function safeJsonParse(raw) {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (error) {
        console.warn("[uploadImageConfig] 解析失败:", error);
        return null;
    }
}

function toPlainObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeFormat(value) {
    const format = String(value || "").trim().toLowerCase();
    return FORMAT_IDS.has(format) ? format : UPLOAD_CONFIG_DEFAULTS.format;
}

function normalizeInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeUploadImageConfig(value) {
    const raw = toPlainObject(value);
    return {
        format: normalizeFormat(raw.format),
        jpegQuality: normalizeInteger(raw.jpegQuality, UPLOAD_CONFIG_DEFAULTS.jpegQuality),
        pngCompression: normalizeInteger(raw.pngCompression, UPLOAD_CONFIG_DEFAULTS.pngCompression),
    };
}

export function getLongEdgeForTaskSize(size) {
    return Infinity;
}

export function getUploadImageConfig() {
    const stored = safeJsonParse(readCompatLocalStorage(STORAGE_KEY));
    return normalizeUploadImageConfig(stored || UPLOAD_CONFIG_DEFAULTS);
}

export const loadUploadImageConfig = getUploadImageConfig;

export function setUploadImageConfig(config) {
    const next = normalizeUploadImageConfig(config);
    writeCompatLocalStorage(STORAGE_KEY, JSON.stringify(next));
}

export const saveUploadImageConfig = setUploadImageConfig;

export function calcTargetSizeByConfig(width, height) {
    return null;
}

export function getMaxSizeForCapture() {
    return Infinity;
}

export function getEffectiveMaxSize(width, height) {
    return Infinity;
}
