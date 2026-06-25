const PREVIEW_TILE_MAX_EDGE = 512;

function rectSize(rect) {
    return {
        width: Number(rect?.right) - Number(rect?.left),
        height: Number(rect?.bottom) - Number(rect?.top),
    };
}

function fitToMaxEdge(width, height, maxEdge) {
    const rawW = Math.max(1, Math.round(width));
    const rawH = Math.max(1, Math.round(height));
    const longest = Math.max(rawW, rawH);
    if (longest <= maxEdge) return { width: rawW, height: rawH };
    const scale = maxEdge / longest;
    return {
        width: Math.max(1, Math.round(rawW * scale)),
        height: Math.max(1, Math.round(rawH * scale)),
    };
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("加载预览图失败"));
        image.src = url;
    });
}

function buildSourceRect(image, captureBounds, tileBounds) {
    const capture = rectSize(captureBounds);
    const tile = rectSize(tileBounds);
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    if (!capture.width || !capture.height || !tile.width || !tile.height || !imageWidth || !imageHeight) {
        return null;
    }

    const scaleX = imageWidth / capture.width;
    const scaleY = imageHeight / capture.height;
    return {
        x: (Number(tileBounds.left) - Number(captureBounds.left)) * scaleX,
        y: (Number(tileBounds.top) - Number(captureBounds.top)) * scaleY,
        width: tile.width * scaleX,
        height: tile.height * scaleY,
    };
}

export async function cropDataUrlToTileCore(dataUrl, captureBounds, tileBounds) {
    try {
        const image = await loadImage(dataUrl);
        const src = buildSourceRect(image, captureBounds, tileBounds);
        if (!src || src.width <= 0 || src.height <= 0) return dataUrl;

        const output = fitToMaxEdge(src.width, src.height, PREVIEW_TILE_MAX_EDGE);
        const canvas = document.createElement("canvas");
        canvas.width = output.width;
        canvas.height = output.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return dataUrl;

        ctx.drawImage(image, src.x, src.y, src.width, src.height, 0, 0, output.width, output.height);
        return canvas.toDataURL("image/jpeg", 0.88);
    } catch (_) {
        return dataUrl;
    }
}
