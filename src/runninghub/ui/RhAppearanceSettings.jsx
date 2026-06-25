import React, { useCallback, useEffect, useMemo, useState } from "react";
import "../../components/settings/BackgroundSettings.css";
import "../../components/Settings.css";
import { useStatus } from "../../utils/StatusContext.jsx";
import { readCompatLocalStorage, writeCompatLocalStorage } from "../../utils/storageKeyCompat.js";
import {
    PRODUCT_THEME_IDS,
    saveProductAppearance,
    loadProductAppearance,
    RUNNINGHUB_APPEARANCE_LABELS,
    RUNNINGHUB_SETTINGS_APPEARANCE_KEYS,
    getAppearancePickerDefault,
    getAppearanceSeedForProduct,
    normalizeRunninghubCustomColors,
} from "../../utils/themeConfig.js";

const RH_PRODUCT_ID = PRODUCT_THEME_IDS.RUNNINGHUB;
const APPEARANCE_SAVED_EVENT = "xlrh-appearance-saved";
const FONT_STORAGE_KEY = "xlrh_input_font_size";
const FONT_LIMIT = Object.freeze({ min: 10, max: 22, fallback: 13 });
const PALETTE_GROUPS = Object.freeze([
    Object.freeze({ title: "工作区", keys: Object.freeze(["result", "input", "param", "operate", "uploadImage"]) }),
    Object.freeze({ title: "设置页", keys: RUNNINGHUB_SETTINGS_APPEARANCE_KEYS }),
]);

function clampFontSize(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return FONT_LIMIT.fallback;
    return Math.min(FONT_LIMIT.max, Math.max(FONT_LIMIT.min, parsed));
}

function cloneColors(colors) {
    return colors && typeof colors === "object" ? { ...colors } : {};
}

function publishAppearanceChange() {
    window.dispatchEvent(new CustomEvent(APPEARANCE_SAVED_EVENT));
}

function readStoredFontSize() {
    return clampFontSize(readCompatLocalStorage(FONT_STORAGE_KEY));
}

function initialAppearanceDraft() {
    const saved = loadProductAppearance(RH_PRODUCT_ID);
    const normalized = normalizeRunninghubCustomColors(saved.customColors);
    return {
        useCustom: Boolean(saved.useCustom),
        colors: normalized.colors,
        normalizedChanged: normalized.didChange,
    };
}

function persistAppearanceDraft(draft) {
    saveProductAppearance(RH_PRODUCT_ID, {
        useCustom: Boolean(draft.useCustom),
        customColors: cloneColors(draft.colors),
    });
    publishAppearanceChange();
}

function useAppearanceDraft() {
    const [draft, setDraft] = useState(() => ({ useCustom: false, colors: {} }));

    useEffect(() => {
        const loaded = initialAppearanceDraft();
        const next = { useCustom: loaded.useCustom, colors: loaded.colors };
        setDraft(next);
        if (loaded.normalizedChanged) persistAppearanceDraft(next);
    }, []);

    const toggleCustom = useCallback((checked) => {
        setDraft((current) => {
            const nextColors = checked && Object.keys(current.colors).length === 0
                ? getAppearanceSeedForProduct(RH_PRODUCT_ID)
                : current.colors;
            const next = { useCustom: checked, colors: nextColors };
            persistAppearanceDraft(next);
            return next;
        });
    }, []);

    const updateColor = useCallback((key, hex) => {
        setDraft((current) => {
            const next = { useCustom: true, colors: { ...current.colors, [key]: hex } };
            persistAppearanceDraft(next);
            return next;
        });
    }, []);

    return { draft, toggleCustom, updateColor };
}

function ColorRow({ colorKey, colors, onPick }) {
    const label = RUNNINGHUB_APPEARANCE_LABELS[colorKey] || colorKey;
    return (
        <div className="theme-custom-item">
            <label>{label}</label>
            <input
                type="color"
                value={colors[colorKey] ?? getAppearancePickerDefault(colorKey)}
                onChange={(event) => onPick(colorKey, event.target.value)}
                className="theme-color-input"
            />
        </div>
    );
}

function PaletteColumn({ group, colors, onPick }) {
    return (
        <div className="theme-custom-col">
            <div className="theme-custom-col-title">{group.title}</div>
            {group.keys.map((key) => <ColorRow key={key} colorKey={key} colors={colors} onPick={onPick} />)}
        </div>
    );
}

function PaletteGrid({ colors, onPick }) {
    return (
        <div className="theme-custom-grid theme-custom-grid-two-col">
            {PALETTE_GROUPS.map((group) => <PaletteColumn key={group.title} group={group} colors={colors} onPick={onPick} />)}
        </div>
    );
}

function FontSizeControl({ value, onChange }) {
    return (
        <div className="input-row" title="输入框字号会应用到当前插件界面">
            <label>输入框字号大小 {value}px</label>
            <div className="slider-row">
                <span className="slider-label-left">{FONT_LIMIT.min}</span>
                <input
                    type="range"
                    min={FONT_LIMIT.min}
                    max={FONT_LIMIT.max}
                    step="1"
                    value={value}
                    onChange={(event) => onChange(clampFontSize(event.target.value))}
                    className="xlrh-slider"
                />
                <span className="slider-label-right">{FONT_LIMIT.max}</span>
            </div>
        </div>
    );
}

export function RhAppearanceSettings() {
    const { pushStatus } = useStatus();
    const { draft, toggleCustom, updateColor } = useAppearanceDraft();
    const [fontSize, setFontSize] = useState(FONT_LIMIT.fallback);

    useEffect(() => {
        setFontSize(readStoredFontSize());
    }, []);

    const saveDisplaySettings = useCallback(() => {
        writeCompatLocalStorage(FONT_STORAGE_KEY, String(fontSize));
        pushStatus("显示配置已保存");
        publishAppearanceChange();
    }, [fontSize, pushStatus]);

    const appearanceContent = useMemo(() => (
        draft.useCustom ? <PaletteGrid colors={draft.colors} onPick={updateColor} /> : null
    ), [draft.colors, draft.useCustom, updateColor]);

    return (
        <div className="rh-appearance-settings">
            <label className="dock-toggle-label">
                <input
                    type="checkbox"
                    checked={draft.useCustom}
                    onChange={(event) => toggleCustom(event.target.checked)}
                />
                <span>自定义卡片颜色</span>
            </label>

            {appearanceContent}

            <div className="appearance-section">
                <div className="appearance-section-title">显示</div>
                <FontSizeControl value={fontSize} onChange={setFontSize} />
                <div className="bg-actions-row">
                    <button type="button" className="settings-save-btn bg-save-btn" onClick={saveDisplaySettings}>
                        保存显示配置
                    </button>
                </div>
            </div>
        </div>
    );
}
