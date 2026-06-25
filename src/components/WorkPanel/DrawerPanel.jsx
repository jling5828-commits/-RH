import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { ReversePanel } from "./ReversePanel.jsx";
import { PromptAssistantPanel } from "./PromptAssistantPanel.jsx";
import { EditAssistantPanel } from "./EditAssistantPanel.jsx";
import { UpscalePanel } from "./UpscalePanel.jsx";
import { HistoryPanel } from "./HistoryPanel.jsx";
import { useDrawer } from "./DrawerContext.jsx";
import { useStatus } from "../../utils/StatusContext.jsx";
import { usePersistedState } from "../../hooks/usePersistedState.js";
import "./DrawerPanel.css";
import "./HistoryPanel.css";

const TOPBAR_HEIGHT = 46;
const EDGE_MARGIN = 8;
const PANEL_MIN_WIDTH = 260;
const PANEL_MIN_HEIGHT = 200;
const DRAG_TOP_PAD = 16;
const TRIGGER_GAP_PX = 8;
const TRIGGER_HEIGHT_ESTIMATE = 44;
const BOTTOM_TRIGGER_WIDTH_ESTIMATE = 80;

const DRAWER_META = Object.freeze({
    reverse: Object.freeze({ title: "图片反推", history: true }),
    assistant: Object.freeze({ title: "提示词小助手", history: true }),
    editAssistant: Object.freeze({ title: "修图评价小助手", history: true }),
    upscale: Object.freeze({ title: "一键超清", history: false }),
});

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function viewportHeight() {
    if (typeof window === "undefined") return 600;
    return window.visualViewport?.height || document.documentElement?.clientHeight || document.body?.clientHeight || window.innerHeight || 600;
}

function viewportWidth() {
    return typeof window === "undefined" ? 400 : window.innerWidth || 400;
}

function workspaceHeight() {
    return Math.max(200, viewportHeight() - TOPBAR_HEIGHT);
}

function bottomPanelWidth(vw) {
    return Math.max(PANEL_MIN_WIDTH, Math.floor(vw) - EDGE_MARGIN * 2);
}

function historyText(item) {
    return String(item?.result || item?.parsedResult?.prompt || "").trim();
}

function keepAwayFromSiblings(value, siblings, side, axis, minGap) {
    let next = value;
    const points = siblings
        .filter((item) => item && item.side === side && typeof item[axis] === "number")
        .map((item) => item[axis])
        .sort((a, b) => a - b);

    for (let pass = 0; pass < 2; pass += 1) {
        for (const point of points) {
            if (Math.abs(next - point) >= minGap) continue;
            next = next < point ? point - minGap : point + minGap;
            next = clamp(next, 5, 95);
        }
    }
    return next;
}

function chooseTriggerSetter(type, setters) {
    return setters[type] || setters.editAssistant;
}

function siblingsFor(type, triggers) {
    return Object.keys(triggers)
        .filter((key) => key !== type)
        .map((key) => triggers[key]);
}

function panelStyleFromTrigger({ triggerSide, triggerTop, triggerLeft, drawerBottomOffsetPx, layoutViewportVw, layoutViewportVh }) {
    const vh = typeof layoutViewportVh === "number" ? layoutViewportVh : viewportHeight();
    const vw = typeof layoutViewportVw === "number" ? layoutViewportVw : viewportWidth();
    const maxBottom = vh - DRAG_TOP_PAD;

    if (triggerSide === "bottom") {
        const width = bottomPanelWidth(vw);
        const center = ((typeof triggerLeft === "number" ? triggerLeft : 50) / 100) * vw;
        const left = clamp(center - width / 2, EDGE_MARGIN, Math.max(EDGE_MARGIN, vw - width - EDGE_MARGIN));
        const bottom = typeof drawerBottomOffsetPx === "number" ? drawerBottomOffsetPx : EDGE_MARGIN;
        return {
            top: "auto",
            left,
            bottom,
            width,
            maxHeight: Math.max(PANEL_MIN_HEIGHT, vh - bottom - TOPBAR_HEIGHT - DRAG_TOP_PAD),
        };
    }

    const workHeight = workspaceHeight();
    const topPercent = typeof triggerTop === "number" ? triggerTop : 50;
    let top = TOPBAR_HEIGHT + (topPercent / 100) * workHeight - 24;
    top = clamp(top, TOPBAR_HEIGHT + DRAG_TOP_PAD, Math.max(TOPBAR_HEIGHT + DRAG_TOP_PAD, maxBottom - 80));
    return {
        top,
        maxHeight: Math.max(PANEL_MIN_HEIGHT, maxBottom - top),
    };
}

