import React, { useMemo } from "react";
import "./RefCard.css";

const REF_SOURCE_MODES = Object.freeze([
    Object.freeze({ key: "canvas", label: "画布", colorClass: "canvas", tip: "截取整个画布作为参考图" }),
    Object.freeze({ key: "layer", label: "图层", colorClass: "layer", tip: "截取当前图层作为参考图" }),
    Object.freeze({ key: "file", label: "文件", colorClass: "file", tip: "选择本地图片作为参考图" }),
]);

function cx(...tokens) {
    return tokens.filter(Boolean).join(" ");
}

function refSlotName(index) {
    return `R${Number(index) + 1}`;
}

function keyboardActivate(event, enabled, action) {
    if (!enabled || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    action?.();
}

function SourceModeButton({ option, selected, enabled, onPick }) {
    return (
        <button
            type="button"
            className={cx("xlup-ref-mode-btn", option.colorClass, selected && "active", !enabled && "dim")}
            disabled={!enabled}
            title={option.tip}
            aria-pressed={selected}
            onClick={(event) => {
                event.stopPropagation();
                if (enabled) onPick?.(option.key);
            }}
        >
            {option.label}
        </button>
    );
}

function RefEnableToggle({ label, enabled, onToggle }) {
    const title = enabled ? `关闭参考图 ${label}` : `启用参考图 ${label}`;
    return (
        <div
            className="xlup-ref-ctrl-top"
            role="button"
            tabIndex={0}
            title={title}
            onClick={() => onToggle?.()}
            onKeyDown={(event) => keyboardActivate(event, true, onToggle)}
        >
            <div className={cx("xlup-check-box", enabled && "checked")}>
                {enabled ? <div className="xlup-check-mark" /> : null}
            </div>
            <span className="xlup-ref-label">{label}</span>
        </div>
    );
}

function SourceModeStrip({ label, enabled, mode, onModeChange }) {
    return (
        <div className="xlup-ref-mode-list" role="group" aria-label={`${label} 来源`}>
            {REF_SOURCE_MODES.map((option) => (
                <SourceModeButton
                    key={option.key}
                    option={option}
                    selected={mode === option.key}
                    enabled={enabled}
                    onPick={onModeChange}
                />
            ))}
        </div>
    );
}

function captureTitle(enabled, mode) {
    if (!enabled) return "请先启用这个参考图";
    return mode === "file" ? "点击选择参考图文件" : "点击截取参考图";
}

function PreviewContent({ enabled, preview, label, refKey }) {
    if (!preview) return <span className="xlup-placeholder-text">{enabled ? "+" : "-"}</span>;
    return <img src={preview} className={cx("xlup-preview-img", !enabled && "grayscale")} alt={refKey || label} />;
}

function PreviewMessage({ loading, errorMsg }) {
    if (loading) return <div className="xlup-loading-mask">读取中...</div>;
    if (errorMsg) return <div className="xlup-loading-mask error">{errorMsg}</div>;
    return null;
}

function RefPreviewBox({ enabled, preview, label, refKey, mode, loading, errorMsg, onCapture, onClear }) {
    const canCapture = Boolean(enabled);
    const showError = Boolean(errorMsg) && !loading;
    const capture = () => {
        if (canCapture) onCapture?.();
    };
    const clear = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (preview) onClear?.();
    };

    return (
        <div
            className={cx("xlup-ref-img", !enabled && "dimmed")}
            role="button"
            tabIndex={canCapture ? 0 : -1}
            title={captureTitle(enabled, mode)}
            onClick={capture}
            onKeyDown={(event) => keyboardActivate(event, canCapture, capture)}
            style={{ borderColor: showError ? "hsla(0, 100%, 70%, 0.4)" : undefined }}
        >
            <PreviewMessage loading={loading} errorMsg={showError ? errorMsg : ""} />
            {preview && onClear ? (
                <button
                    type="button"
                    className="xlup-capture-clear-btn"
                    onClick={clear}
                    title="清空图像"
                    aria-label="清空图像"
                >
                    &times;
                </button>
            ) : null}
            <PreviewContent enabled={enabled} preview={preview} label={label} refKey={refKey} />
            {!enabled && preview ? <div className="xlup-disabled-overlay" /> : null}
        </div>
    );
}

const RefCard = ({
    refKey,
    index,
    active,
    preview,
    mode,
    isThisLoading,
    errorMsg,
    onToggle,
    onModeChange,
    onCapture,
    onClear,
}) => {
    const label = useMemo(() => refSlotName(index), [index]);
    const enabled = Boolean(active);

    return (
        <div className={cx("xlup-ref-card", enabled ? "active" : "inactive")}>
            <div className="xlup-ref-ctrl">
                <RefEnableToggle label={label} enabled={enabled} onToggle={onToggle} />
                <SourceModeStrip label={label} enabled={enabled} mode={mode} onModeChange={onModeChange} />
            </div>
            <RefPreviewBox
                enabled={enabled}
                preview={preview}
                label={label}
                refKey={refKey}
                mode={mode}
                loading={isThisLoading}
                errorMsg={errorMsg}
                onCapture={onCapture}
                onClear={onClear}
            />
        </div>
    );
};

export default RefCard;
