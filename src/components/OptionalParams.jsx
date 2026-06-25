import React, { useMemo } from "react";
import { CustomSelect } from "./CustomSelect.jsx";
import { RhParamNumericStepper } from "../runninghub/ui/RhParamNumericStepper.jsx";
import { getDefaultModel, getModelList } from "../controllers/network/config.js";
import "./OptionalParams.css";

const FALLBACK_MODEL = "RunningHub";
const RATIO_OPTIONS = Object.freeze(["1:1", "4:3", "3:4", "16:9", "9:16"]);
const SIZE_OPTIONS = Object.freeze(["512", "1024", "2048", "4096"]);
const LABELS = Object.freeze({
    model: "\u6a21\u578b",
    ratio: "\u6bd4\u4f8b",
    size: "\u957f\u8fb9",
    count: "\u6570\u91cf",
    sheet: "\u5f20",
});

function normalizeOptions(options, current, fallback) {
    const seen = new Set();
    const list = [];
    for (const item of [current, ...(options || []), fallback]) {
        const value = String(item || "").trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        list.push(value);
    }
    return list;
}

function pickValue(value, options, fallback) {
    const text = String(value || "").trim();
    if (text) return text;
    return options[0] || fallback || "";
}

export function OptionalParams({
    model,
    setModel,
    ratio,
    setRatio,
    size,
    setSize,
    count,
    setCount,
    editorOpen = false,
}) {
    const modelOptions = useMemo(
        () => normalizeOptions(getModelList(), model, getDefaultModel() || FALLBACK_MODEL),
        [model]
    );
    const ratioOptions = useMemo(() => normalizeOptions(RATIO_OPTIONS, ratio, "1:1"), [ratio]);
    const sizeOptions = useMemo(() => normalizeOptions(SIZE_OPTIONS, size, "2048"), [size]);

    const modelValue = pickValue(model, modelOptions, FALLBACK_MODEL);
    const ratioValue = pickValue(ratio, ratioOptions, "1:1");
    const sizeValue = pickValue(size, sizeOptions, "2048");
    const countValue = String(count || "1");
    const disabled = !!editorOpen;

    return (
        <div className="opt-section" aria-disabled={disabled}>
            <div className="opt-row">
                <CustomSelect
                    label={LABELS.model}
                    value={modelValue}
                    displayValue={modelValue}
                    options={modelOptions}
                    disabled={disabled}
                    onChange={(next) => setModel?.(next)}
                />
            </div>
            <div className="opt-flex-2col">
                <div className="opt-col-item">
                    <CustomSelect
                        label={LABELS.ratio}
                        value={ratioValue}
                        displayValue={ratioValue}
                        options={ratioOptions}
                        disabled={disabled}
                        onChange={(next) => setRatio?.(next)}
                    />
                </div>
                <div className="opt-col-item">
                    <CustomSelect
                        label={LABELS.size}
                        value={sizeValue}
                        displayValue={sizeValue}
                        options={sizeOptions}
                        disabled={disabled}
                        onChange={(next) => setSize?.(next)}
                    />
                </div>
            </div>
            <div className="opt-row opt-count-row">
                <div className={`xlrh-param-select-box ${disabled ? "xlrh-param-select-box--disabled" : ""}`}>
                    <div className="xlrh-param-select-label">{LABELS.count}</div>
                    <div className="xlrh-param-select-divider" />
                    <div className="xlrh-param-select-content opt-count-content">
                        <RhParamNumericStepper
                            value={countValue}
                            onChange={(next) => setCount?.(next)}
                            variant="int"
                            min={1}
                            max={8}
                            disabled={disabled}
                            compact
                        />
                        <span className="xlrh-param-select-extra opt-count-unit">{LABELS.sheet}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default OptionalParams;
