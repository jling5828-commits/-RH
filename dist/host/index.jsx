import React, { useLayoutEffect, useRef } from "react";
import ReactDOM from "react-dom";
import { entrypoints } from "uxp";
import { setupBridge, xiaoliangRhPostMainWebviewUploadSessionsInvalidated } from "./bridgeHandlers.js";
import { requestHwMonitorShutdown } from "./hwMonitorAutostart.js";

const PANEL_ID = "xiaoliangRhPanel";
const MAIN_WEBVIEW_ID = "app-webview";
const MAIN_WEBVIEW_SRC = "plugin:/app.html";
const INVALIDATE_DELAY_MS = 400;

const panelMenuHandlers = {
    reloadPanel: () => location.reload(),
};

let panelRoot = null;
let panelHost = null;

function resolvePanelNode(eventOrNode) {
    if (!eventOrNode) return null;
    if (typeof eventOrNode.appendChild === "function") return eventOrNode;
    if (eventOrNode.node && typeof eventOrNode.node.appendChild === "function") return eventOrNode.node;
    if (eventOrNode.target && typeof eventOrNode.target.appendChild === "function") return eventOrNode.target;
    return null;
}

function preparePanelRoot(root) {
    root.dataset.xiaoliangRhPanel = PANEL_ID;
    Object.assign(root.style, {
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100vh",
        minHeight: "100vh",
        margin: "0",
        padding: "0",
        overflow: "hidden",
        boxSizing: "border-box",
        background: "#1e1e1e",
    });
}

function buildMainWebview() {
    const webview = document.createElement("webview");
    webview.id = MAIN_WEBVIEW_ID;
    webview.setAttribute("src", MAIN_WEBVIEW_SRC);
    webview.style.cssText = "position:relative;display:block;flex:1 1 auto;width:100%;height:100%;min-height:0;border:0;";
    return webview;
}

function mountMainWebview(hostNode) {
    if (!hostNode) return null;
    let webview = hostNode.querySelector(`#${MAIN_WEBVIEW_ID}`);
    if (!webview) {
        webview = buildMainWebview();
        hostNode.appendChild(webview);
    }
    setupBridge(webview);
    return webview;
}

function useSingleWebviewMount(hostRef) {
    const webviewRef = useRef(null);
    useLayoutEffect(() => {
        if (webviewRef.current) return undefined;
        webviewRef.current = mountMainWebview(hostRef.current);
        return () => {
            webviewRef.current = null;
        };
    }, [hostRef]);
}

function HostWebviewPanel() {
    const hostRef = useRef(null);
    useSingleWebviewMount(hostRef);
    return (
        <div
            ref={hostRef}
            style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                width: "100%",
                height: "100%",
                minHeight: 0,
                margin: 0,
                padding: 0,
                overflow: "hidden",
                background: "#1e1e1e",
            }}
        />
    );
}

function getPanelRoot() {
    if (panelRoot) return panelRoot;
    panelRoot = document.createElement("div");
    preparePanelRoot(panelRoot);
    ReactDOM.render(<HostWebviewPanel />, panelRoot);
    return panelRoot;
}

function attachPanel(eventOrNode) {
    const host = resolvePanelNode(eventOrNode);
    const root = getPanelRoot();
    if (!host) return root;
    if (root.parentNode && root.parentNode !== host) root.parentNode.removeChild(root);
    if (root.parentNode !== host) host.appendChild(root);
    panelHost = host;
    return root;
}

function detachPanel() {
    if (panelRoot?.parentNode) panelRoot.parentNode.removeChild(panelRoot);
    panelHost = null;
}

function destroyPanel() {
    if (panelRoot) {
        try {
            ReactDOM.unmountComponentAtNode(panelRoot);
        } catch (error) {
            console.warn("[XiaoLiangRH Host] panel unmount failed:", error);
        }
    }
    detachPanel();
    panelRoot = null;
}

function notifyUploadSessionsStale(reason) {
    setTimeout(() => xiaoliangRhPostMainWebviewUploadSessionsInvalidated(reason, "global"), INVALIDATE_DELAY_MS);
}

const pluginLifecycle = {
    create() {
        console.log("[XiaoLiangRH Host] plugin created");
        notifyUploadSessionsStale("pluginCreate");
    },
    destroy() {
        console.log("[XiaoLiangRH Host] plugin destroyed");
        destroyPanel();
        void requestHwMonitorShutdown().catch(() => {});
    },
};

const mainPanel = {
    menuItems: [{ id: "reloadPanel", label: "Reload Plugin", enabled: true, checked: false }],
    create() {
        return getPanelRoot();
    },
    show(event) {
        return attachPanel(event);
    },
    hide() {
        detachPanel();
    },
    destroy() {
        destroyPanel();
    },
    invokeMenu(id) {
        const handler = panelMenuHandlers[id];
        if (typeof handler === "function") handler();
    },
};

entrypoints.setup({
    plugin: pluginLifecycle,
    panels: { [PANEL_ID]: mainPanel },
});
