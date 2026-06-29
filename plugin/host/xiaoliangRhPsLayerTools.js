import {
    applySymmetricEdgeFeatherMask,
    rasterizeLayerForMask,
    isFullCanvasSelBounds,
    parsePlaceEdgeOpts,
    computeAutoPlaceEdgeFeatherPx,
} from "./placeQuadraticLayerMask.js";

const STAMP_SOURCE_LAYER_NAME = "小梁图修 - 源图";

function readNumber(value) {
    if (value == null) return NaN;
    if (typeof value === "number") return Number.isNaN(value) ? NaN : value;
    if (typeof value === "object" && value && "_value" in value) return Number(value._value);
    return Number(value);
}

function positiveDocSize(doc) {
    const width = Math.max(1, Math.round(readNumber(doc?.width) || 0));
    const height = Math.max(1, Math.round(readNumber(doc?.height) || 0));
    return { width, height };
}

function normalizeRect(source) {
    if (!source || typeof source !== "object") return null;
    const left = readNumber(source.left);
    const top = readNumber(source.top);
    const right = readNumber(source.right);
    const bottom = readNumber(source.bottom);
    if (![left, top, right, bottom].every(Number.isFinite)) return null;
    if (right <= left || bottom <= top) return null;
    return { left, top, right, bottom };
}

function clampRectToCanvas(rect, canvasW, canvasH) {
    if (!rect) return null;
    const left = Math.max(0, Math.min(Math.floor(rect.left), canvasW - 1));
    const top = Math.max(0, Math.min(Math.floor(rect.top), canvasH - 1));
    const right = Math.max(left + 1, Math.min(Math.ceil(rect.right), canvasW));
    const bottom = Math.max(top + 1, Math.min(Math.ceil(rect.bottom), canvasH));
    return { left, top, right, bottom };
}

function rectIntersectionOrFallback(base, overlay) {
    const joined = {
        left: Math.max(base.left, overlay.left),
        top: Math.max(base.top, overlay.top),
        right: Math.min(base.right, overlay.right),
        bottom: Math.min(base.bottom, overlay.bottom),
    };
    if (joined.right > joined.left && joined.bottom > joined.top) return joined;
    return overlay;
}

function getLayerCollectionSize(layers) {
    if (!layers) return 0;
    const direct = Number(layers.length);
    if (Number.isFinite(direct)) return Math.max(0, direct);
    const items = Number(layers.numItems);
    return Number.isFinite(items) ? Math.max(0, items) : 0;
}

function getLayerFromCollection(layers, index) {
    if (!layers) return null;
    try {
        const direct = layers[index];
        if (direct) return direct;
    } catch (_) {
        // Try collection getter below.
    }
    try {
        return typeof layers.get === "function" ? layers.get(index) : null;
    } catch (_) {
        return null;
    }
}

function nestedLayersOf(layer) {
    return layer?.layers || layer?.children || null;
}

