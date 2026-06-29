/**
 * UXP Host Bridge Handlers
 * Handle postMessage requests from WebView and return serializable results. */
import { runAiAppAndWaitInHost } from "./runninghubAiAppRunnerHost.js";
import { decodeDuckImageBytes } from "./duckLocalDecoder.js";
import { Jimp, JimpMime } from "jimp";
import * as rhHostHttp from "./runninghubHostHttp.js";
import { maybeStartHwMonitorServer, requestHwMonitorShutdown } from "./hwMonitorAutostart.js";
import { RH_PATH } from "../../src/runninghub/constants.js";
import { extractDownloadUrlFromData } from "../../src/runninghub/rhUploadResponseParse.js";
import { PLUGIN_HTTP_USER_AGENT_RH } from "../../src/pluginMeta.js";
import { isFullCanvasSelBounds } from "./placeQuadraticLayerMask.js";
import {
    finalizePlaceWithOptionalEdgeFeather,
    maybeRestoreRectangularSelectionAfterPlace,
    findLayerByIdInDocument,
    computeSelectionBoundsForRh,
    rasterizeLayerIfSmartObject,
    setStampLayerName,
    sortUpscaleGroupChildrenByTileNumber,
} from "./xiaoliangRhPsLayerTools.js";
import {
    resampleMaskChannelToSize,
    encodePNGFromRGB,
    encodePNGFromRGBA,
} from "./xiaoliangRhPngCodec.js";
import { putUploadSession, peekUploadSession, releaseUploadSession } from "./xiaoliangRhUploadSessionStore.js";
import { parseImageDimensionsFromBytes } from "./imageDimsFromBytes.js";
import {
    buildSavedImageFileName,
    inferExtFromContentType,
    inferExtFromUrl,
    safeUploadFileName,
    resolveFolder,
} from "./xiaoliangRhHostFileTools.js";
import { openNativeFolderInHost } from "./xiaoliangRhHostRuntimeTools.js";
import { XLRH_STORAGE_METHODS, handleXlrhStorageBridgeMethod } from "./xiaoliangRhStorageBridgeHost.js";
const storage = require("uxp").storage;
const fs = storage.localFileSystem;
const formats = storage.formats;
const photoshop = require("photoshop");
const shell = require("uxp").shell;
const os = require("os");
let _dynRequire = null;
try {
    _dynRequire = typeof __non_webpack_require__ === "function"
        ? __non_webpack_require__
        : Function("return require")();
} catch {
    _dynRequire = null;
}

const _notificationSubs = new Map();
/** RunningHub runAiApp：按 WebView 请求 id 取消 */
const _rhAiAppAbortByRequestId = new Map();

function xiaoliangRhNotificationEventList(events) {
    if (!Array.isArray(events)) return [{ event: "set" }];
    return events.map((event) => (typeof event === "string" ? { event } : event));
}

function xiaoliangRhAddPsNotificationBridge(events, listenerId, sendToWebview) {
    const eventArr = xiaoliangRhNotificationEventList(events);
    const listener = (eventName) => sendToWebview({ type: "ps.notification", listenerId, event: eventName });
    const subscription = photoshop.action.addNotificationListener(eventArr, listener);
    _notificationSubs.set(listenerId, { subscription, listener, eventArr });
    return { ok: true };
}

function xiaoliangRhRemovePsNotificationBridge(listenerId) {
    const stored = _notificationSubs.get(listenerId);
    if (!stored) return { ok: true };
    try {
        const remove = stored.subscription?.remove;
        if (typeof remove === "function") remove.call(stored.subscription);
        else if (typeof photoshop.action.removeNotificationListener === "function") {
            photoshop.action.removeNotificationListener(stored.eventArr, stored.listener);
        }
    } catch (error) {
        console.warn("[XiaoLiangRH Bridge] removeNotificationListener:", error);
    }
    _notificationSubs.delete(listenerId);
    return { ok: true };
}
let _upscaleGroupRef = null;
let _upscaleSourceLayerId = null;
/** One WebView generation owns one upscale/stamp context. */
let _upscaleDivideEpoch = null;

async function xiaoliangRhRunAiAppBridgeJob(payload, requestId, sendToWebview) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    if (controller) _rhAiAppAbortByRequestId.set(requestId, controller);
    try {
        return await runAiAppAndWaitInHost(payload && typeof payload === "object" ? payload : {}, requestId, sendToWebview, controller?.signal);
    } finally {
        _rhAiAppAbortByRequestId.delete(requestId);
    }
}

function xiaoliangRhCancelAiAppBridgeJob(requestId) {
    const controller = _rhAiAppAbortByRequestId.get(requestId);
    if (controller) controller.abort();
    return { ok: true };
}

/** Main app.html WebView; sendToWebview always posts to it to avoid stale setupBridge closures. */
let _xiaoliangRhBridgeMainWebviewEl = null;
let _xiaoliangRhBridgeStoredHandleMessage = null;
let _xiaoliangRhBridgeWebviewListenerTarget = null;

function tryParseJson(text) {
    try {
        return JSON.parse(String(text || "{}"));
    } catch {
        return null;
    }
}

function xiaoliangRhClampPreviewEdge(value) {
    const requested = Number(value);
    const usable = Number.isFinite(requested) && requested > 0 ? requested : 256;
    return Math.min(1024, Math.max(32, usable));
}

function xiaoliangRhBytesToDataUrl(bytes, mimeType) {
    try {
        return `data:${mimeType};base64,${btoa(_uint8ToBinaryFallback(bytes))}`;
    } catch {
        return "";
    }
}

async function xiaoliangRhPreviewBytesViaCanvas(sourceBytes, mimeType, edgeLimit) {
    if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return null;
    const bitmap = await createImageBitmap(new Blob([sourceBytes], { type: mimeType }));
    const sourceW = Math.max(1, bitmap.width || 1);
    const sourceH = Math.max(1, bitmap.height || 1);
    const ratio = Math.min(1, edgeLimit / Math.max(sourceW, sourceH));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(sourceW * ratio)), Math.max(1, Math.round(sourceH * ratio)));
    const canvas2d = canvas.getContext("2d");
    if (!canvas2d) throw new Error("preview canvas unavailable");
    canvas2d.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: "image/png", quality: 0.92 });
    return new Uint8Array(await blob.arrayBuffer());
}

async function xiaoliangRhBuildPreviewDataUrlFromBytes(bytes, mimeType = "image/png", maxEdge = 256) {
    const resolvedMime = String(mimeType || "image/png") || "image/png";
    try {
        const previewBytes = await xiaoliangRhPreviewBytesViaCanvas(bytes, resolvedMime, xiaoliangRhClampPreviewEdge(maxEdge));
        if (previewBytes) return xiaoliangRhBytesToDataUrl(previewBytes, "image/png");
    } catch (error) {
        console.warn("[XiaoLiangRH] preview canvas fallback:", error);
    }
    return xiaoliangRhBytesToDataUrl(bytes, resolvedMime);
}

function xiaoliangRhRectFromPlacePayload(placePayload) {
    const raw = placePayload && typeof placePayload === "object" ? placePayload.bounds : null;
    if (!raw || typeof raw !== "object") return null;
    const rect = {
        left: Number(raw.left),
        top: Number(raw.top),
        right: Number(raw.right),
        bottom: Number(raw.bottom),
    };
    return [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) && rect.right > rect.left && rect.bottom > rect.top
        ? rect
        : null;
}

function xiaoliangRhDocIdFromPlacePayload(placePayload) {
    const raw = placePayload && typeof placePayload === "object" ? placePayload.docId : null;
    if (raw == null || raw === "") return null;
    const docId = Number(raw);
    return Number.isFinite(docId) ? docId : null;
}

function xiaoliangRhDocumentExists(docId) {
    const docs = photoshop.app.documents || [];
    for (const doc of docs) {
        if (doc && doc.id === docId) return true;
    }
    return false;
}

function xiaoliangRhRectangleDescriptor(rect) {
    return {
        _obj: "rectangle",
        top: { _unit: "pixelsUnit", _value: rect.top },
        left: { _unit: "pixelsUnit", _value: rect.left },
        bottom: { _unit: "pixelsUnit", _value: rect.bottom },
        right: { _unit: "pixelsUnit", _value: rect.right },
    };
}

async function xiaoliangRhSelectDocumentById(docId) {
    if (!xiaoliangRhDocumentExists(docId)) throw new Error(`Document is closed or missing (id=${docId})`);
    await photoshop.action.batchPlay([
        { _obj: "select", null: { _ref: [{ _ref: "document", _id: docId }] } },
    ], { synchronousExecution: true });
}

async function xiaoliangRhRestoreSelectionRect(rect) {
    await photoshop.action.batchPlay([
        {
            _obj: "set",
            _target: [{ _ref: "channel", _property: "selection" }],
            to: xiaoliangRhRectangleDescriptor(rect),
        },
    ], { synchronousExecution: true });
}

/** @param {Record<string, unknown> | null | undefined} placePayload */
async function xiaoliangRhApplyTaskPlaceContextInModal(placePayload) {
    const docId = xiaoliangRhDocIdFromPlacePayload(placePayload);
    const rect = xiaoliangRhRectFromPlacePayload(placePayload);
    if (docId == null && !rect) return;
    if (docId != null) await xiaoliangRhSelectDocumentById(docId);
    if (rect) await xiaoliangRhRestoreSelectionRect(rect);
}

function xiaoliangRhBridgePostToMainApp(msg) {
    try {
        const el = _xiaoliangRhBridgeMainWebviewEl;
        if (el && typeof el.postMessage === "function") el.postMessage(msg);
    } catch (e) {
        console.error("[Bridge] postMessage failed:", e);
    }
}

/**
 * Notify the main WebView that host-side upload sessions are no longer valid.
 * @param {string} [reason]
 * @param {string} [scope]
 */
export function xiaoliangRhPostMainWebviewUploadSessionsInvalidated(reason = "", scope = "global") {
    xiaoliangRhBridgePostToMainApp({
        type: "xiaoliangRh.uploadSessionsInvalidated",
        reason: String(reason || ""),
        scope: String(scope || "global"),
    });
}

function xiaoliangRhNumberFromHostValue(value) {
    if (value == null) return NaN;
    if (typeof value === "number") return Number.isNaN(value) ? NaN : value;
    if (typeof value === "object" && value && "_value" in value) return Number(value._value);
    return Number(value);
}

function xiaoliangRhSelectionBoundsFromRect(rect) {
    if (!rect || typeof rect !== "object") return null;
    const top = xiaoliangRhNumberFromHostValue(rect.top);
    const left = xiaoliangRhNumberFromHostValue(rect.left);
    const bottom = xiaoliangRhNumberFromHostValue(rect.bottom);
    const right = xiaoliangRhNumberFromHostValue(rect.right);
    if (![top, left, bottom, right].every(Number.isFinite)) return null;
    const width = right - left;
    const height = bottom - top;
    return width > 0 && height > 0
        ? { top, left, bottom, right, width, height, centerX: left + width / 2, centerY: top + height / 2 }
        : null;
}

async function xiaoliangRhReadCanvasBoundsFromPs(batchPlay) {
    const reply = await batchPlay([
        { _obj: "get", _target: [{ _property: "width" }, { _ref: "document", _enum: "ordinal", _value: "targetEnum" }] },
        { _obj: "get", _target: [{ _property: "height" }, { _ref: "document", _enum: "ordinal", _value: "targetEnum" }] },
    ], { synchronousExecution: false });
    const width = Math.max(1, Math.round(xiaoliangRhNumberFromHostValue(reply?.[0]?.width) || 0));
    const height = Math.max(1, Math.round(xiaoliangRhNumberFromHostValue(reply?.[1]?.height) || 0));
    return { top: 0, left: 0, bottom: height, right: width, width, height, centerX: width / 2, centerY: height / 2 };
}

async function xiaoliangRhReadSelectionBoundsFromPs(batchPlay, logTag) {
    try {
        const reply = await batchPlay([
            {
                _obj: "get",
                _target: [
                    { _property: "selection" },
                    { _ref: "document", _enum: "ordinal", _value: "targetEnum" },
                ],
            },
        ], { synchronousExecution: false });
        return xiaoliangRhSelectionBoundsFromRect(reply?.[0]?.selection?.bounds || reply?.[0]?.selection);
    } catch (error) {
        console.warn(`${logTag || "[XiaoLiangRH Place]"} read selection:`, error);
        return null;
    }
}

async function xiaoliangRhClearSelectionBeforePlace(batchPlay, logTag) {
    try {
        await batchPlay([
            {
                _obj: "set",
                _target: [{ _ref: "channel", _property: "selection" }],
                to: { _enum: "ordinal", _value: "none" },
            },
        ], { synchronousExecution: true });
    } catch (error) {
        console.warn(`${logTag || "[XiaoLiangRH Place]"} clear selection:`, error);
    }
}

async function xiaoliangRhResolvePlaceBounds(batchPlay, { savedBounds, preferSavedBounds, logTag } = {}) {
    const saved = xiaoliangRhSelectionBoundsFromRect(savedBounds);
    if (preferSavedBounds && saved) return saved;
    if (preferSavedBounds) return xiaoliangRhReadCanvasBoundsFromPs(batchPlay);
    const activeSelection = await xiaoliangRhReadSelectionBoundsFromPs(batchPlay, logTag);
    if (activeSelection) return activeSelection;
    if (saved) return saved;
    return xiaoliangRhReadCanvasBoundsFromPs(batchPlay);
}

async function xiaoliangRhSelectDocumentForPlace(batchPlay, docId) {
    const id = xiaoliangRhNumberFromHostValue(docId);
    if (!Number.isFinite(id)) return;
    await batchPlay([
        { _obj: "select", null: { _ref: [{ _ref: "document", _id: id }] } },
    ], { synchronousExecution: true });
}

async function xiaoliangRhPlaceSessionToken(batchPlay, fileSessionToken) {
    await batchPlay([
        {
            _obj: "placeEvent",
            null: { _path: fileSessionToken, _kind: "local" },
            freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
            offset: { _obj: "offset", horizontal: { _unit: "pixelsUnit", _value: 0 }, vertical: { _unit: "pixelsUnit", _value: 0 } },
        },
    ], { synchronousExecution: false });
}

async function xiaoliangRhTokenForNamedFolderEntry(storageFs, folder, fileName, logTag) {
    if (!fileName || typeof fileName !== "string") return "";
    try {
        const entry = await folder.getEntry(fileName);
        if (!entry?.isFile) return "";
        return storageFs.createSessionToken(entry);
    } catch (error) {
        console.warn(`${logTag || "[XiaoLiangRH Place]"} missing file:`, fileName, error);
        return "";
    }
}

async function xiaoliangRhMoveCurrentLayerIntoGroup(doc, group, ElementPlacement, logTag) {
    const activeLayer = doc?.activeLayers?.[0];
    if (!activeLayer || !group) return;
    try {
        await activeLayer.move(group, ElementPlacement.PLACEINSIDE);
    } catch (error) {
        console.warn(`${logTag || "[XiaoLiangRH Place]"} move into group:`, error);
    }
}

