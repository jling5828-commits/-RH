export const RH_IMAGE_LONG_EDGE_ORIGINAL = 0;
export const RH_IMAGE_LONG_EDGE_OPTIONS = Object.freeze([512, 1024, 2048, 4096, RH_IMAGE_LONG_EDGE_ORIGINAL]);
export const RH_IMAGE_LONG_EDGE_DEFAULT = RH_IMAGE_LONG_EDGE_ORIGINAL;

function numericValue(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function closestLongEdge(size) {
    const resizeOptions = RH_IMAGE_LONG_EDGE_OPTIONS.filter((option) => option > 0);
    let closest = resizeOptions[0];
    let closestDistance = Math.abs(size - closest);
    for (const option of resizeOptions.slice(1)) {
        const distance = Math.abs(size - option);
        if (distance < closestDistance) {
            closest = option;
            closestDistance = distance;
        }
    }
    return closest;
}

export function normalizeRhImageLongEdgeMax(raw) {
    if (raw === false || raw === "original") return RH_IMAGE_LONG_EDGE_ORIGINAL;
    const size = numericValue(raw);
    if (size == null) return RH_IMAGE_LONG_EDGE_DEFAULT;
    if (size === RH_IMAGE_LONG_EDGE_ORIGINAL) return RH_IMAGE_LONG_EDGE_ORIGINAL;
    return RH_IMAGE_LONG_EDGE_OPTIONS.includes(size) ? size : closestLongEdge(size);
}
