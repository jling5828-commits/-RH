function toFiniteNumber(value) {
    if (value == null) return NaN;
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    if (typeof value === "object" && value && "_value" in value) return Number(value._value);
    return Number(value);
}

function readRectPixels(bounds) {
    const left = Math.floor(toFiniteNumber(bounds?.left));
    const top = Math.floor(toFiniteNumber(bounds?.top));
    const right = Math.ceil(toFiniteNumber(bounds?.right));
    const bottom = Math.ceil(toFiniteNumber(bounds?.bottom));
    return {
        left,
        top,
        right,
        bottom,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
    };
}

function docPixelSize(activeDoc) {
    return {
        width: Math.max(1, Math.round(toFiniteNumber(activeDoc?.width) || 0)),
        height: Math.max(1, Math.round(toFiniteNumber(activeDoc?.height) || 0)),
    };
}

function keepInsideLimit(value, maxValue) {
    return Math.min(Math.max(0, value), Math.max(0, maxValue));
}

function scalePairToFit(first, second, total) {
    if (first + second < total) return [first, second];
    const base = first + second || 1;
    const scale = Math.max(0, total - 1) / base;
    return [Math.floor(first * scale), Math.floor(second * scale)];
}

function edgeReach({ rect, doc, featherPx }) {
    const edgeTolerance = 1;
    const outerPad = 3;
    const touches = {
        left: rect.left <= edgeTolerance,
        top: rect.top <= edgeTolerance,
        right: doc.width - rect.right <= edgeTolerance,
        bottom: doc.height - rect.bottom <= edgeTolerance,
    };
    const expand = {
        left: Math.min(outerPad, Math.max(0, rect.left)),
        top: Math.min(outerPad, Math.max(0, rect.top)),
        right: Math.min(outerPad, Math.max(0, doc.width - rect.right)),
        bottom: Math.min(outerPad, Math.max(0, doc.height - rect.bottom)),
    };
    const maskWidth = rect.width + expand.left + expand.right;
    const maskHeight = rect.height + expand.top + expand.bottom;
    const left = touches.left ? 0 : keepInsideLimit(expand.left + featherPx, maskWidth - 1);
    const right = touches.right ? 0 : keepInsideLimit(expand.right + featherPx, maskWidth - 1);
    const top = touches.top ? 0 : keepInsideLimit(expand.top + featherPx, maskHeight - 1);
    const bottom = touches.bottom ? 0 : keepInsideLimit(expand.bottom + featherPx, maskHeight - 1);
    const fittedX = scalePairToFit(left, right, maskWidth);
    const fittedY = scalePairToFit(top, bottom, maskHeight);
    return {
        maskWidth,
        maskHeight,
        expand,
        fade: {
            left: fittedX[0],
            right: fittedX[1],
            top: fittedY[0],
            bottom: fittedY[1],
        },
    };
}

function rampIn(position, length) {
    if (length <= 0 || position >= length) return 1;
    const t = length <= 1 ? 1 : position / (length - 1);
    return t * t;
}

function rampOut(position, length, size) {
    const start = size - length;
    if (length <= 0 || position < start) return 1;
    const t = length <= 1 ? 1 : (size - 1 - position) / (length - 1);
    return t * t;
}

function buildMaskBytes(maskWidth, maskHeight, fade) {
    const coreLeft = fade.left;
    const coreRight = maskWidth - fade.right;
    const coreTop = fade.top;
    const coreBottom = maskHeight - fade.bottom;
    const data = new Uint8Array(maskWidth * maskHeight);
    for (let y = 0; y < maskHeight; y++) {
        for (let x = 0; x < maskWidth; x++) {
            const offset = y * maskWidth + x;
            if (x >= coreLeft && x < coreRight && y >= coreTop && y < coreBottom) {
                data[offset] = 255;
                continue;
            }
            const alpha = Math.max(0, Math.min(1,
                rampIn(x, fade.left) *
                rampOut(x, fade.right, maskWidth) *
                rampIn(y, fade.top) *
                rampOut(y, fade.bottom, maskHeight)
            ));
            data[offset] = Math.round(alpha * 255);
        }
    }
    return data;
}

async function createGrayMaskImageData(imaging, bytes, width, height, logTag) {
    const attempts = [
        {
            width,
            height,
            components: 1,
            componentSize: 8,
            chunky: false,
            colorSpace: "Grayscale",
            colorProfile: "Gray Gamma 2.2",
        },
        {
            width,
            height,
            components: 1,
            chunky: false,
            colorSpace: "Grayscale",
        },
        {
            width,
            height,
            components: 1,
            chunky: false,
            colorSpace: "Grayscale",
            colorProfile: "Gray Gamma 2.2",
        },
    ];
    let lastError = null;
    for (const options of attempts) {
        try {
            return await imaging.createImageDataFromBuffer(bytes, options);
        } catch (err) {
            lastError = err;
            console.warn(`${logTag} createImageDataFromBuffer fallback:`, err);
        }
    }
    throw lastError || new Error("createImageDataFromBuffer failed");
}

