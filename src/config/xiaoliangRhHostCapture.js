import { readCompatLocalStorage } from "../utils/storageKeyCompat.js";

const HOST_CAPTURE_SETTING_KEY = "xlrh_xiaoliangRh_host_capture";
const HOST_CAPTURE_OFF_VALUE = "0";
const SESSION_MARKER_PREFIX = "xiaoliangRh-session:";

export const XIAOLIANG_RH_UPLOAD_SESSION_PREFIX = SESSION_MARKER_PREFIX;

function readHostCapturePreference() {
    if (typeof localStorage === "undefined") return null;
    return readCompatLocalStorage(HOST_CAPTURE_SETTING_KEY);
}

function cleanSessionId(value) {
    const text = String(value ?? "").trim();
    return text.length > 0 ? text : null;
}

export function isXiaoLiangRhHostCaptureEnabled() {
    try {
        return readHostCapturePreference() !== HOST_CAPTURE_OFF_VALUE;
    } catch {
        return true;
    }
}

export function parseXiaoLiangRhUploadSessionToken(value) {
    if (typeof value !== "string") return null;
    const marker = value.trim();
    if (!marker.startsWith(SESSION_MARKER_PREFIX)) return null;
    return cleanSessionId(marker.slice(SESSION_MARKER_PREFIX.length));
}

export function formatXiaoLiangRhUploadSessionMarker(sessionId) {
    const id = cleanSessionId(sessionId);
    return id ? `${SESSION_MARKER_PREFIX}${id}` : "";
}
