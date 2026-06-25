import { Jimp, JimpMime } from "jimp";
import { LAUNCHER_BG_MAX_DATA_URL_LENGTH } from "./appearanceDefaults.js";

const JPEG_MIME = JimpMime.jpeg;
const PNG_MIME = JimpMime.png;
const BASE64_CHUNK = 32768;
const DEFAULT_PREVIEW_EDGE = 256;

function clampInt(value, fallback, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
}

function rgbaBytes(rgbaData) {
    return rgbaData instanceof Uint8Array ? rgbaData : new Uint8Array(rgbaData || []);
}

function makeJimpImage(rgbaData, width, height) {
    return new Jimp({
        data: rgbaBytes(rgbaData),
        width: Math.max(1, Math.round(Number(width) || 1)),
        height: Math.max(1, Math.round(Number(height) || 1)),
    });
}

function resizeToLongEdge(image, maxEdge) {
    const edge = clampInt(maxEdge, Infinity, 1, 16384);
    if (!Number.isFinite(edge)) return image;
    const { width, height } = image.bitmap;
    if (width <= edge && height <= edge) return image;
    const ratio = Math.min(edge / width, edge / height);
    image.resize({
        w: Math.max(1, Math.round(width * ratio)),
        h: Math.max(1, Math.round(height * ratio)),
    });
    return image;
}

function exactBytes(bufferLike) {
    return bufferLike instanceof Uint8Array ? bufferLike : new Uint8Array(bufferLike);
}

async function encodeRgba(rgbaData, width, height, mimeType, options = {}) {
    const image = makeJimpImage(rgbaData, width, height);
    const buffer = await image.getBuffer(mimeType, options);
    return exactBytes(buffer);
}

export async function rgbaToJPEGBuffer(rgbaData, width, height, quality = 85) {
    return encodeRgba(rgbaData, width, height, JPEG_MIME, {
        quality: clampInt(quality, 85, 1, 100),
    });
}

export async function rgbaToPNGBuffer(rgbaData, width, height, compressionLevel = 6) {
    return encodeRgba(rgbaData, width, height, PNG_MIME, {
        compressionLevel: clampInt(compressionLevel, 6, 0, 9),
    });
}

export function bufferToBase64DataUrl(uint8Array, mimeType = "image/jpeg") {
    const bytes = exactBytes(uint8Array);
    const pieces = [];
    for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
        pieces.push(String.fromCharCode.apply(null, bytes.subarray(offset, offset + BASE64_CHUNK)));
    }
    return `data:${mimeType};base64,${btoa(pieces.join(""))}`;
}

export async function rgbaToBase64JPEG(rgbaData, width, height, quality = 85) {
    return bufferToBase64DataUrl(await rgbaToJPEGBuffer(rgbaData, width, height, quality), "image/jpeg");
}

export async function rgbaToBase64PNG(rgbaData, width, height) {
    return bufferToBase64DataUrl(await rgbaToPNGBuffer(rgbaData, width, height), "image/png");
}

async function rgbaToPreviewDataUrl(rgbaData, width, height, maxSize, mimeType, options) {
    const image = makeJimpImage(rgbaData, width, height);
    resizeToLongEdge(image, maxSize || DEFAULT_PREVIEW_EDGE);
    const buffer = await image.getBuffer(mimeType, options);
    return bufferToBase64DataUrl(exactBytes(buffer), mimeType === JPEG_MIME ? "image/jpeg" : "image/png");
}

export async function rgbaToPreviewBase64(rgbaData, width, height, maxSize = DEFAULT_PREVIEW_EDGE) {
    return rgbaToPreviewDataUrl(rgbaData, width, height, maxSize, JPEG_MIME, { quality: 70 });
}

export async function rgbaToPreviewPNGBase64(rgbaData, width, height, maxSize = DEFAULT_PREVIEW_EDGE) {
    return rgbaToPreviewDataUrl(rgbaData, width, height, maxSize, PNG_MIME, { compressionLevel: 6 });
}

