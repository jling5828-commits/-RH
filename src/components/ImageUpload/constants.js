const PREVIEW_LIMITS = {
    mainPreview: 256,
    mainCapturePreview: 256,
    refPreview: 128,
    refCapturePreview: 128,
    uploadLongEdge: 2048,
    jpegQuality: 85,
    errorDisplayMs: 4000,
};

const MAIN_FRAME = {
    minHeight: 80,
    maxHeight: 200,
    emptyMaxHeight: 120,
    aspect: 3 / 4,
    maxHeightLayout: 240,
};

const REF_GRID = {
    gap: 4,
    minCell: 50,
    maxCell: 100,
    columnSearchMax: 8,
};

export const PREVIEW_MAX_SIZE = PREVIEW_LIMITS.mainPreview;
export const PREVIEW_CAPTURE_MAX_SIZE = PREVIEW_LIMITS.mainCapturePreview;
export const REF_PREVIEW_MAX_SIZE = PREVIEW_LIMITS.refPreview;
export const REF_PREVIEW_CAPTURE_MAX_SIZE = PREVIEW_LIMITS.refCapturePreview;
export const UPLOAD_MAX_SIZE = PREVIEW_LIMITS.uploadLongEdge;
export const UPLOAD_JPEG_QUALITY = PREVIEW_LIMITS.jpegQuality;
export const ERROR_DISPLAY_DURATION = PREVIEW_LIMITS.errorDisplayMs;

export const MAIN_PREVIEW_MIN_HEIGHT = MAIN_FRAME.minHeight;
export const MAIN_PREVIEW_MAX_HEIGHT = MAIN_FRAME.maxHeight;
export const MAIN_PREVIEW_EMPTY_MAX_HEIGHT = MAIN_FRAME.emptyMaxHeight;
export const MAIN_FRAME_ASPECT = MAIN_FRAME.aspect;
export const MAIN_MAX_HEIGHT = MAIN_FRAME.maxHeightLayout;

export const REF_COL_MIN_WIDTH_PX = 104;
export const REF_THUMB_PX = 128;
export const REF_GRID_GAP_PX = REF_GRID.gap;
export const REF_CELL_MIN_PX = REF_GRID.minCell;
export const REF_CELL_MAX_PX = REF_GRID.maxCell;

function clampWidth(width) {
    return Math.max(0, Number(width) || 0);
}

function refCellSize(width, columns) {
    return (width - (columns - 1) * REF_GRID_GAP_PX) / columns;
}

export function computeRefGridColumnCount(containerContentWidth) {
    const width = clampWidth(containerContentWidth);
    if (width <= 0) return 1;

    const maxColumns = Math.max(1, Math.floor((width + REF_GRID_GAP_PX) / (REF_CELL_MIN_PX + REF_GRID_GAP_PX)));
    for (let columns = maxColumns; columns >= 1; columns -= 1) {
        const size = refCellSize(width, columns);
        if (size >= REF_CELL_MIN_PX && size <= REF_CELL_MAX_PX) return columns;
    }

    for (let columns = maxColumns + 1; columns <= REF_GRID.columnSearchMax; columns += 1) {
        const size = refCellSize(width, columns);
        if (size <= REF_CELL_MAX_PX && size >= REF_CELL_MIN_PX - 4) return columns;
    }

    return 1;
}

export function computeRefGridCellPx(containerContentWidth) {
    const width = clampWidth(containerContentWidth);
    const columns = computeRefGridColumnCount(width);
    return Math.min(REF_CELL_MAX_PX, Math.max(REF_CELL_MIN_PX, refCellSize(width, columns)));
}

export const REF_KEYS = Object.freeze(["ref1", "ref2", "ref3", "ref4", "ref5", "ref6"]);

function createRefMap(fillValue) {
    return REF_KEYS.reduce((map, key) => {
        map[key] = fillValue;
        return map;
    }, {});
}

export function createEmptyRefMap() {
    return createRefMap(null);
}

export function createEmptyRefErrors() {
    return createRefMap("");
}
