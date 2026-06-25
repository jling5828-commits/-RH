import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    MAIN_PREVIEW_EMPTY_MAX_HEIGHT,
    MAIN_PREVIEW_MAX_HEIGHT,
    MAIN_PREVIEW_MIN_HEIGHT,
} from "./constants";

function boundedPreviewHeight(value, maxHeight) {
    const ceiling = Math.max(MAIN_PREVIEW_MIN_HEIGHT, Number(maxHeight) || MAIN_PREVIEW_MAX_HEIGHT);
    const measured = Number.isFinite(value) ? Math.round(value) : MAIN_PREVIEW_MIN_HEIGHT;
    return Math.max(MAIN_PREVIEW_MIN_HEIGHT, Math.min(measured, ceiling));
}

function emptySlotHeight(width, ratio, maxHeight) {
    if (!(ratio > 0)) return MAIN_PREVIEW_MIN_HEIGHT;
    const compactHeight = Math.round((width / ratio) * 0.38);
    return Math.max(MAIN_PREVIEW_MIN_HEIGHT, Math.min(MAIN_PREVIEW_EMPTY_MAX_HEIGHT, compactHeight, maxHeight));
}

function resolveFrameHeight({ width, frameRatio, imageRatio, maxHeight, filled }) {
    if (!(width > 0)) return MAIN_PREVIEW_MIN_HEIGHT;
    const ceiling = maxHeight != null ? maxHeight : MAIN_PREVIEW_MAX_HEIGHT;
    if (frameRatio > 0) {
        return filled
            ? boundedPreviewHeight(width / frameRatio, ceiling)
            : emptySlotHeight(width, frameRatio, ceiling);
    }
    if (!filled) return MAIN_PREVIEW_MIN_HEIGHT;
    return boundedPreviewHeight(width / (imageRatio || 1), ceiling);
}

function useElementWidth() {
    const nodeRef = useRef(null);
    const [width, setWidth] = useState(0);

    useEffect(() => {
        const node = nodeRef.current;
        if (!node) return undefined;
        let frameId = null;
        const readWidth = () => {
            const nextWidth = node.clientWidth;
            if (nextWidth > 0) setWidth(nextWidth);
        };
        const queueRead = () => {
            if (frameId != null) return;
            frameId = requestAnimationFrame(() => {
                frameId = null;
                readWidth();
            });
        };
        readWidth();
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(queueRead);
        observer?.observe(node);
        return () => {
            if (frameId != null) cancelAnimationFrame(frameId);
            observer?.disconnect();
        };
    }, []);

    return [nodeRef, width];
}

function MainPreviewStatus({ isThisLoading, errorMsg, isLoading }) {
    if (isThisLoading) return <div className="xlup-loading-mask">读取中...</div>;
    if (errorMsg && !isLoading) return <div className="xlup-loading-mask error">{errorMsg}</div>;
    return null;
}

const MainPreview = ({
    previewBoxRef,
    mainPreview,
    isLoading,
    isThisLoading,
    errorMsg,
    imageAspectRatio,
    fixedFrameAspectRatio = null,
    maxFrameHeight = null,
    onCapture,
    onClearMain,
}) => {
    const [containerRef, containerWidth] = useElementWidth();
    const computedHeight = useMemo(
        () => resolveFrameHeight({
            width: containerWidth,
            frameRatio: fixedFrameAspectRatio,
            imageRatio: imageAspectRatio,
            maxHeight: maxFrameHeight,
            filled: Boolean(mainPreview),
        }),
        [containerWidth, fixedFrameAspectRatio, imageAspectRatio, mainPreview, maxFrameHeight]
    );

    const handleContextMenu = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (mainPreview) onClearMain?.();
    };

    return (
        <div className="xlup-main-section" ref={containerRef}>
            <div
                ref={previewBoxRef}
                className={`xlup-main-preview ${isThisLoading ? "loading" : ""}`}
                onClick={onCapture}
                onContextMenu={handleContextMenu}
                style={{
                    height: `${computedHeight}px`,
                    borderColor: errorMsg ? "hsla(0, 100%, 70%, 0.4)" : undefined,
                }}
            >
                <span className="xlup-main-slot-label" aria-hidden="true">图1</span>
                {mainPreview && onClearMain ? (
                    <button
                        type="button"
                        className="xlup-capture-clear-btn"
                        onClick={handleContextMenu}
                        title="清空图像"
                        aria-label="清空图像"
                    >
                        &times;
                    </button>
                ) : null}
                <MainPreviewStatus isThisLoading={isThisLoading} errorMsg={errorMsg} isLoading={isLoading} />
                {mainPreview ? (
                    <img src={mainPreview} className="xlup-preview-img" alt="主图" />
                ) : (
                    <span className="xlup-placeholder-text">+ 点击获取选区</span>
                )}
            </div>
        </div>
    );
};

export default MainPreview;
