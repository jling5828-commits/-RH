import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import "./TaskPreviewLightbox.css";

function TaskPreviewLightbox({ src, title = "任务预览", onClose }) {
    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === "Escape") onClose?.();
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    const content = (
        <div className="xlrh-task-preview-backdrop" onClick={onClose}>
            <div className="xlrh-task-preview-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
                <img className="xlrh-task-preview-image" src={src} alt="" />
            </div>
            <button type="button" className="xlrh-task-preview-close" onClick={onClose} title="关闭">×</button>
        </div>
    );

    return typeof document !== "undefined" && document.body ? createPortal(content, document.body) : content;
}

export function TaskPreviewThumb({ src, title = "查看大图" }) {
    const [open, setOpen] = useState(false);
    if (!src) return <div className="rh-task-thumb" />;

    const openPreview = (event) => {
        event.stopPropagation();
        setOpen(true);
    };

    return (
        <>
            <button type="button" className="rh-task-thumb xlrh-task-thumb-button" onClick={openPreview} title={title} aria-label={title}>
                <img src={src} alt="" className="rh-task-thumb-img" />
            </button>
            {open && <TaskPreviewLightbox src={src} title={title} onClose={() => setOpen(false)} />}
        </>
    );
}
