import { useLayoutEffect, useState } from "react";

export const RH_APP_MENU_MAX_HEIGHT_PX = 440;

const GAP = 8;
const MIN_WIDTH = 120;
const MIN_HEIGHT = 60;
const FALLBACK_HEIGHT = 200;

function appNameText(name) {
    const text = String(name || "").trim();
    return /^默认AI应用/.test(text) ? "" : text;
}

function idTail(webappId) {
    const text = String(webappId ?? "").trim();
    if (!text) return "";
    return text.length <= 14 ? text : `…${text.slice(-8)}`;
}

export function formatRhAppDisplayLabel(name, webappId) {
    const namePart = appNameText(name);
    const idPart = idTail(webappId);
    if (!idPart) return namePart || "应用";
    return namePart ? `${namePart} · ${idPart}` : idPart;
}

function viewportSize() {
    if (typeof window === "undefined") return { width: 400, height: 600 };
    return {
        width: window.innerWidth || 400,
        height: window.innerHeight || 600,
    };
}

function menuWidth(anchorWidth, viewportWidth) {
    const available = Math.max(MIN_WIDTH, viewportWidth - GAP * 2);
    return Math.min(Math.max(MIN_WIDTH, anchorWidth), available);
}

function menuLeft(anchorLeft, width, viewportWidth) {
    const maxLeft = viewportWidth - GAP - width;
    return Math.max(GAP, Math.min(anchorLeft, maxLeft));
}

function maxHeightForDirection(rect, dropup, cap, viewportHeight) {
    if (dropup) return Math.min(cap, Math.max(MIN_HEIGHT, rect.top - GAP - 2));
    return Math.min(cap, Math.max(MIN_HEIGHT, viewportHeight - rect.bottom - GAP - 2));
}

function menuTop(rect, dropup) {
    return dropup ? rect.top - 2 : rect.bottom + 2;
}

function dropdownStyleFromRect(rect, dropup, maxMenuHeight) {
    const viewport = viewportSize();
    const cap = Math.max(MIN_HEIGHT, Number(maxMenuHeight) > 0 ? Number(maxMenuHeight) : FALLBACK_HEIGHT);
    const width = menuWidth(rect.width, viewport.width);
    return {
        position: "fixed",
        left: menuLeft(rect.left, width, viewport.width),
        top: menuTop(rect, dropup),
        width,
        maxHeight: maxHeightForDirection(rect, dropup, cap, viewport.height),
        boxSizing: "border-box",
    };
}

export function useDropdownPosition(containerRef, isOpen, isDropup = false, maxMenuHeight = FALLBACK_HEIGHT) {
    const [style, setStyle] = useState(null);

    useLayoutEffect(() => {
        if (!isOpen) {
            setStyle(null);
            return undefined;
        }

        let raf = null;
        const update = () => {
            const element = containerRef?.current;
            if (!element) return;
            setStyle(dropdownStyleFromRect(element.getBoundingClientRect(), isDropup, maxMenuHeight));
        };
        const queueUpdate = () => {
            if (raf != null) return;
            raf = requestAnimationFrame(() => {
                raf = null;
                update();
            });
        };

        update();
        queueUpdate();
        window.addEventListener("scroll", queueUpdate, true);
        window.addEventListener("resize", queueUpdate);
        return () => {
            if (raf != null) cancelAnimationFrame(raf);
            window.removeEventListener("scroll", queueUpdate, true);
            window.removeEventListener("resize", queueUpdate);
        };
    }, [containerRef, isOpen, isDropup, maxMenuHeight]);

    return style;
}
