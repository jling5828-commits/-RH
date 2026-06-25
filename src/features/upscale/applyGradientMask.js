const REMOTE_IMAGE = /^https?:\/\//i;
const PIXEL_STRIDE = 4;

function looksRemote(value) {
    return REMOTE_IMAGE.test(String(value || ""));
}

function readBlobAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}

async function sourceToDataUrl(source) {
    if (!looksRemote(source)) return source;
    const response = await fetch(source, { mode: "cors" });
    if (!response.ok) throw new Error("下载图片失败");
    return readBlobAsDataUrl(await response.blob());
}

function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("加载图片失败"));
        image.src = dataUrl;
    });
}

function imageSize(image) {
    return {
        width: image.naturalWidth || image.width || 0,
        height: image.naturalHeight || image.height || 0,
    };
}

function normalizeFeatherRadius(overlap, width, height) {
    const radius = Math.max(0, Math.round(Number(overlap) || 0));
    const longestAllowed = Math.floor(Math.min(width, height) / 2);
    return Math.min(radius, longestAllowed);
}

function distanceFromEdge(x, y, width, height) {
    return Math.min(x, y, width - 1 - x, height - 1 - y);
}

function fadeMultiplier(x, y, width, height, radius) {
    if (radius <= 0) return 1;
    return Math.max(0, Math.min(1, distanceFromEdge(x, y, width, height) / radius));
}

function softenAlphaChannel(imageData, width, height, radius) {
    const { data } = imageData;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const alphaIndex = ((y * width + x) * PIXEL_STRIDE) + 3;
            data[alphaIndex] = Math.round(data[alphaIndex] * fadeMultiplier(x, y, width, height, radius));
        }
    }
}

function makeCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

export async function applyGradientMaskToImage(imageUrl, overlap) {
    if (!imageUrl) return imageUrl;

    const dataUrl = await sourceToDataUrl(imageUrl);
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return dataUrl;

    const image = await loadImage(dataUrl);
    const { width, height } = imageSize(image);
    const radius = normalizeFeatherRadius(overlap, width, height);
    if (width <= 0 || height <= 0 || radius <= 0) return dataUrl;

    const canvas = makeCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;

    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    softenAlphaChannel(pixels, width, height, radius);
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/png");
}

export const applyGradientMask = applyGradientMaskToImage;
