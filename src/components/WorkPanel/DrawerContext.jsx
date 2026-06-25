import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePersistedState } from "../../hooks/usePersistedState.js";

const DrawerContext = createContext(null);

export const useDrawer = () => useContext(DrawerContext);

const DRAWER_CLOSE_DURATION_MS = 220;
const TOPBAR_HEIGHT = 46;
const TRIGGER_MIN_GAP_PX = 8;
const VERTICAL_TRIGGER_ESTIMATE_PX = 44;
const HORIZONTAL_TRIGGER_ESTIMATE_PX = 80;
const DOCK_DRAWER_BOTTOM_OFFSET_PX = 52;
const NORMAL_DRAWER_BOTTOM_OFFSET_PX = 8;

export const DRAWER_CARD_STRIP_HEIGHT = 44;

const DRAWER_TYPES = ["reverse", "assistant", "editAssistant", "upscale"];

const DRAWER_TRIGGER_DEFAULTS = {
    reverse: { side: "left", top: 30, left: 25 },
    assistant: { side: "left", top: 45, left: 50 },
    editAssistant: { side: "left", top: 60, left: 75 },
    upscale: { side: "left", top: 75, left: 85 },
};

const TRIGGER_STORAGE_KEYS = {
    reverse: "xlrh_drawer_trigger_reverse",
    assistant: "xlrh_drawer_trigger_assistant",
    editAssistant: "xlrh_drawer_trigger_edit_assistant",
    upscale: "xlrh_drawer_trigger_upscale",
};

function clampPercent(value, fallback = 50) {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(5, Math.min(95, value)) : fallback;
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

function readViewport() {
    return {
        wsHeight: workspaceHeight(),
        vw: viewportWidth(),
        vh: viewportHeight(),
    };
}

function normalizeTrigger(raw, type) {
    const defaults = DRAWER_TRIGGER_DEFAULTS[type] || DRAWER_TRIGGER_DEFAULTS.reverse;
    if (!raw || typeof raw !== "object") return { ...defaults };

    if (raw.side === "bottom" || raw.side === "cardTop" || raw.side === "cardBottom") {
        return {
            side: raw.side,
            top: 50,
            left: clampPercent(raw.left, defaults.left),
        };
    }

    return {
        side: raw.side === "right" ? "right" : "left",
        top: clampPercent(raw.top, defaults.top),
        left: 50,
    };
}

function spacingPercent(pixelGap, availablePx) {
    return (pixelGap / Math.max(1, availablePx)) * 100;
}

function separateTriggerLanes(items) {
    return items.reduce((lanes, item) => {
        const side = lanes[item.side] ? item.side : "left";
        lanes[side].push({ ...item, side });
        return lanes;
    }, { left: [], right: [], bottom: [], cardTop: [], cardBottom: [] });
}

function resolveOneAxis(items, key, minGapPct) {
    const sorted = [...items].sort((a, b) => a[key] - b[key]);
    for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1][key];
        if (sorted[index][key] - previous < minGapPct) sorted[index][key] = Math.min(95, previous + minGapPct);
    }
    for (let index = sorted.length - 2; index >= 0; index -= 1) {
        const next = sorted[index + 1][key];
        if (next - sorted[index][key] < minGapPct) sorted[index][key] = Math.max(5, next - minGapPct);
    }
    return sorted;
}

function resolveTriggerPositions(rawTriggers, wsHeight, vw) {
    const normalized = DRAWER_TYPES.map((type) => ({ type, ...normalizeTrigger(rawTriggers[type], type) }));
    const lanes = separateTriggerLanes(normalized);
    const verticalGap = spacingPercent(VERTICAL_TRIGGER_ESTIMATE_PX + TRIGGER_MIN_GAP_PX, wsHeight);
    const horizontalGap = spacingPercent(HORIZONTAL_TRIGGER_ESTIMATE_PX + TRIGGER_MIN_GAP_PX, vw);
    const resolved = {};

    for (const lane of ["left", "right"]) {
        for (const item of resolveOneAxis(lanes[lane], "top", verticalGap)) resolved[item.type] = item;
    }
    for (const lane of ["bottom", "cardTop", "cardBottom"]) {
        for (const item of resolveOneAxis(lanes[lane], "left", horizontalGap)) resolved[item.type] = item;
    }

    return DRAWER_TYPES.reduce((acc, type) => {
        const item = resolved[type] || normalizeTrigger(rawTriggers[type], type);
        acc[type] = { side: item.side, top: item.top, left: item.left };
        return acc;
    }, {});
}

function useViewportSnapshot() {
    const [size, setSize] = useState(() => readViewport());
    useEffect(() => {
        const update = () => setSize(readViewport());
        window.addEventListener("resize", update);
        window.visualViewport?.addEventListener("resize", update);
        return () => {
            window.removeEventListener("resize", update);
            window.visualViewport?.removeEventListener("resize", update);
        };
    }, []);
    return size;
}

function useDrawerTriggerState(type) {
    const defaults = DRAWER_TRIGGER_DEFAULTS[type];
    return usePersistedState(TRIGGER_STORAGE_KEYS[type], () => ({ side: defaults.side, top: defaults.top }));
}

function pickActiveTrigger(drawerType, triggers, dockTrigger) {
    if (dockTrigger && dockTrigger.drawerType === drawerType) return dockTrigger;
    return normalizeTrigger(triggers[drawerType], drawerType || "reverse");
}

