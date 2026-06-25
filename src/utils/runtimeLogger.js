import { runtimeWriteLog, isInWebView } from "../bridge/uxpBridge.js";

const LOG_MAX_VALUE_LENGTH = 1000;
const LOG_FLUSH_DELAY_MS = 250;
const MAX_BUFFERED_ENTRIES = 80;
const SECRET_KEY_RE = /(api[_-]?key|authorization|bearer|token|secret|password)/i;

let enabled = false;
let installed = false;
let queue = [];
let timer = null;
let flushing = false;
let originalConsole = null;

function redactString(value) {
    const s = String(value ?? "");
    return s
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer ***")
        .replace(/([A-Za-z0-9_-]{6})[A-Za-z0-9_-]{12,}([A-Za-z0-9_-]{4})/g, "$1***$2")
        .slice(0, LOG_MAX_VALUE_LENGTH);
}

function serializeValue(value, depth = 0, key = "") {
    if (SECRET_KEY_RE.test(key)) return "***";
    if (value == null) return value;
    if (typeof value === "string") return redactString(value);
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (value instanceof Error) {
        return {
            name: value.name,
            message: redactString(value.message),
            stack: redactString(value.stack || ""),
        };
    }
    if (depth >= 2) return redactString(Object.prototype.toString.call(value));
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => serializeValue(item, depth + 1));
    if (typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value).slice(0, 40)) {
            out[k] = serializeValue(v, depth + 1, k);
        }
        return out;
    }
    return redactString(value);
}

function scheduleFlush() {
    if (timer || flushing || !enabled) return;
    timer = setTimeout(() => {
        timer = null;
        flushRuntimeLogs();
    }, LOG_FLUSH_DELAY_MS);
}

export function logRuntimeEvent(level, event, detail = null) {
    if (!enabled) return;
    queue.push({
        ts: new Date().toISOString(),
        level: String(level || "info"),
        event: String(event || "event"),
        detail: serializeValue(detail),
    });
    if (queue.length > MAX_BUFFERED_ENTRIES) queue = queue.slice(queue.length - MAX_BUFFERED_ENTRIES);
    scheduleFlush();
}

export async function flushRuntimeLogs() {
    if (flushing || !enabled || queue.length === 0) return;
    flushing = true;
    const batch = queue;
    queue = [];
    try {
        await runtimeWriteLog(batch);
    } catch (_) {
        // Runtime logging must never break the plugin workflow.
    } finally {
        flushing = false;
        if (queue.length > 0) scheduleFlush();
    }
}

function installConsoleMirror() {
    if (originalConsole) return;
    originalConsole = {
        warn: console.warn?.bind(console),
        error: console.error?.bind(console),
    };
    console.warn = (...args) => {
        try { originalConsole.warn?.(...args); } finally { logRuntimeEvent("warn", "console.warn", args); }
    };
    console.error = (...args) => {
        try { originalConsole.error?.(...args); } finally { logRuntimeEvent("error", "console.error", args); }
    };
}

export function installRuntimeLogger() {
    if (installed) return;
    installed = true;
    enabled = isInWebView();
    if (!enabled) return;
    installConsoleMirror();
    logRuntimeEvent("info", "plugin.start", {
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        location: typeof window !== "undefined" ? window.location?.href : "",
    });
    window.addEventListener("error", (event) => {
        logRuntimeEvent("error", "window.error", {
            message: event?.message || "",
            filename: event?.filename || "",
            line: event?.lineno || 0,
            column: event?.colno || 0,
            error: event?.error instanceof Error ? event.error : null,
        });
    });
    window.addEventListener("unhandledrejection", (event) => {
        logRuntimeEvent("error", "window.unhandledrejection", {
            reason: event?.reason instanceof Error ? event.reason : event?.reason,
        });
    });
}

export function logStatusMessage(text, duration) {
    logRuntimeEvent("info", "status", { text, duration });
}
