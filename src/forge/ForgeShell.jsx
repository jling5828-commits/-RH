import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { core, app } from "photoshop";
import { usePersistedState } from "../hooks/usePersistedState.js";
import { isInWebView, photoshop, shell as bridgeShell, storage as bridgeStorage, xiaoliangRhPeekUploadSessionRawBase64, xiaoliangRhReleaseUploadSession } from "../bridge/uxpBridge.js";
import { captureAll, computeRhPlaceContextBoundsSync } from "../components/ImageUpload/captureUtils.js";
import { useSquareSelectionWarning } from "../components/ImageUpload/SquareSelectionWarning.jsx";
import { CustomSelect } from "../components/CustomSelect.jsx";
import { SettingsCard } from "../components/settings/SettingsCard.jsx";
import { EditableSliderValue } from "../components/EditableSliderValue.jsx";
import { RhImagePreviewField } from "../runninghub/ui/RhImagePreviewField.jsx";
import { RhParamAutoGrowTextarea } from "../runninghub/ui/RhParamAutoGrowTextarea.jsx";
import { saveImageWithBounds, getTempResultFolder } from "../utils/imageSaver.js";
import { performAutoPlace } from "../utils/autoPlace.js";
import { notifyResultFilesChanged } from "../utils/resultFilesSync.js";
import { RESULT_WORKBENCH_FORGE, getEffectiveResultFolderToken } from "../utils/resultFolderTokens.js";
import { playSound, playSoundFail } from "../utils/playSound.js";
import { pluginChildNativePath, pluginRuntimeHint } from "../utils/pluginRuntimePath.js";
import { normalizeRhImageLongEdgeMax } from "../runninghub/rhImageLongEdge.js";
import { RH_PS_CAPTURE_JPEG_QUALITY, normalizeRhUploadImageFormat, stripBase64FromDataUrl, base64ByteLength, rhCaptureFileName } from "../runninghub/ui/xlrhRhWorkPanelLogic.js";
import { ComfySettings } from "../comfy/ComfyShell.jsx";
import {
    fetchForgeControlNetModels,
    fetchForgeControlNetModules,
    fetchForgeLoras,
    fetchForgeModels,
    fetchForgeSamplers,
    fetchForgeSchedulers,
    getForgeProgress,
    interruptForge,
    normalizeForgeBaseUrl,
    refreshForgeLoras,
    runForgeImg2Img,
    testForgeConnection,
    translateForgePrompt,
} from "./forgeApi.js";
import { DEFAULT_FORGE_PRESET_FILES } from "./defaultForgePresetBundle.js";
import "../components/WorkPanel/WorkPanel.css";
import "../components/ImageUpload/ImageUpload.css";
import "../runninghub/ui/RhWorkPanel.css";
import "../comfy/ComfyShell.css";
import "./ForgeShell.css";

const uxpStorage = require("uxp").storage;
const uxpShell = require("uxp").shell;
const uxpFs = uxpStorage.localFileSystem;
const uxpFormats = uxpStorage.formats;

const FORGE_REPEAT_OPTIONS = [3, 6, 9];
const NONE_VALUE = "None";
const FORGE_USER_PRESET_FOLDER = "forge_presets";
const FORGE_USER_PRESET_PREFIX = "user_";

const IconRefresh = ({ className }) => (
    <svg className={className} width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
);

const IconSettings = () => (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

const IconBack = () => (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5" />
        <polyline points="12 19 5 12 12 5" />
    </svg>
);

const IconHelp = () => (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.1 9a3 3 0 1 1 4.9 2.3c-.9.7-1.5 1.2-1.5 2.2" />
        <path d="M12 17h.01" />
    </svg>
);

const PlayIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
);

function nextProductMode(activeProduct) {
    if (activeProduct === "runninghub") return "comfy";
    if (activeProduct === "comfy") return "forge";
    return "runninghub";
}

function ProductModeButton({ activeProduct, onChange }) {
    const target = nextProductMode(activeProduct);
    const title = target === "forge" ? "切换到 Forge UI" : target === "comfy" ? "切换到 Comfy UI" : "切换到 RunningHub";
    const label = activeProduct === "forge" ? "forge ui" : activeProduct === "comfy" ? "comfy ui" : "runninghub";
    return (
        <button type="button" className="icon-btn xlrh-product-mode-btn" onClick={() => onChange?.(target)} title={title} aria-label={title}>
            {label}
        </button>
    );
}

function normalizePlaceContext(ctx) {
    const bounds = ctx?.bounds;
    const hasBounds = bounds && ["left", "top", "right", "bottom"].every((key) => typeof bounds[key] === "number");
    return hasBounds && ctx.docId != null ? { docId: ctx.docId, bounds } : null;
}

async function doForgeFullCapture(longEdgeMax, uploadImageFormat) {
    const max = normalizeRhImageLongEdgeMax(longEdgeMax);
    const format = normalizeRhUploadImageFormat(uploadImageFormat);
    const opts = { longEdgeMax: max, uploadEncodeFormat: format, jpegQuality: RH_PS_CAPTURE_JPEG_QUALITY };
    if (isInWebView()) return captureAll("canvas", { ...opts, __retainUploadSession: true });
    let res;
    await core.executeAsModal(async (executionContext) => {
        const docId = app.activeDocument?.id;
        if (!docId) throw new Error("[NO_DOC]请先打开一个文档");
        const suspensionID = await executionContext.hostControl.suspendHistory({ documentID: docId, name: "Forge UI capture" });
        try {
            res = await captureAll("canvas", opts);
        } finally {
            await executionContext.hostControl.resumeHistory(suspensionID);
        }
    }, { commandName: "Forge UI 截取" });
    return res;
}

async function recordForgePlaceContext() {
    if (isInWebView()) {
        try {
            return normalizePlaceContext(await photoshop.commands.recordRhRunPlaceContext("canvas"));
        } catch (_) {
            return null;
        }
    }
    const box = { value: null };
    try {
        await core.executeAsModal(async () => {
            box.value = computeRhPlaceContextBoundsSync("canvas");
        }, { commandName: "Forge UI 记录贴回上下文" });
    } catch (_) {}
    return box.value;
}

function uploadRecordFromCapture(capture, previousUpload) {
    if (!capture?.uploadBase64 && !capture?.uploadSessionId) return null;
    const prior = previousUpload && typeof previousUpload === "object" ? previousUpload : {};
    const mimeType = capture.mimeType || prior.mimeType || "image/png";
    const bounds = capture.bounds;
    const aspectRatio = bounds && bounds.right > bounds.left && bounds.bottom > bounds.top
        ? (bounds.right - bounds.left) / (bounds.bottom - bounds.top)
        : prior.aspectRatio;
    const common = {
        ...prior,
        fileName: rhCaptureFileName("forge-capture", mimeType),
        mimeType,
        previewBase64: capture.previewBase64 ?? prior.previewBase64,
        aspectRatio,
        uploadWidth: capture.uploadWidth ?? prior.uploadWidth,
        uploadHeight: capture.uploadHeight ?? prior.uploadHeight,
        uploadFormat: capture.uploadFormat ?? prior.uploadFormat,
        uploadByteLength: capture.uploadByteLength ?? prior.uploadByteLength,
    };
    const sessionId = String(capture.uploadSessionId || "").trim();
    if (sessionId) return { ...common, uploadSessionId: sessionId, base64: "" };
    const base64 = stripBase64FromDataUrl(capture.uploadBase64);
    return { ...common, uploadSessionId: "", base64, uploadByteLength: capture.uploadByteLength ?? base64ByteLength(base64) };
}

async function uploadRecordToBase64(uploadRecord) {
    const sessionId = String(uploadRecord?.uploadSessionId || "").trim();
    if (!sessionId) return String(uploadRecord?.base64 || "");
    try {
        const res = await xiaoliangRhPeekUploadSessionRawBase64(sessionId);
        if (!res?.ok || !res.rawBase64) throw new Error(res?.message || "读取图片会话失败");
        return String(res.rawBase64 || "");
    } finally {
        await xiaoliangRhReleaseUploadSession(sessionId).catch(() => {});
    }
}