export const DrawerProvider = ({ children, isSettingsOpen = false }) => {
    const [drawerType, setDrawerType] = useState(null);
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [isDrawerClosing, setIsDrawerClosing] = useState(false);
    const [dockLayoutTrigger, setDockLayoutTrigger] = useState(null);

    const [reverseTaskRunning, setReverseTaskRunning] = useState(false);
    const [assistantTaskRunning, setAssistantTaskRunning] = useState(false);
    const [editAssistantTaskRunning, setEditAssistantTaskRunning] = useState(false);
    const [upscaleTaskRunning, setUpscaleTaskRunning] = useState(false);

    const [reverseTrigger, setReverseTrigger] = useDrawerTriggerState("reverse");
    const [assistantTrigger, setAssistantTrigger] = useDrawerTriggerState("assistant");
    const [editAssistantTrigger, setEditAssistantTrigger] = useDrawerTriggerState("editAssistant");
    const [upscaleTrigger, setUpscaleTrigger] = useDrawerTriggerState("upscale");

    const triggers = useMemo(() => ({
        reverse: reverseTrigger,
        assistant: assistantTrigger,
        editAssistant: editAssistantTrigger,
        upscale: upscaleTrigger,
    }), [assistantTrigger, editAssistantTrigger, reverseTrigger, upscaleTrigger]);

    const viewport = useViewportSnapshot();
    const resolved = useMemo(
        () => resolveTriggerPositions(triggers, viewport.wsHeight, viewport.vw),
        [triggers, viewport.wsHeight, viewport.vw]
    );

    const beginOpenDrawer = useCallback((type, options = {}) => {
        if (options.fromDock && typeof options.left === "number") {
            setDockLayoutTrigger({
                drawerType: type,
                side: "bottom",
                top: 50,
                left: clampPercent(options.left, 50),
            });
        } else {
            setDockLayoutTrigger(null);
        }
        setDrawerType(type);
        setIsDrawerOpen(true);
        setIsDrawerClosing(false);
    }, []);

    const openReverse = useCallback(() => beginOpenDrawer("reverse"), [beginOpenDrawer]);
    const openAssistant = useCallback(() => beginOpenDrawer("assistant"), [beginOpenDrawer]);
    const openEditAssistant = useCallback(() => beginOpenDrawer("editAssistant"), [beginOpenDrawer]);
    const openUpscale = useCallback(() => beginOpenDrawer("upscale"), [beginOpenDrawer]);
    const openDrawer = useCallback((type, options) => beginOpenDrawer(type, options), [beginOpenDrawer]);
    const closeDrawer = useCallback(() => setIsDrawerClosing(true), []);
    const completeClose = useCallback(() => {
        setIsDrawerOpen(false);
        setIsDrawerClosing(false);
    }, []);

    useEffect(() => {
        if (isSettingsOpen && isDrawerOpen) setIsDrawerClosing(true);
    }, [isDrawerOpen, isSettingsOpen]);

    useEffect(() => {
        if (!isDrawerOpen) setDockLayoutTrigger(null);
    }, [isDrawerOpen]);

    const activeTrigger = pickActiveTrigger(drawerType, triggers, dockLayoutTrigger);
    const drawerBottomOffsetPx = dockLayoutTrigger && (isDrawerOpen || isDrawerClosing)
        ? DOCK_DRAWER_BOTTOM_OFFSET_PX
        : NORMAL_DRAWER_BOTTOM_OFFSET_PX;

    const contextValue = useMemo(() => ({
        drawerType,
        isDrawerOpen,
        isDrawerClosing,
        closeDurationMs: DRAWER_CLOSE_DURATION_MS,
        completeClose,
        triggerSide: activeTrigger.side,
        triggerTop: activeTrigger.top,
        triggerLeft: activeTrigger.left,
        reverseTrigger,
        setReverseTrigger,
        assistantTrigger,
        setAssistantTrigger,
        editAssistantTrigger,
        setEditAssistantTrigger,
        upscaleTrigger,
        setUpscaleTrigger,
        resolvedReverseTrigger: resolved.reverse,
        resolvedAssistantTrigger: resolved.assistant,
        resolvedEditAssistantTrigger: resolved.editAssistant,
        resolvedUpscaleTrigger: resolved.upscale,
        reverseTaskRunning,
        setReverseTaskRunning,
        assistantTaskRunning,
        setAssistantTaskRunning,
        editAssistantTaskRunning,
        setEditAssistantTaskRunning,
        upscaleTaskRunning,
        setUpscaleTaskRunning,
        openReverse,
        openAssistant,
        openEditAssistant,
        openUpscale,
        closeDrawer,
        openDrawer,
        drawerBottomOffsetPx,
        layoutViewportVw: viewport.vw,
        layoutViewportVh: viewport.vh,
    }), [
        activeTrigger.left,
        activeTrigger.side,
        activeTrigger.top,
        assistantTaskRunning,
        assistantTrigger,
        closeDrawer,
        completeClose,
        drawerBottomOffsetPx,
        drawerType,
        editAssistantTaskRunning,
        editAssistantTrigger,
        isDrawerClosing,
        isDrawerOpen,
        openAssistant,
        openDrawer,
        openEditAssistant,
        openReverse,
        openUpscale,
        resolved.assistant,
        resolved.editAssistant,
        resolved.reverse,
        resolved.upscale,
        reverseTaskRunning,
        reverseTrigger,
        setAssistantTrigger,
        setEditAssistantTrigger,
        setReverseTrigger,
        setUpscaleTrigger,
        upscaleTaskRunning,
        upscaleTrigger,
        viewport.vh,
        viewport.vw,
    ]);

    return <DrawerContext.Provider value={contextValue}>{children}</DrawerContext.Provider>;
};
