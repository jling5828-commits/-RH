import { action, imaging, app, core } from "photoshop";
import { photoshop, isInWebView, xiaoliangRhPickImageFileToUploadSession } from "../../bridge/uxpBridge.js";
import { isXiaoLiangRhHostCaptureEnabled } from "../../config/xiaoliangRhHostCapture.js";
import {
    rgbaToJPEGBuffer,
    rgbaToPNGBuffer,
    rgbaToPreviewBase64,
    rgbaToPreviewPNGBase64,
    bufferToBase64DataUrl,
} from "../../utils/imageEncoder.js";
import { PREVIEW_MAX_SIZE, PREVIEW_CAPTURE_MAX_SIZE } from "./constants";

const SRGB_PROFILE = "sRGB IEC61966-2.1";
const DEFAULT_UPLOAD_EDGE = 2048;
const DEFAULT_JPEG_QUALITY = 85;
const PNG_COMPRESSION = 6;

function clockNow() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
}

function numberFromPsValue(value) {
    if (value == null) return NaN;
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    if (typeof value === "object" && value && "_value" in value) return Number(value._value);
    return Number(value);
}

function normalizeEdge(value, fallback = DEFAULT_UPLOAD_EDGE) {
    if (value === 0 || value === "0" || value === false || value === "original") return 0;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.max(1, Math.min(8192, Math.round(n)));
}

function safeBounds(raw) {
    if (!raw || typeof raw !== "object") return null;
    const left = Math.floor(numberFromPsValue(raw.left));
    const top = Math.floor(numberFromPsValue(raw.top));
    const right = Math.ceil(numberFromPsValue(raw.right));
    const bottom = Math.ceil(numberFromPsValue(raw.bottom));
    return Number.isFinite(left) && Number.isFinite(top) && Number.isFinite(right) && Number.isFinite(bottom) && right > left && bottom > top
        ? { left, top, right, bottom }
        : null;
}

function documentSize(doc) {
    return {
        width: Math.max(1, Math.round(numberFromPsValue(doc?.width) || 0)),
        height: Math.max(1, Math.round(numberFromPsValue(doc?.height) || 0)),
    };
}

export const clampBoundsToDocument = (bounds, doc) => {
    const { width, height } = documentSize(doc);
    const b = safeBounds(bounds) || { left: 0, top: 0, right: width, bottom: height };
    const left = Math.max(0, Math.min(b.left, width - 1));
    const top = Math.max(0, Math.min(b.top, height - 1));
    return {
        left,
        top,
        right: Math.max(left + 1, Math.min(b.right, width)),
        bottom: Math.max(top + 1, Math.min(b.bottom, height)),
    };
};

function layerBounds(layer, doc) {
    const full = (() => {
        const { width, height } = documentSize(doc);
        return { left: 0, top: 0, right: width, bottom: height };
    })();
    return safeBounds(layer?.bounds) || full;
}

function clampBoundsToLayer(bounds, layer, doc) {
    const layerBox = clampBoundsToDocument(layerBounds(layer, doc), doc);
    const left = Math.max(bounds.left, layerBox.left);
    const top = Math.max(bounds.top, layerBox.top);
    const right = Math.min(bounds.right, layerBox.right);
    const bottom = Math.min(bounds.bottom, layerBox.bottom);
    return right > left && bottom > top ? { left, top, right, bottom } : layerBox;
}

function boundsSize(bounds) {
    return {
        width: Math.max(1, Math.round(bounds.right - bounds.left)),
        height: Math.max(1, Math.round(bounds.bottom - bounds.top)),
    };
}

function scaleToLongEdge(width, height, maxEdge) {
    const edge = normalizeEdge(maxEdge, DEFAULT_UPLOAD_EDGE);
    if (!edge || (width <= edge && height <= edge)) return undefined;
    const ratio = Math.min(edge / width, edge / height);
    return {
        width: Math.max(1, Math.round(width * ratio)),
        height: Math.max(1, Math.round(height * ratio)),
    };
}

function scaleToPixelBudget(width, height, preset) {
    const budgets = { "1M": 1048576, "4M": 4194304, "16M": 16777216 };
    const maxPixels = budgets[preset] || budgets["1M"];
    const pixels = width * height;
    if (pixels <= maxPixels) return undefined;
    const ratio = Math.sqrt(maxPixels / pixels);
    return {
        width: Math.max(1, Math.round(width * ratio)),
        height: Math.max(1, Math.round(height * ratio)),
    };
}

