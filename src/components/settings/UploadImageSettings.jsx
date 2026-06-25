import React, { useEffect, useMemo, useState } from "react";
import { useStatus } from "../../utils/StatusContext.jsx";
import {
    FORMAT_OPTIONS,
    UPLOAD_CONFIG_DEFAULTS,
    loadUploadImageConfig,
    saveUploadImageConfig,
} from "../../utils/uploadImageConfig.js";
import "./UploadImageSettings.css";

const CONFIG_CHANGED_EVENT = "xlrh-upload-image-config-saved";
const JPEG_MIN = 50;
const JPEG_MAX = 100;
const PNG_MIN = 0;
const PNG_MAX = 9;

function clampNumber(value, min, max, fallback) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function normalizeUploadConfig(value) {
    const raw = value && typeof value === "object" ? value : {};
    const format = FORMAT_OPTIONS.some((option) => option.id === raw.format) ? raw.format : UPLOAD_CONFIG_DEFAULTS.format;
    return {
        format,
        jpegQuality: clampNumber(raw.jpegQuality, JPEG_MIN, JPEG_MAX, UPLOAD_CONFIG_DEFAULTS.jpegQuality),
        pngCompression: clampNumber(raw.pngCompression, PNG_MIN, PNG_MAX, UPLOAD_CONFIG_DEFAULTS.pngCompression),
    };
}

function notifyUploadConfigChanged() {
    window.dispatchEvent(new CustomEvent(CONFIG_CHANGED_EVENT));
}

function SettingBlock({ title, aside, children }) {
    return (
        <section className="xlrh-upload-setting-block">
            <div className="xlrh-upload-setting-head">
                <span>{title}</span>
                {aside ? <span className="xlrh-upload-setting-aside">{aside}</span> : null}
            </div>
            {children}
        </section>
    );
}

function FormatChoice({ option, checked, onPick }) {
    return (
        <button
            type="button"
            className={`xlrh-upload-format-card${checked ? " is-selected" : ""}`}
            onClick={onPick}
            title={option.desc}
        >
            <span className="xlrh-upload-format-name">{option.label}</span>
            <span className="xlrh-upload-format-desc">{option.desc}</span>
        </button>
    );
}

function RangeLine({ label, value, min, max, step = 1, leftLabel, rightLabel, onChange }) {
    return (
        <div className="xlrh-upload-range-line">
            <div className="xlrh-upload-range-caption">
                <span>{label}</span>
                <strong>{value}</strong>
            </div>
            <div className="xlrh-upload-range-control">
                <span>{leftLabel ?? min}</span>
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    className="xlrh-upload-slider"
                    onChange={(event) => onChange(Number.parseInt(event.target.value, 10))}
                />
                <span>{rightLabel ?? max}</span>
            </div>
        </div>
    );
}

export const UploadImageSettings = () => {
    const { pushStatus } = useStatus();
    const [config, setConfig] = useState(() => normalizeUploadConfig(UPLOAD_CONFIG_DEFAULTS));
    const [pngPanelOpen, setPngPanelOpen] = useState(false);

    useEffect(() => {
        setConfig(normalizeUploadConfig(loadUploadImageConfig()));
    }, []);

    const cleanConfig = useMemo(() => normalizeUploadConfig(config), [config]);

    const updateConfig = (key, value) => {
        setConfig((current) => normalizeUploadConfig({ ...current, [key]: value }));
    };

    const saveCurrentConfig = () => {
        saveUploadImageConfig(cleanConfig);
        setConfig(cleanConfig);
        pushStatus("上传图像配置已保存 √");
        notifyUploadConfigChanged();
    };

    const resetConfig = () => {
        const defaults = normalizeUploadConfig(UPLOAD_CONFIG_DEFAULTS);
        setConfig(defaults);
        saveUploadImageConfig(defaults);
        pushStatus("已恢复为默认上传配置 √");
        notifyUploadConfigChanged();
    };

    return (
        <div className="xlrh-upload-settings">
            <SettingBlock title="上传格式" aside="原图尺寸">
                <div className="xlrh-upload-format-grid">
                    {FORMAT_OPTIONS.map((option) => (
                        <FormatChoice
                            key={option.id}
                            option={option}
                            checked={cleanConfig.format === option.id}
                            onPick={() => updateConfig("format", option.id)}
                        />
                    ))}
                </div>
            </SettingBlock>

            {cleanConfig.format === "jpeg" ? (
                <SettingBlock title="JPEG 质量" aside="画质 / 体积">
                    <RangeLine
                        label="质量"
                        value={cleanConfig.jpegQuality}
                        min={JPEG_MIN}
                        max={JPEG_MAX}
                        onChange={(value) => updateConfig("jpegQuality", value)}
                    />
                </SettingBlock>
            ) : null}

            {cleanConfig.format === "png" ? (
                <SettingBlock
                    title="PNG 压缩"
                    aside={
                        <button
                            type="button"
                            className="xlrh-upload-inline-toggle"
                            onClick={() => setPngPanelOpen((value) => !value)}
                        >
                            {pngPanelOpen ? "收起" : "高级"}
                        </button>
                    }
                >
                    {pngPanelOpen ? (
                        <RangeLine
                            label="压缩等级"
                            value={cleanConfig.pngCompression}
                            min={PNG_MIN}
                            max={PNG_MAX}
                            leftLabel="快"
                            rightLabel="小"
                            onChange={(value) => updateConfig("pngCompression", value)}
                        />
                    ) : (
                        <div className="xlrh-upload-static-row">
                            <span>无损保存</span>
                            <strong>等级 {cleanConfig.pngCompression}</strong>
                        </div>
                    )}
                </SettingBlock>
            ) : null}

            <SettingBlock title="尺寸处理">
                <div className="xlrh-upload-static-row">
                    <span>提交尺寸</span>
                    <strong>上传原图</strong>
                </div>
            </SettingBlock>

            <div className="xlrh-upload-actions">
                <button type="button" className="xlrh-upload-primary" onClick={saveCurrentConfig}>
                    保存配置
                </button>
                <button type="button" className="xlrh-upload-ghost" onClick={resetConfig} title="恢复 PNG 与默认质量设置">
                    恢复默认
                </button>
            </div>
        </div>
    );
};