async function putMaskWithBounds(imaging, payload, targetBounds, logTag) {
    try {
        await imaging.putLayerMask({ ...payload, targetBounds });
    } catch (err) {
        console.warn(`${logTag} putLayerMask(targetBounds) fallback:`, err);
        await imaging.putLayerMask(payload);
    }
}

export async function rasterizeLayerForMask(photoshop, ctx) {
    const activeDoc = ctx?.activeDoc;
    const batchPlay = ctx?.batchPlay;
    const targetLayer = ctx?.layer || activeDoc?.activeLayers?.[0];
    if (targetLayer && typeof targetLayer.rasterize === "function") {
        try {
            await targetLayer.rasterize();
        } catch (err) {
            console.warn("[PlaceMask] layer rasterize failed:", err);
        }
    }
    if (typeof batchPlay !== "function") return;
    try {
        await batchPlay([
            {
                _obj: "rasterizeLayer",
                _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
            },
        ], { synchronousExecution: true });
    } catch (err) {
        console.warn("[PlaceMask] batchPlay rasterize failed:", err);
    }
}

export async function applySymmetricEdgeFeatherMask(photoshop, {
    activeDoc,
    layer,
    bounds,
    featherPx,
    logTag = "[PlaceMask]",
}) {
    const imaging = photoshop?.imaging;
    const targetLayer = layer || activeDoc?.activeLayers?.[0];
    if (!imaging || !activeDoc || !targetLayer || !bounds) return {};

    const rect = readRectPixels(bounds);
    const maxFeather = Math.max(0, Math.floor(Math.min(rect.width, rect.height) / 2) - 1);
    const feather = Math.min(Math.max(0, Math.floor(Number(featherPx) || 0)), maxFeather);
    if (feather <= 0) return {};

    const doc = docPixelSize(activeDoc);
    const geometry = edgeReach({ rect, doc, featherPx: feather });
    const maskBytes = buildMaskBytes(geometry.maskWidth, geometry.maskHeight, geometry.fade);
    let imageData = null;
    try {
        imageData = await createGrayMaskImageData(imaging, maskBytes, geometry.maskWidth, geometry.maskHeight, logTag);
        const targetBounds = {
            left: rect.left - geometry.expand.left,
            top: rect.top - geometry.expand.top,
            right: rect.right + geometry.expand.right,
            bottom: rect.bottom + geometry.expand.bottom,
        };
        await putMaskWithBounds(imaging, {
            documentID: activeDoc.id,
            layerID: targetLayer.id,
            imageData,
            replace: true,
            kind: "user",
        }, targetBounds, logTag);
        return {};
    } catch (err) {
        console.warn(`${logTag} edge feather mask failed:`, err);
        return { maskWarning: `边缘软边蒙版未应用: ${err?.message || err}` };
    } finally {
        try { imageData?.dispose?.(); } catch {}
    }
}

export function isFullCanvasSelBounds(selBounds, docW, docH, tol = 2) {
    if (!selBounds) return true;
    const width = selBounds.width != null ? selBounds.width : toFiniteNumber(selBounds.right) - toFiniteNumber(selBounds.left);
    const height = selBounds.height != null ? selBounds.height : toFiniteNumber(selBounds.bottom) - toFiniteNumber(selBounds.top);
    const left = toFiniteNumber(selBounds.left);
    const top = toFiniteNumber(selBounds.top);
    if (![width, height, left, top].every(Number.isFinite) || width <= 0 || height <= 0) return true;
    return Math.abs(width - docW) <= tol &&
        Math.abs(height - docH) <= tol &&
        Math.abs(left) <= tol &&
        Math.abs(top) <= tol;
}

export function parsePlaceEdgeOpts(raw) {
    const options = raw && typeof raw === "object" ? raw : {};
    return {
        placeEdgeFeatherAuto: options.placeEdgeFeatherAuto === true,
        placeEdgeFeatherSubcanvasOnly: true,
        placeKeepSelection: options.useSavedPlaceContext === true ? false : options.placeKeepSelection !== false,
    };
}

export function computeAutoPlaceEdgeFeatherPx(selBounds) {
    if (!selBounds) return 0;
    const width = selBounds.width != null ? selBounds.width : toFiniteNumber(selBounds.right) - toFiniteNumber(selBounds.left);
    const height = selBounds.height != null ? selBounds.height : toFiniteNumber(selBounds.bottom) - toFiniteNumber(selBounds.top);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
    return Math.max(0, Math.floor(Math.sqrt(width * height) / 16));
}
