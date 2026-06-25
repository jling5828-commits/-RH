import "./bridge/storagePolyfill.js";
import "./runninghub/index.js";
import "./styles.css";

import React from "react";
import ReactDOM from "react-dom";
import { ensureStorageReady } from "./bridge/persistentStorage.js";
import { RunninghubShell } from "./runninghub/ui/RunninghubShell.jsx";
import { installRuntimeLogger } from "./utils/runtimeLogger.js";
import { StatusProvider } from "./utils/StatusContext.jsx";
import { migrateXlrhStorageKeys } from "./utils/storageKeyCompat.js";

const BOOT_ROOT_ID = "root";
const PANEL_LOG = "[XLRH]";
const RETRY_BUTTON_ID = "xlrh-boot-retry";
const RESIZE_OBSERVER_NOISE = Object.freeze([
    "ResizeObserver loop completed with undelivered notifications",
    "ResizeObserver loop limit exceeded",
]);

const FALLBACK_COPY = Object.freeze({
    loadCrash: "插件加载出错（未捕获）",
    promiseCrash: "插件初始化失败（Promise）",
    renderCrash: "加载出错",
    storageUnavailable: "存储暂不可用",
    storageBody: "为避免配置被覆盖，本次已暂停加载。请稍后点击重试。",
    missingRoot: "未找到 #root 元素",
    retry: "重试",
});

const BOOT_CSS = Object.freeze({
    shell: "box-sizing:border-box;height:100%;padding:16px;overflow:auto;background:#2a2a2a;color:#fff;font-family:sans-serif;font-size:12px;",
    body: "margin-bottom:10px;color:rgba(255,255,255,0.75);line-height:1.55;",
    button: "display:inline-flex;align-items:center;justify-content:center;margin:0 0 10px;padding:8px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.22);background:rgba(255,255,255,0.06);color:#fff;cursor:pointer;",
    detail: "margin:0;color:rgba(255,255,255,0.78);white-space:pre-wrap;word-break:break-all;",
});

const BOUNDARY_PANEL_STYLE = Object.freeze({
    boxSizing: "border-box",
    height: "100%",
    padding: 16,
    overflow: "auto",
    background: "#333",
    color: "#fff",
    fontFamily: "sans-serif",
    fontSize: 12,
});

function escapeHtml(value) {
    const text = String(value ?? "");
    return text.replace(/[<>&]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[char]));
}

function describeError(error, fallback = "") {
    if (error?.stack) return error.stack;
    if (error?.message) return error.message;
    return String(error ?? fallback);
}

function retryButtonHtml(enabled) {
    if (!enabled) return "";
    return `<button id="${RETRY_BUTTON_ID}" style="${BOOT_CSS.button}">${FALLBACK_COPY.retry}</button>`;
}

function fallbackHtml({ title, detail, body = "", tone = "error", retry = false }) {
    const color = tone === "warn" ? "#ffbf55" : "#ff8f8f";
    const bodyHtml = body ? `<div style="${BOOT_CSS.body}">${escapeHtml(body)}</div>` : "";
    return `<div style="${BOOT_CSS.shell}">
        <div style="margin-bottom:8px;color:${color};font-weight:700;">${escapeHtml(title)}</div>
        ${bodyHtml}
        ${retryButtonHtml(retry)}
        <pre style="${BOOT_CSS.detail}">${escapeHtml(detail)}</pre>
    </div>`;
}

function showFallback(target, options) {
    const host = target || document.body;
    if (!host) return;
    host.innerHTML = fallbackHtml(options);
    const retry = options.retry ? host.querySelector(`#${RETRY_BUTTON_ID}`) : null;
    if (retry) retry.onclick = () => window.location.reload();
}

function isResizeObserverMessage(message, error) {
    const text = `${String(message ?? "")}\n${String(error?.message ?? "")}`;
    return RESIZE_OBSERVER_NOISE.some((line) => text.includes(line));
}

function isReactRemoveChildRace(message, error) {
    const text = `${String(message ?? "")}\n${String(error?.message ?? "")}`;
    return error?.name === "NotFoundError" && text.includes("removeChild") && text.includes("not a child");
}

function installWindowCrashFallback(resolveRoot) {
    window.onerror = (message, url, line, column, error) => {
        if (isResizeObserverMessage(message, error)) {
            console.warn(`${PANEL_LOG} 已忽略 Chromium ResizeObserver 提示:`, message);
            return true;
        }

        if (isReactRemoveChildRace(message, error)) {
            console.warn(`${PANEL_LOG} ignored React removeChild race:`, message);
            return true;
        }

        const detail = error?.stack || `${message} (${url || ""}:${line || ""}:${column || ""})`;
        console.error(`${PANEL_LOG} 未捕获错误:`, detail);
        showFallback(resolveRoot() || document.body, { title: FALLBACK_COPY.loadCrash, detail });
        return true;
    };

    window.onunhandledrejection = (event) => {
        const detail = describeError(event?.reason, String(event));
        console.error(`${PANEL_LOG} 未处理 Promise:`, detail);
        showFallback(resolveRoot() || document.body, { title: FALLBACK_COPY.promiseCrash, detail });
    };
}

class XlrhBootBoundary extends React.PureComponent {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        console.error(`${PANEL_LOG} ErrorBoundary:`, error, info?.componentStack);
    }

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;
        return (
            <div style={BOUNDARY_PANEL_STYLE}>
                <div style={{ color: "#ff9a9a", marginBottom: 8, fontWeight: 700 }}>{FALLBACK_COPY.renderCrash}</div>
                <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                    {describeError(error)}
                </pre>
            </div>
        );
    }
}

function PanelApp() {
    return (
        <XlrhBootBoundary>
            <StatusProvider>
                <RunninghubShell isActiveProduct={true} />
            </StatusProvider>
        </XlrhBootBoundary>
    );
}

async function preparePanelRuntime() {
    await ensureStorageReady();
    migrateXlrhStorageKeys();
}

async function startPanel(rootElement) {
    try {
        await preparePanelRuntime();
        ReactDOM.render(<PanelApp />, rootElement);
    } catch (error) {
        console.error(`${PANEL_LOG} 初始化失败:`, error);
        showFallback(rootElement, {
            title: FALLBACK_COPY.storageUnavailable,
            detail: describeError(error),
            tone: "warn",
            body: FALLBACK_COPY.storageBody,
            retry: true,
        });
    }
}

installRuntimeLogger();

const rootElement = document.getElementById(BOOT_ROOT_ID);
installWindowCrashFallback(() => rootElement || document.body);

if (rootElement) {
    void startPanel(rootElement);
} else if (document.body) {
    document.body.innerHTML = `<div style="padding:16px;color:#ff8f8f;">${FALLBACK_COPY.missingRoot}</div>`;
}