async function xiaoliangRhMoveGroupToDocumentRoot(doc, group, ElementPlacement, logTag) {
    if (!doc || !group) return;
    const rootLayers = doc.layers;
    let topLayer = null;
    try {
        topLayer = rootLayers?.[0] || (typeof rootLayers?.get === "function" ? rootLayers.get(0) : null);
    } catch (_) {
        topLayer = null;
    }
    if (!topLayer) return;
    try {
        if (Number(topLayer.id) === Number(group.id)) return;
    } catch (_) {}
    try {
        await group.move(topLayer, ElementPlacement.PLACEBEFORE);
    } catch (error) {
        console.warn(`${logTag || "[XiaoLiangRH Place]"} move group to document root:`, error);
    }
}

async function xiaoliangRhReadPlacedLayerBounds(batchPlay, logTag) {
    try {
        const reply = await batchPlay([
            { _obj: "get", _target: [{ _property: "bounds" }, { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }] },
        ], { synchronousExecution: false });
        return xiaoliangRhSelectionBoundsFromRect(reply?.[0]?.bounds);
    } catch (error) {
        console.warn(`${logTag || "[XiaoLiangRH Place]"} read layer bounds:`, error);
        return null;
    }
}

function xiaoliangRhBuildFitTransform(layerBounds, targetBounds) {
    if (!layerBounds || !targetBounds) return null;
    const scale = Math.min(targetBounds.width / layerBounds.width, targetBounds.height / layerBounds.height) * 100;
    if (!Number.isFinite(scale) || scale <= 0) return null;
    return {
        _obj: "transform",
        freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
        offset: {
            _obj: "offset",
            horizontal: { _unit: "pixelsUnit", _value: targetBounds.centerX - layerBounds.centerX },
            vertical: { _unit: "pixelsUnit", _value: targetBounds.centerY - layerBounds.centerY },
        },
        width: { _unit: "percentUnit", _value: scale },
        height: { _unit: "percentUnit", _value: scale },
        interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubicAutomatic" },
    };
}

async function xiaoliangRhFitPlacedLayerIntoBounds(batchPlay, targetBounds, logTag) {
    const layerBounds = await xiaoliangRhReadPlacedLayerBounds(batchPlay, logTag);
    const transform = xiaoliangRhBuildFitTransform(layerBounds, targetBounds);
    if (transform) await batchPlay([transform], { synchronousExecution: false });
}

function xiaoliangRhBuildStretchToBoundsTransform(layerBounds, targetBounds) {
    if (!layerBounds || !targetBounds) return null;
    const scaleX = (targetBounds.width / layerBounds.width) * 100;
    const scaleY = (targetBounds.height / layerBounds.height) * 100;
    if (![scaleX, scaleY].every((value) => Number.isFinite(value) && value > 0)) return null;
    const scaledWidth = layerBounds.width * (scaleX / 100);
    const scaledHeight = layerBounds.height * (scaleY / 100);
    return {
        _obj: "transform",
        freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
        offset: {
            _obj: "offset",
            horizontal: { _unit: "pixelsUnit", _value: Math.round(targetBounds.left - (layerBounds.centerX - scaledWidth / 2)) },
            vertical: { _unit: "pixelsUnit", _value: Math.round(targetBounds.top - (layerBounds.centerY - scaledHeight / 2)) },
        },
        width: { _unit: "percentUnit", _value: scaleX },
        height: { _unit: "percentUnit", _value: scaleY },
        interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubicAutomatic" },
    };
}

async function xiaoliangRhStretchPlacedLayerToCanvas(batchPlay, canvasBounds, logTag) {
    const layerBounds = await xiaoliangRhReadPlacedLayerBounds(batchPlay, logTag);
    const transform = xiaoliangRhBuildStretchToBoundsTransform(layerBounds, canvasBounds);
    if (transform) await batchPlay([transform], { synchronousExecution: true });
}

async function xiaoliangRhDocumentSnapshotPngBytes(activeDoc) {
    const { width, height } = xiaoliangRhDocumentPixelSize(activeDoc);
    const bounds = { left: 0, top: 0, right: width, bottom: height, width, height, centerX: width / 2, centerY: height / 2 };
    const options = {
        documentID: activeDoc.id,
        sourceBounds: bounds,
        componentSize: 8,
        colorSpace: "RGB",
        applyAlpha: false,
    };
    try {
        if (activeDoc.colorProfileName && activeDoc.colorProfileName !== "sRGB IEC61966-2.1") options.colorProfile = "sRGB IEC61966-2.1";
    } catch (_) {}
    const imageData = (await photoshop.imaging.getPixels(options)).imageData;
    try {
        const widthPx = imageData.width;
        const heightPx = imageData.height;
        const components = imageData.components || 3;
        const pixels = xiaoliangRhTypedPixelsToByteArray(await xiaoliangRhGetImageDataBuffer(imageData), widthPx * heightPx * components);
        return { pngBytes: encodePNGFromRGB(widthPx, heightPx, pixels, components), canvasBounds: bounds };
    } finally {
        Promise.resolve().then(() => { try { imageData.dispose?.(); } catch (_) {} });
    }
}

async function xiaoliangRhPlaceDocumentSnapshotAsLayer({ activeDoc, batchPlay, storageFs, storageFormats, logTag }) {
    const { pngBytes, canvasBounds } = await xiaoliangRhDocumentSnapshotPngBytes(activeDoc);
    const tempFolder = await storageFs.getTemporaryFolder();
    const tempFile = await tempFolder.createFile(`xiaoliang_rh_upscale_stamp_${Date.now()}.png`, { overwrite: true });
    try {
        await tempFile.write(pngBytes, { format: storageFormats.binary });
        await xiaoliangRhPlaceSessionToken(batchPlay, await storageFs.createSessionToken(tempFile));
        await xiaoliangRhStretchPlacedLayerToCanvas(batchPlay, canvasBounds, logTag);
        return activeDoc.activeLayers?.[0] || null;
    } finally {
        try { await tempFile.delete(); } catch (_) {}
    }
}

async function xiaoliangRhPlaceFolderImageIntoGroup({ storageFs, folder, fileName, batchPlay, doc, group, ElementPlacement, targetBounds, placeOpts, warnings, logTag }) {
    const token = await xiaoliangRhTokenForNamedFolderEntry(storageFs, folder, fileName, logTag);
    if (!token) return;
    await xiaoliangRhClearSelectionBeforePlace(batchPlay, logTag);
    await xiaoliangRhPlaceSessionToken(batchPlay, token);
    if (targetBounds) await xiaoliangRhFitPlacedLayerIntoBounds(batchPlay, targetBounds, logTag);
    if (doc && targetBounds) {
        const placed = await finalizePlaceWithOptionalEdgeFeather(photoshop, { batchPlay, activeDoc: doc, selBounds: targetBounds, placeOpts });
        if (placed?.maskWarning) warnings?.push(placed.maskWarning);
    }
    await xiaoliangRhMoveCurrentLayerIntoGroup(doc, group, ElementPlacement, logTag);
}

async function xiaoliangRhFinishPlace(batchPlay, selBounds, placeOpts) {
    const activeDoc = photoshop.app.activeDocument;
    if (!activeDoc || !selBounds) return null;
    const finalized = await finalizePlaceWithOptionalEdgeFeather(photoshop, { batchPlay, activeDoc, selBounds, placeOpts });
    await maybeRestoreRectangularSelectionAfterPlace(batchPlay, { placeOpts, activeDoc, selBounds });
    return finalized?.maskWarning || null;
}

async function xiaoliangRhPlaceFileTokenIntoPs({ fileSessionToken, docId, savedBounds, preferSavedBounds, placeOpts, commandName, logTag }) {
    if (!fileSessionToken || typeof fileSessionToken !== "string") {
        throw new Error("Invalid file token. Please choose the result folder again.");
    }
    const batchPlay = photoshop.action.batchPlay;
    let maskWarning = null;
    await photoshop.core.executeAsModal(async () => {
        await xiaoliangRhSelectDocumentForPlace(batchPlay, docId);
        const targetBounds = await xiaoliangRhResolvePlaceBounds(batchPlay, { savedBounds, preferSavedBounds, logTag });
        await xiaoliangRhClearSelectionBeforePlace(batchPlay, logTag);
        await xiaoliangRhPlaceSessionToken(batchPlay, fileSessionToken);
        await xiaoliangRhFitPlacedLayerIntoBounds(batchPlay, targetBounds, logTag);
        maskWarning = await xiaoliangRhFinishPlace(batchPlay, targetBounds, placeOpts);
    }, { commandName });
    return { ok: true, ...(maskWarning ? { maskWarning } : {}) };
}

function xiaoliangRhRectForCapture(raw, docW, docH) {
    if (!raw || typeof raw !== "object") return null;
    const left = Math.floor(xiaoliangRhNumberFromHostValue(raw.left) || 0);
    const top = Math.floor(xiaoliangRhNumberFromHostValue(raw.top) || 0);
    const right = Math.ceil(xiaoliangRhNumberFromHostValue(raw.right) || 0);
    const bottom = Math.ceil(xiaoliangRhNumberFromHostValue(raw.bottom) || 0);
    if (right <= left || bottom <= top) return null;
    return {
        left: Math.max(0, Math.min(left, docW - 1)),
        top: Math.max(0, Math.min(top, docH - 1)),
        right: Math.max(left + 1, Math.min(right, docW)),
        bottom: Math.max(top + 1, Math.min(bottom, docH)),
    };
}

async function xiaoliangRhReadActiveLayerCaptureRect(app, activeLayer, docW, docH) {
    const direct = xiaoliangRhRectForCapture(activeLayer?.bounds, docW, docH);
    if (direct) return direct;
    try {
        const reply = await app.batchPlay([
            { _obj: "get", _target: [{ _property: "bounds" }, { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }] },
        ], {});
        return xiaoliangRhRectForCapture(reply?.[0]?.bounds || reply?.[0], docW, docH);
    } catch (_) {
        return null;
    }
}

function xiaoliangRhIntersectCaptureRects(base, fallback) {
    const joined = {
        left: Math.max(base.left, fallback.left),
        top: Math.max(base.top, fallback.top),
        right: Math.min(base.right, fallback.right),
        bottom: Math.min(base.bottom, fallback.bottom),
    };
    return joined.left < joined.right && joined.top < joined.bottom ? joined : fallback;
}

async function xiaoliangRhApplyLayerScopeToCapture(app, doc, bounds, docW, docH, mode) {
    if (mode !== "layer") return { bounds, layerID: null };
    const activeLayer = doc.activeLayers?.[0];
    if (!activeLayer) throw new Error("No selected layer");
    const layerBounds = await xiaoliangRhReadActiveLayerCaptureRect(app, activeLayer, docW, docH);
    return {
        bounds: layerBounds ? xiaoliangRhIntersectCaptureRects(bounds, layerBounds) : bounds,
        layerID: activeLayer.id,
    };
}

/** Fallback without TextDecoder: chunk conversion avoids O(n^2) byte concatenation. */
function _uint8ToBinaryFallback(u8) {
    const CHUNK = 8192;
    const parts = [];
    for (let i = 0; i < u8.length; i += CHUNK) {
        parts.push(String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CHUNK, u8.length))));
    }
    return parts.join("");
}

const RESULT_SIDECAR_V_HOST = 2;
const GEOM_KEYS_HOST = ["left", "top", "right", "bottom", "width", "height"];

function pickBoundsKeysHost(b) {
    if (!b || typeof b !== "object") return null;
    const o = {};
    for (const k of GEOM_KEYS_HOST) {
        if (typeof b[k] === "number") o[k] = b[k];
    }
    return Object.keys(o).length ? o : null;
}

function shouldWriteSidecarHost(bounds, docId, resultSidecar) {
    const hasGeom = bounds && typeof bounds === "object" && pickBoundsKeysHost(bounds);
    const hasResult = resultSidecar && typeof resultSidecar === "object" && Object.keys(resultSidecar).length > 0;
    return !!(hasGeom || docId != null || hasResult);
}

/**
 * v2 侧车含 result 元数据；其它调用方保持旧扁平 JSON
 */
async function writeResultBoundsSidecar(folder, fileName, bounds, docId, resultSidecar) {
    if (!shouldWriteSidecarHost(bounds, docId, resultSidecar)) return;
    try {
        let jsonStr;
        if (resultSidecar && typeof resultSidecar === "object") {
            const rect = bounds != null ? pickBoundsKeysHost(bounds) : null;
            const place = { bounds: rect };
            if (docId != null && typeof docId === "number") place.docId = docId;
            const obj = { v: RESULT_SIDECAR_V_HOST, place, result: resultSidecar };
            jsonStr = JSON.stringify(obj);
        } else if (bounds && typeof bounds === "object") {
            jsonStr = JSON.stringify(docId != null ? { ...bounds, docId } : bounds);
        } else {
            return;
        }
        const boundsFile = await folder.createFile(String(fileName) + ".bounds.json", { overwrite: true });
        await boundsFile.write(jsonStr, { format: formats.utf8 });
    } catch (e) {
        console.warn("[bounds sidecar]", e);
    }
}

function hasNonOpaqueAlphaHost(rgbaData) {
    if (!rgbaData || !rgbaData.length) return false;
    for (let i = 3; i < rgbaData.length; i += 4) {
        if (rgbaData[i] !== 255) return true;
    }
    return false;
}

function flattenAlphaToWhiteHost(rgbaData) {
    if (!hasNonOpaqueAlphaHost(rgbaData)) return rgbaData;
    const out = new Uint8Array(rgbaData.length);
    for (let i = 0; i < rgbaData.length; i += 4) {
        const a = rgbaData[i + 3];
        if (a >= 255) {
            out[i] = rgbaData[i];
            out[i + 1] = rgbaData[i + 1];
            out[i + 2] = rgbaData[i + 2];
        } else if (a <= 0) {
            out[i] = 255;
            out[i + 1] = 255;
            out[i + 2] = 255;
        } else {
            const inv = 255 - a;
            out[i] = Math.round((rgbaData[i] * a + 255 * inv) / 255);
            out[i + 1] = Math.round((rgbaData[i + 1] * a + 255 * inv) / 255);
            out[i + 2] = Math.round((rgbaData[i + 2] * a + 255 * inv) / 255);
        }
        out[i + 3] = 255;
    }
    return out;
}

function xiaoliangRhBytesFromBase64Text(base64Text) {
    return Uint8Array.from(atob(String(base64Text || "")), (char) => char.charCodeAt(0));
}

