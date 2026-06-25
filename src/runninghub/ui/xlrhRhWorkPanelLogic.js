import {
    MAIN_PREVIEW_MAX_HEIGHT,
    MAIN_PREVIEW_MIN_HEIGHT,
} from "../../components/ImageUpload/constants.js";
import { formatRhUploadBytes } from "../rhUploadEstimate.js";

export const RH_SUCCESS_STAMP = "小梁图修好了";
export const RH_UPLOAD_DEFAULT_LONG_EDGE = 0;
export const RH_PS_CAPTURE_UPLOAD_FORMAT = "jpeg";
export const RH_PS_CAPTURE_JPEG_QUALITY = 97;
export const RH_UPLOAD_IMAGE_FORMAT_OPTIONS = Object.freeze([
    Object.freeze({ value: "jpeg", label: "JPG" }),
    Object.freeze({ value: "png", label: "PNG" }),
]);

export function normalizeRhUploadImageFormat(value) {
    return String(value || "").toLowerCase() === "png" ? "png" : "jpeg";
}

const SUBMITTED_OR_LATER_PHASES = new Set(["poll_status", "fetch_result", "fetch_result_fallback", "failed"]);
const UPLOAD_WARN_BYTES = 30 * 1024 * 1024;
const UPLOAD_BIG_WARN_BYTES = 50 * 1024 * 1024;

export function isRhRunBeforeSubmitDone(run) {
    return !!(run && run.status === "running" && !SUBMITTED_OR_LATER_PHASES.has(String(run.phase || "")));
}

export function buildRhSuccessDisplayMessage(urls, successMsg) {
    const text = String(successMsg || "").trim();
    if (/小黄鸭/.test(text)) return text;
    if (/自动回传已关闭|等待手动贴回/.test(text)) return text;
    if (/保存失败|失败:/.test(text)) return text;
    const count = Array.isArray(urls) ? urls.length : 0;
    if (count > 0 && /已保存 \d+ 张到返图目录/.test(text)) return `已成功保存 ${count} 张 ${RH_SUCCESS_STAMP}`;
    if (count > 0) return `已完成 ${count} 个输出 ${RH_SUCCESS_STAMP}`;
    return `${text} ${RH_SUCCESS_STAMP}`.trim();
}

export function computePreviewHeight(containerWidth, aspectRatio) {
    const width = Number(containerWidth) || 0;
    const ratio = Number(aspectRatio) || 0;
    if (width <= 0 || ratio <= 0) return MAIN_PREVIEW_MIN_HEIGHT;
    const fitted = Math.round(width / ratio);
    return Math.max(MAIN_PREVIEW_MIN_HEIGHT, Math.min(fitted, MAIN_PREVIEW_MAX_HEIGHT));
}

export function pickRhListDefaultFromFieldData(fieldData) {
    let parsed = fieldData;
    if (typeof parsed === "string") {
        try {
            parsed = JSON.parse(parsed);
        } catch (_) {
            return "";
        }
    }
    const candidates = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
    for (const item of candidates) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const value = item.default ?? item.defaultValue;
        if (value != null && String(value).trim() !== "") return String(value).trim();
    }
    return "";
}

export function stripBase64FromDataUrl(dataUrl) {
    if (!dataUrl || typeof dataUrl !== "string") return "";
    const comma = dataUrl.indexOf(",");
    return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

export function base64ByteLength(rawBase64) {
    const payload = String(rawBase64 || "").replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
    if (!payload) return 0;
    const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

export function buildRhUploadWarning(info, runningCount = 0) {
    const total = Number(info?.knownBytes || 0);
    if (total <= 0) return "";
    if (total >= UPLOAD_BIG_WARN_BYTES) return `当前上传约 ${formatRhUploadBytes(total)}，可能卡在上传阶段，请耐心等待`;
    if (total >= UPLOAD_WARN_BYTES) return `当前上传较大（约 ${formatRhUploadBytes(total)}），上传阶段可能较慢`;
    if (runningCount >= 4 && total >= 15 * 1024 * 1024) return `当前已有 ${runningCount} 个任务，继续并发会占用较多网络和内存`;
    return "";
}

export function rhDisplayPhase(phase, detail, extra) {
    const note = detail ? String(detail).trim() : "";
    if (extra?.displayMode === "node") return note || "生成中";
    const withNote = (label) => (note ? `${label} · ${note}` : label);
    switch (phase) {
        case "preflight":
            return "运行前体检";
        case "capture":
            return note || "截取中";
        case "upload":
            return withNote("上传中");
        case "submit":
            return "已提交，等待平台接收";
        case "poll_status":
            return withNote("生成中");
        case "fetch_result":
        case "fetch_result_fallback":
            return withNote("下载中");
        case "save_result":
            return note || "保存返图中";
        case "place_result":
            return note || "贴回中";
        case "failed":
            return note || "失败";
        default:
            return note || "运行中";
    }
}

export function rhCaptureFileName(prefix, mimeType) {
    const ext = String(mimeType || "").toLowerCase().includes("jpeg") ? "jpg" : "png";
    return `${prefix}-${Date.now()}.${ext}`;
}

export function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result;
            if (typeof dataUrl !== "string") {
                reject(new Error("读取失败"));
                return;
            }
            const mimeMatch = /^data:([^;]+);/.exec(dataUrl);
            resolve({
                base64: stripBase64FromDataUrl(dataUrl),
                mimeType: mimeMatch ? mimeMatch[1] : file.type || "application/octet-stream",
            });
        };
        reader.onerror = () => reject(reader.error || new Error("读取失败"));
        reader.readAsDataURL(file);
    });
}
