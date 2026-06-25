import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./RhParamNumericStepper.css";

const FIELD_NUMBER_KEYS = Object.freeze({
    step: ["step", "stepSize", "increment"],
    min: ["min", "minimum", "minValue"],
    max: ["max", "maximum", "maxValue"],
    defaultValue: ["default", "defaultValue", "default_value", "value"],
});

const HOLD_START_MS = 400;
const REPEAT_MS = 72;
const REPEAT_FAST_MS = 32;
const FAST_AFTER_MS = 900;
const SHORT_INT_LIMIT = 12;
const LABELS = Object.freeze({
    decrease: "\u51cf\u5c11",
    increase: "\u589e\u52a0",
    editHint: "\u53cc\u51fb\u8f93\u5165\u6570\u503c",
});

function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function toNumber(value) {
    if (value == null) return null;
    const parsed = Number.parseFloat(String(value).replace(/,/g, ".").trim());
    return Number.isFinite(parsed) ? parsed : null;
}

function readNumberField(fieldData, keys, { positive = false } = {}) {
    const obj = asObject(fieldData);
    if (!obj) return undefined;
    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
        const parsed = toNumber(obj[key]);
        if (parsed == null || (positive && parsed <= 0)) continue;
        return parsed;
    }
    return undefined;
}

export function parseNumericStepFromFieldData(fieldData) {
    return readNumberField(fieldData, FIELD_NUMBER_KEYS.step, { positive: true });
}

export function parseNumericMinFromFieldData(fieldData) {
    return readNumberField(fieldData, FIELD_NUMBER_KEYS.min);
}

export function parseNumericMaxFromFieldData(fieldData) {
    return readNumberField(fieldData, FIELD_NUMBER_KEYS.max);
}

export function parseNumericDefaultFromFieldData(fieldData) {
    return readNumberField(fieldData, FIELD_NUMBER_KEYS.defaultValue);
}

function precisionForStep(step) {
    if (!Number.isFinite(step) || step <= 0) return 2;
    for (let digits = 0; digits <= 8; digits += 1) {
        const scaled = step * 10 ** digits;
        if (Math.abs(scaled - Math.round(scaled)) < 1e-7) return digits;
    }
    return 2;
}

function shortenIntegerText(value) {
    const text = String(value);
    const sign = text.startsWith("-") ? "-" : "";
    const digits = sign ? text.slice(1) : text;
    if (!/^\d+$/.test(digits) || digits.length <= SHORT_INT_LIMIT) return text;
    return `${sign}${digits.slice(0, 5)}...${digits.slice(-4)}`;
}

function useRepeatingPress(onStep, stepRef, disabled) {
    const timers = useRef({ delay: null, ramp: null, interval: null });

    const stop = useCallback(() => {
        const current = timers.current;
        if (current.delay != null) clearTimeout(current.delay);
        if (current.ramp != null) clearTimeout(current.ramp);
        if (current.interval != null) clearInterval(current.interval);
        timers.current = { delay: null, ramp: null, interval: null };
    }, []);

    useEffect(() => stop, [stop]);

    const start = useCallback((sign) => (event) => {
        if (disabled) return;
        if (event.button != null && event.button !== 0) return;
        event.preventDefault();
        onStep(sign * stepRef.current);
        stop();
        const tick = () => onStep(sign * stepRef.current);
        timers.current.delay = window.setTimeout(() => {
            timers.current.delay = null;
            timers.current.interval = window.setInterval(tick, REPEAT_MS);
            timers.current.ramp = window.setTimeout(() => {
                timers.current.ramp = null;
                if (timers.current.interval != null) clearInterval(timers.current.interval);
                timers.current.interval = window.setInterval(tick, REPEAT_FAST_MS);
            }, FAST_AFTER_MS);
        }, HOLD_START_MS);
    }, [disabled, onStep, stepRef, stop]);

    return { start, stop };
}