function resolveTargetSize(bounds, request) {
    const { width, height } = boundsSize(bounds);
    if (typeof request === "number") return scaleToLongEdge(width, height, request);
    if (!request || typeof request !== "object") return undefined;
    if (request.forceNoTargetSize) return undefined;
    if (request._legacyMaxSize != null) return scaleToLongEdge(width, height, request._legacyMaxSize);
    if (request.sizeLimitMode === "pixelCount") return scaleToPixelBudget(width, height, request.pixelCountPreset);
    return scaleToLongEdge(width, height, request.longEdgeMax ?? DEFAULT_UPLOAD_EDGE);
}

export const getSelectionBounds = () => {
    const doc = app.activeDocument;
    if (!doc) throw new Error("[NO_DOC]请先打开一个文档");
    const fromSelection = safeBounds(doc.selection?.bounds);
    if (fromSelection) return fromSelection;
    const { width, height } = documentSize(doc);
    return { left: 0, top: 0, right: width, bottom: height };
};

export const resolveCaptureBounds = (doc, mode) => {
    if (!doc) throw new Error("[NO_DOC]请先打开一个文档");
    let bounds = clampBoundsToDocument(getSelectionBounds(), doc);
    let layerID = null;
    if (mode === "layer") {
        const layer = doc.activeLayers?.[0];
        if (!layer) throw new Error("请先选中一个图层");
        layerID = layer.id;
        bounds = clampBoundsToLayer(bounds, layer, doc);
    }
    const { width, height } = boundsSize(bounds);
    if (width <= 0 || height <= 0) throw new Error("选区尺寸无效");
    return { bounds, layerID, origWidth: width, origHeight: height };
};

export function computeRhPlaceContextBoundsSync(mode) {
    const doc = app.activeDocument;
    if (!doc) return null;
    try {
        const { bounds } = resolveCaptureBounds(doc, mode);
        return { docId: doc.id, bounds };
    } catch (_) {
        return null;
    }
}

export async function getActiveSelectionCaptureInfo(mode = "canvas") {
    if (isInWebView() && photoshop.commands?.getActiveSelectionBounds) {
        const info = await photoshop.commands.getActiveSelectionBounds(mode);
        if (!info?.bounds) return null;
        const width = Math.max(1, Math.round(Number(info.width) || Number(info.bounds.right) - Number(info.bounds.left)));
        const height = Math.max(1, Math.round(Number(info.height) || Number(info.bounds.bottom) - Number(info.bounds.top)));
        return width > 0 && height > 0 ? { ...info, width, height } : null;
    }

    const doc = app.activeDocument;
    if (!doc) return null;
    if (!safeBounds(doc.selection?.bounds)) return null;
    const { bounds, layerID } = resolveCaptureBounds(doc, mode);
    const { width, height } = boundsSize(bounds);
    return { docId: doc.id, bounds, layerID, width, height };
}

export async function clearActiveSelection() {
    if (isInWebView() && photoshop.commands?.clearActiveSelection) {
        await photoshop.commands.clearActiveSelection();
        return;
    }
    await core.executeAsModal(
        async () => {
            await action.batchPlay(
                [
                    {
                        _obj: "set",
                        _target: [{ _ref: "channel", _property: "selection" }],
                        to: { _enum: "ordinal", _value: "none" },
                    },
                ],
                { synchronousExecution: true }
            );
        },
        { commandName: "小梁RH清除选区" }
    );
}

export const restoreSelection = async (bounds) => {
    const b = safeBounds(bounds);
    if (!b) return;
    try {
        await action.batchPlay(
            [
                {
                    _obj: "set",
                    _target: [{ _ref: "channel", _property: "selection" }],
                    to: {
                        _obj: "rectangle",
                        top: { _unit: "pixelsUnit", _value: b.top },
                        left: { _unit: "pixelsUnit", _value: b.left },
                        bottom: { _unit: "pixelsUnit", _value: b.bottom },
                        right: { _unit: "pixelsUnit", _value: b.right },
                    },
                },
            ],
            { synchronousExecution: true }
        );
    } catch (e) {
        console.warn("[XiaoLiangRH] restore selection failed", e);
    }
};

