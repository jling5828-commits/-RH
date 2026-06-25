import React, { useMemo } from "react";
import { rhInputRowKey } from "../rhInputUtils.js";

const FALLBACK_IMAGE_MODE = "canvas";

function ReadyIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
        </svg>
    );
}

function mediaRowsOnly(rows) {
    return Array.isArray(rows) ? rows.filter((row) => row?.nodeId && row?.fieldName) : [];
}

function keyFor(row) {
    return rhInputRowKey(row.nodeId, row.fieldName);
}

function valueFor(row, values) {
    const key = keyFor(row);
    const source = Object.prototype.hasOwnProperty.call(values || {}, key) ? values[key] : row.fieldValue;
    return source == null ? "" : String(source).trim();
}

function remoteReady(value) {
    return Boolean(value) && !value.startsWith("data:");
}

function imageReady(key, pending, imageModes) {
    if (pending?.base64) return true;
    const mode = imageModes?.[key] || FALLBACK_IMAGE_MODE;
    return mode !== "file" && Boolean(pending?.previewBase64);
}

function rowReady(row, values, pendingUploads, imageModes) {
    const key = keyFor(row);
    const pending = pendingUploads?.[key];
    if (row.fieldType === "IMAGE") return imageReady(key, pending, imageModes);
    return pending?.base64 ? true : remoteReady(valueFor(row, values));
}

function labelForCapture(rows, key) {
    if (!key) return "";
    const row = rows.find((item) => keyFor(item) === key);
    return row ? row.nodeName || row.fieldName || key : key;
}

function summarize(rows, values, pendingUploads, imageModes, capturingKey) {
    return {
        ready: rows.filter((row) => rowReady(row, values, pendingUploads, imageModes)).length,
        total: rows.length,
        label: labelForCapture(rows, capturingKey),
    };
}

function StatusShell({ kind, title, children }) {
    return (
        <span className={`xlup-status-badge xlup-status-${kind}`} title={title}>
            {children}
        </span>
    );
}

function LoadingBadge({ label }) {
    return (
        <StatusShell kind="loading" title={label ? `正在获取：${label}...` : "正在获取媒体..."}>
            <span className="xlup-status-spinner" />
        </StatusShell>
    );
}

function ReadyBadge({ ready, total }) {
    const title = ready >= total ? `全部 ${total} 项媒体已就绪` : `已准备 ${ready}/${total} 项媒体`;
    return <StatusShell kind="ready" title={title}><ReadyIcon /></StatusShell>;
}

function EmptyBadge() {
    return <StatusShell kind="empty" title="尚未获取媒体">-</StatusShell>;
}

export function RhImageUploadStatusBadge({ mediaRows, fieldValues, pendingUploads, imageModes = {}, capturingKey }) {
    const rows = useMemo(() => mediaRowsOnly(mediaRows), [mediaRows]);
    const state = useMemo(
        () => summarize(rows, fieldValues, pendingUploads, imageModes, capturingKey),
        [rows, fieldValues, pendingUploads, imageModes, capturingKey]
    );

    if (state.total === 0) return null;
    if (capturingKey) return <LoadingBadge label={state.label} />;
    if (state.ready > 0) return <ReadyBadge ready={state.ready} total={state.total} />;
    return <EmptyBadge />;
}

export default RhImageUploadStatusBadge;
