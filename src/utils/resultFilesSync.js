export const RESULT_FILES_CHANGED = "xlrh-result-files-changed";

function canDispatchWindowEvent() {
    return typeof window !== "undefined" && typeof window.dispatchEvent === "function";
}

function normalizeResultFilesDetail(detail) {
    if (!detail || typeof detail !== "object") return {};
    const next = { ...detail };
    next.folderToken = detail.folderToken == null ? null : String(detail.folderToken);
    return next;
}

export function buildResultFilesChangedEvent(detail = {}) {
    return new CustomEvent(RESULT_FILES_CHANGED, { detail: normalizeResultFilesDetail(detail) });
}

export function notifyResultFilesChanged(detail = {}) {
    if (!canDispatchWindowEvent()) return false;
    try {
        window.dispatchEvent(buildResultFilesChangedEvent(detail));
        return true;
    } catch (error) {
        console.warn("[xiaoliang-rh] result files refresh event failed:", error);
        return false;
    }
}