export async function applyTaskPlaceContextBeforeCapture(placeContext) {
    const rawDocId = placeContext?.docId;
    const docId = rawDocId != null && rawDocId !== "" ? Number(rawDocId) : NaN;
    const bounds = safeBounds(placeContext?.bounds);
    const hasDoc = Number.isFinite(docId);
    if (!hasDoc && !bounds) return;

    const payload = { docId: hasDoc ? docId : null, bounds };
    if (isInWebView()) {
        await photoshop.commands.applyTaskPlaceContext(payload);
        return;
    }

    await core.executeAsModal(
        async () => {
            if (hasDoc) {
                let found = false;
                const count = app.documents?.length ?? 0;
                for (let i = 0; i < count; i++) {
                    if (app.documents[i]?.id === docId) {
                        found = true;
                        break;
                    }
                }
                if (!found) throw new Error(`文档已关闭或不存在（id=${docId}）`);
                await action.batchPlay(
                    [{ _obj: "select", null: { _ref: [{ _ref: "document", _id: docId }] } }],
                    { synchronousExecution: true }
                );
            }
            if (bounds) await restoreSelection(bounds);
        },
        { commandName: "小梁RH还原任务选区" }
    );
}

function assertRgbReadable(doc) {
    let mode = "";
    try {
        mode = String(doc.mode || "").toLowerCase();
    } catch (_) {}
    if (mode.includes("cmyk") || mode.includes("bitmap") || mode.includes("indexed") || mode.includes("multichannel")) {
        throw new Error("[UNSUPPORTED_MODE]当前文档色彩模式不支持，请先转换为 RGB");
    }
}

async function documentBitDepth(doc) {
    try {
        if (typeof doc.bitsPerChannel === "number" && doc.bitsPerChannel > 0) return doc.bitsPerChannel;
        const data = await action.batchPlay(
            [{ _obj: "get", _target: [{ _property: "depth" }, { _ref: "document", _enum: "ordinal", _value: "targetEnum" }] }],
            {}
        );
        return Number(data?.[0]?.depth) || 8;
    } catch (_) {
        return 8;
    }
}

function disposeImageDataLater(imageData) {
    Promise.resolve().then(() => {
        try {
            imageData?.dispose?.();
        } catch (_) {}
    });
}

async function pullImageData(imageData) {
    if (typeof imageData?.getData === "function") return imageData.getData({});
    if (imageData?.data && imageData.data.length > 0) return imageData.data;
    if (imageData?.buffer) return new Uint8Array(imageData.buffer);
    throw new Error("无法获取像素数据");
}

function samplesToUint8(source, expectedLength) {
    if (source instanceof Uint8Array) {
        return source.length > expectedLength ? source.subarray(0, expectedLength) : source;
    }
    const out = new Uint8Array(expectedLength);
    if (source instanceof Uint16Array) {
        let max = 0;
        for (let i = 0; i < Math.min(source.length, 4096); i++) max = Math.max(max, source[i]);
        const psRange = max > 0 && max <= 32769;
        for (let i = 0; i < expectedLength && i < source.length; i++) {
            out[i] = psRange ? Math.min(255, Math.round((source[i] * 255) / 32768)) : Math.min(255, (source[i] + 128) >> 8);
        }
        return out;
    }
    if (source instanceof Float32Array || source instanceof Float64Array) {
        for (let i = 0; i < expectedLength && i < source.length; i++) {
            out[i] = Math.round(Math.max(0, Math.min(1, source[i])) * 255);
        }
        return out;
    }
    const bytes = new Uint8Array(source?.buffer || source || []);
    return bytes.length > expectedLength ? bytes.subarray(0, expectedLength) : bytes;
}

function convertToRgba(samples, width, height, components) {
    const pixelCount = width * height;
    if (components === 4) return samples;
    const rgba = new Uint8Array(pixelCount * 4);
    if (components === 3) {
        for (let i = 0, j = 0; i < pixelCount; i++, j += 3) {
            const k = i * 4;
            rgba[k] = samples[j];
            rgba[k + 1] = samples[j + 1];
            rgba[k + 2] = samples[j + 2];
            rgba[k + 3] = 255;
        }
        return rgba;
    }
    if (components === 1) {
        for (let i = 0; i < pixelCount; i++) {
            const v = samples[i];
            const k = i * 4;
            rgba[k] = v;
            rgba[k + 1] = v;
            rgba[k + 2] = v;
            rgba[k + 3] = 255;
        }
        return rgba;
    }
    throw new Error(`不支持的通道数：${components}`);
}