function useStepperMath({ value, variant, step, minProp, maxProp, onChange }) {
    const decimals = variant === "float" ? precisionForStep(step) : 0;
    const min = minProp != null && Number.isFinite(Number(minProp)) ? Number(minProp) : null;
    const max = maxProp != null && Number.isFinite(Number(maxProp)) ? Number(maxProp) : null;
    const validRange = !(min != null && max != null && min > max);

    const parseValue = useCallback((input) => toNumber(input), []);

    const clamp = useCallback((number) => {
        if (!validRange || !Number.isFinite(number)) return number;
        let next = number;
        if (min != null) next = Math.max(min, next);
        if (max != null) next = Math.min(max, next);
        return next;
    }, [max, min, validRange]);

    const format = useCallback((number) => {
        if (!Number.isFinite(number)) return variant === "int" ? "0" : (0).toFixed(decimals);
        const clean = variant === "int" ? Math.round(number) : Math.round(number * 1e8) / 1e8;
        return variant === "int" ? String(clean) : clean.toFixed(decimals);
    }, [decimals, variant]);

    const numericValue = useCallback(() => parseValue(value) ?? 0, [parseValue, value]);

    const applyDelta = useCallback((delta) => {
        const raw = numericValue() + delta;
        const rounded = variant === "int" ? Math.round(raw) : raw;
        onChange(format(clamp(rounded)));
    }, [clamp, format, numericValue, onChange, variant]);

    const display = useMemo(() => {
        if (value === "" || value === undefined || value === null) return "-";
        if (variant === "int") return shortenIntegerText(value);
        const parsed = parseValue(value);
        return parsed == null ? String(value) : format(parsed);
    }, [format, parseValue, value, variant]);

    const current = numericValue();
    const nextDown = clamp(variant === "int" ? Math.round(current - step) : current - step);
    const nextUp = clamp(variant === "int" ? Math.round(current + step) : current + step);
    const hasBounds = validRange && (min != null || max != null);
    const atLower = hasBounds && (variant === "int" ? nextDown === current : Math.abs(nextDown - current) < 1e-10);
    const atUpper = hasBounds && (variant === "int" ? nextUp === current : Math.abs(nextUp - current) < 1e-10);

    return { applyDelta, clamp, display, format, parseValue, atLower, atUpper };
}

export function RhParamNumericStepper({
    value,
    onChange,
    variant,
    step: stepProp,
    min: minProp,
    max: maxProp,
    disabled = false,
    compact = false,
}) {
    const step = useMemo(() => {
        const upstream = stepProp != null ? Number(stepProp) : NaN;
        if (Number.isFinite(upstream) && upstream > 0) return upstream;
        return variant === "int" ? 1 : 0.01;
    }, [stepProp, variant]);

    const stepRef = useRef(step);
    stepRef.current = step;

    const inputRef = useRef(null);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const math = useStepperMath({ value, variant, step, minProp, maxProp, onChange });
    const hold = useRepeatingPress(math.applyDelta, stepRef, disabled);

    useEffect(() => {
        if (!editing || !inputRef.current) return;
        inputRef.current.focus();
        inputRef.current.select();
    }, [editing]);

    const beginEdit = useCallback(() => {
        if (disabled) return;
        if (value === undefined || value === null || value === "") {
            setDraft("");
        } else if (variant === "float") {
            const parsed = math.parseValue(value);
            setDraft(parsed == null ? String(value) : math.format(parsed));
        } else {
            setDraft(String(value));
        }
        setEditing(true);
    }, [disabled, math, value, variant]);

    const commitDraft = useCallback(() => {
        const parsed = math.parseValue(draft);
        if (parsed != null) {
            const rounded = variant === "int" ? Math.round(parsed) : parsed;
            onChange(math.format(math.clamp(rounded)));
        }
        setEditing(false);
    }, [draft, math, onChange, variant]);

    const stepKeyHandler = useCallback((sign) => (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        math.applyDelta(sign * step);
    }, [math, step]);

    const valueTitle = value === "" || value === undefined || value === null ? LABELS.editHint : `${String(value)}\n${LABELS.editHint}`;
    const className = [
        "xlrh-stepper",
        compact ? "xlrh-stepper--compact" : "",
        disabled ? "xlrh-stepper--disabled" : "",
    ].filter(Boolean).join(" ");

    return (
        <div className={className}>
            <button
                type="button"
                className="xlrh-stepper-btn"
                aria-label={LABELS.decrease}
                disabled={disabled || math.atLower}
                onPointerDown={hold.start(-1)}
                onPointerUp={hold.stop}
                onPointerCancel={hold.stop}
                onPointerLeave={hold.stop}
                onKeyDown={stepKeyHandler(-1)}
            >
                -
            </button>

            {editing ? (
                <input
                    ref={inputRef}
                    type="text"
                    inputMode={variant === "int" ? "numeric" : "decimal"}
                    className="xlrh-stepper-input"
                    disabled={disabled}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={commitDraft}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            commitDraft();
                        }
                        if (event.key === "Escape") {
                            event.preventDefault();
                            setEditing(false);
                        }
                    }}
                />
            ) : (
                <button
                    type="button"
                    className="xlrh-stepper-value"
                    title={valueTitle}
                    disabled={disabled}
                    onDoubleClick={beginEdit}
                >
                    {math.display}
                </button>
            )}

            <button
                type="button"
                className="xlrh-stepper-btn"
                aria-label={LABELS.increase}
                disabled={disabled || math.atUpper}
                onPointerDown={hold.start(1)}
                onPointerUp={hold.stop}
                onPointerCancel={hold.stop}
                onPointerLeave={hold.stop}
                onKeyDown={stepKeyHandler(1)}
            >
                +
            </button>
        </div>
    );
}