function releaseUploadRecord(uploadRecord) {
    const sessionId = String(uploadRecord?.uploadSessionId || "").trim();
    if (sessionId) xiaoliangRhReleaseUploadSession(sessionId).catch(() => {});
}

function asNumber(value, fallback, min = -Infinity, max = Infinity) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function asInt(value, fallback, min = -Infinity, max = Infinity) {
    return Math.round(asNumber(value, fallback, min, max));
}

function clean(value) {
    return value == null ? "" : String(value).trim();
}

function isNone(value) {
    const text = clean(value);
    return !text || /^none$/i.test(text);
}

function normalizeRepeatCount(value) {
    const count = Number(value);
    return FORGE_REPEAT_OPTIONS.includes(count) ? count : 1;
}

function makeDefaultParams(preset) {
    const data = preset?.data || {};
    return {
        model: clean(data.model),
        steps: asInt(data.step, 20, 1, 150),
        denoise: asNumber(data.redrawAmount, 0.35, 0, 1),
        resolution: asInt(data.resolution, 768, 256, 4096),
        sampler: clean(data.selectedName) || "DPM++ 2M",
        scheduler: clean(data.selectedScheduler) || "automatic",
        cfg: asNumber(data.cfgScale, 7, 1, 30),
        seed: clean(data.seed) || "-1",
        batch: 1,
        lora: clean(data.lora),
        loraWeight: asNumber(data.loraWeight, 0, 0, 2),
        positivePrompt: data.positivePrompt || "",
        negativePrompt: data.negativePrompt || "",
        controlNetModule: clean(data.selectedControlNetModule),
        controlNetModel: clean(data.controlNetModel),
        controlNetWeight: asNumber(data.controlNetWeight, 1, 0, 2),
    };
}

function paramsToPresetData(params) {
    const p = params || {};
    return {
        model: clean(p.model),
        lora: clean(p.lora),
        loraWeight: String(p.loraWeight ?? 0),
        redrawAmount: String(p.denoise ?? 0.35),
        imageCount: String(p.batch ?? 1),
        resolution: String(p.resolution ?? 768),
        positivePrompt: p.positivePrompt || "",
        negativePrompt: p.negativePrompt || "",
        selectedControlNetModule: clean(p.controlNetModule),
        controlNetModel: clean(p.controlNetModel),
        controlNetWeight: String(p.controlNetWeight ?? 1),
        step: String(p.steps ?? 20),
        selectedName: clean(p.sampler),
        selectedScheduler: clean(p.scheduler),
        cfgScale: String(p.cfg ?? 7),
        seed: clean(p.seed) || "-1",
    };
}

function safePresetFileName(value) {
    return (clean(value) || "preset").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 48);
}

async function getForgePresetFolder() {
    const pluginFolder = await uxpFs.getPluginFolder();
    try {
        const existing = await pluginFolder.getEntry(FORGE_USER_PRESET_FOLDER);
        if (existing?.isFile === false) return existing;
    } catch (_) {}
    return pluginFolder.createFolder(FORGE_USER_PRESET_FOLDER);
}

function normalizeUserPreset(value, fileName) {
    if (!value || typeof value !== "object" || !value.data) return null;
    const id = clean(value.id) || `${FORGE_USER_PRESET_PREFIX}${safePresetFileName(fileName).replace(/\.json$/i, "")}`;
    const source = value.source === "factory" || value.source === "factory-file" ? "factory-file" : "user";
    return { ...value, id, name: clean(value.name) || "自定义预设", source, fileName };
}

async function loadForgeUserPresets() {
    const folder = await getForgePresetFolder();
    const entries = (await folder.getEntries()).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN"));
    const out = [];
    for (const entry of entries || []) {
        if (entry.isFile === false || !/\.json$/i.test(entry.name || "")) continue;
        try {
            const preset = normalizeUserPreset(JSON.parse(await entry.read({ format: uxpFormats.utf8 })), entry.name);
            if (preset) out.push(preset);
        } catch (_) {}
    }
    return out;
}

async function restoreMissingForgeDefaultPresets() {
    const folder = await getForgePresetFolder();
    const entries = await folder.getEntries();
    const existing = new Set((entries || []).filter((entry) => entry?.isFile !== false).map((entry) => String(entry.name || "")));
    let restored = 0;

    for (const item of DEFAULT_FORGE_PRESET_FILES) {
        const fileName = clean(item?.fileName);
        if (!fileName || existing.has(fileName)) continue;
        const file = await folder.createFile(fileName, { overwrite: false });
        await file.write(JSON.stringify(item.preset, null, 2), { format: uxpFormats.utf8 });
        existing.add(fileName);
        restored += 1;
    }

    return restored;
}

async function saveForgeUserPreset(preset) {
    const folder = await getForgePresetFolder();
    const file = await folder.createFile(`${safePresetFileName(preset.name || preset.id)}.json`, { overwrite: true });
    await file.write(JSON.stringify(preset, null, 2), { format: uxpFormats.utf8 });
}

async function deleteForgeUserPreset(preset) {
    const folder = await getForgePresetFolder();
    const fileName = preset?.fileName || `${safePresetFileName(preset?.id)}.json`;
    const file = await folder.getEntry(fileName);
    if (file?.isFile !== false) await file.delete();
}

function mergeUnique(...lists) {
    const out = [];
    for (const list of lists) {
        for (const item of list || []) {
            const text = clean(item);
            if (text && !out.includes(text)) out.push(text);
        }
    }
    return out;
}

function promptWithLora(prompt, lora, weight) {
    const tag = clean(lora);
    if (!tag || /[,，]/.test(tag)) return prompt || "";
    const token = `<lora:${tag}:${asNumber(weight, 1, 0, 2)}>`;
    return String(prompt || "").includes(token) ? String(prompt || "") : `${prompt || ""}${prompt ? "," : ""}${token}`;
}

function appendPromptText(current, nextText) {
    const next = clean(nextText);
    if (!next) return current || "";
    const base = String(current || "").trim();
    if (!base) return next;
    return `${base}${/[，,\s]$/.test(base) ? " " : ", "}${next}`;
}

function sizeFromLongEdge(width, height, longEdge) {
    const w = Number(width || 0);
    const h = Number(height || 0);
    const edge = asInt(longEdge, 768, 64, 4096);
    if (w <= 0 || h <= 0) return { width: edge, height: edge };
    const scale = edge / Math.max(w, h);
    const snap = (value) => Math.max(64, Math.round(value / 8) * 8);
    return { width: snap(w * scale), height: snap(h * scale) };
}

function buildForgePayload(params, imageBase64, upload) {
    const size = sizeFromLongEdge(upload?.uploadWidth, upload?.uploadHeight, params.resolution);
    const payload = {
        init_images: [imageBase64],
        prompt: promptWithLora(params.positivePrompt, params.lora, params.loraWeight),
        negative_prompt: params.negativePrompt || "",
        steps: asInt(params.steps, 20, 1, 150),
        denoising_strength: asNumber(params.denoise, 0.35, 0, 1),
        width: size.width,
        height: size.height,
        sampler_name: clean(params.sampler) || undefined,
        scheduler: clean(params.scheduler) || undefined,
        cfg_scale: asNumber(params.cfg, 7, 1, 30),
        seed: asInt(params.seed, -1),
        batch_size: asInt(params.batch, 1, 1, 16),
        n_iter: 1,
        override_settings_restore_afterwards: true,
    };
    if (clean(params.model)) payload.override_settings = { sd_model_checkpoint: clean(params.model) };
    if (!isNone(params.controlNetModule) || !isNone(params.controlNetModel)) {
        const unit = {
            enabled: true,
            module: isNone(params.controlNetModule) ? "none" : clean(params.controlNetModule),
            model: isNone(params.controlNetModel) ? "None" : clean(params.controlNetModel),
            weight: asNumber(params.controlNetWeight, 1, 0, 2),
            image: imageBase64,
            input_image: imageBase64,
            resize_mode: "Just Resize",
            control_mode: "Balanced",
            pixel_perfect: true,
            guidance_start: 0,
            guidance_end: 1,
        };
        payload.alwayson_scripts = { ControlNet: { args: [unit] } };
        payload.controlnet_units = [unit];
    }
    return payload;
}