async function readMaskImage(doc, layerID, bounds, targetSize) {
    if (layerID == null) return null;
    try {
        const result = await imaging.getLayerMask({
            documentID: doc.id,
            layerID,
            sourceBounds: bounds,
            targetSize: targetSize || undefined,
        });
        const imageData = result?.imageData;
        if (!imageData) return null;
        const width = imageData.width;
        const height = imageData.height;
        const components = Math.max(1, Number(imageData.components) || 1);
        const raw = await pullImageData(imageData);
        const samples = samplesToUint8(raw, width * height * components);
        disposeImageDataLater(imageData);
        return { samples, width, height, components };
    } catch (e) {
        console.warn("[XiaoLiangRH] read layer mask failed", e?.message || e);
        return null;
    }
}

function resizeGrayNearest(gray, fromW, fromH, toW, toH) {
    if (fromW === toW && fromH === toH) return gray;
    const out = new Uint8Array(toW * toH);
    for (let y = 0; y < toH; y++) {
        const sy = Math.min(fromH - 1, Math.floor(((y + 0.5) * fromH) / toH));
        for (let x = 0; x < toW; x++) {
            const sx = Math.min(fromW - 1, Math.floor(((x + 0.5) * fromW) / toW));
            out[y * toW + x] = gray[sy * fromW + sx];
        }
    }
    return out;
}

function grayFromMask(mask, targetW, targetH) {
    if (!mask?.samples) return null;
    const source = new Uint8Array(mask.width * mask.height);
    for (let i = 0; i < source.length; i++) source[i] = mask.samples[i * mask.components];
    const gray = resizeGrayNearest(source, mask.width, mask.height, targetW, targetH);
    let maskMin = 255;
    let maskMax = 0;
    for (const v of gray) {
        if (v < maskMin) maskMin = v;
        if (v > maskMax) maskMax = v;
    }
    return { gray, maskMin, maskMax };
}

function setOpaqueAlpha(rgbaData) {
    for (let i = 3; i < rgbaData.length; i += 4) rgbaData[i] = 255;
}

function copyGrayToAlpha(rgbaData, gray) {
    const pixels = Math.min(gray.length, Math.floor(rgbaData.length / 4));
    for (let i = 0; i < pixels; i++) rgbaData[i * 4 + 3] = gray[i];
}

function multiplyAlphaByGray(rgbaData, gray) {
    const pixels = Math.min(gray.length, Math.floor(rgbaData.length / 4));
    for (let i = 0; i < pixels; i++) {
        rgbaData[i * 4 + 3] = Math.round((rgbaData[i * 4 + 3] * gray[i]) / 255);
    }
}

function flattenAlphaToWhite(rgbaData) {
    let hasTransparency = false;
    for (let i = 3; i < rgbaData.length; i += 4) {
        if (rgbaData[i] !== 255) {
            hasTransparency = true;
            break;
        }
    }
    if (!hasTransparency) return rgbaData;
    const out = new Uint8Array(rgbaData.length);
    for (let i = 0; i < rgbaData.length; i += 4) {
        const a = rgbaData[i + 3];
        const inv = 255 - a;
        out[i] = a >= 255 ? rgbaData[i] : Math.round((rgbaData[i] * a + 255 * inv) / 255);
        out[i + 1] = a >= 255 ? rgbaData[i + 1] : Math.round((rgbaData[i + 1] * a + 255 * inv) / 255);
        out[i + 2] = a >= 255 ? rgbaData[i + 2] : Math.round((rgbaData[i + 2] * a + 255 * inv) / 255);
        out[i + 3] = 255;
    }
    return out;
}