async function xiaoliangRhCapturePreviewFromActiveDocument(opts = {}) {
    const mode = opts.mode || "canvas";
    const maxSize = Number(opts.maxSize) > 0 ? Number(opts.maxSize) : 256;
    const captured = await photoshop.core.executeAsModal(
        () => xiaoliangRhExecutePsCaptureSelectionModalCore(mode, { longEdgeMax: maxSize }),
        { commandName: "Preview Capture" }
    );
    const rgbaBytes = xiaoliangRhBytesFromBase64Text(captured?.rgbaBase64);
    const pngBytes = encodePNGFromRGBA(captured.width, captured.height, rgbaBytes);
    return {
        previewBase64: `data:image/png;base64,${btoa(_uint8ToBinaryFallback(pngBytes))}`,
        bounds: captured.bounds,
    };
}

function xiaoliangRhPreviewTarget(bounds, maxSize) {
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    if (width <= 0 || height <= 0) throw new Error("选区尺寸无效");
    const edgeLimit = Number(maxSize) > 0 ? Number(maxSize) : 0;
    const ratio = edgeLimit && (width > edgeLimit || height > edgeLimit) ? Math.min(edgeLimit / width, edgeLimit / height) : 1;
    return ratio < 1 ? { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) } : undefined;
}

const XLRH_CAPTURE_PIXEL_PRESETS = Object.freeze({ "1M": 1048576, "4M": 4194304, "16M": 16777216 });

function xiaoliangRhScaledTarget(width, height, ratio) {
    return ratio < 1 ? { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) } : undefined;
}

function xiaoliangRhWantsOriginalLongEdge(value) {
    return value === 0 || value === "0" || value === "original" || value === false;
}

function xiaoliangRhResolveCaptureTargetSize(bounds, opts, mode) {
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    if (width <= 0 || height <= 0) throw new Error("选区尺寸无效");
    let targetSize;
    if (opts.forceNoTargetSize) {
        targetSize = undefined;
    } else if (opts._legacyMaxSize != null) {
        const edge = Number(opts._legacyMaxSize) || 0;
        targetSize = xiaoliangRhScaledTarget(width, height, edge > 0 ? Math.min(edge / width, edge / height, 1) : 1);
    } else if (opts.sizeLimitMode === "pixelCount") {
        const limit = XLRH_CAPTURE_PIXEL_PRESETS[opts.pixelCountPreset] ?? XLRH_CAPTURE_PIXEL_PRESETS["1M"];
        targetSize = width * height > limit ? xiaoliangRhScaledTarget(width, height, Math.sqrt(limit / (width * height))) : undefined;
    } else if (!xiaoliangRhWantsOriginalLongEdge(opts.longEdgeMax)) {
        const edge = Math.max(1, Math.min(8192, Number(opts.longEdgeMax) || 2048));
        targetSize = width > edge || height > edge ? xiaoliangRhScaledTarget(width, height, Math.min(edge / width, edge / height)) : undefined;
    }
    if (opts.splitMaskMode && mode === "layer") return targetSize || { width, height };
    return targetSize;
}

async function xiaoliangRhReadDocumentBitDepth(app, doc) {
    try {
        const direct = Number(doc.bitsPerChannel);
        if (Number.isFinite(direct) && direct > 0) return direct;
        const reply = await app.batchPlay([
            { _obj: "get", _target: [{ _property: "depth" }, { _ref: "document", _enum: "ordinal", _value: "targetEnum" }] },
        ], {});
        return Number(reply?.[0]?.depth) || 8;
    } catch (_) {
        return 8;
    }
}

async function xiaoliangRhGetPixelsWithDepthFallback(app, imaging, doc, options) {
    try {
        return await imaging.getPixels(options);
    } catch (error) {
        const depth = await xiaoliangRhReadDocumentBitDepth(app, doc);
        if (depth !== 16 && depth !== 32) throw error;
        const fallbackOptions = { ...options };
        delete fallbackOptions.componentSize;
        return imaging.getPixels(fallbackOptions);
    }
}

async function xiaoliangRhGetImageDataBuffer(imageData) {
    if (typeof imageData.getData === "function") return imageData.getData({});
    if (imageData.data?.length) return imageData.data;
    if (imageData.buffer) return new Uint8Array(imageData.buffer);
    throw new Error("无法获取像素数据");
}

function xiaoliangRhTypedPixelsToByteArray(rawBuffer, expectedLength) {
    if (!rawBuffer || rawBuffer.length === 0) throw new Error("像素数据为空");
    if (rawBuffer instanceof Uint8Array && rawBuffer.length === expectedLength) return rawBuffer;
    const output = new Uint8Array(expectedLength);
    if (rawBuffer instanceof Uint16Array) {
        let sampleMax = 0;
        for (let index = 0; index < Math.min(rawBuffer.length, 5000); index += 1) sampleMax = Math.max(sampleMax, rawBuffer[index]);
        const divisor = sampleMax > 0 && sampleMax <= 32769 ? 32768 : 65535;
        for (let index = 0; index < expectedLength && index < rawBuffer.length; index += 1) {
            output[index] = Math.min(255, Math.round(rawBuffer[index] * 255 / divisor));
        }
        return output;
    }
    if (rawBuffer instanceof Float32Array) {
        for (let index = 0; index < expectedLength && index < rawBuffer.length; index += 1) {
            output[index] = Math.round(Math.max(0, Math.min(1, rawBuffer[index])) * 255);
        }
        return output;
    }
    const bytes = rawBuffer instanceof Uint8Array ? rawBuffer : new Uint8Array(rawBuffer);
    if (bytes.length === expectedLength) return bytes;
    if (bytes.length === expectedLength * 2) {
        const hiFirst = bytes[0] >= bytes[1];
        for (let index = 0; index < expectedLength; index += 1) {
            const offset = index * 2;
            const hi = bytes[offset + (hiFirst ? 0 : 1)];
            const lo = bytes[offset + (hiFirst ? 1 : 0)];
            output[index] = Math.min(255, Math.round(((hi << 8) | lo) * 255 / 32768));
        }
        return output;
    }
    return bytes.subarray ? bytes.subarray(0, expectedLength) : new Uint8Array(bytes).subarray(0, expectedLength);
}

function xiaoliangRhPixelsToRgba(rawBytes, components, width, height) {
    const channelCount = Number(components) || 0;
    if (channelCount === 4) return rawBytes;
    if (channelCount !== 3) throw new Error(`Unsupported channel count: ${components}`);
    const rgba = new Uint8Array(width * height * 4);
    for (let source = 0, target = 0; source < rawBytes.length; source += 3, target += 4) {
        rgba[target] = rawBytes[source];
        rgba[target + 1] = rawBytes[source + 1];
        rgba[target + 2] = rawBytes[source + 2];
        rgba[target + 3] = 255;
    }
    return rgba;
}

async function xiaoliangRhReadLayerMaskGray({ imaging, docId, layerID, bounds, targetSize, width, height }) {
    const maskReply = await imaging.getLayerMask({ documentID: docId, layerID, sourceBounds: bounds, targetSize });
    const imageData = maskReply?.imageData;
    if (!imageData) return null;
    const maskWidth = Math.max(1, Number(imageData.width) || width);
    const maskHeight = Math.max(1, Number(imageData.height) || height);
    const maskComponents = Math.max(1, Number(imageData.components) || 1);
    let rawMask;
    try {
        rawMask = await xiaoliangRhGetImageDataBuffer(imageData);
    } finally {
        try { imageData.dispose?.(); } catch (_) {}
    }
    const packed = xiaoliangRhTypedPixelsToByteArray(rawMask, maskWidth * maskHeight * maskComponents);
    let gray;
    if (maskWidth === width && maskHeight === height) {
        gray = new Uint8Array(width * height);
        for (let pixel = 0; pixel < gray.length; pixel += 1) gray[pixel] = packed[pixel * maskComponents] || 0;
    } else {
        gray = resampleMaskChannelToSize(packed, maskWidth, maskHeight, maskComponents, width, height);
    }
    return { gray, ...xiaoliangRhGrayStats(gray) };
}

function xiaoliangRhGrayStats(gray) {
    let min = 255;
    let max = 0;
    for (let index = 0; index < gray.length; index += 1) {
        const value = gray[index];
        if (value < min) min = value;
        if (value > max) max = value;
    }
    return { min, max };
}

function xiaoliangRhSetAlphaToValue(rgbaData, value) {
    for (let offset = 3; offset < rgbaData.length; offset += 4) rgbaData[offset] = value;
}

function xiaoliangRhApplyGrayMaskToAlpha(rgbaData, gray, mode) {
    const pixels = Math.min(gray.length, Math.floor(rgbaData.length / 4));
    for (let pixel = 0; pixel < pixels; pixel += 1) {
        const alphaIndex = pixel * 4 + 3;
        const maskValue = gray[pixel] || 0;
        rgbaData[alphaIndex] = mode === "replace"
            ? maskValue
            : Math.round(rgbaData[alphaIndex] * (maskValue / 255));
    }
}

function xiaoliangRhMaskUploadBase64(width, height, gray) {
    const rgb = new Uint8Array(width * height * 3);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
        const value = gray[pixel] || 0;
        const base = pixel * 3;
        rgb[base] = value;
        rgb[base + 1] = value;
        rgb[base + 2] = value;
    }
    const png = encodePNGFromRGB(width, height, rgb, 3);
    return "data:image/png;base64," + btoa(_uint8ToBinaryFallback(png));
}

function xiaoliangRhWhiteMaskUpload(width, height) {
    const white = new Uint8Array(width * height);
    white.fill(255);
    return { uploadBase64: xiaoliangRhMaskUploadBase64(width, height, white), min: 255, max: 255 };
}

async function xiaoliangRhCaptureRgbPreviewPng({ app, imaging, doc, bounds, maxSize, layerID }) {
    const targetSize = xiaoliangRhPreviewTarget(bounds, maxSize);
    const options = {
        documentID: doc.id,
        sourceBounds: bounds,
        targetSize,
        componentSize: 8,
        colorSpace: "RGB",
        applyAlpha: false,
    };
    if (layerID != null && Number.isFinite(Number(layerID))) options.layerID = Number(layerID);
    try {
        if (doc.colorProfileName && doc.colorProfileName !== "sRGB IEC61966-2.1") options.colorProfile = "sRGB IEC61966-2.1";
    } catch (_) {}
    const pixelResult = await xiaoliangRhGetPixelsWithDepthFallback(app, imaging, doc, options);
    const imageData = pixelResult.imageData;
    try {
        const width = imageData.width;
        const height = imageData.height;
        const components = imageData.components || 3;
        const pixels = xiaoliangRhTypedPixelsToByteArray(await xiaoliangRhGetImageDataBuffer(imageData), width * height * components);
        const pngBytes = encodePNGFromRGB(width, height, pixels, components);
        return `data:image/png;base64,${btoa(_uint8ToBinaryFallback(pngBytes))}`;
    } finally {
        try { imageData.dispose?.(); } catch (_) {}
    }
}

function xiaoliangRhAssertPreviewReadableMode(doc) {
    let modeName = "";
    try {
        modeName = String(doc?.mode || "").toLowerCase();
    } catch (_) {
        modeName = "";
    }
    const unsupported = ["cmyk", "bitmap", "indexed", "multichannel"].some((token) => modeName.includes(token));
    if (unsupported) throw new Error("[UNSUPPORTED_MODE] Current document color mode is unsupported. Convert to RGB first.");
}

function xiaoliangRhNumberFromPsValue(value) {
    if (value == null) return NaN;
    if (typeof value === "number") return Number.isNaN(value) ? NaN : value;
    if (typeof value === "object" && value && "_value" in value) return Number(value._value);
    return Number(value);
}

function xiaoliangRhDocumentPixelSize(doc) {
    return {
        width: Math.max(1, Math.round(xiaoliangRhNumberFromPsValue(doc?.width) || 0)),
        height: Math.max(1, Math.round(xiaoliangRhNumberFromPsValue(doc?.height) || 0)),
    };
}

function xiaoliangRhRectFromPsBounds(rawBounds, { requirePositive = false } = {}) {
    if (!rawBounds || typeof rawBounds !== "object") return null;
    const rect = {
        left: Math.floor(xiaoliangRhNumberFromPsValue(rawBounds.left) || 0),
        top: Math.floor(xiaoliangRhNumberFromPsValue(rawBounds.top) || 0),
        right: Math.ceil(xiaoliangRhNumberFromPsValue(rawBounds.right) || 0),
        bottom: Math.ceil(xiaoliangRhNumberFromPsValue(rawBounds.bottom) || 0),
    };
    if (requirePositive && !(rect.right > rect.left && rect.bottom > rect.top)) return null;
    return rect;
}

function xiaoliangRhClampRectToDocument(rect, docWidth, docHeight) {
    const left = Math.max(0, Math.min(rect.left, docWidth - 1));
    const top = Math.max(0, Math.min(rect.top, docHeight - 1));
    return {
        left,
        top,
        right: Math.max(left + 1, Math.min(rect.right, docWidth)),
        bottom: Math.max(top + 1, Math.min(rect.bottom, docHeight)),
    };
}

async function xiaoliangRhReadActiveSelectionRect(app, doc, { allowDomFallback = true } = {}) {
    try {
        const selectionInfo = await app.batchPlay([
            {
                _obj: "get",
                _target: [
                    { _property: "selection" },
                    { _ref: "document", _enum: "ordinal", _value: "targetEnum" },
                ],
            },
        ], { synchronousExecution: false });
        const descriptorBounds = selectionInfo?.[0]?.selection?.bounds || selectionInfo?.[0]?.selection;
        const descriptorRect = xiaoliangRhRectFromPsBounds(descriptorBounds, { requirePositive: true });
        if (descriptorRect) return descriptorRect;
    } catch (error) {
        console.warn("[XiaoLiangRH capture] selection descriptor unavailable", error);
    }
    return allowDomFallback
        ? xiaoliangRhRectFromPsBounds(doc?.selection?.bounds, { requirePositive: true })
        : null;
}

async function xiaoliangRhResolveCaptureBounds(app, doc, opts, docWidth, docHeight) {
    const frozenRect = xiaoliangRhRectFromPsBounds(opts?.frozenBounds || opts?.sourceBounds);
    if (frozenRect) return xiaoliangRhClampRectToDocument(frozenRect, docWidth, docHeight);
    const pickedRect = await xiaoliangRhReadActiveSelectionRect(app, doc);
    if (opts?.requireSelection && !pickedRect) throw new Error("[NO_SELECTION]请先用框选工具框选需要处理的图片区域");
    const sourceRect = pickedRect || { left: 0, top: 0, right: docWidth, bottom: docHeight };
    return xiaoliangRhClampRectToDocument(sourceRect, docWidth, docHeight);
}

function xiaoliangRhBytesFromImageDataUrl(dataUrl) {
    const match = String(dataUrl || "").match(/^data:image\/(\w+);base64,(.+)$/s);
    if (!match) throw new Error("无效的 data URL");
    const ext = match[1] === "jpeg" ? "jpg" : String(match[1] || "png").toLowerCase();
    const binary = atob(match[2] || "");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return { bytes, ext, contentType: `image/${ext === "jpg" ? "jpeg" : ext}` };
}

function xiaoliangRhReaderValueToBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value?.buffer instanceof ArrayBuffer) {
        const offset = Number(value.byteOffset || 0);
        const length = Number(value.byteLength || value.length || 0);
        return new Uint8Array(value.buffer, offset, length);
    }
    return null;
}

function xiaoliangRhMergeByteChunks(chunks, totalBytes) {
    const merged = new Uint8Array(totalBytes);
    let cursor = 0;
    for (const chunk of chunks) {
        merged.set(chunk, cursor);
        cursor += Number(chunk.byteLength || chunk.length || 0);
    }
    return merged;
}

function xiaoliangRhEmitDownloadProgress(progressSink, requestId, loaded, total, phase = "downloading") {
    if (typeof progressSink !== "function") return;
    const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100))) : 0;
    progressSink({ type: "network.downloadProgress", requestId, loaded, total, percent: pct, phase });
}

async function xiaoliangRhResponseBytes(response, { requestId, progressSink } = {}) {
    const declaredTotal = Number(response.headers?.get?.("content-length") || 0) || 0;
    const reader = response.body?.getReader?.();
    if (!reader) {
        const bytes = new Uint8Array(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
        xiaoliangRhEmitDownloadProgress(progressSink, requestId, bytes.length, bytes.length);
        return bytes;
    }
    const chunks = [];
    let loaded = 0;
    let lastProgressAt = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = xiaoliangRhReaderValueToBytes(value);
        const chunkLength = Number(chunk?.byteLength || chunk?.length || 0);
        if (chunk && chunkLength > 0) {
            chunks.push(chunk);
            loaded += chunkLength;
        }
        const now = Date.now();
        if (now - lastProgressAt > 120) {
            xiaoliangRhEmitDownloadProgress(progressSink, requestId, loaded, declaredTotal);
            lastProgressAt = now;
        }
    }
    const streamed = loaded > 0 ? xiaoliangRhMergeByteChunks(chunks, loaded) : null;
    const bytes = streamed || new Uint8Array(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
    xiaoliangRhEmitDownloadProgress(progressSink, requestId, bytes.length, declaredTotal || bytes.length);
    return bytes;
}

async function xiaoliangRhLoadResultImageBytes(imageUrl, { timeoutMs, requestId, progressSink } = {}) {
    if (String(imageUrl || "").startsWith("data:")) return xiaoliangRhBytesFromImageDataUrl(imageUrl);
    const timeout = typeof timeoutMs === "number" ? Math.max(1000, timeoutMs + 60000) : 660000;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
    try {
        const response = await fetch(imageUrl, { method: "GET", signal: controller?.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await xiaoliangRhResponseBytes(response, { requestId, progressSink });
        const contentType = String(response.headers?.get?.("content-type") || "");
        return { bytes, contentType, ext: inferExtFromContentType(contentType, inferExtFromUrl(imageUrl)) };
    } catch (error) {
        if (error?.name === "AbortError") throw new Error("请求超时");
        throw error;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function xiaoliangRhOpenShellPath(pathOrUrl) {
    const rawPath = String(pathOrUrl || "");
    const attempts = [];
    try {
        if (/^[a-zA-Z]:[\\/]/.test(rawPath) || /^\\\\/.test(rawPath)) {
            const opened = await openNativeFolderInHost(rawPath);
            return { ok: true, nativePath: rawPath, opener: opened.opener, attempts: opened.attempts || [] };
        }
        const result = await shell.openPath(pathOrUrl, "小梁RH正在打开文件");
        if (result) throw new Error(String(result));
        return { ok: true, opener: "uxp" };
    } catch (error) {
        attempts.push(error?.message || String(error));
    }
    if (/^[a-zA-Z]:[\\/]/.test(rawPath) || /^\\\\/.test(rawPath)) {
        throw new Error(`openPath failed: ${attempts.join(" / ")}`);
    }
    try {
        if (typeof shell.openExternal === "function") {
            const result = await shell.openExternal(rawPath, "小梁RH正在打开链接");
            if (result) throw new Error(String(result));
            return { ok: true, opener: "uxp-external" };
        }
    } catch (fallbackError) {
        attempts.push(fallbackError?.message || String(fallbackError));
    }
    throw new Error(`openPath failed: ${attempts.join(" / ")}`);
}

async function xiaoliangRhOpenExternalUrl(url) {
    const opener = typeof shell.openExternal === "function" ? shell.openExternal : shell.openPath;
    await opener.call(shell, url);
    return { ok: true };
}

async function xiaoliangRhOpenBundledPluginFile(relativePath) {
    const pluginFolder = await fs.getPluginFolder();
    const parts = String(relativePath || "").replace(/\\/g, "/").split("/").filter(Boolean);
    let entry = null;
    try {
        entry = await pluginFolder.getEntry(relativePath);
    } catch (_) {
        let cursor = pluginFolder;
        for (let index = 0; index < parts.length; index += 1) {
            cursor = await cursor.getEntry(parts[index]);
            if (index < parts.length - 1 && cursor?.isFile) throw new Error(`Folder not found: ${parts[index]}`);
        }
        entry = cursor;
    }
    if (!entry?.isFile) throw new Error(`File not found: ${relativePath}`);
    await shell.openPath(entry.nativePath);
    return { ok: true };
}

async function xiaoliangRhDataFolderSettingsFile({ create = false } = {}) {
    const dataFolder = await fs.getDataFolder();
    return create
        ? dataFolder.createFile("settings.json", { overwrite: true })
        : dataFolder.getEntry("settings.json");
}

async function xiaoliangRhReadSettingsTextOrNull() {
    try {
        const entry = await xiaoliangRhDataFolderSettingsFile();
        const text = await entry.read({ format: formats.utf8 });
        return typeof text === "string" ? text : "";
    } catch (_) {
        return null;
    }
}

async function xiaoliangRhWriteSettingsText(content) {
    const file = await xiaoliangRhDataFolderSettingsFile({ create: true });
    await file.write(typeof content === "string" ? content : String(content), { format: formats.utf8 });
    return { ok: true };
}

async function xiaoliangRhBackupSettingsIfNonEmpty(dataFolder) {
    const raw = await xiaoliangRhReadSettingsTextOrNull();
    if (!raw || !raw.replace(/^\uFEFF/, "").trim()) return false;
    const backup = await dataFolder.createFile(`settings.corrupt.${Date.now()}.json`, { overwrite: true });
    await backup.write(raw, { format: formats.utf8 });
    return true;
}

async function xiaoliangRhQuarantineSettingsAndReset() {
    try {
        const dataFolder = await fs.getDataFolder();
        let backupWritten = false;
        try { backupWritten = await xiaoliangRhBackupSettingsIfNonEmpty(dataFolder); } catch (_) { backupWritten = false; }
        await xiaoliangRhWriteSettingsText("{}");
        return { ok: true, backupWritten };
    } catch (error) {
        return { ok: false, error: String(error?.message || error) };
    }
}

function xiaoliangRhBuildFetchTimeout(opts = {}) {
    const buffer = typeof opts.hostTimeoutBufferMs === "number" ? Math.max(0, opts.hostTimeoutBufferMs) : 60000;
    return typeof opts.timeoutMs === "number" ? opts.timeoutMs + buffer : 660000;
}

function xiaoliangRhFetchController(timeoutMs) {
    if (typeof AbortController === "undefined") return { controller: null, timeoutId: null };
    const controller = new AbortController();
    return { controller, timeoutId: setTimeout(() => controller.abort(), timeoutMs) };
}

async function xiaoliangRhReadFetchResponse(resp, returnBinary) {
    if (returnBinary) {
        const bytes = new Uint8Array(await resp.arrayBuffer().catch(() => new ArrayBuffer(0)));
        const binary = typeof TextDecoder !== "undefined" ? new TextDecoder("latin1").decode(bytes) : _uint8ToBinaryFallback(bytes);
        return {
            ok: resp.ok,
            status: resp.status,
            statusText: resp.statusText || "",
            bodyBase64: btoa(binary),
            contentType: resp.headers.get("content-type") || "",
        };
    }
    return {
        ok: resp.ok,
        status: resp.status,
        statusText: resp.statusText || "",
        body: await resp.text().catch(() => ""),
    };
}

async function xiaoliangRhHostFetch(reqUrl, opts = {}) {
    const { controller, timeoutId } = xiaoliangRhFetchController(xiaoliangRhBuildFetchTimeout(opts));
    try {
        const fetchOpts = { method: opts.method || "GET", headers: opts.headers || {}, body: opts.body };
        if (controller) fetchOpts.signal = controller.signal;
        return await xiaoliangRhReadFetchResponse(await fetch(reqUrl, fetchOpts), opts.returnBinary === true);
    } catch (error) {
        if (error?.name === "AbortError") throw new Error("请求超时");
        throw error;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

function xiaoliangRhHeadersForMultipart(headers) {
    const next = { ...(headers && typeof headers === "object" ? headers : {}) };
    for (const key of Object.keys(next)) {
        if (String(key).toLowerCase() === "content-type") delete next[key];
    }
    return next;
}

function xiaoliangRhBytesFromBase64Payload(payload) {
    const text = String(payload || "").trim();
    if (!text) return null;
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

function xiaoliangRhUploadFetchError(error, timeoutMs) {
    const aborted = error?.name === "AbortError";
    return {
        ok: false,
        status: 0,
        ...(aborted ? { code: "RH_UPLOAD_TIMEOUT" } : {}),
        message: aborted ? `上传超时（${Math.round(timeoutMs / 1000)}秒）` : error?.message || String(error),
    };
}

async function xiaoliangRhParseUploadBinaryResponse(response) {
    const bodyText = await response.text().catch(() => "");
    if (!response.ok) return { ok: false, status: response.status, message: response.statusText || "" };
    let envelope;
    try {
        envelope = JSON.parse(bodyText || "{}");
    } catch (_) {
        return { ok: false, status: response.status, message: "上传响应不是合法 JSON" };
    }
    const code = Number(envelope?.code ?? envelope?.env?.code ?? 0);
    const message = String(envelope?.message ?? envelope?.env?.message ?? "");
    const data = envelope?.data && typeof envelope.data === "object" ? envelope.data : {};
    if (code !== 0) return { ok: false, status: response.status, code, message: message || "上传失败" };
    const uploadedName = String(data.fileName || data.file_name || data.path || data.filePath || data.file_path || "").trim();
    if (!uploadedName) return { ok: false, status: response.status, message: "上传成功但未返回 fileName" };
    const downloadUrl = extractDownloadUrlFromData(data) || undefined;
    return {
        ok: true,
        status: response.status,
        fileName: uploadedName,
        downloadUrl,
        type: typeof data.type === "string" ? String(data.type) : undefined,
        size: data.size != null ? String(data.size) : undefined,
    };
}

async function xiaoliangRhPostRunningHubBinaryUpload({ uploadUrl, apiKey, bytes, mimeType, fileName, timeoutMs }) {
    const formData = new FormData();
    formData.append("file", new Blob([bytes], { type: mimeType }), fileName);
    const { controller, timeoutId } = xiaoliangRhFetchController(timeoutMs);
    try {
        const response = await fetch(uploadUrl, {
            method: "POST",
            body: formData,
            headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": PLUGIN_HTTP_USER_AGENT_RH },
            ...(controller ? { signal: controller.signal } : {}),
        });
        return xiaoliangRhParseUploadBinaryResponse(response);
    } catch (error) {
        return xiaoliangRhUploadFetchError(error, timeoutMs);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

function xiaoliangRhAppendPlainFormFields(formData, fields) {
    for (const [key, value] of Object.entries(fields || {})) {
        if (value != null) formData.append(key, String(value));
    }
}

function xiaoliangRhAppendMultipartBytes(formData, fieldName, bytes, mimeType, fileName) {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) return;
    const name = safeUploadFileName(fileName, "image.png");
    const type = String(mimeType || "image/png").trim() || "image/png";
    formData.append(String(fieldName || "file").trim() || "file", new Blob([bytes], { type }), name);
}

async function xiaoliangRhPostMultipart(reqUrl, formData, headers) {
    try {
        const response = await fetch(reqUrl, { method: "POST", body: formData, headers: xiaoliangRhHeadersForMultipart(headers) });
        return { ok: response.ok, status: response.status, statusText: response.statusText || "", body: await response.text().catch(() => "") };
    } catch (error) {
        return { ok: false, status: 0, statusText: error?.message || String(error), body: "" };
    }
}

async function xiaoliangRhFetchMultipartSingle(args) {
    const [reqUrl, formFields = {}, fileBase64, fileName = "image.png", mimeType = "image/png", extraHeaders = {}, fileFieldName = "file"] = args;
    const formData = new FormData();
    xiaoliangRhAppendPlainFormFields(formData, formFields);
    xiaoliangRhAppendMultipartBytes(formData, String(fileFieldName || "file").trim() || "file", xiaoliangRhBytesFromBase64Payload(fileBase64), mimeType, fileName);
    return xiaoliangRhPostMultipart(reqUrl, formData, extraHeaders);
}

async function xiaoliangRhFetchMultipartMany(args) {
    const [reqUrl, formFields = {}, fileParts = [], extraHeaders = {}] = args;
    const formData = new FormData();
    xiaoliangRhAppendPlainFormFields(formData, formFields);
    for (const part of Array.isArray(fileParts) ? fileParts : []) {
        const bytes = xiaoliangRhBytesFromBase64Payload(part?.base64);
        if (!bytes) continue;
        xiaoliangRhAppendMultipartBytes(
            formData,
            String(part?.field || "file").trim() || "file",
            bytes,
            String(part?.mimeType || "image/png").trim() || "image/png",
            String(part?.fileName || "image.png").trim() || "image.png"
        );
    }
    return xiaoliangRhPostMultipart(reqUrl, formData, extraHeaders);
}

async function xiaoliangRhFetchMultipartUploadSession(args) {
    const [reqUrl, formFields = {}, uploadSessionId, fileName = "image.png", mimeType = "image/png", extraHeaders = {}, fileFieldName = "file"] = args;
    const taken = peekUploadSession(String(uploadSessionId || ""));
    if (!taken) return { __xlrhError: "uploadSession 无效或已过期" };
    const formData = new FormData();
    xiaoliangRhAppendPlainFormFields(formData, formFields);
    xiaoliangRhAppendMultipartBytes(formData, String(fileFieldName || "file").trim() || "file", taken.bytes, mimeType || taken.mimeType, fileName);
    return xiaoliangRhPostMultipart(reqUrl, formData, extraHeaders);
}

function xiaoliangRhExtractStreamText(line) {
    const text = String(line || "").trim();
    if (!text.startsWith("data:")) return "";
    const payload = text.slice(5).trim();
    if (!payload || payload === "[DONE]") return "";
    try {
        const parts = JSON.parse(payload)?.candidates?.[0]?.content?.parts;
        return Array.isArray(parts) ? parts.map((part) => part?.text ? String(part.text) : "").join("") : "";
    } catch (_) {
        return "";
    }
}

async function xiaoliangRhCollectTextStream(resp, streamId, sendToWebview) {
    const reader = resp.body?.getReader?.();
    if (!reader) return resp.text().catch(() => "");
    const decoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;
    let body = "";
    let pending = "";
    const absorb = (line) => {
        const chunk = xiaoliangRhExtractStreamText(line);
        if (!chunk) return;
        body += chunk;
        if (streamId) sendToWebview({ type: "streamChunk", streamId, chunk });
    };
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder ? decoder.decode(value, { stream: true }) : _uint8ToBinaryFallback(new Uint8Array(value));
        const lines = pending.split("\n");
        pending = lines.pop() || "";
        lines.forEach(absorb);
    }
    absorb(pending);
    return body;
}

async function xiaoliangRhHostFetchStream(reqUrl, opts = {}, sendToWebview) {
    const timeoutMs = opts.timeoutMs ?? 120000;
    const { controller, timeoutId } = xiaoliangRhFetchController(timeoutMs);
    try {
        const fetchOpts = { method: opts.method || "GET", headers: opts.headers || {}, body: opts.body };
        if (controller) fetchOpts.signal = controller.signal;
        const resp = await fetch(reqUrl, fetchOpts);
        if (!resp.ok) {
            return { ok: false, status: resp.status, statusText: resp.statusText || "", body: await resp.text().catch(() => "") };
        }
        return { ok: true, status: resp.status, statusText: resp.statusText || "", body: await xiaoliangRhCollectTextStream(resp, opts.streamId, sendToWebview) };
    } catch (error) {
        if (error?.name === "AbortError") throw new Error("请求超时");
        throw error;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

function createJimpFromRGBAHost(rgbaData, width, height) {
    const data = rgbaData instanceof Uint8Array ? rgbaData : new Uint8Array(rgbaData);
    return new Jimp({ data, width, height });
}

async function encodeJPEGFromRGBAHost(w, h, rgbaData, quality = 92) {
    const qRaw = Number(quality);
    const q = Math.max(1, Math.min(100, Number.isFinite(qRaw) ? qRaw : 92));
    const img = createJimpFromRGBAHost(rgbaData, w, h);
    const buffer = await img.getBuffer(JimpMime.jpeg, { quality: q });
    return new Uint8Array(buffer);
}

function dataUrlToBytesHost(dataUrl) {
    const s = String(dataUrl || "");
    const m = s.match(/^data:[^;]+;base64,(.+)$/s);
    if (!m) return null;
    const bin = atob(m[1] || "");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

async function encodeJPEGFromRGBAWithCanvasHost(w, h, rgbaData, quality = 0.92) {
    const qRaw = Number(quality);
    const q = Math.max(0.1, Math.min(1, Number.isFinite(qRaw) ? (qRaw > 1 ? qRaw / 100 : qRaw) : 0.92));
    let canvas = null;
    if (typeof OffscreenCanvas === "function") {
        canvas = new OffscreenCanvas(w, h);
    } else if (typeof document !== "undefined" && document.createElement) {
        canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
    }
    if (!canvas) throw new Error("canvas unavailable");
    const ctx = canvas.getContext && canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    const clamped = rgbaData instanceof Uint8ClampedArray ? rgbaData : new Uint8ClampedArray(rgbaData);
    let imageData;
    if (typeof ImageData === "function") {
        imageData = new ImageData(clamped, w, h);
    } else if (typeof ctx.createImageData === "function") {
        imageData = ctx.createImageData(w, h);
        imageData.data.set(clamped);
    } else {
        throw new Error("ImageData unavailable");
    }
    ctx.putImageData(imageData, 0, 0);
    if (typeof canvas.convertToBlob === "function") {
        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: q });
        return new Uint8Array(await blob.arrayBuffer());
    }
    if (typeof canvas.toBlob === "function") {
        const blob = await new Promise((resolve, reject) => {
            try {
                canvas.toBlob((b) => b ? resolve(b) : reject(new Error("jpeg blob empty")), "image/jpeg", q);
            } catch (e) {
                reject(e);
            }
        });
        return new Uint8Array(await blob.arrayBuffer());
    }
    if (typeof canvas.toDataURL === "function") {
        const bytes = dataUrlToBytesHost(canvas.toDataURL("image/jpeg", q));
        if (bytes) return bytes;
    }
    throw new Error("jpeg export unavailable");
}

/** Shared capture implementation; must run inside executeAsModal. */
async function xiaoliangRhExecutePsCaptureSelectionModalCore(mode, sizeOpts) {
    const app = photoshop.app;
    const imaging = photoshop.imaging;
    const doc = app.activeDocument;
    if (!doc) throw new Error("No active document");
    xiaoliangRhAssertPreviewReadableMode(doc);
    const { width: docW, height: docH } = xiaoliangRhDocumentPixelSize(doc);
    const opts = typeof sizeOpts === "number" ? { _legacyMaxSize: sizeOpts } : (sizeOpts || {});
    const splitMaskMode = Boolean(opts.splitMaskMode);
    const returnHostSession = Boolean(opts.__returnHostSession);
    let bounds = await xiaoliangRhResolveCaptureBounds(app, doc, opts, docW, docH);
    let layerID = null;
    ({ bounds, layerID } = await xiaoliangRhApplyLayerScopeToCapture(app, doc, bounds, docW, docH, mode));
    const targetSize = xiaoliangRhResolveCaptureTargetSize(bounds, opts, mode);
    const options = {
        documentID: doc.id,
        sourceBounds: bounds,
        targetSize,
        componentSize: 8,
        colorSpace: "RGB",
        applyAlpha: true,
        hasAlpha: true,
    };
    if (mode === "layer" && layerID != null) {
        const idNum = Number(layerID);
        if (!isNaN(idNum)) options.layerID = idNum;
    }
    try {
        if (doc.colorProfileName && doc.colorProfileName !== "sRGB IEC61966-2.1") {
            options.colorProfile = "sRGB IEC61966-2.1";
        }
    } catch (e) {}
    const pixelResult = await xiaoliangRhGetPixelsWithDepthFallback(app, imaging, doc, options);
    const imageData = pixelResult.imageData;
    const pw = imageData.width;
    const ph = imageData.height;
    const components = imageData.components;
    const raw8 = xiaoliangRhTypedPixelsToByteArray(await xiaoliangRhGetImageDataBuffer(imageData), pw * ph * components);
    let rgbaData = xiaoliangRhPixelsToRgba(raw8, components, pw, ph);
    Promise.resolve().then(() => { try { imageData.dispose?.(); } catch (e) {} });
    if (mode === "layer" && layerID) {
        if (!splitMaskMode) {
            try {
                const mask = await xiaoliangRhReadLayerMaskGray({ imaging, docId: doc.id, layerID, bounds, targetSize, width: pw, height: ph });
                if (mask?.gray) xiaoliangRhApplyGrayMaskToAlpha(rgbaData, mask.gray, "multiply");
            } catch (e) { console.warn("[Mask]", e); }
        } else {
            xiaoliangRhSetAlphaToValue(rgbaData, 255);
        }
    }
    /** @type {string | undefined} */
    let maskUploadBase64;
    let maskMin = -1;
    let maskMax = -1;
    if (splitMaskMode && mode === "layer" && layerID) {
        try {
            const mask = await xiaoliangRhReadLayerMaskGray({ imaging, docId: doc.id, layerID, bounds, targetSize, width: pw, height: ph });
            if (mask?.gray) {
                if (mask.max === 0) throw new Error("Layer mask is fully black; upload blocked");
                xiaoliangRhApplyGrayMaskToAlpha(rgbaData, mask.gray, "replace");
                maskMin = mask.min;
                maskMax = mask.max;
                maskUploadBase64 = xiaoliangRhMaskUploadBase64(pw, ph, mask.gray);
            }
        } catch (e3) { console.warn("[Mask split upload]", e3); }
        if (!maskUploadBase64) {
            const fallbackMask = xiaoliangRhWhiteMaskUpload(pw, ph);
            maskUploadBase64 = fallbackMask.uploadBase64;
            maskMin = fallbackMask.min;
            maskMax = fallbackMask.max;
        }
    }
    if (returnHostSession) {
        const wantJpeg = String(opts.uploadEncodeFormat || "").toLowerCase() === "jpeg";
        const jpegQuality = Number(opts.jpegQuality);
        let uploadBytes = null;
        let uploadMime = "image/png";
        let uploadFormat = "png";
        if (wantJpeg && !maskUploadBase64) {
            const jpegPixels = flattenAlphaToWhiteHost(rgbaData);
            try {
                uploadBytes = await encodeJPEGFromRGBAHost(
                    pw,
                    ph,
                    jpegPixels,
                    Number.isFinite(jpegQuality) ? jpegQuality : 92
                );
                uploadMime = "image/jpeg";
                uploadFormat = "jpg";
            } catch (jpegErr) {
                try {
                    uploadBytes = await encodeJPEGFromRGBAWithCanvasHost(
                        pw,
                        ph,
                        jpegPixels,
                        Number.isFinite(jpegQuality) ? jpegQuality : 92
                    );
                    uploadMime = "image/jpeg";
                    uploadFormat = "jpg";
                } catch (canvasJpegErr) {
                    console.warn("[XiaoLiangRH] JPEG capture encode failed, fallback to PNG:", jpegErr, canvasJpegErr);
                }
            }
        }
        if (!uploadBytes) {
            uploadBytes = encodePNGFromRGBA(pw, ph, rgbaData);
            uploadMime = "image/png";
            uploadFormat = "png";
        }
        const previewBase64 = opts.__previewFromUpload
            ? await xiaoliangRhBuildPreviewDataUrlFromBytes(uploadBytes, uploadMime, opts.previewMaxEdge || 256)
            : "";
        const retainUntilRelease = Boolean(opts.__retainUploadSession);
        const uploadSessionId = putUploadSession(uploadBytes, uploadMime, {
            width: pw,
            height: ph,
            bounds,
            mode,
            uploadFormat,
            uploadByteLength: uploadBytes.length,
            maskUploadBase64: Boolean(maskUploadBase64),
            ...(retainUntilRelease ? { retainUntilRelease: true } : {}),
        });
        return {
            uploadSessionId,
            uploadWidth: pw,
            uploadHeight: ph,
            docId: doc.id,
            bounds,
            mimeType: uploadMime,
            uploadFormat,
            uploadByteLength: uploadBytes.length,
            ...(previewBase64 ? { previewBase64 } : {}),
            ...(maskUploadBase64
                ? { maskUploadBase64, maskMin, maskMax }
                : {}),
        };
    }
    const out = {
        rgbaBase64: btoa(_uint8ToBinaryFallback(rgbaData)),
        width: pw,
        height: ph,
        docId: doc.id,
        bounds,
    };
    if (maskUploadBase64) {
        out.maskUploadBase64 = maskUploadBase64;
        out.maskMin = maskMin;
        out.maskMax = maskMax;
    }
    return out;
}

export function setupBridge(webviewEl) {
    if (webviewEl) _xiaoliangRhBridgeMainWebviewEl = webviewEl;

    const sendToWebview = (msg) => xiaoliangRhBridgePostToMainApp(msg);

    const handleMessage = async (e) => {
        const data = e.data;
        if (!data || typeof data !== "object" || !data.id || !data.method) return;

        const { id, method, args = [] } = data;
        let result, error;

        try {
            if (XLRH_STORAGE_METHODS.has(method)) {
                result = await handleXlrhStorageBridgeMethod(method, args);
                sendToWebview({ id, result });
                return;
            }
            switch (method) {
                case "storage.getManifestVersion": {
                    try {
                        const pluginFolder = await fs.getPluginFolder();
                        const entry = await pluginFolder.getEntry("manifest.json");
                        const data = await entry.read({ format: formats.utf8 });
                        const manifest = typeof data === "string" ? JSON.parse(data) : {};
                        result = manifest.version || "0.0.0";
                    } catch (e) {
                        result = "0.0.0";
                    }
                    break;
                }
                case "storage.readSettings": {
                    result = await xiaoliangRhReadSettingsTextOrNull();
                    break;
                }
                case "storage.writeSettings": {
                    const [content] = args;
                    result = await xiaoliangRhWriteSettingsText(content);
                    break;
                }
                case "storage.quarantineAndResetSettings": {
                    result = await xiaoliangRhQuarantineSettingsAndReset();
                    break;
                }
                case "storage.getMachineStableId": {
                    try {
                        const input = [
                            os.hostname() || "",
                            os.platform() || "",
                            os.homedir ? (os.homedir() || "") : "",
                        ].join("|");
                        let hash = 5381;
                        for (let i = 0; i < input.length; i++) {
                            hash = ((hash << 5) + hash) + input.charCodeAt(i);
                            hash = hash & 0xffffffff;
                        }
                        const hex = (hash >>> 0).toString(36);
                        result = "m_" + hex;
                    } catch (e) {
                        result = null;
                    }
                    break;
                }
                case "ps.batchPlay": {
                    const [actions, opts] = args;
                    result = await photoshop.action.batchPlay(actions, opts || {});
                    break;
                }
                case "ps.app.activeDocument": {
                    const doc = photoshop.app.activeDocument;
                    result = doc ? { id: doc.id, name: doc.name } : null;
                    break;
                }
                case "ps.getSelectionBounds": {
                    const mode = args[0];
                    result = await photoshop.core.executeAsModal(async () => {
                        const app = photoshop.app;
                        const doc = app.activeDocument;
                        if (!doc) return null;
                        const b = await computeSelectionBoundsForRh(app, doc, mode);
                        if (!b) console.warn("[getSelectionBounds] no valid bounds");
                        return b;
                    }, { commandName: "获取选区边界" });
                    break;
                }
                case "ps.getActiveSelectionBounds": {
                    const mode = args[0];
                    result = await photoshop.core.executeAsModal(async () => {
                        const app = photoshop.app;
                        const doc = app.activeDocument;
                        if (!doc) return null;
                        const docW = Math.max(1, Math.round(xiaoliangRhNumberFromPsValue(doc.width) || 0));
                        const docH = Math.max(1, Math.round(xiaoliangRhNumberFromPsValue(doc.height) || 0));
                        let b = await xiaoliangRhReadActiveSelectionRect(app, doc, { allowDomFallback: false });
                        if (!b) return null;
                        b = xiaoliangRhClampRectToDocument(b, docW, docH);
                        let layerID = null;
                        ({ bounds: b, layerID } = await xiaoliangRhApplyLayerScopeToCapture(app, doc, b, docW, docH, mode));
                        return { docId: doc.id, bounds: b, layerID, width: Math.max(1, b.right - b.left), height: Math.max(1, b.bottom - b.top) };
                    }, { commandName: "读取当前选区" });
                    break;
                }
                case "ps.clearActiveSelection": {
                    result = await photoshop.core.executeAsModal(async () => {
                        await photoshop.action.batchPlay([
                            {
                                _obj: "set",
                                _target: [{ _ref: "channel", _property: "selection" }],
                                to: { _enum: "ordinal", _value: "none" },
                            },
                        ], { synchronousExecution: true });
                        return { ok: true };
                    }, { commandName: "清除当前选区" });
                    break;
                }
                case "ps.rhRecordRunPlaceContext": {
                    const mode = args[0];
                    result = await photoshop.core.executeAsModal(async () => {
                        const app = photoshop.app;
                        const doc = app.activeDocument;
                        if (!doc) return null;
                        const docId = doc.id;
                        const docName = doc.name;
                        const bounds = await computeSelectionBoundsForRh(app, doc, mode);
                        if (!bounds) return null;
                        return { docId, docName, bounds };
                    }, { commandName: "RunningHub record place context" });
                    break;
                }
                case "ps.applyTaskPlaceContext": {
                    const [payload] = args;
                    const p = payload && typeof payload === "object" ? payload : {};
                    result = await photoshop.core.executeAsModal(async () => {
                        await xiaoliangRhApplyTaskPlaceContextInModal(p);
                    }, { commandName: "RunningHub 任务还原文档与选区" });
                    break;
                }
                case "ps.addNotificationListener": {
                    const [events, listenerId] = args;
                    result = xiaoliangRhAddPsNotificationBridge(events, listenerId, sendToWebview);
                    break;
                }
                case "ps.removeNotificationListener": {
                    const [listenerId] = args;
                    result = xiaoliangRhRemovePsNotificationBridge(listenerId);
                    break;
                }
                case "ps.commandOpenDocument": {
                    const [fileSessionToken] = args;
                    await photoshop.core.executeAsModal(
                        async () => {
                            await photoshop.action.batchPlay([
                                { _obj: "open", null: { _path: fileSessionToken, _kind: "local" } },
                            ], { synchronousExecution: false });
                        },
                        { commandName: "打开图片为新文档" }
                    );
                    result = { ok: true };
                    break;
                }
                case "ps.commandPlaceToDocument": {
                    const [docId, fileSessionToken, savedBounds, placeOpts] = args;
                    result = await xiaoliangRhPlaceFileTokenIntoPs({
                        fileSessionToken,
                        docId,
                        savedBounds,
                        preferSavedBounds: true,
                        placeOpts,
                        commandName: "Place image to document",
                        logTag: "[XiaoLiangRH PlaceDoc]",
                    });
                    break;
                }
                case "ps.commandPlaceFilesIntoNewGroup": {
                    const [folderToken, fileNames, savedBounds, groupName, placeOpts] = args;
                    if (!folderToken || !Array.isArray(fileNames) || fileNames.length === 0) {
                        throw new Error("Valid folder token and file list are required");
                    }
                    const folder = await resolveFolder(folderToken);
                    if (!folder) {
                        throw new Error("Invalid result folder");
                    }
                    const app = photoshop.app;
                    const doc = app.activeDocument;
                    if (!doc) {
                        throw new Error("Please open a document first");
                    }
                    const batchPlay = photoshop.action.batchPlay;
                    const hostNumber = (value) => {
                        if (value == null) return NaN;
                        if (typeof value === "number") return Number.isNaN(value) ? NaN : value;
                        if (typeof value === "object" && value && "_value" in value) return Number(value._value);
                        return Number(value);
                    };
                    const toPlacementRect = (source) => {
                        if (!source || typeof source !== "object") return null;
                        const top = hostNumber(source.top);
                        const left = hostNumber(source.left);
                        const bottom = hostNumber(source.bottom);
                        const right = hostNumber(source.right);
                        if (![top, left, bottom, right].every(Number.isFinite)) return null;
                        const width = right - left;
                        const height = bottom - top;
                        return width > 0 && height > 0
                            ? { top, left, bottom, right, width, height, centerX: left + width / 2, centerY: top + height / 2 }
                            : null;
                    };
                    const readGroupPlacementBounds = async () => {
                        const savedRect = toPlacementRect(savedBounds);
                        if (savedRect) return savedRect;
                        const docReply = await batchPlay(
                            [
                                { _obj: "get", _target: [{ _property: "width" }, { _ref: "document", _enum: "ordinal", _value: "targetEnum" }] },
                                { _obj: "get", _target: [{ _property: "height" }, { _ref: "document", _enum: "ordinal", _value: "targetEnum" }] },
                            ],
                            { synchronousExecution: false }
                        );
                        const width = Math.max(1, Math.round(hostNumber(docReply?.[0]?.width) || 0));
                        const height = Math.max(1, Math.round(hostNumber(docReply?.[1]?.height) || 0));
                        return { top: 0, left: 0, bottom: height, right: width, width, height, centerX: width / 2, centerY: height / 2 };
                    };
                    const finalGroupName = (typeof groupName === "string" && groupName.trim()) ? groupName.trim() : "小梁图修";
                    const placeMaskWarnGrp = [];
                    await photoshop.core.executeAsModal(async () => {
                        const group = await doc.createLayerGroup({ name: finalGroupName });
                        const selBounds = await readGroupPlacementBounds();
                        const { ElementPlacement } = require("photoshop").constants;
                        await xiaoliangRhMoveGroupToDocumentRoot(doc, group, ElementPlacement, "[PlaceFilesIntoGroup]");
                        for (let i = 0; i < fileNames.length; i++) {
                            const fileName = fileNames[i];
                            await xiaoliangRhPlaceFolderImageIntoGroup({
                                storageFs: fs,
                                folder,
                                fileName,
                                batchPlay,
                                doc,
                                group,
                                ElementPlacement,
                                targetBounds: selBounds,
                                placeOpts,
                                warnings: placeMaskWarnGrp,
                                logTag: "[PlaceFilesIntoGroup]",
                            });
                        }
                        await maybeRestoreRectangularSelectionAfterPlace(batchPlay, {
                            placeOpts,
                            activeDoc: doc,
                            selBounds,
                        });
                    }, { commandName: "置入多图到图层组" });
                    result = { ok: true, ...(placeMaskWarnGrp.length ? { maskWarning: placeMaskWarnGrp.join("; ") } : {}) };
                    break;
                }
                case "ps.commandPlaceFilesIntoNewGroupInDocument": {
                    const [docId, folderToken, entries, groupName, placeOpts] = args;
                    if (docId == null || !folderToken || !Array.isArray(entries) || entries.length === 0) {
                        throw new Error("需要 docId、文件夹 token 和 entries 列表");
                    }
                    const folder = await resolveFolder(folderToken);
                    if (!folder) throw new Error("无效的返图文件夹");
                    const app = photoshop.app;
                    const batchPlay = photoshop.action.batchPlay;
                    const finalGroupNameDoc = (typeof groupName === "string" && groupName.trim()) ? groupName.trim() : "小梁图修";
                    const placeMaskWarnDoc = [];
                    await photoshop.core.executeAsModal(async () => {
                        await xiaoliangRhSelectDocumentForPlace(batchPlay, docId);
                        const doc = app.activeDocument;
                        if (!doc) throw new Error("Document does not exist");
                        const canvasBounds = await xiaoliangRhReadCanvasBoundsFromPs(batchPlay);
                        const group = await doc.createLayerGroup({ name: finalGroupNameDoc });
                        const { ElementPlacement } = require("photoshop").constants;
                        await xiaoliangRhMoveGroupToDocumentRoot(doc, group, ElementPlacement, "[XiaoLiangRH PlaceIntoDocumentGroup]");
                        let lastSubcanvasSelBounds = null;
                        for (let i = 0; i < entries.length; i++) {
                            const { fileName, bounds } = entries[i] || {};
                            if (!fileName) continue;
                            const targetBounds = xiaoliangRhSelectionBoundsFromRect(bounds) || canvasBounds;
                            if (!isFullCanvasSelBounds(targetBounds, canvasBounds.width, canvasBounds.height)) {
                                lastSubcanvasSelBounds = targetBounds;
                            }
                            await xiaoliangRhPlaceFolderImageIntoGroup({
                                storageFs: fs,
                                folder,
                                fileName,
                                batchPlay,
                                doc,
                                group,
                                ElementPlacement,
                                targetBounds,
                                placeOpts,
                                warnings: placeMaskWarnDoc,
                                logTag: "[XiaoLiangRH PlaceIntoDocumentGroup]",
                            });
                        }
                        await maybeRestoreRectangularSelectionAfterPlace(batchPlay, {
                            placeOpts,
                            activeDoc: doc,
                            selBounds: lastSubcanvasSelBounds,
                        });
                    }, { commandName: "小梁RH 批量置入文档图层组" });
                    result = { ok: true, ...(placeMaskWarnDoc.length ? { maskWarning: placeMaskWarnDoc.join("; ") } : {}) };
                    break;
                }
                case "ps.commandPlaceFileToCanvas": {
                    const [fileSessionToken, savedBounds, preferSavedBounds, placeOpts] = args;
                    result = await xiaoliangRhPlaceFileTokenIntoPs({
                        fileSessionToken,
                        savedBounds,
                        preferSavedBounds,
                        placeOpts,
                        commandName: "置入图片到选区",
                        logTag: "[XiaoLiangRH PlaceCanvas]",
                    });
                    break;
                }
                case "ps.commandPsGaussianBlur": {
                    const [dataUrl, blurRadius, targetWidth] = args;
                    const app = photoshop.app;
                    const fs2 = storage.localFileSystem;
                    const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
                    if (!match) {
                        result = dataUrl;
                        break;
                    }
                    const mimeType = match[1];
                    const base64Data = match[2];
                    const binaryStr = atob(base64Data);
                    const bytes = new Uint8Array(binaryStr.length);
                    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                    const tempFolder = await fs2.getTemporaryFolder();
                    let ext = "png";
                    if (mimeType === "image/jpeg") ext = "jpg";
                    else if (mimeType === "image/webp") ext = "webp";
                    const tempFileName = "_xiaoliang_rh_blur_temp_" + Date.now() + "." + ext;
                    const tempFile = await tempFolder.createFile(tempFileName, { overwrite: true });
                    await tempFile.write(bytes, { format: formats.binary });
                    const tempToken = await fs2.createSessionToken(tempFile);
                    let blurredDataUrl = dataUrl;
                    const toNum = (v) => {
                        if (v == null) return NaN;
                        if (typeof v === "number" && !isNaN(v)) return v;
                        if (typeof v === "object" && v && "_value" in v) return Number(v._value);
                        return Number(v);
                    };
                    try {
                        await photoshop.core.executeAsModal(async () => {
                            const origDoc = app.activeDocument;
                            await photoshop.action.batchPlay([{ _obj: "open", null: { _path: tempToken, _kind: "local" } }], { synchronousExecution: true });
                            const tempDoc = app.activeDocument;
                            if (!tempDoc) throw new Error("打开临时图片失败");
                            const origW = toNum(tempDoc.width);
                            const origH = toNum(tempDoc.height);
                            if (isNaN(origW) || origW <= 0 || isNaN(origH) || origH <= 0) throw new Error("无法获取图片尺寸");
                            const scale = Math.min((targetWidth || 300) / origW, 1);
                            const newW = Math.round(origW * scale);
                            const newH = Math.round(origH * scale);
                            if (scale < 1) {
                                await photoshop.action.batchPlay([{
                                    _obj: "imageSize",
                                    width: { _unit: "pixelsUnit", _value: newW },
                                    height: { _unit: "pixelsUnit", _value: newH },
                                    scaleStyles: true,
                                    constrainProportions: true,
                                    interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubic" },
                                }], { synchronousExecution: true });
                            }
                            await photoshop.action.batchPlay([{ _obj: "flattenImage" }], { synchronousExecution: true });
                            const effectiveRadius = (blurRadius != null && blurRadius >= 0) ? blurRadius : 20;
                            if (effectiveRadius > 0) {
                                await photoshop.action.batchPlay([{ _obj: "gaussianBlur", radius: { _unit: "pixelsUnit", _value: effectiveRadius } }], { synchronousExecution: true });
                            }
                            const outFileName = "_xiaoliang_rh_blur_out_" + Date.now() + ".jpg";
                            const outFile = await tempFolder.createFile(outFileName, { overwrite: true });
                            const outToken = await fs2.createSessionToken(outFile);
                            await photoshop.action.batchPlay([{
                                _obj: "save",
                                as: { _obj: "JPEG", extendedQuality: 6, matteColor: { _enum: "matteColor", _value: "none" } },
                                in: { _path: outToken, _kind: "local" },
                                copy: true,
                                lowerCase: true,
                            }], { synchronousExecution: true });
                            await photoshop.action.batchPlay([{ _obj: "close", saving: { _enum: "yesNo", _value: "no" } }], { synchronousExecution: true });
                            if (origDoc != null) {
                                try {
                                    const docId = toNum(origDoc.id) || origDoc.id;
                                    if (docId != null && !isNaN(docId)) {
                                        await photoshop.action.batchPlay([{ _obj: "select", null: { _ref: [{ _ref: "document", _id: docId }] } }], { synchronousExecution: true });
                                    }
                                } catch (e) {}
                            }
                            const outData = await outFile.read({ format: formats.binary });
                            const outBytes = outData instanceof Uint8Array ? outData : new Uint8Array(outData || []);
                            blurredDataUrl = "data:image/jpeg;base64," + btoa(_uint8ToBinaryFallback(outBytes));
                            try { await outFile.delete(); } catch (e) {}
                        }, { commandName: "生成模糊背景" });
                    } catch (err) {
                        console.error("[psBlur] Error:", err);
                        throw err;
                    }
                    try { await tempFile.delete(); } catch (e) {}
                    result = blurredDataUrl;
                    break;
                }
                case "ps.imaging.getLayerMask": {
                    const [opts] = args;
                    const maskResult = await photoshop.imaging.getLayerMask(opts);
                    if (!maskResult?.imageData) { result = null; break; }
                    const imgData = maskResult.imageData;
                    let maskData;
                    if (typeof imgData.getData === "function") {
                        maskData = await imgData.getData({});
                    } else if (imgData.data?.length) {
                        maskData = imgData.data;
                    } else { result = null; break; }
                    const arr = maskData instanceof Uint8Array ? maskData : new Uint8Array(maskData);
                    result = { base64: btoa(_uint8ToBinaryFallback(arr)), width: imgData.width, height: imgData.height };
                    try { imgData.dispose?.(); } catch (e) {}
                    break;
                }
                case "shell.openPath": {
                    result = await xiaoliangRhOpenShellPath(args[0]);
                    break;
                }
                case "shell.openExternal": {
                    result = await xiaoliangRhOpenExternalUrl(args[0]);
                    break;
                }
                case "hwMonitor.ensureRunning": {
                    result = await maybeStartHwMonitorServer({ force: args[0] === true });
                    break;
                }
                case "hwMonitor.shutdown": {
                    await requestHwMonitorShutdown();
                    result = { ok: true };
                    break;
                }
                case "shell.openPluginFile": {
                    result = await xiaoliangRhOpenBundledPluginFile(args[0]);
                    break;
                }
                case "network.fetch": {
                    result = await xiaoliangRhHostFetch(args[0], args[1] || {});
                    break;
                }
                case "network.fetchFormData": {
                    result = await xiaoliangRhFetchMultipartSingle(args);
                    break;
                }
                /** multipart 多文件上传 */
                case "network.fetchFormDataMultiFiles": {
                    result = await xiaoliangRhFetchMultipartMany(args);
                    break;
                }
                /** multipart: file bytes come from host upload session, not WebView Base64. */
                case "network.fetchFormDataFromUploadSession": {
                    const uploadResult = await xiaoliangRhFetchMultipartUploadSession(args);
                    if (uploadResult?.__xlrhError) {
                        error = { message: uploadResult.__xlrhError };
                    } else {
                        result = uploadResult;
                    }
                    break;
                }
                case "xiaoliangRh.putUploadSessionFromRawBase64": {
                    const [payload = {}] = args;
                    const raw = String(payload.rawBase64 || "").trim();
                    const mimeType = String(payload.mimeType || "image/png");
                    if (!raw) {
                        result = { ok: false, message: "rawBase64 为空" };
                        break;
                    }
                    try {
                        const binaryStr = atob(raw);
                        const bytes = new Uint8Array(binaryStr.length);
                        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                        const uploadSessionId = putUploadSession(bytes, mimeType, { source: "webview_raw_base64" });
                        result = { ok: true, uploadSessionId };
                    } catch (e) {
                        result = { ok: false, message: e?.message || String(e) };
                    }
                    break;
                }
                case "xiaoliangRh.releaseUploadSession": {
                    const [sessionId] = args;
                    releaseUploadSession(String(sessionId || "").trim());
                    result = { ok: true };
                    break;
                }
                case "xiaoliangRh.peekUploadSessionRawBase64": {
                    const [sessionId] = args;
                    const id = String(sessionId || "").trim();
                    const p = peekUploadSession(id);
                    if (!p) {
                        result = { ok: false, message: "uploadSession 无效或已过期" };
                        break;
                    }
                    result = {
                        ok: true,
                        rawBase64: btoa(_uint8ToBinaryFallback(p.bytes)),
                        mimeType: p.mimeType || "image/png",
                    };
                    break;
                }
                /** Probe whether the session exists without crossing the bridge or returning base64. */
                case "xiaoliangRh.probeUploadSession": {
                    const [sessionId] = args;
                    const id = String(sessionId || "").trim();
                    const p = peekUploadSession(id);
                    result = {
                        ok: !!(p && p.bytes instanceof Uint8Array && p.bytes.length > 0),
                    };
                    break;
                }
                /** 本地选图 -> 字节进入 uploadSession，WebView 仅持 xiaoliangRh-session:id */
                case "xiaoliangRh.pickImageFileToUploadSession": {
                    const [payload = {}] = args;
                    const previewMaxEdge = Math.max(64, Math.min(Number(payload.previewMaxEdge) || 256, 1024));
                    const f = await fs.getFileForOpening({
                        types: ["png", "jpg", "jpeg", "webp", "bmp"],
                    });
                    if (!f) {
                        result = { ok: false, cancelled: true };
                        break;
                    }
                    const bytes = new Uint8Array(await f.read({ format: formats.binary }));
                    if (!bytes.length) {
                        result = { ok: false, message: "文件为空" };
                        break;
                    }
                    const ext = String(f.name || "")
                        .split(".")
                        .pop()
                        .toLowerCase();
                    let mime = "image/png";
                    if (ext === "jpg" || ext === "jpeg") mime = "image/jpeg";
                    else if (ext === "webp") mime = "image/webp";
                    else if (ext === "bmp") mime = "image/bmp";
                    const dims = parseImageDimensionsFromBytes(bytes, mime);
                    try {
                        const previewBase64 = await xiaoliangRhBuildPreviewDataUrlFromBytes(bytes, mime, previewMaxEdge);
                        const uploadSessionId = putUploadSession(bytes, mime, {
                            retainUntilRelease: true,
                            source: "xiaoliang_rh_file_pick",
                            fileName: f.name || "",
                            width: dims.width,
                            height: dims.height,
                        });
                        result = {
                            ok: true,
                            uploadSessionId,
                            mimeType: mime,
                            uploadWidth: dims.width,
                            uploadHeight: dims.height,
                            uploadByteLength: bytes.length,
                            fileName: f.name || "",
                            previewBase64,
                        };
                    } catch (e) {
                        result = { ok: false, message: e?.message || String(e) };
                    }
                    break;
                }
                /** RunningHub：宿主执行任务并回传进度 */
                case "runninghub.runAiApp": {
                    const [payload = {}] = args;
                    result = await xiaoliangRhRunAiAppBridgeJob(payload, id, sendToWebview);
                    break;
                }
                case "runninghub.runAiAppCancel": {
                    const [reqId] = args;
                    result = xiaoliangRhCancelAiAppBridgeJob(reqId);
                    break;
                }
                case "runninghub.http": {
                    const [cmd = {}] = args;
                    const op = cmd.op;
                    const timeoutMs = cmd.timeoutMs;
                    const apiKey = cmd.apiKey;
                    try {
                        if (op === "postJsonResult") {
                            result = await rhHostHttp.rhPostJsonResultHost(cmd.url, cmd.body, apiKey, { timeoutMs });
                        } else if (op === "getJsonResult") {
                            result = await rhHostHttp.rhGetJsonResultHost(cmd.url, apiKey, { timeoutMs });
                        } else if (op === "postJson") {
                            result = await rhHostHttp.rhPostJsonHost(cmd.url, cmd.body, apiKey, { timeoutMs });
                        } else if (op === "postJsonBearerOnly") {
                            result = await rhHostHttp.rhPostJsonBearerOnlyHost(cmd.url, cmd.body, apiKey, { timeoutMs });
                        } else {
                            error = { message: "未知的 runninghub.http.op" };
                        }
                    } catch (e) {
                        error = {
                            message: e?.message || String(e),
                            code: e?.code,
                            status: e?.status,
                            rawBody: e?.rawBody,
                            originalMessage: e?.originalMessage,
                        };
                    }
                    break;
                }
                case "runninghub.uploadBinary": {
                    const [payload = {}] = args;
                    const baseUrl = String(payload.baseUrl || "").trim().replace(/\/$/, "");
                    const apiKey = String(payload.apiKey || "").trim();
                    const uploadSessionId = payload.uploadSessionId != null ? String(payload.uploadSessionId).trim() : "";
                    const fileBase64 = String(payload.fileBase64 || "");
                    const fileName = String(payload.fileName || "image.png");
                    const mimeType = String(payload.mimeType || "image/png");
                    const timeoutRaw = Number(payload.timeoutMs);
                    const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.max(1000, timeoutRaw) : 600000;
                    if (!baseUrl || !apiKey || (!fileBase64 && !uploadSessionId)) {
                        error = { message: "runninghub.uploadBinary parameters incomplete" };
                        break;
                    }
                    /** OpenAPI v2: multipart file field with Bearer auth; returns data.download_url. */
                    const uploadUrl = baseUrl + RH_PATH.UPLOAD_BINARY;
                    let bytes;
                    let effMime = mimeType;
                    if (uploadSessionId) {
                        const taken = peekUploadSession(uploadSessionId);
                        if (!taken) {
                            error = { message: "RH uploadSession 无效或已过期" };
                            break;
                        }
                        bytes = taken.bytes;
                        effMime = taken.mimeType || mimeType;
                    } else {
                        bytes = xiaoliangRhBytesFromBase64Payload(fileBase64);
                    }
                    if (!bytes?.length) {
                        error = { message: "上传图像数据为空" };
                        break;
                    }
                    result = await xiaoliangRhPostRunningHubBinaryUpload({
                        uploadUrl,
                        apiKey,
                        bytes,
                        mimeType: effMime,
                        fileName,
                        timeoutMs,
                    });
                    break;
                }
                case "network.downloadAndSave": {
                    const [payload = {}] = args;
                    const {
                        imageUrl,
                        folderToken,
                        index = 1,
                        presetName,
                        channel,
                        size,
                        runningHubAppName,
                        fileNameSuffix,
                        bounds,
                        docId,
                        timeoutMs,
                        resultSidecar,
                        duckDecodeEnabled,
                    } = payload || {};

                    if (typeof imageUrl !== "string" || !imageUrl.trim()) {
                        error = { message: "无效的 imageUrl" };
                        break;
                    }
                    if (typeof folderToken !== "string" || !folderToken.trim()) {
                        error = { message: "无效的 folderToken" };
                        break;
                    }

                    let ext = inferExtFromUrl(imageUrl);
                    let contentType = "";
                    let bytes = null;
                    let duckDecode = null;

                    try {
                        const loadedImage = await xiaoliangRhLoadResultImageBytes(imageUrl, {
                            timeoutMs,
                            requestId: id,
                            progressSink: sendToWebview,
                        });
                        bytes = loadedImage.bytes;
                        contentType = loadedImage.contentType || "";
                        ext = loadedImage.ext || ext;
                    } catch (downloadErr) {
                        error = { message: downloadErr?.message || "下载失败" };
                        break;
                    }

                    if (!bytes || bytes.length <= 0) {
                        error = { message: "下载失败" };
                        break;
                    }

                    if (duckDecodeEnabled) {
                        sendToWebview({ type: "uxp.progress", domain: "duckDecode", requestId: id, phase: "start", detail: "小黄鸭解码中", extra: null });
                        try {
                            const decoded = await decodeDuckImageBytes(bytes, contentType || ("image/" + (ext || "png")));
                            if (decoded?.ok && decoded.bytes?.length > 0) {
                                bytes = decoded.bytes;
                                ext = decoded.ext || ext || "png";
                                duckDecode = { ok: true, bitDepth: decoded.bitDepth, ext, width: decoded.width, height: decoded.height };
                                sendToWebview({ type: "uxp.progress", domain: "duckDecode", requestId: id, phase: "success", detail: "小黄鸭解码成功", extra: duckDecode });
                            } else {
                                duckDecode = {
                                    ok: false,
                                    error: decoded?.error || "decode failed",
                                    reason: decoded?.reason || "decode_failed",
                                    sourceExt: ext,
                                    contentType,
                                    width: decoded?.width,
                                    height: decoded?.height,
                                };
                                sendToWebview({ type: "uxp.progress", domain: "duckDecode", requestId: id, phase: "failed", detail: "小黄鸭解码失败，已回传原图", extra: duckDecode });
                            }
                        } catch (duckErr) {
                            duckDecode = {
                                ok: false,
                                error: duckErr?.message || String(duckErr),
                                reason: "exception",
                                sourceExt: ext,
                                contentType,
                            };
                            sendToWebview({ type: "uxp.progress", domain: "duckDecode", requestId: id, phase: "failed", detail: "小黄鸭解码失败，已回传原图", extra: duckDecode });
                        }
                    }

                    const folder = await resolveFolder(folderToken);
                    const ts = new Date().toISOString().replace(/[-:TZ.]/g, "");
                    const fileName = buildSavedImageFileName(ts, Number(index) || 1, ext, {
                        presetName,
                        channel,
                        size,
                        runningHubAppName,
                        fileNameSuffix,
                    });
                    const file = await folder.createFile(fileName, { overwrite: true });
                    sendToWebview({ type: "network.downloadProgress", requestId: id, loaded: bytes.length, total: bytes.length, percent: 100, phase: "writing" });
                    await file.write(bytes, { format: formats.binary });

                    await writeResultBoundsSidecar(folder, fileName, bounds, docId, resultSidecar);

                    sendToWebview({ type: "network.downloadProgress", requestId: id, loaded: bytes.length, total: bytes.length, percent: 100, phase: "done" });
                    result = { ok: true, fileName, byteLength: bytes.length, ext, duckDecode };
                    break;
                }
                case "network.fetchStream": {
                    result = await xiaoliangRhHostFetchStream(args[0], args[1] || {}, sendToWebview);
                    break;
                }
                // 宿主预览抓图
                case "ps.captureForPreviewInHost": {
                    const [opts = {}] = args;
                    const { mode = "canvas", maxSize = 256 } = opts;
                    const captureResult = await photoshop.core.executeAsModal(
                        async () => {
                            const app = photoshop.app;
                            const imaging = photoshop.imaging;
                            const doc = app.activeDocument;
                            if (!doc) throw new Error("No active document");
                            const toNum = (v) => {
                                if (v == null) return NaN;
                                if (typeof v === "number" && !isNaN(v)) return v;
                                if (typeof v === "object" && v && "_value" in v) return Number(v._value);
                                return Number(v);
                            };
                            let docMode = "";
                            try { docMode = String(doc.mode || "").toLowerCase(); } catch (e) {}
                            if (docMode.includes("cmyk") || docMode.includes("bitmap") || docMode.includes("indexed") || docMode.includes("multichannel")) {
                                throw new Error("[UNSUPPORTED_MODE] Current document color mode is unsupported. Convert to RGB first.");
                            }
                            let b;
                            const docW = Math.max(1, Math.round(toNum(doc.width) || 0));
                            const docH = Math.max(1, Math.round(toNum(doc.height) || 0));
                            const sel = doc.selection;
                            if (sel && sel.bounds) {
                                b = {
                                    left: Math.floor(toNum(sel.bounds.left) || 0),
                                    top: Math.floor(toNum(sel.bounds.top) || 0),
                                    right: Math.ceil(toNum(sel.bounds.right) || 0),
                                    bottom: Math.ceil(toNum(sel.bounds.bottom) || 0),
                                };
                                b = {
                                    left: Math.max(0, Math.min(b.left, docW - 1)),
                                    top: Math.max(0, Math.min(b.top, docH - 1)),
                                    right: Math.max(b.left + 1, Math.min(b.right, docW)),
                                    bottom: Math.max(b.top + 1, Math.min(b.bottom, docH)),
                                };
                            } else {
                                b = { left: 0, top: 0, right: docW, bottom: docH };
                            }
                            let lid = null;
                            ({ bounds: b, layerID: lid } = await xiaoliangRhApplyLayerScopeToCapture(app, doc, b, docW, docH, mode));
                            return {
                                previewBase64: await xiaoliangRhCaptureRgbPreviewPng({ app, imaging, doc, bounds: b, maxSize, layerID: lid }),
                                bounds: b,
                            };
                        },
                        { commandName: "Preview Capture" }
                    );
                    result = captureResult;
                    break;
                }
                /* Tile panel preview: crop the given region and shrink by max long edge. */
                case "ps.captureBoundsForPreviewInHost": {
                    const [boundsArg, maxSize = 256] = args;
                    const toNum = (v) => {
                        if (v == null) return NaN;
                        if (typeof v === "number" && !isNaN(v)) return v;
                        if (typeof v === "object" && v && "_value" in v) return Number(v._value);
                        return Number(v);
                    };
                    const left = toNum(boundsArg?.left);
                    const top = toNum(boundsArg?.top);
                    const right = toNum(boundsArg?.right);
                    const bottom = toNum(boundsArg?.bottom);
                    const w = toNum(boundsArg?.width);
                    const h = toNum(boundsArg?.height);
                    let b = {
                        left: Math.floor(!isNaN(left) ? left : 0),
                        top: Math.floor(!isNaN(top) ? top : 0),
                        right: Math.ceil(!isNaN(right) ? right : (!isNaN(left) && !isNaN(w) ? left + w : 0)),
                        bottom: Math.ceil(!isNaN(bottom) ? bottom : (!isNaN(top) && !isNaN(h) ? top + h : 0)),
                    };
                    const doc = photoshop.app.activeDocument;
                    if (!doc) {
                        result = { previewBase64: null };
                        break;
                    }
                    const docW = Math.max(1, Math.round(toNum(doc.width) || 0));
                    const docH = Math.max(1, Math.round(toNum(doc.height) || 0));
                    b = {
                        left: Math.max(0, Math.min(b.left, docW - 1)),
                        top: Math.max(0, Math.min(b.top, docH - 1)),
                        right: Math.max(b.left + 1, Math.min(b.right, docW)),
                        bottom: Math.max(b.top + 1, Math.min(b.bottom, docH)),
                    };
                    if (b.right <= b.left || b.bottom <= b.top) {
                        result = { previewBase64: null };
                        break;
                    }
                    const captureResult = await photoshop.core.executeAsModal(
                        async () => {
                            const app = photoshop.app;
                            const imaging = photoshop.imaging;
                            const document = app.activeDocument;
                            if (!document) throw new Error("No active document");
                            xiaoliangRhAssertPreviewReadableMode(document);
                            return {
                                previewBase64: await xiaoliangRhCaptureRgbPreviewPng({ app, imaging, doc: document, bounds: b, maxSize }),
                            };
                        },
                        { commandName: "Preview Capture Bounds" }
                    );
                    result = captureResult || { previewBase64: null };
                    break;
                }
                case "ps.captureSelection": {
                    const [mode, sizeOpts] = args;
                    result = await photoshop.core.executeAsModal(async () => {
                        return await xiaoliangRhExecutePsCaptureSelectionModalCore(mode, sizeOpts);
                    }, { commandName: "Capture" });
                    break;
                }
                case "ps.cloneUploadSession": {
                    const [sourceSessionIdRaw] = args;
                    const sourceSessionId = String(sourceSessionIdRaw || "").trim();
                    if (!sourceSessionId) throw new Error("sourceSessionId 为空");
                    const source = peekUploadSession(sourceSessionId);
                    if (!source || !(source.bytes instanceof Uint8Array) || source.bytes.length === 0) {
                        throw new Error("uploadSession 无效或已过期");
                    }
                    const nextSessionId = putUploadSession(source.bytes, source.mimeType || "image/png", {
                        ...(source.meta || {}),
                        clonedFrom: sourceSessionId,
                    });
                    result = { uploadSessionId: nextSessionId, mimeType: source.mimeType || "image/png" };
                    break;
                }
                case "ps.upscaleRemoveGuides": {
                    const app = photoshop.app;
                    const doc = app.activeDocument;
                    if (!doc) { result = { ok: true }; break; }
                    await photoshop.core.executeAsModal(async () => {
                        try {
                            if (typeof doc.guides?.removeAll === "function") {
                                doc.guides.removeAll();
                            } else if (doc.guides?.length != null) {
                                for (let i = doc.guides.length - 1; i >= 0; i--) {
                                    try { doc.guides[i].delete?.(); } catch (e) { console.warn("[Guides] remove:", e); }
                                }
                            }
                        } catch (e) { console.warn("[Guides] removeAll:", e); }
                    }, { commandName: "清除超清参考线" });
                    result = { ok: true };
                    break;
                }
                case "ps.upscaleAddGuides": {
                    const [opts] = args;
                    const guidePositions = opts && typeof opts === "object" ? (opts.guidePositions ?? opts) : opts;
                    if (!guidePositions || typeof guidePositions !== "object") {
                        result = { ok: true };
                        break;
                    }
                    const app = photoshop.app;
                    const doc = app.activeDocument;
                    if (!doc) throw new Error("No active document");
                    const { constants } = require("photoshop");
                    const dirH = constants?.Direction?.HORIZONTAL ?? 1;
                    const dirV = constants?.Direction?.VERTICAL ?? 2;
                    await photoshop.core.executeAsModal(async () => {
                        for (const x of guidePositions.vertical || []) {
                            if (typeof x === "number" && !isNaN(x)) {
                                try { doc.guides.add(dirV, x); } catch (e) { console.warn("[Guides] vertical:", e); }
                            }
                        }
                        for (const y of guidePositions.horizontal || []) {
                            if (typeof y === "number" && !isNaN(y)) {
                                try { doc.guides.add(dirH, y); } catch (e) { console.warn("[Guides] horizontal:", e); }
                            }
                        }
                    }, { commandName: "超清分界线参考线" });
                    result = { ok: true };
                    break;
                }
                case "ps.upscaleBeginUpscale": {
                    const raw0 = args[0];
                    const opts = typeof raw0 === "object" && raw0 != null && !Array.isArray(raw0)
                        ? raw0
                        : { groupName: typeof raw0 === "string" ? raw0 : "超清 - 瓦片" };
                    const groupName = (typeof opts.groupName === "string" && opts.groupName.trim()) ? opts.groupName.trim() : "超清 - 瓦片";
                    const divideEpoch = opts.divideEpoch;
                    const app = photoshop.app;
                    const doc = app.activeDocument;
                    if (!doc) throw new Error("No active document");
                    if (divideEpoch != null && divideEpoch === _upscaleDivideEpoch && _upscaleGroupRef != null && _upscaleSourceLayerId != null) {
                        try {
                            const gDoc = _upscaleGroupRef.document;
                            const stampLayerStillThere = findLayerByIdInDocument(doc, _upscaleSourceLayerId);
                            const groupStillThere = findLayerByIdInDocument(doc, _upscaleGroupRef.id);
                            /** Reuse only when the layer id still exists; avoid full restamp after user renames layers. */
                            if (gDoc && gDoc.id === doc.id && stampLayerStillThere && groupStillThere) {
                                result = { ok: true, reused: true };
                                break;
                            }
                            console.warn("[Upscale] reuse conditions not met; will recreate group");
                        } catch (reuseErr) {
                            console.warn("[Upscale] reuse check failed; will recreate group", reuseErr);
                        }
                    }
                    _upscaleGroupRef = null;
                    _upscaleSourceLayerId = null;
                    const stampMethodOut = { value: "pixelsPlace" };
                    await photoshop.core.executeAsModal(async () => {
                        const batchPlay = photoshop.action.batchPlay;
                        const { ElementPlacement } = require("photoshop").constants;
                        const toNum = (v) => {
                            if (v == null) return NaN;
                            if (typeof v === "number" && !isNaN(v)) return v;
                            if (typeof v === "object" && v && "_value" in v) return Number(v._value);
                            return Number(v);
                        };
                        const activeDoc = app.activeDocument;
                        if (!activeDoc) throw new Error("Document unavailable");
                        let stampLayer = null;
                        let usedStampVisible = false;
                        const beforeTop = activeDoc.activeLayers?.[0];
                        const beforeTopId = beforeTop != null && typeof beforeTop.id === "number" ? beforeTop.id : null;
                        try {
                            await batchPlay([{ _obj: "mergeLayersNew" }], { synchronousExecution: true });
                            const afterTop = activeDoc.activeLayers?.[0];
                            stampLayer = afterTop;
                            if (stampLayer && beforeTopId != null && stampLayer.id === beforeTopId) {
                                console.warn("[Upscale] mergeLayersNew 未产生新顶层（id 未变），回退 getPixels+置入");
                                stampLayer = null;
                            } else if (stampLayer) {
                                usedStampVisible = true;
                                stampMethodOut.value = "mergeLayersNew";
                                await rasterizeLayerIfSmartObject(stampLayer, batchPlay);
                            }
                        } catch (stampErr) {
                            console.warn("[Upscale] mergeLayersNew(盖印可见) 不可用，回退 getPixels+置入:", stampErr);
                            stampLayer = null;
                        }
                        if (!stampLayer) {
                            stampLayer = await xiaoliangRhPlaceDocumentSnapshotAsLayer({
                                activeDoc,
                                batchPlay,
                                storageFs: fs,
                                storageFormats: formats,
                                logTag: "[Upscale] snapshot stamp",
                            });
                            if (stampLayer) {
                                await rasterizeLayerIfSmartObject(stampLayer, batchPlay);
                            }
                        }
                        if (stampLayer) {
                            await setStampLayerName(stampLayer, batchPlay);
                            try { await stampLayer.setProperty("locked", true); } catch (e) {}
                            _upscaleSourceLayerId = stampLayer.id;
                        } else {
                            throw new Error("盖印失败：无法生成「超清 - 源图」图层（请确保至少有一个可见图层后再运行超清）");
                        }
                        _upscaleGroupRef = await activeDoc.createLayerGroup({ name: groupName });
                        if (_upscaleGroupRef && stampLayer) {
                            try {
                                await _upscaleGroupRef.move(stampLayer, ElementPlacement.PLACEBEFORE);
                            } catch (moveErr) {
                                console.warn("[Upscale] 将超清组置于盖印层之上失败", moveErr);
                            }
                        }
                    }, { commandName: "Start upscale session" });
                    if (divideEpoch != null) _upscaleDivideEpoch = divideEpoch;
                    result = { ok: true, stampMethod: stampMethodOut.value };
                    break;
                }
                case "ps.upscalePlaceTile": {
                    const [dataUrl, bounds, docId] = args;
                    if (!dataUrl || typeof dataUrl !== "string") throw new Error("Tile image data URL is required");
                    const app = photoshop.app;
                    let doc = app.activeDocument;
                    if (docId != null) {
                        const docs = app.documents;
                        for (let i = 0; i < docs.length; i++) {
                            if (docs[i].id === docId) { doc = docs[i]; break; }
                        }
                    }
                    if (!doc) throw new Error("Document does not exist");
                    const safeNum = (v) => {
                        if (v == null) return NaN;
                        if (typeof v === "number" && !isNaN(v)) return v;
                        if (typeof v === "object" && v && "_value" in v) return Number(v._value);
                        return Number(v);
                    };
                    const selBounds = xiaoliangRhSelectionBoundsFromRect(bounds);
                    if (!selBounds) throw new Error("无效的 bounds");

                    const match = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
                    if (!match) throw new Error("无效的 data URL");
                    const binary = atob(match[1]);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

                    const tempFolder = await fs.getTemporaryFolder();
                    const ts = Date.now();
                    const rnd = Math.random().toString(36).slice(2, 8);
                    const tempFileName = "xiaoliang_rh_upscale_tile_" + ts + "_" + rnd + ".png";
                    const tempFile = await tempFolder.createFile(tempFileName, { overwrite: true });
                    await tempFile.write(bytes, { format: formats.binary });

                    const token = await fs.createSessionToken(tempFile);
                    const batchPlay = photoshop.action.batchPlay;
                    const { ElementPlacement } = require("photoshop").constants;

                    await photoshop.core.executeAsModal(async () => {
                        if (docId != null && doc.id !== docId) {
                            await batchPlay([{ _obj: "select", null: { _ref: [{ _ref: "document", _id: docId }] } }], { synchronousExecution: true });
                        }
                        const activeDoc = app.activeDocument;
                        if (!activeDoc) throw new Error("Document unavailable");
                        await batchPlay([{
                            _obj: "placeEvent",
                            null: { _path: token, _kind: "local" },
                            freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
                            offset: { _obj: "offset", horizontal: { _unit: "pixelsUnit", _value: 0 }, vertical: { _unit: "pixelsUnit", _value: 0 } },
                        }], { synchronousExecution: false });
                        const boundsResult = await batchPlay([
                            { _obj: "get", _target: [{ _property: "bounds" }, { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }] },
                        ], { synchronousExecution: false });
                        const lb = boundsResult?.[0]?.bounds;
                        if (lb && selBounds) {
                            const lbLeft = safeNum(lb.left), lbTop = safeNum(lb.top);
                            const lbRight = safeNum(lb.right), lbBottom = safeNum(lb.bottom);
                            const layerW = lbRight - lbLeft, layerH = lbBottom - lbTop;
                            const layerCX = lbLeft + layerW / 2, layerCY = lbTop + layerH / 2;
                            const scale = Math.min(selBounds.width / layerW, selBounds.height / layerH) * 100;
                            const offsetX = selBounds.centerX - layerCX, offsetY = selBounds.centerY - layerCY;
                            await batchPlay([{
                                _obj: "transform",
                                freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
                                offset: { _obj: "offset", horizontal: { _unit: "pixelsUnit", _value: offsetX }, vertical: { _unit: "pixelsUnit", _value: offsetY } },
                                width: { _unit: "percentUnit", _value: scale },
                                height: { _unit: "percentUnit", _value: scale },
                                interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubicAutomatic" },
                            }], { synchronousExecution: false });
                        }
                        const activeLayer = activeDoc.activeLayers?.[0];
                        if (activeLayer && _upscaleGroupRef) {
                            try { await activeLayer.move(_upscaleGroupRef, ElementPlacement.PLACEINSIDE); } catch (e) { console.warn("[Upscale] move:", e); }
                            await sortUpscaleGroupChildrenByTileNumber(_upscaleGroupRef);
                        }
                        try { await tempFile.delete(); } catch (e) {}
                    }, { commandName: "置入超清瓦片" });
                    result = { ok: true };
                    break;
                }
                default:
                    throw new Error("Unknown bridge method: " + method);
            }
        } catch (err) {
            error = {
                message: err?.message || String(err),
                code: err?.code,
                status: err?.status,
                rawBody: err?.rawBody,
                originalMessage: err?.originalMessage,
            };
        }

        sendToWebview(error ? { id, error } : { id, result });
    };

    if (!_xiaoliangRhBridgeStoredHandleMessage) {
        _xiaoliangRhBridgeStoredHandleMessage = handleMessage;
        window.addEventListener("message", handleMessage);
    }
    if (webviewEl) {
        if (_xiaoliangRhBridgeWebviewListenerTarget && _xiaoliangRhBridgeWebviewListenerTarget !== webviewEl) {
            try {
                _xiaoliangRhBridgeWebviewListenerTarget.removeEventListener("message", _xiaoliangRhBridgeStoredHandleMessage);
            } catch (e) {
                /* ignore */
            }
        }
        webviewEl.addEventListener("message", _xiaoliangRhBridgeStoredHandleMessage);
        _xiaoliangRhBridgeWebviewListenerTarget = webviewEl;
    }
}