function activePanelRef(type, refs) {
    if (type === "assistant") return refs.assistant.current;
    if (type === "editAssistant") return refs.editAssistant.current;
    if (type === "reverse") return refs.reverse.current;
    return null;
}

function shouldIgnoreHeaderDrag(target) {
    return !!target?.closest?.(".drawer-close, .drawer-history-btn");
}

export const DrawerPanel = ({
    uploadData,
    imageUploadRef,
    prompt,
    setPrompt,
    onPresetSaved,
    clearPresetRef,
    inputFontSize = 13,
}) => {
    const { pushStatus } = useStatus();
    const [drawerView, setDrawerView] = useState("main");
    const [assistantMode] = usePersistedState("xlrh_assistant_mode", "chat");
    const [dragging, setDragging] = useState(false);
    const dragStartRef = useRef({ pointerX: 0, pointerY: 0, panelTop: 0, panelLeft: 0 });
    const drawerContentRef = useRef(null);
    const panelRefs = {
        reverse: useRef(null),
        assistant: useRef(null),
        editAssistant: useRef(null),
    };

    const drawer = useDrawer();
    const {
        drawerType,
        isDrawerOpen,
        isDrawerClosing,
        closeDrawer,
        completeClose,
        closeDurationMs,
        triggerSide,
        triggerTop,
        triggerLeft,
        drawerBottomOffsetPx,
        layoutViewportVw,
        layoutViewportVh,
    } = drawer;

    const triggerSetters = useMemo(() => ({
        reverse: drawer.setReverseTrigger,
        assistant: drawer.setAssistantTrigger,
        editAssistant: drawer.setEditAssistantTrigger,
        upscale: drawer.setUpscaleTrigger,
    }), [drawer.setAssistantTrigger, drawer.setEditAssistantTrigger, drawer.setReverseTrigger, drawer.setUpscaleTrigger]);

    const triggerMap = useMemo(() => ({
        reverse: drawer.reverseTrigger,
        assistant: drawer.assistantTrigger,
        editAssistant: drawer.editAssistantTrigger,
        upscale: drawer.upscaleTrigger,
    }), [drawer.assistantTrigger, drawer.editAssistantTrigger, drawer.reverseTrigger, drawer.upscaleTrigger]);

    const siblingTriggers = useMemo(() => siblingsFor(drawerType, triggerMap), [drawerType, triggerMap]);
    const activeSetter = useMemo(() => chooseTriggerSetter(drawerType, triggerSetters), [drawerType, triggerSetters]);

    const loadHistoryIntoPanel = useCallback((item) => {
        activePanelRef(drawerType, panelRefs)?.loadFromHistory?.(item);
    }, [drawerType, panelRefs]);

    const fillHistory = useCallback((item, mode) => {
        const text = historyText(item);
        if (!text) return;
        clearPresetRef?.current?.();
        if (mode === "append") {
            setPrompt((prev) => (prev ? `${prev}\n${text}` : text));
            pushStatus("已追加到提示词", 2000);
        } else {
            setPrompt(text);
            pushStatus("已填入提示词（替换）", 2000);
        }
        loadHistoryIntoPanel(item);
        setDrawerView("main");
    }, [clearPresetRef, loadHistoryIntoPanel, pushStatus, setPrompt]);

    const closeWithSave = useCallback(async () => {
        if (drawerType === "assistant") await panelRefs.assistant.current?.saveCurrentChat?.();
        closeDrawer();
    }, [closeDrawer, drawerType, panelRefs.assistant]);

    const openHistory = useCallback(async () => {
        if (drawerView === "main") {
            if (drawerType === "assistant") await panelRefs.assistant.current?.saveCurrentChat?.();
            setDrawerView("history");
        } else {
            setDrawerView("main");
        }
    }, [drawerType, drawerView, panelRefs.assistant]);

    const beginDrag = useCallback((event) => {
        if (event.button !== 0 || isDrawerClosing || shouldIgnoreHeaderDrag(event.target)) return;
        const panel = event.currentTarget.closest(".drawer-panel");
        if (!panel) return;
        event.preventDefault();
        const rect = panel.getBoundingClientRect();
        dragStartRef.current = {
            pointerX: event.clientX,
            pointerY: event.clientY,
            panelTop: rect.top,
            panelLeft: rect.left,
        };
        setDragging(true);
    }, [isDrawerClosing]);

    const applyDrag = useCallback((event) => {
        if (!dragging || !activeSetter) return;
        const start = dragStartRef.current;

        if (triggerSide === "bottom") {
            const vw = viewportWidth();
            const width = bottomPanelWidth(vw);
            const left = clamp(start.panelLeft + event.clientX - start.pointerX, EDGE_MARGIN, Math.max(EDGE_MARGIN, vw - width - EDGE_MARGIN));
            const centerPercent = clamp(((left + width / 2) / vw) * 100, 5, 95);
            const minGap = ((BOTTOM_TRIGGER_WIDTH_ESTIMATE + TRIGGER_GAP_PX) / vw) * 100;
            const nextLeft = keepAwayFromSiblings(centerPercent, siblingTriggers, "bottom", "left", minGap);
            activeSetter((prev) => ({ ...(prev && typeof prev === "object" ? prev : { side: "bottom" }), side: "bottom", top: 50, left: nextLeft }));
            return;
        }

        const workHeight = workspaceHeight();
        const rawTop = start.panelTop + event.clientY - start.pointerY;
        const boundedTop = clamp(rawTop, TOPBAR_HEIGHT + DRAG_TOP_PAD, Math.max(TOPBAR_HEIGHT + DRAG_TOP_PAD, viewportHeight() - DRAG_TOP_PAD - 80));
        const percent = clamp(((boundedTop - TOPBAR_HEIGHT + 24) / workHeight) * 100, 5, 95);
        const side = triggerSide === "right" ? "right" : "left";
        const minGap = ((TRIGGER_HEIGHT_ESTIMATE + TRIGGER_GAP_PX) / workHeight) * 100;
        const nextTop = keepAwayFromSiblings(percent, siblingTriggers, side, "top", minGap);
        activeSetter((prev) => ({ ...(prev && typeof prev === "object" ? prev : { side }), side, top: nextTop, left: 50 }));
    }, [activeSetter, dragging, siblingTriggers, triggerSide]);

    useEffect(() => {
        if (!dragging) return;
        const onMove = (event) => applyDrag(event);
        const onUp = () => setDragging(false);
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        return () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        };
    }, [applyDrag, dragging]);

    useEffect(() => {
        if (!isDrawerClosing) return;
        const timer = window.setTimeout(completeClose, closeDurationMs ?? 220);
        return () => window.clearTimeout(timer);
    }, [closeDurationMs, completeClose, isDrawerClosing]);

    useEffect(() => {
        if (isDrawerOpen && !isDrawerClosing) setDrawerView("main");
    }, [drawerType, isDrawerClosing, isDrawerOpen]);

    const isVisible = isDrawerOpen || isDrawerClosing;
    const meta = DRAWER_META[drawerType] || DRAWER_META.editAssistant;
    const panelStyle = useMemo(
        () => isVisible
            ? panelStyleFromTrigger({ triggerSide, triggerTop, triggerLeft, drawerBottomOffsetPx, layoutViewportVw, layoutViewportVh })
            : {},
        [drawerBottomOffsetPx, isVisible, layoutViewportVh, layoutViewportVw, triggerLeft, triggerSide, triggerTop]
    );

    if (drawerType == null) return null;

    const content = (
        <div style={isVisible ? undefined : { display: "none" }}>
            <div className={`drawer-overlay ${isDrawerClosing ? "drawer-closing" : ""}`} onClick={closeWithSave} aria-hidden="true" />
            <div
                className={`drawer-panel drawer-type-${drawerType} trigger-${triggerSide} ${isDrawerClosing ? "drawer-closing" : ""}`}
                style={{ ...panelStyle, "--xlrh-input-font-size": `${inputFontSize}px` }}
            >
                <div
                    className={`drawer-header ${dragging ? "dragging" : ""}`}
                    onMouseDown={beginDrag}
                    title="拖动标题栏可移动抽屉"
                >
                    <span className="drawer-title">{drawerView === "history" ? "历史记录" : meta.title}</span>
                    <div className="drawer-header-actions">
                        {meta.history && (
                            <button
                                type="button"
                                className={`drawer-history-btn ${drawerView === "history" ? "active" : ""}`}
                                onClick={openHistory}
                                title={drawerView === "history" ? "返回主面板" : "查看历史"}
                            >
                                {drawerView === "history" ? "返回" : "历史"}
                            </button>
                        )}
                        <button type="button" className="drawer-close" onClick={closeWithSave} title="关闭">✕</button>
                    </div>
                </div>

                <div className="drawer-content" ref={drawerContentRef}>
                    <div className="drawer-content-history" style={{ display: drawerView === "history" ? "block" : "none" }}>
                        <HistoryPanel
                            drawerType={drawerType}
                            assistantMode={assistantMode}
                            drawerContentRef={drawerContentRef}
                            isVisible={drawerView === "history"}
                            onFillReplace={(item) => fillHistory(item, "replace")}
                            onFillAppend={(item) => fillHistory(item, "append")}
                            onSelect={(item) => {
                                loadHistoryIntoPanel(item);
                                setDrawerView("main");
                            }}
                            onBackToMain={() => setDrawerView("main")}
                        />
                    </div>

                    <div className="drawer-content-main" style={{ display: drawerView === "main" ? "block" : "none" }}>
                        <div style={{ display: drawerType === "reverse" ? "block" : "none" }}>
                            <ReversePanel
                                ref={panelRefs.reverse}
                                uploadData={uploadData}
                                imageUploadRef={imageUploadRef}
                                prompt={prompt}
                                setPrompt={setPrompt}
                                onClearPreset={() => clearPresetRef?.current?.()}
                            />
                        </div>
                        <div style={{ display: drawerType === "assistant" ? "block" : "none" }}>
                            <PromptAssistantPanel
                                ref={panelRefs.assistant}
                                prompt={prompt}
                                setPrompt={setPrompt}
                                onPresetSaved={onPresetSaved}
                                onClearPreset={() => clearPresetRef?.current?.()}
                            />
                        </div>
                        <div style={{ display: drawerType === "editAssistant" ? "block" : "none" }}>
                            <EditAssistantPanel
                                ref={panelRefs.editAssistant}
                                uploadData={uploadData}
                                imageUploadRef={imageUploadRef}
                            />
                        </div>
                        <div style={{ display: drawerType === "upscale" ? "block" : "none" }}>
                            <UpscalePanel />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    return typeof document !== "undefined" && document.body
        ? ReactDOM.createPortal(content, document.body)
        : content;
};