async function readPixelsFromPS(doc, bounds, mode, layerID, sizeRequest, flags = {}) {
    assertRgbReadable(doc);
    const targetSize = flags.forceNoTargetSize ? undefined : resolveTargetSize(bounds, sizeRequest);
    const bitDepth = await documentBitDepth(doc);
    const options = {
        documentID: doc.id,
        sourceBounds: bounds,
        targetSize: targetSize || undefined,
        componentSize: 8,
        colorSpace: "RGB",
        applyAlpha: true,
        hasAlpha: true,
    };
    if (mode === "layer" && layerID != null) options.layerID = Number(layerID);
    try {
        if (doc.colorProfileName && doc.colorProfileName !== SRGB_PROFILE) options.colorProfile = SRGB_PROFILE;
    } catch (_) {}

    let result;
    try {
        result = await imaging.getPixels(options);
    } catch (e) {
        if (bitDepth === 16 || bitDepth === 32) {
            delete options.componentSize;
            result = await imaging.getPixels(options);
        } else {
            throw e;
        }
    }

    const imageData = result?.imageData;
    if (!imageData) throw new Error("无法读取图像像素");
    const width = imageData.width;
    const height = imageData.height;
    const components = Number(imageData.components) || 4;
    const raw = await pullImageData(imageData);
    if (!raw || raw.length === 0) throw new Error("像素数据为空");
    const samples = samplesToUint8(raw, width * height * components);
    const rgbaData = convertToRgba(samples, width, height, components);
    disposeImageDataLater(imageData);

    if (mode === "layer" && layerID != null && !flags.skipLayerMaskComposite) {
        const mask = await readMaskImage(doc, layerID, bounds, targetSize);
        const gray = grayFromMask(mask, width, height);
        if (gray?.gray) multiplyAlphaByGray(rgbaData, gray.gray);
    }

    return { rgbaData, width, height, targetSize };
}

async function maskForUpload(doc, layerID, bounds, width, height, targetSize) {
    const mask = await readMaskImage(doc, layerID, bounds, targetSize || { width, height });
    const gray = grayFromMask(mask, width, height);
    if (gray?.gray) return gray;
    const white = new Uint8Array(width * height);
    white.fill(255);
    return { gray: white, maskMin: 255, maskMax: 255 };
}

async function grayMaskDataUrl(gray, width, height) {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        const v = gray[i];
        const k = i * 4;
        rgba[k] = v;
        rgba[k + 1] = v;
        rgba[k + 2] = v;
        rgba[k + 3] = 255;
    }
    const png = await rgbaToPNGBuffer(rgba, width, height, PNG_COMPRESSION);
    return bufferToBase64DataUrl(png, "image/png");
}

async function previewFromRgba(mode, rgbaData, width, height, maxEdge) {
    return mode === "layer"
        ? rgbaToPreviewPNGBase64(rgbaData, width, height, maxEdge)
        : rgbaToPreviewBase64(rgbaData, width, height, maxEdge);
}

function base64ToUint8(base64) {
    const binary = atob(String(base64 || ""));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}

function decodeHostRgba(data) {
    if (!data?.rgbaBase64) throw new Error("获取图像失败");
    return {
        rgbaData: base64ToUint8(data.rgbaBase64),
        width: Number(data.width) || 0,
        height: Number(data.height) || 0,
        bounds: data.bounds ?? null,
        maskUploadBase64: data.maskUploadBase64 != null ? String(data.maskUploadBase64) : null,
        maskMin: Number(data.maskMin ?? -1),
        maskMax: Number(data.maskMax ?? -1),
    };
}

function profileRecorder(enabled) {
    const start = enabled ? clockNow() : 0;
    const phases = enabled ? [] : null;
    return {
        phases,
        async measure(id, label, work) {
            const t = enabled ? clockNow() : 0;
            const value = await work();
            if (enabled) phases.push({ id, label, ms: Math.round(clockNow() - t) });
            return value;
        },
        result() {
            return enabled ? { phases, totalMs: Math.round(clockNow() - start) } : null;
        },
    };
}

export const captureForPreview = async (mode = "canvas", opts = {}) => {
    const splitMaskMode = Boolean(opts.splitMaskMode);
    const readFlags = { skipLayerMaskComposite: splitMaskMode && mode === "layer" };

    if (isInWebView() && photoshop.captureSelection) {
        const request = splitMaskMode
            ? { _legacyMaxSize: PREVIEW_CAPTURE_MAX_SIZE, splitMaskMode: true }
            : { _legacyMaxSize: PREVIEW_CAPTURE_MAX_SIZE };
        const data = await photoshop.captureSelection(mode, request);
        const pixels = decodeHostRgba(data);
        if (splitMaskMode && mode === "layer") setOpaqueAlpha(pixels.rgbaData);
        const previewBase64 = await previewFromRgba(mode, pixels.rgbaData, pixels.width, pixels.height, PREVIEW_MAX_SIZE);
        const opaque = data?.previewOpaqueBase64 != null ? String(data.previewOpaqueBase64).trim() : "";
        return {
            previewBase64,
            bounds: pixels.bounds,
            previewWidth: pixels.width,
            previewHeight: pixels.height,
            ...(opaque ? { previewOpaqueBase64: opaque } : {}),
        };
    }

    const doc = app.activeDocument;
    if (!doc) throw new Error("[NO_DOC]请先打开一个文档");
    const { bounds, layerID } = resolveCaptureBounds(doc, mode);
    const pixels = await readPixelsFromPS(doc, bounds, mode, layerID, { _legacyMaxSize: PREVIEW_CAPTURE_MAX_SIZE }, readFlags);
    if (splitMaskMode && mode === "layer") setOpaqueAlpha(pixels.rgbaData);
    const previewBase64 = await previewFromRgba(mode, pixels.rgbaData, pixels.width, pixels.height, PREVIEW_MAX_SIZE);
    return { previewBase64, bounds, previewWidth: pixels.width, previewHeight: pixels.height };
};