function resultUrlsFromForge(data) {
    const images = Array.isArray(data?.images) ? data.images : [];
    return images.filter(Boolean).map((raw) => /^data:/i.test(raw) ? raw : `data:image/png;base64,${raw}`);
}

function batchProgressText(run) {
    const total = Number(run?.batchImageTotal || run?.batchTotal || 0);
    if (total <= 1) return "";
    return `返回 ${Number(run?.batchDone || 0)} 张/共 ${total} 张`;
}

function runStatusText(run) {
    if (!run) return "暂无任务";
    if (run.status === "running") return run.stageText || "运行中";
    if (run.status === "success") return run.placeStatus === "pending" ? "已完成 · 待回图" : "已完成";
    if (run.status === "cancelled") return "已取消";
    return "失败";
}

function SliderRow({ label, value, min, max, step, onChange, parse = Number }) {
    const parseValue = (draft) => {
        const n = parse(draft);
        if (!Number.isFinite(n)) return "";
        return Math.max(min, Math.min(max, n));
    };
    return (
        <div className="rh-param-row rh-param-row--numeric rh-param-row--slider">
            <div className="rh-param-label-col"><span className="rh-param-name">{label}</span></div>
            <div className="rh-param-control-col rh-param-control-col--slider">
                <div className="rh-param-slider-wrapper comfy-param-slider-wrapper">
                    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseValue(e.target.value))} className="xlrh-slider" />
                    <EditableSliderValue value={value} parseValue={parseValue} onCommit={onChange} />
                </div>
            </div>
        </div>
    );
}

function FieldSelect({ label, value, displayValue, options, onChange, disabled, getItemLabel, getItemTitle, canDeleteItem, onDeleteItem, deleteItemLabel }) {
    return (
        <CustomSelect
            label={label}
            value={value || ""}
            displayValue={displayValue || value || "None"}
            compareValue={value || ""}
            options={options}
            onChange={onChange}
            disabled={disabled}
            getItemLabel={getItemLabel}
            getItemTitle={getItemTitle}
            canDeleteItem={canDeleteItem}
            onDeleteItem={onDeleteItem}
            deleteItemLabel={deleteItemLabel}
            dropdownPlacement="down"
            useDropdownPortal
        />
    );
}

