import React, { useCallback, useEffect, useRef, useState } from "react";
import { useDrawer, DRAWER_CARD_STRIP_HEIGHT } from "./DrawerContext.jsx";

const LONG_PRESS_MS = 200;
const HOVER_CLOSE_MS = 180;
const TOPBAR_HEIGHT = 46;
const MIN_GAP_PX = 8;
const EDGE_LIMIT = { min: 5, max: 95 };
const DEFAULT_SIZE = { width: 36, height: 36 };

const TRIGGER_DEFS = Object.freeze([
    Object.freeze({ type: "reverse", label: "反推", short: "反", className: "reverse", defaultTop: 30, defaultLeft: 25 }),
    Object.freeze({ type: "assistant", label: "提示词", short: "提", className: "assistant", defaultTop: 45, defaultLeft: 50 }),
    Object.freeze({ type: "editAssistant", label: "修图", short: "修", className: "editAssistant", defaultTop: 60, defaultLeft: 75 }),
    Object.freeze({ type: "upscale", label: "超清", short: "超", className: "upscale", defaultTop: 75, defaultLeft: 85 }),
]);

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

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function percent(value, total) {
    return total > 0 ? (value / total) * 100 : 50;
}

function snapSide(centerX, centerY) {
    const relY = centerY - TOPBAR_HEIGHT;
    const workHeight = workspaceHeight();
    if (relY >= 0 && relY < DRAWER_CARD_STRIP_HEIGHT) return "cardTop";
    if (relY > workHeight - DRAWER_CARD_STRIP_HEIGHT) return "cardBottom";
    if (relY > workHeight * 2 / 3) return "bottom";
    return centerX > viewportWidth() / 2 ? "right" : "left";
}

function normalizeTrigger(trigger, fallback) {
    if (!trigger || typeof trigger !== "object") {
        return { side: "left", top: fallback.defaultTop, left: fallback.defaultLeft };
    }
    const side = ["left", "right", "bottom", "cardTop", "cardBottom"].includes(trigger.side) ? trigger.side : "left";
    return {
        side,
        top: typeof trigger.top === "number" ? clamp(trigger.top, EDGE_LIMIT.min, EDGE_LIMIT.max) : fallback.defaultTop,
        left: typeof trigger.left === "number" ? clamp(trigger.left, EDGE_LIMIT.min, EDGE_LIMIT.max) : fallback.defaultLeft,
    };
}

function keepGap(candidate, side, axis, others, minGap) {
    let next = candidate;
    for (const other of others) {
        if (!other || other.side !== side || typeof other[axis] !== "number") continue;
        if (Math.abs(next - other[axis]) >= minGap) continue;
        next = next < other[axis]
            ? clamp(other[axis] - minGap, EDGE_LIMIT.min, EDGE_LIMIT.max)
            : clamp(other[axis] + minGap, EDGE_LIMIT.min, EDGE_LIMIT.max);
    }
    return next;
}

function savePositionFromDrag({ x, y, width, height }, others) {
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const side = snapSide(centerX, centerY);
    const workHeight = workspaceHeight();
    const viewWidth = viewportWidth();

    if (side === "bottom" || side === "cardTop" || side === "cardBottom") {
        const minGap = ((80 + MIN_GAP_PX) / viewWidth) * 100;
        const left = keepGap(clamp(percent(centerX, viewWidth), EDGE_LIMIT.min, EDGE_LIMIT.max), side, "left", others, minGap);
        return { side, top: 50, left };
    }

    const minGap = ((DEFAULT_SIZE.height + MIN_GAP_PX) / workHeight) * 100;
    const top = keepGap(clamp(percent(centerY - TOPBAR_HEIGHT, workHeight), EDGE_LIMIT.min, EDGE_LIMIT.max), side, "top", others, minGap);
    return { side, top, left: 50 };
}

function styleForTrigger(trigger, dragBox) {
    const base = { position: "fixed", zIndex: 997 };
    const viewWidth = viewportWidth();
    const viewHeight = viewportHeight();
    const workHeight = workspaceHeight();

    if (dragBox) {
        return {
            ...base,
            left: clamp(dragBox.x, 0, viewWidth - 50),
            top: clamp(dragBox.y, TOPBAR_HEIGHT + 4, TOPBAR_HEIGHT + workHeight - 40),
            transform: "translate(-50%, -50%)",
        };
    }

    const topPx = TOPBAR_HEIGHT + (Number(trigger.top) / 100) * workHeight;
    const leftPx = (Number(trigger.left) / 100) * viewWidth;
    if (trigger.side === "bottom") {
        return { ...base, left: leftPx, bottom: 8, top: "auto", transform: "translateX(-50%)" };
    }
    if (trigger.side === "cardTop") {
        return { ...base, left: leftPx, top: TOPBAR_HEIGHT + DRAWER_CARD_STRIP_HEIGHT / 2, bottom: "auto", transform: "translate(-50%, -50%)" };
    }
    if (trigger.side === "cardBottom") {
        return { ...base, left: leftPx, top: viewHeight - DRAWER_CARD_STRIP_HEIGHT / 2, bottom: "auto", transform: "translate(-50%, -50%)" };
    }
    if (trigger.side === "right") {
        return { ...base, right: 0, left: "auto", top: topPx, transform: "translateY(-50%)" };
    }
    return { ...base, left: 0, right: "auto", top: topPx, transform: "translateY(-50%)" };
}