async function notifyPreview(onPreviewReady, payload) {
    if (typeof onPreviewReady === "function") await Promise.resolve(onPreviewReady(payload));
}

function exactArrayBuffer(bytes) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export const captureAll = async (mode = "canvas", opts = {}) => {
    const longEdgeMax = opts.longEdgeMax ?? DEFAULT_UPLOAD_EDGE;
    const previewReadCap = Number(opts.previewReadCap) > 0 ? Number(opts.previewReadCap) : PREVIEW_CAPTURE_MAX_SIZE;
    const previewEncodeMax = Number(opts.previewEncodeMax) > 0 ? Number(opts.previewEncodeMax) : PREVIEW_MAX_SIZE;
    const splitMaskMode = Boolean(opts.splitMaskMode);
    const jpegQuality = Number(opts.jpegQuality) >= 1 && Number(opts.jpegQuality) <= 100 ? Number(opts.jpegQuality) : DEFAULT_JPEG_QUALITY;
    const profiler = profileRecorder(opts.captureProfile === true);
    const onPreviewReady = typeof opts.onPreviewReady === "function" ? opts.onPreviewReady : null;
    let uploadEncodeFormat = opts.uploadEncodeFormat === "jpeg" ? "jpeg" : "png";
    if (splitMaskMode && mode === "layer") uploadEncodeFormat = "png";

    if (isInWebView() && photoshop.captureSelection) {
        const previewRequest = splitMaskMode
            ? { _legacyMaxSize: previewReadCap, splitMaskMode: true }
            : { _legacyMaxSize: previewReadCap };
        const previewData = await profiler.measure("host_preview_capture", "preview capture in host", () => photoshop.captureSelection(mode, previewRequest));
        const previewPixels = decodeHostRgba(previewData);
        if (splitMaskMode && mode === "layer") setOpaqueAlpha(previewPixels.rgbaData);
        const previewBase64 = await profiler.measure("preview_encode", "encode preview", () =>
            previewFromRgba(mode, previewPixels.rgbaData, previewPixels.width, previewPixels.height, previewEncodeMax)
        );
        await notifyPreview(onPreviewReady, {
            previewBase64,
            uploadWidth: previewPixels.width,
            uploadHeight: previewPixels.height,
            bounds: previewPixels.bounds,
        });
        previewPixels.rgbaData = null;

        const fullRequest = {
            sizeLimitMode: "longEdge",
            longEdgeMax,
            splitMaskMode,
            __returnHostSession: true,
            uploadEncodeFormat,
            jpegQuality,
            __retainUploadSession: Boolean(opts.__retainUploadSession),
        };
        const hostUpload = await profiler.measure("host_upload_session", "host upload session", () => photoshop.captureSelection(mode, fullRequest));
        if (!hostUpload?.uploadSessionId) throw new Error("宿主未返回 uploadSessionId");
        const profile = profiler.result();
        return {
            previewBase64,
            uploadSessionId: hostUpload.uploadSessionId,
            uploadWidth: hostUpload.uploadWidth,
            uploadHeight: hostUpload.uploadHeight,
            uploadByteLength: hostUpload.uploadByteLength,
            docId: hostUpload.docId ?? null,
            bounds: hostUpload.bounds ?? null,
            mimeType: hostUpload.mimeType || "image/png",
            uploadFormat: hostUpload.uploadFormat || (String(hostUpload.mimeType || "").includes("jpeg") ? "jpg" : "png"),
            ...(hostUpload.maskUploadBase64 != null
                ? {
                      maskUploadBase64: String(hostUpload.maskUploadBase64),
                      maskMin: Number(hostUpload.maskMin ?? -1),
                      maskMax: Number(hostUpload.maskMax ?? -1),
                  }
                : {}),
            ...(profile ? { captureProfile: profile } : {}),
        };
    }

    const doc = app.activeDocument;
    if (!doc) throw new Error("[NO_DOC]请先打开一个文档");
    const { bounds, layerID, origWidth, origHeight } = resolveCaptureBounds(doc, mode);
    const readFlags = { skipLayerMaskComposite: splitMaskMode && mode === "layer" };

    const previewPixels = await profiler.measure("uxp_preview_read", "read preview pixels", () =>
        readPixelsFromPS(doc, bounds, mode, layerID, { _legacyMaxSize: previewReadCap }, readFlags)
    );
    if (splitMaskMode && mode === "layer") setOpaqueAlpha(previewPixels.rgbaData);
    const previewBase64 = await profiler.measure("uxp_preview_encode", "encode preview", () =>
        previewFromRgba(mode, previewPixels.rgbaData, previewPixels.width, previewPixels.height, previewEncodeMax)
    );
    await notifyPreview(onPreviewReady, {
        previewBase64,
        uploadWidth: previewPixels.width,
        uploadHeight: previewPixels.height,
        bounds,
    });
    previewPixels.rgbaData = null;

    const fullRequest = { sizeLimitMode: "longEdge", longEdgeMax };
    const uploadPixels = await profiler.measure("uxp_upload_read", "read upload pixels", () =>
        readPixelsFromPS(doc, bounds, mode, layerID, fullRequest, readFlags)
    );

    let maskUploadBase64 = null;
    let maskMin = -1;
    let maskMax = -1;
    if (splitMaskMode && mode === "layer" && layerID != null) {
        setOpaqueAlpha(uploadPixels.rgbaData);
        const mask = await profiler.measure("uxp_mask_read", "read layer mask", () =>
            maskForUpload(doc, layerID, bounds, uploadPixels.width, uploadPixels.height, uploadPixels.targetSize)
        );
        if (mask.maskMax === 0) throw new Error("图层蒙版全黑（无可见像素），已阻断上传");
        copyGrayToAlpha(uploadPixels.rgbaData, mask.gray);
        maskUploadBase64 = await profiler.measure("uxp_mask_encode", "encode layer mask", () =>
            grayMaskDataUrl(mask.gray, uploadPixels.width, uploadPixels.height)
        );
        maskMin = mask.maskMin;
        maskMax = mask.maskMax;
    }

    const useJpeg = uploadEncodeFormat === "jpeg" && !maskUploadBase64;
    const uploadBuffer = await profiler.measure("uxp_upload_encode", "encode upload image", () =>
        useJpeg
            ? rgbaToJPEGBuffer(flattenAlphaToWhite(uploadPixels.rgbaData), uploadPixels.width, uploadPixels.height, jpegQuality)
            : rgbaToPNGBuffer(uploadPixels.rgbaData, uploadPixels.width, uploadPixels.height, PNG_COMPRESSION)
    );
    const mimeType = useJpeg ? "image/jpeg" : "image/png";
    const uploadBase64 = await profiler.measure("uxp_data_url", "wrap upload data", () =>
        Promise.resolve(bufferToBase64DataUrl(uploadBuffer, mimeType))
    );
    uploadPixels.rgbaData = null;
    const profile = profiler.result();

    return {
        previewBase64,
        uploadBase64,
        uploadBuffer: exactArrayBuffer(uploadBuffer),
        uploadFormat: useJpeg ? "jpg" : "png",
        mimeType,
        uploadWidth: uploadPixels.width,
        uploadHeight: uploadPixels.height,
        uploadByteLength: uploadBuffer.byteLength,
        docId: doc.id,
        bounds,
        origWidth,
        origHeight,
        ...(splitMaskMode && mode === "layer" ? { maskUploadBase64, maskMin, maskMax } : {}),
        ...(profile ? { captureProfile: profile } : {}),
    };
};