function ForgeTopBar({ activeProduct, onChangeProduct, isSettingsOpen, onToggleView, onRefresh }) {
    const [showHelpPopup, setShowHelpPopup] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const handleRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            await Promise.resolve(onRefresh?.());
        } finally {
            setRefreshing(false);
        }
    }, [onRefresh]);
    return (
        <>
            <div className="rh-balance-bar comfy-topbar forge-topbar">
                <div className="rh-balance-content comfy-topbar-left">
                    <img src="icons/eye.png" className="rh-balance-icon" alt="" />
                </div>
                <div className="rh-balance-bar-right">
                    <ProductModeButton activeProduct={activeProduct} onChange={onChangeProduct} />
                    <div className="icon-btn" onClick={handleRefresh} title="刷新 Forge 参数">
                        <IconRefresh className={refreshing ? "rh-spinning" : ""} />
                    </div>
                    <div className="icon-btn rh-help-btn" onClick={() => setShowHelpPopup(true)} title="使用说明">
                        <IconHelp />
                    </div>
                    <div className="icon-btn" onClick={onToggleView} title={isSettingsOpen ? "返回主页" : "打开设置"}>
                        {isSettingsOpen ? <IconBack /> : <IconSettings />}
                    </div>
                </div>
            </div>
            {showHelpPopup && (
                <div className="xl-popup-overlay" onClick={() => setShowHelpPopup(false)}>
                    <div className="xl-popup-dialog rh-help-dialog" role="dialog" aria-modal="true" aria-label="Forge UI 使用说明" onClick={(e) => e.stopPropagation()}>
                        <div className="xl-popup-icon rh-help-icon">?</div>
                        <div className="xl-popup-title">Forge UI 使用说明</div>
                        <div className="xl-popup-body rh-help-body">
                            <p className="rh-help-intro">Forge UI 模式用于连接你已经启动的 Stable Diffusion WebUI Forge，在 Photoshop 内提交图生图并保存生成结果。</p>
                            <div className="rh-help-section-title">基础流程</div>
                            <ol className="rh-help-list">
                                <li>先启动 Forge UI，并确认 WebUI API 可用；本地地址通常是 http://127.0.0.1:7860。</li>
                                <li>在插件 FG 页填写地址并点击连接，连接成功后会读取模型、采样器、LoRA、ControlNet 列表。</li>
                                <li>选择预设后按需调整模型、重绘、尺寸、提示词、LoRA 或 ControlNet 参数。</li>
                                <li>点击捕获图像获取当前 PS 图像，再点击开始运行提交 1 张；×3、×6、×9 会并发提交对应数量。</li>
                                <li>开启自动回传时，完成后会自动贴回当前 PS 文档。</li>
                            </ol>
                        </div>
                        <div className="xl-popup-actions rh-help-actions">
                            <button className="xl-btn xl-btn-primary" onClick={() => setShowHelpPopup(false)}>知道了</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function ForgeHome({ state, actions }) {
    const latest = state.runs[state.runs.length - 1];
    const connected = state.connected;
    const running = state.runs.some((run) => run.status === "running");
    const progress = latest?.status === "running" ? Number(latest.progress || 0) : 0;
    const statusText = state.connectError || (latest ? runStatusText(latest) : connected ? "已连接" : "请先连接 Forge UI");
    const lowerStatusText = latest || state.connectError ? statusText : (state.message || statusText);
    return (
        <div className="rh-work comfy-work forge-work">
            <div className="rh-work-toolbar comfy-toolbar forge-toolbar">
                <FieldSelect label="预设" value={state.selectedPresetId} displayValue={state.selectedPresetName} options={state.presetOptions} onChange={actions.selectPreset} getItemLabel={actions.getPresetName} getItemTitle={actions.getPresetName} />
                <input className="comfy-url-input" value={state.baseUrl} onChange={(e) => actions.setBaseUrl(e.target.value)} placeholder="http://127.0.0.1:7860" />
                <button type="button" className="rh-work-btn-primary comfy-connect-btn" onClick={actions.connect} disabled={state.connecting}>
                    {state.connecting ? "连接中" : "连接"}
                </button>
            </div>
            <div className="rh-run-section">
                <div className="comfy-run-wrap">
                    <button className={`rh-run-btn ${state.submitting ? "running" : ""}`} disabled={!connected || state.submitting} onClick={() => actions.run(1)}>
                        {state.submitting ? <span className="rh-run-btn-spinner" /> : <PlayIcon />}
                        {state.submitting ? "提交中..." : "开始运行"}
                    </button>
                    <div className="comfy-run-multipliers" aria-label="并发提交次数">
                        {FORGE_REPEAT_OPTIONS.map((count) => (
                            <button key={count} type="button" className="comfy-run-multiplier-btn" disabled={!connected || state.submitting} onClick={() => actions.run(count)}>
                                ×{count}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="rh-upload-status-bar">
                    <div className="rh-status-text">{lowerStatusText}</div>
                    <div className="rh-progress-bar"><div className="rh-progress-fill" style={{ width: `${running ? progress : 0}%` }} /></div>
                </div>
            </div>

            <div className="rh-work-cards">
                <ForgeCaptureCard pending={state.pendingUpload} busy={state.capturing} onCapture={actions.captureImage} onClear={actions.clearImage} />
                <ForgeParamCard state={state} actions={actions} />
                <ForgeQueueCard runs={state.queueRuns} onDismiss={actions.dismissQueueRun} onRetryPlace={actions.retryQueuePlace} />
            </div>
        </div>
    );
}

function ForgeCaptureCard({ pending, busy, onCapture, onClear }) {
    const [open, setOpen] = useState(true);
    return (
        <div className={`xlrh-card rh-capture-card ${!open ? "is-collapsed" : ""}`}>
            <div className="card-header" onClick={() => setOpen((v) => !v)}>
                <span className="header-title"><span className="title-icon">📷</span>捕获图像</span>
                <div className={`collapse-arrow ${open ? "expanded" : "collapsed"}`}><span className="arrow-icon" /></div>
            </div>
            <div className={`card-content ${!open ? "collapsed" : ""}`}>
                <RhImagePreviewField label="图 1" pending={pending} busy={busy} onCapture={onCapture} onClear={onClear} />
            </div>
        </div>
    );
}

function ForgeParamCard({ state, actions }) {
    const [open, setOpen] = useState(true);
    const p = state.params;
    const samplerOptions = mergeUnique(state.samplers, [p.sampler]);
    const schedulerOptions = mergeUnique(state.schedulers, [p.scheduler]);
    const modelOptions = mergeUnique(state.models, [p.model]);
    const loraOptions = mergeUnique([NONE_VALUE], state.loras, [p.lora]);
    const cnModuleOptions = mergeUnique([NONE_VALUE], state.controlNetModules, [p.controlNetModule]);
    const cnModelOptions = mergeUnique([NONE_VALUE], state.controlNetModels, [p.controlNetModel]);
    return (
        <div className={`xlrh-card rh-param-card ${!open ? "is-collapsed" : ""}`}>
            <div className="card-header" onClick={() => setOpen((v) => !v)}>
                <span className="header-title"><span className="title-icon">⚙</span>参数设置</span>
                <div className={`collapse-arrow ${open ? "expanded" : "collapsed"}`}><span className="arrow-icon" /></div>
            </div>
            <div className={`card-content ${!open ? "collapsed" : ""}`}>
                <div className="rh-param-card-stack"><div className="rh-work-fields rh-param-fields forge-param-fields">
                    <FieldSelect label="模型" value={p.model} options={modelOptions} onChange={(v) => actions.setParam("model", v)} />
                    <SliderRow label="步数" value={p.steps} min={1} max={80} step={1} parse={(v) => parseInt(v, 10)} onChange={(v) => actions.setParam("steps", v)} />
                    <SliderRow label="重绘" value={p.denoise} min={0} max={1} step={0.01} parse={parseFloat} onChange={(v) => actions.setParam("denoise", v)} />
                    <SliderRow label="尺寸" value={p.resolution} min={256} max={4096} step={64} parse={(v) => parseInt(v, 10)} onChange={(v) => actions.setParam("resolution", v)} />
                    <FieldSelect label="采样" value={p.sampler} options={samplerOptions} onChange={(v) => actions.setParam("sampler", v)} />
                    <FieldSelect label="调度" value={p.scheduler} options={schedulerOptions} onChange={(v) => actions.setParam("scheduler", v)} />
                    <SliderRow label="CFG" value={p.cfg} min={1} max={30} step={0.5} parse={parseFloat} onChange={(v) => actions.setParam("cfg", v)} />
                    <div className="rh-param-row">
                        <div className="rh-param-meta"><span className="rh-param-name">Seed</span></div>
                        <input className="forge-text-input" value={p.seed} onChange={(e) => actions.setParam("seed", e.target.value)} />
                    </div>
                    <SliderRow label="张数" value={p.batch} min={1} max={8} step={1} parse={(v) => parseInt(v, 10)} onChange={(v) => actions.setParam("batch", v)} />
                    <div className="forge-addon-buttons">
                        <button type="button" className="forge-mini-btn" onClick={actions.addLora}>+ LoRA</button>
                        <button type="button" className="forge-mini-btn" onClick={actions.refreshLoras}>刷新 LoRA</button>
                    </div>
                    <FieldSelect label="LoRA" value={p.lora || NONE_VALUE} options={loraOptions} onChange={(v) => actions.setParam("lora", v === NONE_VALUE ? "" : v)} />
                    <SliderRow label="权重" value={p.loraWeight} min={0} max={2} step={0.05} parse={parseFloat} onChange={(v) => actions.setParam("loraWeight", v)} />
                    <button type="button" className="forge-mini-btn forge-addon-single" onClick={actions.addControlNet}>+ ControlNet</button>
                    <FieldSelect label="CN预处理" value={p.controlNetModule || NONE_VALUE} options={cnModuleOptions} onChange={(v) => actions.setParam("controlNetModule", v === NONE_VALUE ? "" : v)} />
                    <FieldSelect label="CN模型" value={p.controlNetModel || NONE_VALUE} options={cnModelOptions} onChange={(v) => actions.setParam("controlNetModel", v === NONE_VALUE ? "" : v)} />
                    <SliderRow label="CN权重" value={p.controlNetWeight} min={0} max={2} step={0.05} parse={parseFloat} onChange={(v) => actions.setParam("controlNetWeight", v)} />
                    <div className="rh-param-row">
                        <div className="rh-param-meta"><span className="rh-param-name">正向提示词</span></div>
                        <RhParamAutoGrowTextarea className="rh-param-textarea rh-param-textarea-autogrow" value={p.positivePrompt} onChange={(v) => actions.setParam("positivePrompt", v)} />
                    </div>
                    <div className="rh-param-row">
                        <div className="rh-param-meta"><span className="rh-param-name">反向提示词</span></div>
                        <RhParamAutoGrowTextarea className="rh-param-textarea rh-param-textarea-autogrow" value={p.negativePrompt} onChange={(v) => actions.setParam("negativePrompt", v)} />
                    </div>
                    <ForgePromptTranslator actions={actions} />
                </div></div>
            </div>
        </div>
    );
}

function ForgePromptTranslator({ actions }) {
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const handleTranslate = useCallback(async () => {
        setBusy(true);
        try {
            setDraft(await actions.translatePrompt(draft));
        } catch (_) {
            /* translatePrompt already reports the error. */
        } finally {
            setBusy(false);
        }
    }, [actions, draft]);
    return (
        <div className="forge-prompt-translate-block">
            <div className="forge-prompt-translator">
                <input className="forge-text-input forge-prompt-translate-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="输入要翻译的中文..." />
                <div className="forge-prompt-translate-actions">
                    <button type="button" className="forge-mini-btn" disabled={busy || !clean(draft)} onClick={handleTranslate}>{busy ? "翻译中" : "在线翻译"}</button>
                    <button type="button" className="forge-mini-btn" disabled={!clean(draft)} onClick={() => actions.appendPrompt("positivePrompt", draft)}>+正向</button>
                    <button type="button" className="forge-mini-btn" disabled={!clean(draft)} onClick={() => actions.appendPrompt("negativePrompt", draft)}>+负向</button>
                </div>
            </div>
        </div>
    );
}

function ForgePresetManagerCard({ state, actions }) {
    const saveDialog = state.presetSaveOpen ? (
        <div className="xl-popup-overlay" onClick={actions.closePresetSaveDialog}>
            <div className="xl-popup-dialog forge-preset-save-dialog" role="dialog" aria-modal="true" aria-label="保存 Forge 预设" onClick={(e) => e.stopPropagation()}>
                <div className="xl-popup-title">保存 Forge 预设</div>
                <div className="xl-popup-subtitle">输入这个预设的名称</div>
                <div className="xl-popup-body">
                    <div className="xl-input-wrapper">
                        <input className="xl-input-field forge-preset-name-input" type="text" value={state.presetSaveName} onChange={(e) => actions.setPresetSaveName(e.target.value)} placeholder="预设名称" autoFocus />
                    </div>
                </div>
                <div className="xl-popup-actions">
                    <button type="button" className="xl-btn xl-btn-secondary" onClick={actions.closePresetSaveDialog} disabled={state.presetSaving}>取消</button>
                    <button type="button" className={`xl-btn xl-btn-primary ${state.presetSaving ? "is-loading" : ""}`} onClick={actions.commitPresetSave} disabled={state.presetSaving}>{state.presetSaving ? "保存中..." : "保存"}</button>
                </div>
            </div>
        </div>
    ) : null;

    return (
        <SettingsCard cardClass="forge-preset-manager-card" icon="▾" title="预设管理" defaultOpen>
            <div className="forge-preset-manager-stack">
                <FieldSelect label={`预设 (${state.presetOptions.length})`} value={state.selectedPresetId} displayValue={state.selectedPresetName} options={state.presetOptions} onChange={actions.selectPreset} getItemLabel={actions.getPresetName} getItemTitle={actions.getPresetName} canDeleteItem={actions.canDeletePreset} onDeleteItem={actions.deletePreset} deleteItemLabel="×" />
                <button type="button" className="forge-preset-manager-btn" onClick={actions.openPresetSaveDialog}>保存</button>
                <button type="button" className="forge-preset-manager-btn" onClick={actions.openUserPresetFolder}>打开文件夹</button>
            </div>
            {saveDialog && typeof document !== "undefined" && document.body ? createPortal(saveDialog, document.body) : saveDialog}
        </SettingsCard>
    );
}

async function copyTextToClipboard(text) {
    const value = String(text || "");
    if (!value) return;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
}

function ForgeQueueCard({ runs, onDismiss, onRetryPlace }) {
    const [open, setOpen] = useState(true);
    const [copyState, setCopyState] = useState({ id: "", status: "" });
    return (
        <div className={`xlrh-card rh-queue-card ${!open ? "is-collapsed" : ""}`}>
            <div className="card-header" onClick={() => setOpen((v) => !v)}>
                <span className="header-title"><span className="title-icon">📋</span>任务队列 {runs.length > 0 ? `(${runs.length})` : ""}</span>
                <div className={`collapse-arrow ${open ? "expanded" : "collapsed"}`}><span className="arrow-icon" /></div>
            </div>
            <div className={`card-content ${!open ? "collapsed" : ""}`}>
                <div className="rh-task-queue">
                    {runs.length === 0 ? <div className="rh-task-empty">暂无任务</div> : runs.map((run) => {
                        const platform = run.platform || "forge";
                        const isRhRun = platform === "runninghub";
                        const isComfyRun = platform === "comfy";
                        const platformLabel = isRhRun ? "RunningHub" : isComfyRun ? "Comfy UI" : "Forge UI";
                        const snap = run.snapshot && typeof run.snapshot === "object" ? run.snapshot : null;
                        const uploadsForPreview = isRhRun ? snap?.pendingUploads : run.pendingUploads;
                        const previewBase64 = Object.values(uploadsForPreview || {}).find((u) => u?.previewBase64)?.previewBase64;
                        const taskName = isRhRun ? (snap?.appMetaName || run.presetName || "RunningHub") : isComfyRun ? (run.workflowName || "Comfy UI") : (run.presetName || "Forge UI");
                        const submitTime = new Date(run.startTime);
                        const timeStr = `${submitTime.getHours().toString().padStart(2, "0")}:${submitTime.getMinutes().toString().padStart(2, "0")}`;
                        const elapsed = run.elapsedSec || 0;
                        const elapsedStr = elapsed < 60 ? `${elapsed.toFixed(1)}秒` : `${Math.floor(elapsed / 60)}分${Math.round(elapsed % 60)}秒`;
                        const statusClass = run.status === "running" ? "running" : run.status === "success" ? "success" : run.status === "cancelled" ? "warning" : "error";
                        const hasPendingPlace = run.placeStatus === "pending";
                        const statusText = run.status === "running" ? "运行中" : runStatusText(run);
                        const batchLine = !isRhRun ? batchProgressText(run) : "";
                        const stageLine = run.stageText && run.stageText !== statusText ? run.stageText : "";
                        const canCopyError = run.status === "error" && stageLine;
                        const copyLabel = copyState.id === run.id && copyState.status ? copyState.status : "复制";
                        const handleCopyError = async (event) => {
                            event.stopPropagation();
                            try {
                                await copyTextToClipboard(stageLine);
                                setCopyState({ id: run.id, status: "已复制" });
                            } catch (_) {
                                setCopyState({ id: run.id, status: "失败" });
                            }
                            setTimeout(() => setCopyState((current) => current.id === run.id ? { id: "", status: "" } : current), 1200);
                        };
                        return (
                            <div key={run.id} className="rh-task-item">
                                {previewBase64 ? <div className="rh-task-thumb"><img src={previewBase64} alt="" className="rh-task-thumb-img" /></div> : <div className="rh-task-thumb" />}
                                <div className="rh-task-status-wrapper"><div className={`rh-task-status ${statusClass}`} /></div>
                                <div className="rh-task-info">
                                    <div className="rh-task-name">{taskName}</div>
                                    <div className="rh-task-meta"><span className={`rh-task-platform-badge rh-task-platform-badge--${platform}`}>{platformLabel}</span><span className="rh-task-time">{timeStr} 提交</span><span className="rh-task-duration">{elapsedStr}</span></div>
                                    <div className="rh-task-progress">{statusText}{batchLine && <span className="rh-task-stage" title={batchLine}>{batchLine}</span>}{stageLine && <span className="rh-task-stage" title={stageLine}>{stageLine}</span>}</div>
                                </div>
                                <div className="rh-task-actions">
                                    {canCopyError && <button className="rh-task-copy" onClick={handleCopyError} title={stageLine}>{copyLabel}</button>}
                                    {hasPendingPlace && <button className="rh-task-retry" onClick={(e) => { e.stopPropagation(); onRetryPlace(platform, run.id); }} title="贴回图片">↩</button>}
                                    <button className="rh-task-close" onClick={(e) => { e.stopPropagation(); onDismiss(platform, run.id); }} title="关闭任务">×</button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export function ForgeShell({
    activeProduct = "forge",
    onChangeProduct,
    sharedSettings,
    onRunsChange,
    sharedTaskRuns,
    onDismissSharedRun,
    onRetrySharedPlace,
    onRegisterTaskActions,
}) {
    const { pushStatus } = sharedSettings;
    const { confirmCaptureSelection, warningDialog: squareSelectionWarningDialog } = useSquareSelectionWarning(pushStatus);
    const [userPresets, setUserPresets] = useState([]);
    const [presetSaveOpen, setPresetSaveOpen] = useState(false);
    const [presetSaveName, setPresetSaveName] = useState("");
    const [presetSaving, setPresetSaving] = useState(false);
    const allPresets = userPresets;
    const defaultPreset = allPresets[0] || null;
    const [currentPage, setCurrentPage] = useState("home");
    const [baseUrl, setBaseUrl] = usePersistedState("forge_base_url", "http://127.0.0.1:7860");
    const [selectedPresetId, setSelectedPresetId] = usePersistedState("forge_selected_preset_id", "");
    const selectedPreset = useMemo(() => allPresets.find((item) => item.id === selectedPresetId) || defaultPreset, [allPresets, defaultPreset, selectedPresetId]);
    const [params, setParams] = usePersistedState("forge_params", makeDefaultParams(selectedPreset));
    const [connected, setConnected] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [connectError, setConnectError] = useState("");
    const [message, setMessage] = useState("");
    const [models, setModels] = useState([]);
    const [samplers, setSamplers] = useState([]);
    const [schedulers, setSchedulers] = useState([]);
    const [loras, setLoras] = useState([]);
    const [controlNetModules, setControlNetModules] = useState([]);
    const [controlNetModels, setControlNetModels] = useState([]);
    const [pendingUpload, setPendingUpload] = useState(null);
    const [capturing, setCapturing] = useState(false);
    const [runs, setRuns] = useState([]);
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    const runCancelRefs = useRef({});
    const runAbortRefs = useRef({});
    const autoPlaceQueueRef = useRef(Promise.resolve());
    const taskRunsForQueue = Array.isArray(sharedTaskRuns) ? sharedTaskRuns : runs;

    useEffect(() => {
        setParams((prev) => ({ ...makeDefaultParams(selectedPreset), ...(prev && typeof prev === "object" ? prev : {}), batch: 1 }));
    }, []);

    useEffect(() => {
        onRunsChange?.(runs);
    }, [onRunsChange, runs]);

    const refreshUserPresets = useCallback(async ({ restoreDefaults = false } = {}) => {
        try {
            const restored = restoreDefaults ? await restoreMissingForgeDefaultPresets() : 0;
            const loaded = await loadForgeUserPresets();
            setUserPresets(loaded);
            pushStatus(restored ? `已恢复 Forge 默认预设：${restored} 个，当前 ${loaded.length} 个` : `已刷新 Forge 预设：${loaded.length} 个`, 2500);
        } catch (error) {
            pushStatus(`刷新 Forge 预设失败：${error?.message || error}`, 5000);
        }
    }, [pushStatus]);

    useEffect(() => {
        refreshUserPresets();
    }, [refreshUserPresets]);

    useEffect(() => {
        if (!allPresets.length) return;
        if (selectedPresetId && allPresets.some((item) => item.id === selectedPresetId)) return;
        setSelectedPresetId(allPresets[0].id);
        setParams(makeDefaultParams(allPresets[0]));
    }, [allPresets, selectedPresetId, setParams, setSelectedPresetId]);

    useEffect(() => {
        const timer = setInterval(() => {
            setRuns((prev) => prev.map((run) => run.status === "running" ? { ...run, elapsedSec: elapsedSeconds(run.startTime) } : run));
        }, 500);
        return () => clearInterval(timer);
    }, []);

    const presetOptions = useMemo(() => allPresets.map((item) => item.id), [allPresets]);
    const selectedPresetName = selectedPreset?.name || "选择预设";

    const updateRun = useCallback((id, patch) => {
        setRuns((prev) => prev.map((run) => run.id === id ? { ...run, ...patch, elapsedSec: elapsedSeconds(run.startTime) } : run));
    }, []);

    const refreshRemoteOptions = useCallback(async (targetBaseUrl = baseUrl) => {
        const url = normalizeForgeBaseUrl(targetBaseUrl);
        if (!url) {
            setMessage("请先填写 Forge UI 地址");
            return;
        }
        const results = await Promise.allSettled([
            fetchForgeModels(url),
            fetchForgeSamplers(url),
            fetchForgeSchedulers(url),
            fetchForgeLoras(url),
            fetchForgeControlNetModules(url),
            fetchForgeControlNetModels(url),
        ]);
        if (results[0].status === "fulfilled") setModels(results[0].value);
        if (results[1].status === "fulfilled") setSamplers(results[1].value);
        if (results[2].status === "fulfilled") setSchedulers(results[2].value);
        if (results[3].status === "fulfilled") setLoras(results[3].value);
        if (results[4].status === "fulfilled") setControlNetModules(results[4].value);
        if (results[5].status === "fulfilled") setControlNetModels(results[5].value);
        setMessage(`已读取 Forge 参数：模型 ${results[0].value?.length || 0} 个，LoRA ${results[3].value?.length || 0} 个`);
    }, [baseUrl]);

    const refreshForgeTopBar = useCallback(async () => {
        await refreshUserPresets({ restoreDefaults: true });
        await refreshRemoteOptions();
    }, [refreshRemoteOptions, refreshUserPresets]);

    const connect = useCallback(async () => {
        setConnecting(true);
        setConnectError("");
        try {
            const res = await testForgeConnection(baseUrl);
            setBaseUrl(res.baseUrl);
            setConnected(true);
            await refreshRemoteOptions(res.baseUrl);
            pushStatus(`Forge UI 已连接：${res.baseUrl}`, 3000);
        } catch (error) {
            const msg = error?.message || String(error);
            setConnected(false);
            setConnectError(msg);
            pushStatus(`Forge UI 连接失败：${msg}`, 6000);
        } finally {
            setConnecting(false);
        }
    }, [baseUrl, pushStatus, refreshRemoteOptions, setBaseUrl]);

    const selectPreset = useCallback((id) => {
        const preset = allPresets.find((item) => item.id === id);
        if (!preset) return;
        setSelectedPresetId(id);
        setParams(makeDefaultParams(preset));
        pushStatus(`已切换 Forge 预设：${preset.name}`, 2500);
    }, [allPresets, pushStatus, setParams, setSelectedPresetId]);

    const getPresetName = useCallback((id) => allPresets.find((item) => item.id === id)?.name || id, [allPresets]);

    const canDeletePreset = useCallback((id) => Boolean(allPresets.find((item) => item.id === id)?.fileName), [allPresets]);

    const openPresetSaveDialog = useCallback(() => {
        setPresetSaveName(selectedPreset?.source === "user" ? selectedPreset.name : "");
        setPresetSaveOpen(true);
    }, [selectedPreset]);

    const closePresetSaveDialog = useCallback(() => {
        if (!presetSaving) setPresetSaveOpen(false);
    }, [presetSaving]);

    const commitPresetSave = useCallback(async () => {
        const name = clean(presetSaveName);
        if (!name) return pushStatus("请先输入预设名称", 2500);
        const id = selectedPreset?.source === "user" ? selectedPreset.id : `${FORGE_USER_PRESET_PREFIX}${Date.now()}`;
        setPresetSaving(true);
        try {
            await saveForgeUserPreset({ id, name, category: "user", source: "user", data: paramsToPresetData(params) });
            const loaded = await loadForgeUserPresets();
            setUserPresets(loaded);
            setSelectedPresetId(id);
            setPresetSaveOpen(false);
            pushStatus(`已保存 Forge 预设：${name}`, 3000);
        } catch (error) {
            pushStatus(`保存 Forge 预设失败：${error?.message || error}`, 5000);
        } finally {
            setPresetSaving(false);
        }
    }, [params, presetSaveName, pushStatus, selectedPreset, setSelectedPresetId]);

    const deletePreset = useCallback(async (id) => {
        const preset = allPresets.find((item) => item.id === id);
        if (!preset?.fileName) return;
        try {
            await deleteForgeUserPreset(preset);
            const loaded = await loadForgeUserPresets();
            setUserPresets(loaded);
            if (selectedPresetId === id) {
                const nextPreset = loaded[0] || null;
                setSelectedPresetId(nextPreset?.id || "");
                setParams(makeDefaultParams(nextPreset));
            }
            pushStatus(`已删除 Forge 预设：${preset.name}`, 2500);
        } catch (error) {
            pushStatus(`删除 Forge 预设失败：${error?.message || error}`, 5000);
        }
    }, [allPresets, defaultPreset, pushStatus, selectedPresetId, setParams, setSelectedPresetId]);

    const openUserPresetFolder = useCallback(async () => {
        try {
            const directPath = pluginChildNativePath(FORGE_USER_PRESET_FOLDER);
            let directError = null;
            if (directPath) {
                try {
                    await bridgeShell.openPath(directPath);
                    return;
                } catch (error) {
                    directError = error;
                }
            }
            try {
            await bridgeStorage.localFileSystem.openForgePresetFolder(pluginRuntimeHint());
            return;
        } catch (bridgeError) {
            const folder = await getForgePresetFolder();
            const path = folder.nativePath;
            if (!path) throw directError || bridgeError || new Error("forge_presets path unavailable");
            try {
                await uxpShell.openPath(path);
            } catch (_) {
                await bridgeShell.openPath(path);
            }
            }
        } catch (error) {
            pushStatus(`打开 Forge 预设文件夹失败：${error?.message || error}`, 5000);
        }
    }, [pushStatus]);

    const setParam = useCallback((key, value) => {
        setParams((prev) => ({ ...(prev || makeDefaultParams(selectedPreset)), [key]: value }));
    }, [selectedPreset, setParams]);

    const appendPrompt = useCallback((key, value) => {
        setParams((prev) => ({ ...(prev || makeDefaultParams(selectedPreset)), [key]: appendPromptText(prev?.[key], value) }));
    }, [selectedPreset, setParams]);

    const addLora = useCallback(() => {
        const first = (loras || []).find((item) => !isNone(item));
        if (!first) return pushStatus("请先连接 Forge 或刷新 LoRA", 3500);
        setParams((prev) => ({ ...(prev || makeDefaultParams(selectedPreset)), lora: isNone(prev?.lora) ? first : prev.lora }));
    }, [loras, pushStatus, selectedPreset, setParams]);

    const addControlNet = useCallback(() => {
        const firstModule = (controlNetModules || []).find((item) => !isNone(item));
        const firstModel = (controlNetModels || []).find((item) => !isNone(item));
        if (!firstModule && !firstModel) return pushStatus("请先连接 Forge 读取 ControlNet", 3500);
        setParams((prev) => ({
            ...(prev || makeDefaultParams(selectedPreset)),
            controlNetModule: isNone(prev?.controlNetModule) ? (firstModule || "") : prev.controlNetModule,
            controlNetModel: isNone(prev?.controlNetModel) ? (firstModel || "") : prev.controlNetModel,
        }));
    }, [controlNetModels, controlNetModules, pushStatus, selectedPreset, setParams]);

    const translatePrompt = useCallback(async (value) => {
        try {
            const translated = await translateForgePrompt(value);
            pushStatus("在线翻译完成", 2200);
            return translated;
        } catch (error) {
            pushStatus(`翻译失败：${error?.message || error}`, 5000);
            throw error;
        }
    }, [pushStatus]);

    const refreshLorasAction = useCallback(async () => {
        try {
            const list = await refreshForgeLoras(baseUrl);
            setLoras(list);
            pushStatus(`LoRA 已刷新：${list.length} 个`, 3000);
        } catch (error) {
            pushStatus(`刷新 LoRA 失败：${error?.message || error}`, 5000);
        }
    }, [baseUrl, pushStatus]);

    const captureImage = useCallback(async () => {
        const shouldCapture = await confirmCaptureSelection({
            mode: "canvas",
            clearCapture: () => {
                releaseUploadRecord(pendingUpload);
                setPendingUpload(null);
            },
        });
        if (!shouldCapture) return;
        setCapturing(true);
        try {
            pushStatus("Forge 正在捕获图像...", 0);
            releaseUploadRecord(pendingUpload);
            const capture = await doForgeFullCapture(sharedSettings.uploadLongEdgeMax, sharedSettings.uploadImageFormat);
            const record = uploadRecordFromCapture(capture, pendingUpload);
            if (!record) throw new Error("未获取到图像");
            setPendingUpload(record);
            pushStatus("Forge 图像捕获成功", 3000);
        } catch (error) {
            pushStatus(`Forge 图像捕获失败：${error?.message || error}`, 5000);
        } finally {
            setCapturing(false);
        }
    }, [confirmCaptureSelection, pendingUpload, pushStatus, sharedSettings.uploadImageFormat, sharedSettings.uploadLongEdgeMax]);

    const clearImage = useCallback(() => {
        releaseUploadRecord(pendingUpload);
        setPendingUpload(null);
    }, [pendingUpload]);

    const enqueueAutoPlace = useCallback((savedFileNames, groupName, bounds, placeToken, docId) => {
        const prev = autoPlaceQueueRef.current.catch(() => {});
        const next = prev.then(() => performAutoPlace(savedFileNames, groupName, bounds, placeToken, docId, { force: true }));
        autoPlaceQueueRef.current = next.catch(() => {});
        return next;
    }, []);

    const run = useCallback(async (repeatCount = 1) => {
        if (submittingRef.current) return;
        const repeats = normalizeRepeatCount(repeatCount);
        const url = normalizeForgeBaseUrl(baseUrl);
        if (!connected || !url) return pushStatus("请先连接 Forge UI", 4000);
        submittingRef.current = true;
        setSubmitting(true);
        let releaseSubmitLockDone = false;
        const releaseSubmitLock = () => {
            if (releaseSubmitLockDone) return;
            releaseSubmitLockDone = true;
            submittingRef.current = false;
            setSubmitting(false);
        };
        const runId = `forge_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const startTime = Date.now();
        const abortController = typeof AbortController !== "undefined" ? new AbortController() : null;
        if (abortController) runAbortRefs.current[runId] = abortController;
        runCancelRefs.current[runId] = false;
        const initialUpload = pendingUpload;
        setRuns((prev) => [...prev, { id: runId, status: "running", progress: 0, stageText: "准备中", startTime, elapsedSec: 0, presetName: selectedPresetName, pendingUploads: initialUpload ? { main: initialUpload } : {}, batchTotal: repeats, batchImageTotal: repeats * asInt(params.batch, 1, 1, 16), batchDone: 0 }]);
        const isCancelled = () => runCancelRefs.current[runId] === true || abortController?.signal?.aborted;
        const throwIfCancelled = () => {
            if (isCancelled()) throw new Error("已取消");
        };
        const savedAll = [];
        const pendingPlaceFileNames = [];
        let batchImageTotal = repeats * asInt(params.batch, 1, 1, 16);
        let hadPlaceFailure = false;
        let uploadForRun = initialUpload;
        try {
            updateRun(runId, { stageText: "检查 Forge 连接", progress: 2 });
            await testForgeConnection(url);
            throwIfCancelled();
            const placeContext = await recordForgePlaceContext();
            updateRun(runId, { stageText: "截取主图", progress: 8 });
            const capture = await doForgeFullCapture(sharedSettings.uploadLongEdgeMax, sharedSettings.uploadImageFormat);
            uploadForRun = uploadRecordFromCapture(capture, uploadForRun);
            if (!uploadForRun) throw new Error("图像截取失败");
            setPendingUpload(uploadForRun);
            updateRun(runId, { pendingUploads: { main: uploadForRun }, progress: 14 });
            throwIfCancelled();
            updateRun(runId, { stageText: "准备图片", progress: 20 });
            const imageBase64 = await uploadRecordToBase64(uploadForRun);
            if (!imageBase64) throw new Error("图像编码失败");
            const payload = buildForgePayload(params, imageBase64, uploadForRun);
            const token = getEffectiveResultFolderToken(RESULT_WORKBENCH_FORGE);
            let folder = token ? await uxpFs.getEntryForPersistentToken(token) : null;
            let placeToken = token;
            if (!folder) {
                folder = await getTempResultFolder();
                placeToken = folder?.token ?? null;
            }
            if (!folder || !placeToken) throw new Error("无法访问回图缓存");
            const autoReturnOn = sharedSettings.rhAutoReturnEnabled !== false && sharedSettings.rhAutoReturnEnabled !== "false";
            updateRun(runId, { stageText: repeats > 1 ? `并发提交 ${repeats} 个任务` : "提交 Forge", progress: 30 });
            const progressTimer = setInterval(() => {
                getForgeProgress(url).then((progress) => {
                    const pct = Math.max(35, Math.min(88, 35 + Math.round(Number(progress?.progress || 0) * 45)));
                    updateRun(runId, { progress: pct, stageText: repeats > 1 ? "Forge 执行中" : "生成中" });
                }).catch(() => {});
            }, 2000);
            const requests = Array.from({ length: repeats }, (_, index) => runForgeImg2Img(url, payload, abortController?.signal).then(
                (result) => ({ index, result }),
                (error) => ({ index, error })
            ));
            releaseSubmitLock();
            const results = await Promise.all(requests);
            clearInterval(progressTimer);
            const firstError = results.find((item) => item.error)?.error;
            if (firstError) throw firstError;
            let completed = 0;
            for (const item of results) {
                throwIfCancelled();
                completed += 1;
                const urls = resultUrlsFromForge(item.result);
                if (urls.length > 0) batchImageTotal = Math.max(batchImageTotal, urls.length * repeats);
                updateRun(runId, { batchImageTotal, stageText: repeats > 1 ? `保存回图 ${completed}/${repeats}` : "保存回图", progress: Math.min(94, 70 + Math.round(completed * 20 / repeats)) });
                const savedFileNames = [];
                for (let i = 0; i < urls.length; i += 1) {
                    const saved = await saveImageWithBounds(folder, urls[i], savedAll.length + i + 1, {
                        bounds: placeContext?.bounds ?? null,
                        docId: placeContext?.docId ?? null,
                        runningHubAppName: selectedPresetName || "Forge UI",
                        resultSidecar: { platform: "forge", presetName: selectedPresetName },
                    });
                    savedFileNames.push(saved.fileName);
                }
                savedAll.push(...savedFileNames);
                notifyResultFilesChanged({ folderToken: placeToken });
                updateRun(runId, { batchDone: savedAll.length, batchImageTotal, placeSavedFileNames: pendingPlaceFileNames.concat(savedFileNames), placeBounds: placeContext?.bounds ?? null, placeToken, placeDocId: placeContext?.docId ?? null, placeGroupName: `${selectedPresetName || "Forge UI"} 生成` });
                if (!autoReturnOn) {
                    pendingPlaceFileNames.push(...savedFileNames);
                    updateRun(runId, { placeStatus: "pending", placeSavedFileNames: pendingPlaceFileNames.slice() });
                    continue;
                }
                try {
                    await enqueueAutoPlace(savedFileNames, `${selectedPresetName || "Forge UI"} 生成`, placeContext?.bounds ?? null, placeToken, placeContext?.docId ?? null);
                    updateRun(runId, { placeStatus: pendingPlaceFileNames.length > 0 ? "pending" : "placed" });
                } catch (error) {
                    hadPlaceFailure = true;
                    if (error?.canRetry) {
                        pendingPlaceFileNames.push(...savedFileNames);
                        updateRun(runId, { placeStatus: "pending", placeError: error.reason, placeSavedFileNames: pendingPlaceFileNames.slice() });
                    } else {
                        updateRun(runId, { placeStatus: pendingPlaceFileNames.length > 0 ? "pending" : "failed", placeError: error?.reason || error?.message || String(error) });
                    }
                }
            }
            const placePatch = pendingPlaceFileNames.length > 0
                ? { placeStatus: "pending", placeSavedFileNames: pendingPlaceFileNames.slice(), placeBounds: placeContext?.bounds ?? null, placeToken, placeDocId: placeContext?.docId ?? null, placeGroupName: `${selectedPresetName || "Forge UI"} 生成` }
                : { placeStatus: autoReturnOn ? (hadPlaceFailure ? "failed" : "placed") : "pending" };
            updateRun(runId, { status: "success", progress: 100, stageText: "已完成", completedAt: Date.now(), batchDone: savedAll.length, batchImageTotal, ...placePatch });
            pushStatus(autoReturnOn ? `Forge 已完成并保存 ${savedAll.length} 张` : "Forge 已完成，自动回传已关闭", 6000);
            playSound({ fileName: sharedSettings.successSoundFile });
        } catch (error) {
            const msg = error?.message || String(error);
            const cancelled = runCancelRefs.current[runId] === true;
            abortController?.abort?.();
            if (cancelled) interruptForge(url).catch(() => {});
            updateRun(runId, { status: cancelled ? "cancelled" : "error", progress: 100, stageText: msg, completedAt: Date.now() });
            if (cancelled) pushStatus("Forge 任务已取消", 3000);
            else {
                playSoundFail({ fileName: sharedSettings.failSoundFile });
                pushStatus(`Forge 运行失败：${msg}`, 7000);
            }
        } finally {
            delete runAbortRefs.current[runId];
            delete runCancelRefs.current[runId];
            releaseSubmitLock();
        }
    }, [baseUrl, connected, enqueueAutoPlace, params, pendingUpload, pushStatus, selectedPresetName, sharedSettings.rhAutoReturnEnabled, sharedSettings.uploadImageFormat, sharedSettings.uploadLongEdgeMax, sharedSettings.successSoundFile, sharedSettings.failSoundFile, updateRun]);

    const dismissRun = useCallback((id) => {
        const runItem = runs.find((run) => run.id === id);
        if (runItem?.status === "running") runCancelRefs.current[id] = true;
        runAbortRefs.current[id]?.abort?.();
        delete runAbortRefs.current[id];
        if (runItem?.status === "running") interruptForge(baseUrl).catch(() => {});
        setRuns((prev) => prev.filter((run) => run.id !== id));
    }, [baseUrl, runs]);

    const retryPlace = useCallback(async (id) => {
        const runItem = runs.find((run) => run.id === id);
        if (!runItem?.placeSavedFileNames || !runItem.placeToken) return;
        try {
            pushStatus("正在重试贴回图片...", 3000);
            await enqueueAutoPlace(runItem.placeSavedFileNames, runItem.placeGroupName || "Forge UI 生成", runItem.placeBounds, runItem.placeToken, runItem.placeDocId);
            updateRun(id, { placeStatus: "placed", placeError: null });
            pushStatus("贴回成功", 3000);
        } catch (error) {
            updateRun(id, { placeError: error?.reason || error?.message || String(error) });
            pushStatus(`贴回失败：${error?.reason || error?.message || error}`, 5000);
        }
    }, [enqueueAutoPlace, pushStatus, runs, updateRun]);

    useEffect(() => {
        if (typeof onRegisterTaskActions !== "function") return undefined;
        return onRegisterTaskActions({ dismiss: dismissRun, retryPlace });
    }, [dismissRun, onRegisterTaskActions, retryPlace]);

    const dismissQueueRun = useCallback((platformOrRunId, maybeRunId) => {
        const runId = maybeRunId ?? platformOrRunId;
        const platform = maybeRunId ? platformOrRunId : (taskRunsForQueue.find((run) => run.id === runId)?.platform || "forge");
        if (onDismissSharedRun) onDismissSharedRun(platform, runId);
        else dismissRun(runId);
    }, [dismissRun, onDismissSharedRun, taskRunsForQueue]);

    const retryQueuePlace = useCallback((platformOrRunId, maybeRunId) => {
        const runId = maybeRunId ?? platformOrRunId;
        const platform = maybeRunId ? platformOrRunId : (taskRunsForQueue.find((run) => run.id === runId)?.platform || "forge");
        if (onRetrySharedPlace) onRetrySharedPlace(platform, runId);
        else retryPlace(runId);
    }, [onRetrySharedPlace, retryPlace, taskRunsForQueue]);

    const state = { baseUrl, connected, connecting, connectError, message, selectedPresetId, selectedPresetName, presetOptions, presetSaveOpen, presetSaveName, presetSaving, params, models, samplers, schedulers, loras, controlNetModules, controlNetModels, pendingUpload, capturing, runs, queueRuns: taskRunsForQueue, submitting };
    const actions = { setBaseUrl, connect, selectPreset, getPresetName, canDeletePreset, deletePreset, openPresetSaveDialog, closePresetSaveDialog, setPresetSaveName, commitPresetSave, setParam, addLora, addControlNet, appendPrompt, translatePrompt, refreshLoras: refreshLorasAction, refreshUserPresets, openUserPresetFolder, captureImage, clearImage, run, dismissQueueRun, retryQueuePlace };
    const isHome = currentPage === "home";

    return (
        <>
            {squareSelectionWarningDialog}
            <ForgeTopBar activeProduct={activeProduct} onChangeProduct={onChangeProduct} isSettingsOpen={!isHome} onToggleView={() => setCurrentPage((p) => p === "home" ? "settings" : "home")} onRefresh={refreshForgeTopBar} />
            <div style={{ flex: 1, minHeight: 0, overflow: "visible", display: isHome ? "flex" : "none", flexDirection: "column", background: "transparent" }}>
                <ForgeHome state={state} actions={actions} />
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "visible", display: isHome ? "none" : "block", background: "transparent" }}>
                <div className="forge-settings-wrap">
                    <ForgePresetManagerCard state={state} actions={actions} />
                    <ComfySettings props={sharedSettings} workbenchId={RESULT_WORKBENCH_FORGE} productLabel="Forge" />
                </div>
            </div>
        </>
    );
}

function elapsedSeconds(startTime) {
    return (Date.now() - startTime) / 1000;
}
