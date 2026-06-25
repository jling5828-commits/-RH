import React from "react";

const REF_KEYS = Object.freeze(["ref1", "ref2", "ref3", "ref4", "ref5", "ref6"]);

function ReadyIcon() {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M5 12.5l4.2 4.2L19.5 7" />
        </svg>
    );
}

function countReadyRefs(refs) {
    if (!refs || typeof refs !== "object") return 0;
    return REF_KEYS.reduce((total, key) => total + (refs[key] ? 1 : 0), 0);
}

function loadingLabel(target) {
    return target === "main" ? "正在获取主图..." : `正在获取${target?.toUpperCase?.() || "图像"}...`;
}

function resolveBadge(uploadData) {
    if (!uploadData) return null;

    if (uploadData.isLoading) {
        return { kind: "loading", title: loadingLabel(uploadData.loadingTarget) };
    }

    const refs = countReadyRefs(uploadData.refs);
    const hasMain = Boolean(uploadData.mainUploadReady || uploadData.main);
    if (!hasMain && refs <= 0) return { kind: "empty", title: "尚未获取图像" };

    return {
        kind: "ready",
        title: refs > 0 ? `主图 + ${refs} 张参考图` : "主图已就绪",
    };
}

function LoadingStatus({ title }) {
    return (
        <span className="xlup-status-badge xlup-status-loading" title={title} aria-label={title}>
            <span className="xlup-status-spinner" />
        </span>
    );
}

function ReadyStatus({ title }) {
    return (
        <span className="xlup-status-badge xlup-status-ready" title={title} aria-label={title}>
            <ReadyIcon />
        </span>
    );
}

function EmptyStatus({ title }) {
    return (
        <span className="xlup-status-badge xlup-status-empty" title={title} aria-label={title}>
            -
        </span>
    );
}

const STATUS_VIEW = Object.freeze({
    loading: LoadingStatus,
    ready: ReadyStatus,
    empty: EmptyStatus,
});

const ImageUploadStatusBadge = ({ uploadData }) => {
    const state = resolveBadge(uploadData);
    if (!state) return null;
    const View = STATUS_VIEW[state.kind] || EmptyStatus;
    return <View title={state.title} />;
};

export default ImageUploadStatusBadge;