export const formatErrorMessage = (e) => {
    const msg = e && typeof e === "object" && "message" in e ? String(e.message || "") : String(e || "");
    if (msg.includes("[NO_DOC]")) return "请先打开一个文档";
    if (msg.includes("[UNSUPPORTED_MODE]")) return msg.replace("[UNSUPPORTED_MODE]", "").trim();
    if (/Code:\s*-1|Photoshop Error/i.test(msg)) {
        return "获取画布失败。请检查文档是否为 RGB/8 位通道，或尝试缩小选区后重试";
    }
    if (/selection|选区/i.test(msg)) return "请检查 PS 选区或当前画布范围";
    if (/document|文档/i.test(msg)) return "请先打开一个文档";
    if (/memory/i.test(msg)) return "内存不足，请缩小选区或降低上传长边";
    if (/cancel/i.test(msg)) return "操作已取消";
    if (/layer|图层/i.test(msg)) return "请先选中一个图层";
    return msg || "获取图像失败";
};

function mimeFromExtension(name) {
    const ext = String(name || "").split(".").pop()?.toLowerCase() || "png";
    if (ext === "jpg" || ext === "jpeg") return { ext: "jpg", mimeType: "image/jpeg" };
    if (ext === "webp") return { ext: "webp", mimeType: "image/webp" };
    if (ext === "bmp") return { ext: "bmp", mimeType: "image/bmp" };
    return { ext: "png", mimeType: "image/png" };
}

