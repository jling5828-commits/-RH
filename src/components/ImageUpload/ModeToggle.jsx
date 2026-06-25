import React, { useMemo } from "react";
import "./ModeToggle.css";

const BUILTIN_MODES = Object.freeze([
    Object.freeze({ key: "canvas", label: "画布", colorClass: "canvas", tip: "截取整个画布，包含所有可见图层" }),
    Object.freeze({ key: "layer", label: "图层", colorClass: "layer", tip: "仅截取当前选中图层" }),
    Object.freeze({ key: "file", label: "文件", colorClass: "file", tip: "从本地选择图片文件" }),
]);

function classNames(...values) {
    return values.filter(Boolean).join(" ");
}

function normalizeModes(modeDefs) {
    return Array.isArray(modeDefs) && modeDefs.length ? modeDefs : BUILTIN_MODES;
}

function ModeButton({ item, selected, onSelect }) {
    return (
        <button
            key={item.key}
            type="button"
            className={classNames("xlup-mode-btn", item.colorClass, selected && "active")}
            aria-pressed={selected}
            title={item.tip}
            onClick={() => {
                if (!selected && typeof onSelect === "function") onSelect(item.key);
            }}
        >
            {item.label}
        </button>
    );
}

const ModeToggle = ({ mode, onChange, vertical = false, modeDefs = null, segmented = false }) => {
    const modes = useMemo(() => normalizeModes(modeDefs), [modeDefs]);

    return (
        <div
            className={classNames("xlup-mode-group", vertical && "vertical", segmented && "xlup-mode-group--segmented")}
            role="group"
            aria-label="图片来源"
        >
            {modes.map((item) => (
                <ModeButton key={item.key} item={item} selected={mode === item.key} onSelect={onChange} />
            ))}
        </div>
    );
};

export default ModeToggle;
