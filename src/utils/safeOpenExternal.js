import { shell } from "../bridge/uxpBridge.js";

const USER_CANCEL_HINTS = Object.freeze([
    "user denied",
    "permission denied",
    "用户拒绝",
    "已拒绝",
    "拒绝授权",
]);

function cleanUrl(value) {
    return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error) {
    if (!error) return "未知错误";
    return typeof error.message === "string" && error.message ? error.message : String(error);
}

function pushMessage(pushStatus, message, duration = 3000) {
    if (typeof pushStatus === "function") {
        pushStatus(message, duration);
        return;
    }
    console.warn("[xiaoliang-rh openExternal]", message);
}

function isPermissionCancel(error) {
    const lower = errorMessage(error).toLowerCase();
    return USER_CANCEL_HINTS.some((hint) => lower.includes(hint.toLowerCase()));
}

export async function safeOpenExternal(url, opts = {}) {
    const pushStatus = opts?.pushStatus;
    const target = cleanUrl(url);
    if (!target) {
        pushMessage(pushStatus, "链接无效", 3000);
        return false;
    }

    try {
        await shell.openExternal(target);
        return true;
    } catch (error) {
        if (isPermissionCancel(error)) {
            pushMessage(pushStatus, "已取消打开链接；需要访问时请在权限弹窗中选择允许", 5000);
            return false;
        }
        const detail = errorMessage(error);
        console.warn("[xiaoliang-rh openExternal] failed:", error);
        pushMessage(pushStatus, `打开链接失败：${detail}`, 5000);
        return false;
    }
}
