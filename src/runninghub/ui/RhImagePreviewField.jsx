import React, { useCallback, useEffect, useRef, useState } from "react";
import { MAIN_PREVIEW_MIN_HEIGHT } from "../../components/ImageUpload/constants.js";
import { computePreviewHeight } from "./xlrhRhWorkPanelLogic.js";

export function RhImagePreviewField({
    label,
    pending,
    busy,
    onCapture,
    onClear,
    onHeightChange,
    minPreviewHeight = MAIN_PREVIEW_MIN_HEIGHT,
}) {
    const containerRef = useRef(null);
    const [containerWidth, setContainerWidth] = useState(0);

    const aspectRatio = pending?.aspectRatio ?? null;
    const hasPreview = !!pending?.previewBase64;
    const previewHeight = computePreviewHeight(containerWidth, aspectRatio || (hasPreview ? 1 : null));
    const renderedHeight = Math.max(Number(minPreviewHeight) || MAIN_PREVIEW_MIN_HEIGHT, previewHeight);
    const canClearUpload = !!(pending?.previewBase64 || pending?.base64 || pending?.uploadSessionId || pending?.fileName);

    const clearPreview = useCallback(
        (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (canClearUpload) onClear?.();
        },
        [canClearUpload, onClear]
    );

    useEffect(() => {
        const node = containerRef.current;
        if (!node) return undefined;
        let rafId = null;
        let observer = null;
        const measure = () => {
            const width = node.clientWidth;
            if (width > 0) setContainerWidth(width);
        };
        const schedule = () => {
            if (rafId != null) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                measure();
            });
        };
        measure();
        if (typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(schedule);
            observer.observe(node);
        }
        return () => {
            if (rafId != null) cancelAnimationFrame(rafId);
            observer?.disconnect?.();
        };
    }, []);

    useEffect(() => {
        onHeightChange?.(renderedHeight);
    }, [renderedHeight, onHeightChange]);

    const handlePreviewClick = () => {
        if (!busy) onCapture?.();
    };

    const previewTitle = canClearUpload ? "点击重新捕获；右键清空预览" : "点击捕获图像";
    const labelTitle = [label, canClearUpload ? "右键清空预览" : ""].filter(Boolean).join("\n") || undefined;

    return (
        <div className="rh-xlup-field">
            <div className="xlup-main-section" ref={containerRef}>
                <div
                    className={`xlup-main-preview ${busy ? "loading" : ""}`}
                    style={{
                        height: `${renderedHeight}px`,
                        minHeight: `${Math.max(MAIN_PREVIEW_MIN_HEIGHT, Number(minPreviewHeight) || 0)}px`,
                    }}
                    onClick={handlePreviewClick}
                    title={previewTitle}
                >
                    <span
                        className={`xlup-main-slot-label rh-main-node-label ${canClearUpload ? "xlup-float-label-btn" : ""}`}
                        onContextMenu={clearPreview}
                        title={labelTitle}
                    >
                        {label || "图"}
                    </span>
                    {canClearUpload && onClear ? (
                        <button
                            type="button"
                            className="xlup-capture-clear-btn"
                            onClick={clearPreview}
                            title="清空图像"
                            aria-label="清空图像"
                        >
                            &times;
                        </button>
                    ) : null}
                    {busy ? <div className="xlup-loading-mask">读取中...</div> : null}
                    {pending?.previewBase64 ? (
                        <img
                            src={pending.previewBase64}
                            className={`xlup-preview-img ${canClearUpload ? "rh-preview-img--clearable" : ""}`}
                            alt="预览"
                            onContextMenu={clearPreview}
                            title={canClearUpload ? "右键清空预览" : undefined}
                        />
                    ) : (
                        <span className="xlup-placeholder-text">+ 点击捕获图像</span>
                    )}
                </div>
            </div>
        </div>
    );
}