function bindingFor(drawer, type) {
    const map = {
        reverse: [drawer.resolvedReverseTrigger, drawer.setReverseTrigger, drawer.reverseTaskRunning, [drawer.assistantTrigger, drawer.editAssistantTrigger, drawer.upscaleTrigger]],
        assistant: [drawer.resolvedAssistantTrigger, drawer.setAssistantTrigger, drawer.assistantTaskRunning, [drawer.reverseTrigger, drawer.editAssistantTrigger, drawer.upscaleTrigger]],
        editAssistant: [drawer.resolvedEditAssistantTrigger, drawer.setEditAssistantTrigger, drawer.editAssistantTaskRunning, [drawer.reverseTrigger, drawer.assistantTrigger, drawer.upscaleTrigger]],
        upscale: [drawer.resolvedUpscaleTrigger, drawer.setUpscaleTrigger, drawer.upscaleTaskRunning, [drawer.reverseTrigger, drawer.assistantTrigger, drawer.editAssistantTrigger]],
    };
    return map[type] || map.reverse;
}

function DrawerTriggerTag({ config }) {
    const drawer = useDrawer();
    const [resolvedTrigger, setTrigger, taskRunning, otherTriggers] = bindingFor(drawer, config.type);
    const trigger = normalizeTrigger(resolvedTrigger, config);
    const setTriggerRef = useRef(setTrigger);
    const otherTriggersRef = useRef(otherTriggers);
    const tagRef = useRef(null);
    const hoverTimerRef = useRef(null);
    const pressTimerRef = useRef(null);
    const dragBoxRef = useRef(null);
    const dragStartRef = useRef(null);
    const didDragRef = useRef(false);
    const [hovered, setHovered] = useState(false);
    const [dragBox, setDragBox] = useState(null);

    useEffect(() => { setTriggerRef.current = setTrigger; }, [setTrigger]);
    useEffect(() => { otherTriggersRef.current = otherTriggers; }, [otherTriggers]);

    const cancelHoverTimer = useCallback(() => {
        if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
        }
    }, []);

    useEffect(() => () => {
        cancelHoverTimer();
        if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    }, [cancelHoverTimer]);

    const finishDrag = useCallback(() => {
        if (pressTimerRef.current) {
            clearTimeout(pressTimerRef.current);
            pressTimerRef.current = null;
        }
        const box = dragBoxRef.current;
        if (!box) return;
        const normalizedOthers = otherTriggersRef.current.map((item, index) => normalizeTrigger(item, TRIGGER_DEFS[index] || config));
        setTriggerRef.current(savePositionFromDrag(box, normalizedOthers));
        dragBoxRef.current = null;
        setDragBox(null);
    }, [config]);

    const handleMouseDown = useCallback((event) => {
        if (event.button !== 0 || !tagRef.current) return;
        event.preventDefault();
        didDragRef.current = false;
        const rect = tagRef.current.getBoundingClientRect();
        dragStartRef.current = {
            pointerX: event.clientX,
            pointerY: event.clientY,
            x: rect.left,
            y: rect.top,
            width: rect.width || DEFAULT_SIZE.width,
            height: rect.height || DEFAULT_SIZE.height,
        };

        const handleMove = (moveEvent) => {
            if (!dragBoxRef.current || !dragStartRef.current) return;
            const start = dragStartRef.current;
            const next = {
                x: start.x + moveEvent.clientX - start.pointerX,
                y: start.y + moveEvent.clientY - start.pointerY,
                width: start.width,
                height: start.height,
            };
            dragBoxRef.current = next;
            setDragBox(next);
        };
        const handleUp = () => {
            document.removeEventListener("mousemove", handleMove);
            document.removeEventListener("mouseup", handleUp);
            finishDrag();
        };

        document.addEventListener("mousemove", handleMove);
        document.addEventListener("mouseup", handleUp);
        pressTimerRef.current = window.setTimeout(() => {
            pressTimerRef.current = null;
            didDragRef.current = true;
            const start = dragStartRef.current;
            dragBoxRef.current = { x: start.x, y: start.y, width: start.width, height: start.height };
            setDragBox(dragBoxRef.current);
        }, LONG_PRESS_MS);
    }, [finishDrag]);

    const handleClick = useCallback(() => {
        if (pressTimerRef.current) {
            clearTimeout(pressTimerRef.current);
            pressTimerRef.current = null;
        }
        if (didDragRef.current) {
            window.setTimeout(() => { didDragRef.current = false; }, 0);
            return;
        }
        drawer.openDrawer(config.type);
    }, [drawer, config.type]);

    const active = (drawer.isDrawerOpen || drawer.isDrawerClosing) && drawer.drawerType === config.type;
    const dragging = !!dragBox;
    const wrapperClass = [
        "drawer-trigger-tag-wrap",
        trigger.side,
        dragging && "dragging ball",
        taskRunning && !dragging && "task-running",
        hovered && "hovered",
        active && "active",
    ].filter(Boolean).join(" ");
    const label = hovered || dragging || active ? config.label : config.short;

    return (
        <div
            ref={tagRef}
            className={wrapperClass}
            style={styleForTrigger(trigger, dragBox)}
            title={`${config.label}（长按拖动）`}
            onClick={handleClick}
            onMouseDown={handleMouseDown}
            onMouseEnter={() => {
                cancelHoverTimer();
                setHovered(true);
            }}
            onMouseLeave={() => {
                cancelHoverTimer();
                hoverTimerRef.current = window.setTimeout(() => setHovered(false), HOVER_CLOSE_MS);
            }}
        >
            <span className={`drawer-trigger-tag ${config.className} ${trigger.side}`}>{label}</span>
        </div>
    );
}

export const DrawerTriggerBar = () => (
    <>
        {TRIGGER_DEFS.map((config) => <DrawerTriggerTag key={config.type} config={config} />)}
    </>
);

export default DrawerTriggerBar;