function bytesToDataUrl(bytes, mimeType) {
    return bufferToBase64DataUrl(bytes, mimeType);
}

function readPngDimensions(bytes) {
    if (bytes.length <= 24) return null;
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    return width > 0 && height > 0 ? { width, height } : null;
}

function readJpegDimensions(bytes) {
    let i = 2;
    while (i < bytes.length - 9) {
        if (bytes[i] !== 0xff) {
            i++;
            continue;
        }
        const marker = bytes[i + 1];
        const length = (bytes[i + 2] << 8) | bytes[i + 3];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8) {
            const height = (bytes[i + 5] << 8) | bytes[i + 6];
            const width = (bytes[i + 7] << 8) | bytes[i + 8];
            return width > 0 && height > 0 ? { width, height } : null;
        }
        i += Math.max(2, 2 + length);
    }
    return null;
}

function parseImageDimensions(bytes, mimeType) {
    try {
        if (mimeType === "image/png") return readPngDimensions(bytes) || { width: 512, height: 512 };
        if (mimeType === "image/jpeg") return readJpegDimensions(bytes) || { width: 512, height: 512 };
    } catch (e) {
        console.warn("[XiaoLiangRH] parse image dimensions failed", e?.message || e);
    }
    return { width: 512, height: 512 };
}

export const captureFromFile = async (previewMaxEdge = PREVIEW_MAX_SIZE) => {
    if (isInWebView() && isXiaoLiangRhHostCaptureEnabled()) {
        const edge = Math.max(64, Math.min(Number(previewMaxEdge) || PREVIEW_MAX_SIZE, 1024));
        const picked = await xiaoliangRhPickImageFileToUploadSession({ previewMaxEdge: edge });
        if (!picked?.ok) {
            if (picked?.cancelled) throw new Error("未选择文件");
            throw new Error(picked?.message || "选择文件失败");
        }
        const previewBase64 = String(picked.previewBase64 || "").trim();
        if (!previewBase64) throw new Error("宿主未返回预览图");
        return {
            previewBase64,
            uploadSessionId: picked.uploadSessionId,
            mimeType: picked.mimeType || "image/png",
            uploadWidth: picked.uploadWidth,
            uploadHeight: picked.uploadHeight,
            uploadByteLength: picked.uploadByteLength,
            uploadFormat: picked.uploadFormat,
            bounds: null,
            origWidth: picked.uploadWidth,
            origHeight: picked.uploadHeight,
        };
    }

    const uxpStorage = require("uxp").storage;
    const fs = uxpStorage.localFileSystem;
    const file = await fs.getFileForOpening({ types: ["png", "jpg", "jpeg", "webp", "bmp"] });
    if (!file) throw new Error("未选择文件");

    const arrayBuffer = await file.read({ format: uxpStorage.formats.binary });
    const bytes = new Uint8Array(arrayBuffer);
    const { ext, mimeType } = mimeFromExtension(file.name);
    const dataUrl = bytesToDataUrl(bytes, mimeType);
    const dims = parseImageDimensions(bytes, mimeType);

    return {
        previewBase64: dataUrl,
        uploadBase64: dataUrl,
        uploadBuffer: arrayBuffer,
        uploadFormat: ext,
        mimeType,
        uploadWidth: dims.width,
        uploadHeight: dims.height,
        uploadByteLength: bytes.length,
        bounds: null,
        origWidth: dims.width,
        origHeight: dims.height,
    };
};
