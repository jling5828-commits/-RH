import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./TopBar.css";
import { ensureStorageReady } from "../bridge/persistentStorage.js";
import { useStatus } from "../utils/StatusContext.jsx";
import { ProductSwitcherMenu } from "./ProductSwitcherMenu.jsx";

const TOOLBAR_FALLBACK_BOTTOM = 46;
const CLOSE_ANIMATION_MS = 180;

function SvgIcon({ name, size = 18 }) {
    if (name === "back") {
        return (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M19 12H5" />
                <path d="m12 19-7-7 7-7" />
            </svg>
        );
    }
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3" />
            <path d="M12 19v3" />
            <path d="M4.93 4.93l2.12 2.12" />
            <path d="M16.95 16.95l2.12 2.12" />
            <path d="M2 12h3" />
            <path d="M19 12h3" />
            <path d="M4.93 19.07l2.12-2.12" />
            <path d="M16.95 7.05l2.12-2.12" />
        </svg>
    );
}

function useMeasuredBottom(active) {
    const nodeRef = useRef(null);
    const [bottom, setBottom] = useState(TOOLBAR_FALLBACK_BOTTOM);

    const measure = useCallback(() => {
        const rect = nodeRef.current?.getBoundingClientRect?.();
        if (rect && rect.height > 1) setBottom(Math.round(rect.bottom));
    }, []);

    useLayoutEffect(() => {
        if (!active) return undefined;
        measure();
        const node = nodeRef.current;
        const observer = node && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
        observer?.observe(node);
        window.addEventListener("resize", measure);
        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", measure);
        };
    }, [active, measure]);

    return { nodeRef, bottom, measure };
}

function useStatusPanel(active, measure) {
    const [state, setState] = useState("closed");
    const visible = state === "open" || state === "closing";

    const open = useCallback(() => {
        measure();
        setState("open");
    }, [measure]);

    const close = useCallback(() => {
        setState((prev) => (prev === "open" ? "closing" : "closed"));
    }, []);

    const toggle = useCallback(() => {
        setState((prev) => {
            if (prev === "open") return "closing";
            measure();
            return "open";
        });
    }, [measure]);

    useEffect(() => {
        if (active) return undefined;
        setState("closed");
        return undefined;
    }, [active]);

    useEffect(() => {
        if (state !== "closing") return undefined;
        const timer = setTimeout(() => setState("closed"), CLOSE_ANIMATION_MS);
        return () => clearTimeout(timer);
    }, [state]);

    return { visible, closing: state === "closing", open, close, toggle };
}

function ToolbarIconButton({ title, onClick, children }) {
    return (
        <button type="button" className="xlrh-toolbar-btn" title={title} aria-label={title} onClick={onClick}>
            {children}
        </button>
    );
}

function StatusPanel({ bottom, closing, onClose, isSettingsOpen, onOpenSettings }) {
    if (typeof document === "undefined") return null;
    return createPortal(
        <>
            <button
                type="button"
                className={`xlrh-status-panel-shade${closing ? " is-leaving" : ""}`}
                style={{ top: bottom }}
                aria-label="关闭状态面板"
                onClick={onClose}
            />
            <section className={`xlrh-status-panel${closing ? " is-leaving" : ""}`} style={{ top: bottom }}>
                <div className="xlrh-status-panel-kicker">RunningHub</div>
                <div className="xlrh-status-panel-title">账户与任务状态</div>
                <p className="xlrh-status-panel-copy">余额和 RH 币以设置页刷新结果为准。</p>
                {!isSettingsOpen && (
                    <button type="button" className="xlrh-status-panel-action" onClick={onOpenSettings}>
                        打开设置
                    </button>
                )}
            </section>
        </>,
        document.body
    );
}

export const TopBar = ({
    isSettingsOpen,
    onToggleView,
    onRefresh,
    onSwitchProduct,
    activeProductId,
    isActiveProduct = true,
}) => {
    const { statusText, refreshCredits } = useStatus();
    const [productMenuOpen, setProductMenuOpen] = useState(false);
    const { nodeRef, bottom, measure } = useMeasuredBottom(isActiveProduct);
    const statusPanel = useStatusPanel(isActiveProduct, measure);

    useEffect(() => {
        if (!isSettingsOpen) refreshCredits();
    }, [isSettingsOpen, refreshCredits]);

    const runRefresh = useCallback(() => {
        Promise.resolve()
            .then(() => ensureStorageReady())
            .then(() => (typeof onRefresh === "function" ? onRefresh() : window.location.reload()))
            .catch((error) => console.warn("[XLRH] 刷新已取消:", error?.message || error));
    }, [onRefresh]);

    const openSettings = useCallback(() => {
        statusPanel.close();
        onToggleView?.();
    }, [onToggleView, statusPanel]);

    const switcher = useMemo(() => {
        if (typeof onSwitchProduct !== "function") return null;
        return (
            <ProductSwitcherMenu
                onOpenChange={setProductMenuOpen}
                onOpenLauncher={() => onSwitchProduct()}
                onSelectRunningHub={() => onSwitchProduct("runninghub")}
                onReload={runRefresh}
                activeProductId={activeProductId}
                isActiveProduct={isActiveProduct}
                triggerTitle="工作台"
            />
        );
    }, [activeProductId, isActiveProduct, onSwitchProduct, runRefresh]);

    const label = statusText || (isSettingsOpen ? "设置" : "系统就绪");

    return (
        <header
            ref={nodeRef}
            className={`xlrh-toolbar${statusPanel.visible ? " is-status-open" : ""}${productMenuOpen ? " is-menu-open" : ""}`}
            title={label}
        >
            {switcher}
            <button type="button" className="xlrh-toolbar-status" onClick={statusPanel.toggle} title="查看状态">
                <span className="xlrh-toolbar-status-dot" aria-hidden />
                <span className="xlrh-toolbar-status-label">{label}</span>
            </button>
            <ToolbarIconButton title={isSettingsOpen ? "返回主页" : "打开设置"} onClick={openSettings}>
                <SvgIcon name={isSettingsOpen ? "back" : "settings"} />
            </ToolbarIconButton>
            {statusPanel.visible && (
                <StatusPanel
                    bottom={bottom}
                    closing={statusPanel.closing}
                    onClose={statusPanel.close}
                    isSettingsOpen={isSettingsOpen}
                    onOpenSettings={openSettings}
                />
            )}
        </header>
    );
};