export async function scaleDataUrlToMaxSizePNG(dataUrl, maxSize = Infinity) {
    return dataUrl;
}

export const scaleDataUrlToMaxSize = scaleDataUrlToMaxSizePNG;

export async function compressDataUrlForUpload(dataUrl, maxSize = 2048) {
    return scaleDataUrlToConfig(dataUrl, maxSize);
}

export async function scaleDataUrlToConfig(dataUrl) {
    return dataUrl;
}

function bytesFromDataUrl(dataUrl) {
    const match = String(dataUrl || "").match(/^data:image\/[^;]+;base64,(.+)$/);
    if (!match) return null;
    const binary = atob(match[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function arrayBufferFromBytes(bytes) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export async function readAlignedGrayFromMaskPngDataUrl(maskDataUrl, targetW, targetH) {
    const bytes = bytesFromDataUrl(maskDataUrl);
    if (!bytes) return null;
    const width = Math.max(1, Math.round(Number(targetW) || 1));
    const height = Math.max(1, Math.round(Number(targetH) || 1));
    try {
        const image = await Jimp.read(arrayBufferFromBytes(bytes));
        if (image.bitmap.width !== width || image.bitmap.height !== height) image.resize({ w: width, h: height });
        const data = image.bitmap.data;
        const gray = new Uint8Array(width * height);
        let maskMin = 255;
        let maskMax = 0;
        for (let i = 0; i < gray.length; i++) {
            const value = data[i * 4];
            gray[i] = value;
            if (value < maskMin) maskMin = value;
            if (value > maskMax) maskMax = value;
        }
        return { gray, maskMin, maskMax };
    } catch (e) {
        console.warn("[XiaoLiangRH] mask decode failed", e?.message || e);
        return null;
    }
}

function escapeSvgText(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .slice(0, 80);
}

export async function encodeLauncherBackgroundFromBytes(bytes, opts = {}) {
    const input = exactBytes(bytes || []);
    if (input.length === 0) throw new Error("图片数据为空");

    const maxLength = opts.maxDataUrlLength ?? LAUNCHER_BG_MAX_DATA_URL_LENGTH;
    const edges = opts.longEdges ?? [2560, 1920, 1600, 1280, 1024, 768];
    const qualities = opts.jpegQualities ?? [82, 76, 70, 64, 58, 52, 48];
    const image = await Jimp.read(arrayBufferFromBytes(input));
    let lastSize = "";

    for (const edge of edges) {
        resizeToLongEdge(image, edge);
        const sizeKey = `${image.bitmap.width}x${image.bitmap.height}`;
        if (sizeKey === lastSize) continue;
        lastSize = sizeKey;
        for (const quality of qualities) {
            const buffer = await image.getBuffer(JPEG_MIME, { quality: clampInt(quality, 70, 1, 100) });
            const dataUrl = bufferToBase64DataUrl(exactBytes(buffer), "image/jpeg");
            if (dataUrl.length <= maxLength) return dataUrl;
        }
    }

    throw new Error("无法把背景图压缩到可保存大小，请换一张图片重试");
}

export function makeFileSessionPlaceholderDataUrl(width, height, fileName = "") {
    const w = clampInt(width, 512, 1, 8192);
    const h = clampInt(height, 512, 1, 8192);
    const name = escapeSvgText(fileName);
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
  <rect width="320" height="240" rx="10" fill="#1e1e24"/>
  <text x="160" y="96" fill="#a8a8b8" font-size="13" text-anchor="middle" font-family="system-ui,sans-serif">已从本地文件加载</text>
  <text x="160" y="126" fill="#6ec9c0" font-size="12" text-anchor="middle" font-family="system-ui,sans-serif">${w} x ${h}</text>
  ${name ? `<text x="160" y="156" fill="#8888a0" font-size="11" text-anchor="middle" font-family="system-ui,sans-serif">${name}</text>` : ""}
</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
