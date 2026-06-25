import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const DEFAULT_MIN_PX = 36;
const DEFAULT_MAX_PX = 220;
const SETTLE_MS = 280;
const WIDTH_EPSILON = 1;

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function measurable(element) {
    return Boolean(element) && element.getBoundingClientRect().width >= 4;
}

function resetForMeasurement(element) {
    element.style.transition = "none";
    element.style.minHeight = "0";
    element.style.maxHeight = "none";
    element.style.height = "auto";
    element.style.overflow = "hidden";
}

function restoreMeasuredStyles(element) {
    element.style.minHeight = "";
    element.style.maxHeight = "";
    element.style.overflow = "";
}

function overflowMode(element) {
    return element.scrollHeight - element.clientHeight > 1 ? "auto" : "hidden";
}

function useAutoHeight(textareaRef, value, minHeightPx, maxHeightPx) {
    const [overflowY, setOverflowY] = useState("hidden");
    const lastWidthRef = useRef(-1);

    const commitOverflow = useCallback((element) => {
        if (element) setOverflowY(overflowMode(element));
    }, []);

    const fit = useCallback((animate = false) => {
        const element = textareaRef.current;
        if (!measurable(element)) return;

        const startHeight = element.offsetHeight;
        resetForMeasurement(element);
        const targetHeight = clamp(element.scrollHeight, minHeightPx, maxHeightPx);
        restoreMeasuredStyles(element);

        if (!animate || Math.abs(startHeight - targetHeight) < 1) {
            element.style.height = `${targetHeight}px`;
            void element.offsetHeight;
            element.style.transition = "";
            commitOverflow(element);
            return;
        }

        element.style.height = `${startHeight}px`;
        void element.offsetHeight;
        setOverflowY("hidden");
        requestAnimationFrame(() => {
            element.style.transition = "";
            element.style.height = `${targetHeight}px`;
        });
    }, [commitOverflow, maxHeightPx, minHeightPx, textareaRef]);

    useLayoutEffect(() => {
        let alive = true;
        fit(true);
        const timer = setTimeout(() => {
            if (alive) fit(false);
        }, SETTLE_MS);
        return () => {
            alive = false;
            clearTimeout(timer);
        };
    }, [fit, value]);

    useEffect(() => {
        const element = textareaRef.current;
        if (!element) return undefined;
        const done = (event) => {
            if (event.target === element && event.propertyName === "height") fit(false);
        };
        element.addEventListener("transitionend", done);
        return () => element.removeEventListener("transitionend", done);
    }, [fit, textareaRef]);

    useEffect(() => {
        let alive = true;
        document.fonts?.ready?.then(() => {
            if (alive) requestAnimationFrame(() => fit(false));
        });
        return () => { alive = false; };
    }, [fit]);

    useEffect(() => {
        const element = textareaRef.current;
        if (!element || typeof ResizeObserver === "undefined") return undefined;
        let raf = null;
        lastWidthRef.current = -1;
        const observer = new ResizeObserver((entries) => {
            if (raf != null) return;
            const width = entries[0]?.contentRect?.width ?? element.getBoundingClientRect().width;
            raf = requestAnimationFrame(() => {
                raf = null;
                if (lastWidthRef.current >= 0 && Math.abs(width - lastWidthRef.current) < WIDTH_EPSILON) return;
                lastWidthRef.current = width;
                fit(false);
            });
        });
        observer.observe(element);
        return () => {
            if (raf != null) cancelAnimationFrame(raf);
            observer.disconnect();
        };
    }, [fit, textareaRef]);

    useEffect(() => {
        const element = textareaRef.current;
        if (!element || typeof IntersectionObserver === "undefined") return undefined;
        let wasVisible = false;
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                const visible = entry.isIntersecting && entry.boundingClientRect.width > 4;
                if (visible && !wasVisible) requestAnimationFrame(() => fit(false));
                wasVisible = visible;
            }
        }, { threshold: 0, rootMargin: "0px 0px 32px 0px" });
        observer.observe(element);
        return () => observer.disconnect();
    }, [fit, textareaRef]);

    useEffect(() => {
        window.addEventListener("resize", fit);
        return () => window.removeEventListener("resize", fit);
    }, [fit]);

    useEffect(() => {
        const element = textareaRef.current;
        if (!element) return undefined;
        const update = () => fit(false);
        element.addEventListener("focus", update);
        element.addEventListener("pointerenter", update);
        return () => {
            element.removeEventListener("focus", update);
            element.removeEventListener("pointerenter", update);
        };
    }, [fit, textareaRef]);

    return overflowY;
}

export function RhParamAutoGrowTextarea({
    value,
    onChange,
    placeholder,
    className = "",
    minHeightPx = DEFAULT_MIN_PX,
    maxHeightPx = DEFAULT_MAX_PX,
    disabled = false,
}) {
    const textareaRef = useRef(null);
    const overflowY = useAutoHeight(textareaRef, value, minHeightPx, maxHeightPx);

    return (
        <textarea
            ref={textareaRef}
            rows={1}
            className={className}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            style={{
                minHeight: minHeightPx,
                overflowY,
                overflowX: "hidden",
                boxSizing: "border-box",
            }}
        />
    );
}

export default RhParamAutoGrowTextarea;