async function readTargetLayerBounds(app) {
    try {
        const reply = await app.batchPlay(
            [
                {
                    _obj: "get",
                    _target: [{ _property: "bounds" }, { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
                },
            ],
            {}
        );
        return normalizeRect(reply?.[0]?.bounds || reply?.[0]);
    } catch (_) {
        return null;
    }
}

function buildSelectionRectangle(bounds) {
    const rect = normalizeRect(bounds);
    if (!rect) return null;
    const top = Math.round(rect.top);
    const left = Math.round(rect.left);
    const bottom = Math.round(rect.bottom);
    const right = Math.round(rect.right);
    if (right <= left || bottom <= top) return null;
    return { top, left, bottom, right };
}

export async function finalizePlaceWithOptionalEdgeFeather(photoshop, { batchPlay, activeDoc, selBounds, placeOpts }) {
    const selectedRect = normalizeRect(selBounds);
    if (!photoshop || !batchPlay || !activeDoc || !selectedRect) return null;

    const { width: docW, height: docH } = positiveDocSize(activeDoc);
    const edgeOpts = parsePlaceEdgeOpts(placeOpts);
    const featherPx = edgeOpts.placeEdgeFeatherAuto ? computeAutoPlaceEdgeFeatherPx(selectedRect) : 0;
    if (!(featherPx > 0) && !edgeOpts.placeCreateMask) return null;
    if (edgeOpts.placeEdgeFeatherSubcanvasOnly && isFullCanvasSelBounds(selectedRect, docW, docH)) return null;

    const layer = activeDoc.activeLayers?.[0];
    if (!layer) return null;
    await rasterizeLayerForMask(photoshop, { activeDoc, layer, batchPlay });

    const layerBoundsReply = await batchPlay(
        [{ _obj: "get", _target: [{ _property: "bounds" }, { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }] }],
        { synchronousExecution: false }
    );
    const placedBounds = normalizeRect(layerBoundsReply?.[0]?.bounds);
    if (!placedBounds) return null;

    return applySymmetricEdgeFeatherMask(photoshop, {
        activeDoc,
        layer,
        bounds: placedBounds,
        featherPx,
        forceMask: edgeOpts.placeCreateMask,
        logTag: "[XiaoLiangRH PlaceEdge]",
    });
}

export async function maybeRestoreRectangularSelectionAfterPlace(batchPlay, { placeOpts, activeDoc, selBounds }) {
    if (!batchPlay || !activeDoc) return;
    const { placeKeepSelection } = parsePlaceEdgeOpts(placeOpts);
    if (!placeKeepSelection) return;

    const rect = buildSelectionRectangle(selBounds);
    if (!rect) return;
    const { width: docW, height: docH } = positiveDocSize(activeDoc);
    if (isFullCanvasSelBounds(rect, docW, docH)) return;

    try {
        await batchPlay(
            [
                {
                    _obj: "set",
                    _target: [{ _ref: "channel", _property: "selection" }],
                    to: {
                        _obj: "rectangle",
                        top: { _unit: "pixelsUnit", _value: rect.top },
                        left: { _unit: "pixelsUnit", _value: rect.left },
                        bottom: { _unit: "pixelsUnit", _value: rect.bottom },
                        right: { _unit: "pixelsUnit", _value: rect.right },
                    },
                },
            ],
            { synchronousExecution: true }
        );
    } catch (error) {
        console.warn("[XiaoLiangRH Place] restore selection failed:", error);
    }
}

export function findLayerByIdInDocument(doc, layerId) {
    if (!doc || layerId == null || !Number.isFinite(Number(layerId))) return null;
    const wanted = Number(layerId);
    const stack = [doc.layers].filter(Boolean);
    while (stack.length) {
        const layers = stack.pop();
        const count = getLayerCollectionSize(layers);
        for (let index = count - 1; index >= 0; index--) {
            const layer = getLayerFromCollection(layers, index);
            if (!layer) continue;
            try {
                if (Number(layer.id) === wanted) return layer;
            } catch (_) {
                // Keep scanning the remaining tree.
            }
            const children = nestedLayersOf(layer);
            if (children && getLayerCollectionSize(children) > 0) stack.push(children);
        }
    }
    return null;
}

export async function computeSelectionBoundsForRh(app, doc, mode) {
    if (!doc) return null;
    try {
        const { width: docW, height: docH } = positiveDocSize(doc);
        const fullCanvas = { left: 0, top: 0, right: docW, bottom: docH };
        const selectionRect = clampRectToCanvas(normalizeRect(doc.selection?.bounds), docW, docH) || fullCanvas;
        if (mode !== "layer") return selectionRect;

        const layer = doc.activeLayers?.[0];
        if (!layer) return selectionRect;
        const rawLayerRect = normalizeRect(layer.bounds) || (await readTargetLayerBounds(app));
        const layerRect = clampRectToCanvas(rawLayerRect, docW, docH);
        return layerRect ? rectIntersectionOrFallback(selectionRect, layerRect) : selectionRect;
    } catch (error) {
        console.warn("[XiaoLiangRH selection bounds]", error);
        return null;
    }
}

function isSmartObjectLayer(layer) {
    const kind = String(layer?.kind ?? "").toLowerCase();
    return kind === "3" || kind.includes("smart");
}

export async function rasterizeLayerIfSmartObject(layer, batchPlay) {
    if (!layer || !isSmartObjectLayer(layer)) return;
    try {
        if (typeof layer.rasterize === "function") {
            await layer.rasterize();
            return;
        }
        if (batchPlay) {
            await batchPlay(
                [{ _obj: "rasterizeLayer", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }] }],
                { synchronousExecution: true }
            );
        }
    } catch (error) {
        console.warn("[XiaoLiangRH upscale] rasterize smart layer failed:", error);
    }
}

export async function setStampLayerName(layer, batchPlay) {
    if (!layer) return;
    try {
        layer.name = STAMP_SOURCE_LAYER_NAME;
        return;
    } catch (_) {
        // Some host objects expose setProperty instead.
    }
    try {
        if (typeof layer.setProperty === "function") {
            await layer.setProperty("name", STAMP_SOURCE_LAYER_NAME);
            return;
        }
    } catch (_) {
        // Fall back to action manager below.
    }
    try {
        if (batchPlay) {
            await batchPlay(
                [
                    {
                        _obj: "set",
                        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
                        to: { _obj: "layer", name: STAMP_SOURCE_LAYER_NAME },
                    },
                ],
                { synchronousExecution: true }
            );
        }
    } catch (error) {
        console.warn("[XiaoLiangRH upscale] rename stamp source layer failed:", error);
    }
}

export function parseTilePrefixFromLayerName(name) {
    const text = typeof name === "string" ? name.trim() : "";
    if (!text) return null;
    const numericPrefix = text.match(/^(\d+)_of_(\d+)_/);
    if (numericPrefix) return { n: Number(numericPrefix[1]), total: Number(numericPrefix[2]) };
    const xlrhPrefix = text.match(/xiaoliang_rh_upscale_tile_(\d+)_of_(\d+)/i);
    if (xlrhPrefix) return { n: Number(xlrhPrefix[1]), total: Number(xlrhPrefix[2]) };
    return null;
}

function layersArray(groupRef) {
    const layers = groupRef?.layers || groupRef?.children || [];
    const count = getLayerCollectionSize(layers);
    const result = [];
    for (let i = 0; i < count; i++) {
        const layer = getLayerFromCollection(layers, i);
        if (layer) result.push(layer);
    }
    return result;
}

export async function sortUpscaleGroupChildrenByTileNumber(groupRef) {
    const layers = layersArray(groupRef);
    if (layers.length < 2) return;
    try {
        const { ElementPlacement } = require("photoshop").constants;
        const ordered = layers
            .map((layer, originalIndex) => ({
                layer,
                originalIndex,
                order: parseTilePrefixFromLayerName(layer.name)?.n ?? Number.MAX_SAFE_INTEGER,
            }))
            .sort((a, b) => (a.order === b.order ? a.originalIndex - b.originalIndex : a.order - b.order));

        const currentTop = layers[0];
        if (ordered[0].layer?.id !== currentTop?.id) {
            await ordered[0].layer.move(currentTop, ElementPlacement.PLACEBEFORE);
        }
        for (let index = 1; index < ordered.length; index++) {
            await ordered[index].layer.move(ordered[index - 1].layer, ElementPlacement.PLACEAFTER);
        }
    } catch (error) {
        console.warn("[XiaoLiangRH upscale] sort group layers failed:", error);
    }
}
