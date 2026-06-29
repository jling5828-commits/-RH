import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { core, app } from "photoshop";
import { usePersistedState } from "../hooks/usePersistedState.js";
import { isInWebView, photoshop, xiaoliangRhPeekUploadSessionRawBase64, xiaoliangRhReleaseUploadSession } from "../bridge/uxpBridge.js";
import { captureAll, computeRhPlaceContextBoundsSync } from "../components/ImageUpload/captureUtils.js";
import { useSquareSelectionWarning } from "../components/ImageUpload/SquareSelectionWarning.jsx";
import { CustomSelect } from "../components/CustomSelect.jsx";
import { TaskPreviewThumb } from "../components/shared/TaskPreviewLightbox.jsx";
import { SettingsCard } from "../components/settings/SettingsCard.jsx";
import { RhImagePreviewField } from "../runninghub/ui/RhImagePreviewField.jsx";
import { IconExternalLink, RhSecureKeyField } from "../runninghub/ui/RhApiKeySettingsBlock.jsx";
import { normalizeRhImageLongEdgeMax } from "../runninghub/rhImageLongEdge.js";
import { RH_PS_CAPTURE_JPEG_QUALITY, base64ByteLength, normalizeRhUploadImageFormat, rhCaptureFileName, stripBase64FromDataUrl } from "../runninghub/ui/xlrhRhWorkPanelLogic.js";
import { RESULT_WORKBENCH_BANANA, getEffectiveResultFolderToken } from "../utils/resultFolderTokens.js";
import { getTempResultFolder, saveImageWithBounds } from "../utils/imageSaver.js";
import { performAutoPlace } from "../utils/autoPlace.js";
import { notifyResultFilesChanged } from "../utils/resultFilesSync.js";
import { safeOpenExternal } from "../utils/safeOpenExternal.js";
import { playSound, playSoundFail } from "../utils/playSound.js";
import {
    readAutoReturnEnabled,
    readConcurrentReturnGroupEnabled,
    readFailSoundFile,
    readSuccessSoundFile,
} from "../utils/sharedInteractionSettings.js";
import { readCompatLocalStorage, removeCompatLocalStorage } from "../utils/storageKeyCompat.js";
import { pruneCompletedRhRuns } from "../runninghub/hooks/xlrhRunQueueRecords.js";
import { ComfySettings } from "../comfy/ComfyShell.jsx";
import { BANANA_AJI_ENDPOINTS, BANANA_AJI_MODELS, BANANA_GRS_ENDPOINT, BANANA_GRS_MODELS, fetchBananaBalance, fetchBananaModels, probeBananaProvider, resolveBananaRunConfig, runBananaImage, toBananaAjiBaseModel } from "./bananaApi.js";
import "../components/WorkPanel/WorkPanel.css";
import "../components/ImageUpload/ImageUpload.css";
import "../runninghub/ui/RhWorkPanel.css";
import "../comfy/ComfyShell.css";
import "./BananaShell.css";

const uxpStorage = require("uxp").storage;
const uxpFs = uxpStorage.localFileSystem;
const uxpFormats = uxpStorage.formats;
const AJI = "aji";
const GRS = "grs";
const BANANA_PRESET_FOLDER = "banana_presets";
const BANANA_PROMPT_PRESET_STORAGE_KEY = "banana_prompt_presets";
const BANANA_PRESET_MIGRATION_KEY = "banana_prompt_presets_migrated_to_data_folder_v1";
const BANANA_AJI_CONTACT_QQ = "770466704";
const BANANA_GRS_API_KEY_URL = "https://grsai.com/zh/dashboard/api-keys";
const PROVIDER_LABELS = Object.freeze({ [AJI]: "AJI", [GRS]: "GRS" });
const BALANCE_UNSET = "-";
const BANANA_PARAM_MENU_Z_INDEX = 100020;
const BANANA_PROMPT_MENU_Z_INDEX = 100030;

const IconRefresh = ({ className = "" }) => (
    <svg className={className} width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
);

const IconSettings = () => (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

const IconBack = () => (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M19 12H5" /><polyline points="12 19 5 12 12 5" />
    </svg>
);

const IconHelp = () => (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="10" />
        <path d="M9.1 9a3 3 0 1 1 4.9 2.3c-.9.7-1.5 1.2-1.5 2.2" />
        <path d="M12 17h.01" />
    </svg>
);

const PlayIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
);

function normalizePlaceContext(value) {
    const bounds = value?.bounds;
    return bounds && value?.docId != null && ["left", "top", "right", "bottom"].every((key) => Number.isFinite(bounds[key])) ? { docId: value.docId, bounds } : null;
}

async function captureBananaImage(longEdgeMax, uploadImageFormat) {
    const options = {
        longEdgeMax: normalizeRhImageLongEdgeMax(longEdgeMax),
        uploadEncodeFormat: normalizeRhUploadImageFormat(uploadImageFormat),
        jpegQuality: RH_PS_CAPTURE_JPEG_QUALITY,
        requireSelection: true,
        hostPreviewFromUpload: true,
    };
    if (isInWebView()) return captureAll("canvas", { ...options, __retainUploadSession: true });
    let capture;
    await core.executeAsModal(async (context) => {
        const docId = app.activeDocument?.id;
        if (!docId) throw new Error("请先打开 Photoshop 文档");
        const historyId = await context.hostControl.suspendHistory({ documentID: docId, name: "Banana capture" });
        try { capture = await captureAll("canvas", options); }
        finally { await context.hostControl.resumeHistory(historyId); }
    }, { commandName: "Banana 捕获" });
    return capture;
}

async function recordPlaceContext() {
    if (isInWebView()) {
        try { return normalizePlaceContext(await photoshop.commands.recordRhRunPlaceContext("canvas")); }
        catch (_) { return null; }
    }
    const box = { value: null };
    try {
        await core.executeAsModal(async () => { box.value = computeRhPlaceContextBoundsSync("canvas"); }, { commandName: "Banana 记录回图选区" });
    } catch (_) {}
    return normalizePlaceContext(box.value);
}

function uploadFromCapture(capture, previous) {
    const base64 = stripBase64FromDataUrl(capture?.uploadBase64 || "");
    const uploadSessionId = String(capture?.uploadSessionId || "").trim();
    if (!base64 && !uploadSessionId) return null;
    const mimeType = capture.mimeType || previous?.mimeType || "image/png";
    const bounds = capture?.bounds;
    const aspectRatio = bounds && bounds.right > bounds.left && bounds.bottom > bounds.top ? (bounds.right - bounds.left) / (bounds.bottom - bounds.top) : previous?.aspectRatio;
    return {
        fileName: rhCaptureFileName("banana", mimeType),
        mimeType,
        base64,
        uploadSessionId,
        previewBase64: capture.previewBase64 || previous?.previewBase64 || "",
        uploadByteLength: capture.uploadByteLength || base64ByteLength(base64),
        uploadWidth: capture.uploadWidth,
        uploadHeight: capture.uploadHeight,
        aspectRatio,
        docId: capture?.docId ?? previous?.docId ?? null,
        bounds: capture?.bounds ?? previous?.bounds ?? null,
    };
}

async function materializeUploadRecord(uploadRecord) {
    if (!uploadRecord?.uploadSessionId) return uploadRecord;
    try {
        const res = await xiaoliangRhPeekUploadSessionRawBase64(uploadRecord.uploadSessionId);
        if (!res?.ok || !res.rawBase64) throw new Error(res?.message || "读取图片会话失败");
        const base64 = String(res.rawBase64 || "");
        return {
            ...uploadRecord,
            base64,
            uploadSessionId: "",
            uploadByteLength: uploadRecord.uploadByteLength || base64ByteLength(base64),
        };
    } finally {
        await xiaoliangRhReleaseUploadSession(uploadRecord.uploadSessionId).catch(() => {});
    }
}

function releaseUploadRecord(uploadRecord) {
    const sessionId = String(uploadRecord?.uploadSessionId || "").trim();
    if (sessionId) xiaoliangRhReleaseUploadSession(sessionId).catch(() => {});
}

function formatRunStatus(run) {
    if (run.status === "success") return run.failedCount ? `完成 ${run.doneCount}/${run.total}，失败 ${run.failedCount}` : "已完成";
    if (run.status === "cancelled") return "已取消";
    if (run.status === "error") return "失败";
    return "运行中";
}

function elapsedSeconds(startTime) {
    return startTime ? (Date.now() - startTime) / 1000 : 0;
}

function batchProgressText(run) {
    const total = Number(run?.batchImageTotal || run?.batchTotal || 0);
    return total > 1 ? `返回 ${Number(run?.batchDone || 0)} 张/共 ${total} 张` : "";
}

function formatBananaBalance(provider, value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return BALANCE_UNSET;
    if (provider === GRS) return `${Math.round(numeric).toLocaleString()} pts`;
    const usd = numeric > 10000 ? numeric / 500000 : numeric;
    return `$${usd.toFixed(4)}`;
}

function providerEndpointLabel(provider, endpoint) {
    if (endpoint?.label) return endpoint.label;
    return provider === GRS ? "自动 GRS" : "自动 AJI";
}

function safeBananaPresetFileName(value) {
    return (String(value || "").trim() || "preset").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 48);
}

function normalizeBananaPreset(value, fileName) {
    if (!value || typeof value !== "object") return null;
    const name = String(value.name || "").trim();
    const prompt = String(value.prompt || "").trim();
    if (!name || !prompt) return null;
    const id = String(value.id || "").trim() || `banana_prompt_${safeBananaPresetFileName(fileName).replace(/\.json$/i, "")}`;
    return { id, name, prompt, updatedAt: Number(value.updatedAt || 0), fileName };
}

async function getBananaPresetFolder() {
    const dataFolder = await uxpFs.getDataFolder();
    try {
        const existing = await dataFolder.getEntry(BANANA_PRESET_FOLDER);
        if (existing?.isFile === false) return existing;
    } catch (_) {}
    return dataFolder.createFolder(BANANA_PRESET_FOLDER);
}

function hasMigratedBananaPromptPresets() {
    try {
        return localStorage.getItem(BANANA_PRESET_MIGRATION_KEY) === "1";
    } catch (_) {
        return false;
    }
}

function markBananaPromptPresetsMigrated() {
    try {
        localStorage.setItem(BANANA_PRESET_MIGRATION_KEY, "1");
    } catch (_) {}
}

async function migrateBananaPromptPresets(folder) {
    if (hasMigratedBananaPromptPresets()) return 0;
    let migrated = 0;
    try {
        const raw = readCompatLocalStorage(BANANA_PROMPT_PRESET_STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        if (Array.isArray(list)) {
            const existing = new Set(((await folder.getEntries()) || []).map((entry) => String(entry?.name || "")));
            for (const item of list) {
                const preset = normalizeBananaPreset(item, "");
                if (!preset) continue;
                const fileName = `${safeBananaPresetFileName(preset.name || preset.id)}.json`;
                if (existing.has(fileName)) continue;
                const file = await folder.createFile(fileName, { overwrite: false });
                await file.write(JSON.stringify(preset, null, 2), { format: uxpFormats.utf8 });
                existing.add(fileName);
                migrated += 1;
            }
        }
    } catch (_) {}
    markBananaPromptPresetsMigrated();
    return migrated;
}

async function loadBananaPromptPresets() {
    const folder = await getBananaPresetFolder();
    await migrateBananaPromptPresets(folder);
    const entries = (await folder.getEntries()).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN"));
    const out = [];
    for (const entry of entries || []) {
        if (entry?.isFile === false || !/\.json$/i.test(entry?.name || "")) continue;
        try {
            const preset = normalizeBananaPreset(JSON.parse(await entry.read({ format: uxpFormats.utf8 })), entry.name);
            if (preset) out.push(preset);
        } catch (_) {}
    }
    return out.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

async function saveBananaPromptPresetFile(preset) {
    const folder = await getBananaPresetFolder();
    const file = await folder.createFile(`${safeBananaPresetFileName(preset.name || preset.id)}.json`, { overwrite: true });
    await file.write(JSON.stringify(preset, null, 2), { format: uxpFormats.utf8 });
}

async function deleteBananaPromptPresetFile(preset) {
    const folder = await getBananaPresetFolder();
    const fileName = preset?.fileName || `${safeBananaPresetFileName(preset?.name || preset?.id)}.json`;
    const file = await folder.getEntry(fileName);
    if (file?.isFile !== false) await file.delete();
}

function BananaLatencyToast({ result }) {
    if (!result) return null;
    const label = result.latencyMs != null ? `${Math.max(0, Math.round(result.latencyMs))}ms` : "失败";
    return <div key={result.id} className={`banana-latency-toast ${result.ok ? "is-ok" : "is-bad"}`} title={result.label || ""}>{label}</div>;
}

function Stepper({ label, value, min, max, onChange, suffix = "" }) {
    const next = (delta) => onChange(Math.max(min, Math.min(max, Number(value || min) + delta)));
    return (
        <div className="banana-stepper">
            <span className="banana-stepper-label">{label}</span>
            <div className="banana-stepper-control">
                <button type="button" onClick={() => next(-1)} disabled={value <= min} title={`减少${label}`}>−</button>
                <span>{value}{suffix}</span>
                <button type="button" onClick={() => next(1)} disabled={value >= max} title={`增加${label}`}>+</button>
            </div>
        </div>
    );
}

function bananaParamMenuStyle(anchor) {
    if (!anchor || typeof window === "undefined") return null;
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - rect.width - margin));
    const maxHeight = Math.max(140, Math.min(292, window.innerHeight - rect.bottom - margin - 5));
    return {
        position: "fixed",
        left,
        top: rect.bottom + 5,
        width: rect.width,
        maxHeight,
        zIndex: BANANA_PARAM_MENU_Z_INDEX,
    };
}

function bananaPromptMenuStyle(anchor) {
    if (!anchor || typeof window === "undefined") return null;
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(260, Math.max(210, rect.width + 188));
    return {
        position: "fixed",
        right: Math.max(margin, window.innerWidth - rect.right),
        top: rect.bottom + 6,
        width: Math.min(width, window.innerWidth - margin * 2),
        maxHeight: Math.max(150, Math.min(310, window.innerHeight - rect.bottom - margin - 6)),
        zIndex: BANANA_PROMPT_MENU_Z_INDEX,
    };
}

function BananaTopBar({ balance, loading, onRefresh, isSettingsOpen, onToggleView }) {
    const [helpOpen, setHelpOpen] = useState(false);
    return (
        <>
            <div className="rh-balance-bar comfy-topbar banana-balance-bar">
                <div className="rh-balance-content comfy-topbar-left">
                    <img src="icons/eye.png" className="rh-balance-icon" alt="" />
                    <div className="rh-balance-info"><span className="rh-balance-item">余额 <span className="rh-balance-value">{loading ? "查询中" : balance ?? "-"}</span></span></div>
                </div>
                <div className="rh-balance-bar-right">
                    <button type="button" className="icon-btn" onClick={onRefresh} title="查询余额并刷新模型"><IconRefresh className={loading ? "rh-spinning" : ""} /></button>
                    <button type="button" className="icon-btn rh-help-btn" onClick={() => setHelpOpen(true)} title="使用说明"><IconHelp /></button>
                    <button type="button" className="icon-btn" onClick={onToggleView} title={isSettingsOpen ? "返回主页" : "打开设置"}>{isSettingsOpen ? <IconBack /> : <IconSettings />}</button>
                </div>
            </div>
            {helpOpen && <div className="xl-popup-overlay" onClick={() => setHelpOpen(false)}><div className="xl-popup-dialog rh-help-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
                <div className="xl-popup-icon rh-help-icon">?</div>
                <div className="xl-popup-title">Banana 使用说明</div>
                <div className="xl-popup-body rh-help-body"><p>先在设置页账户管理中填写 AJI 或 GRS 的 API Key，并查询余额刷新模型。</p><p>主页面参数设置可选择供应商、模型、尺寸、并发和超时；提示词可直接在文本框输入。</p><p>捕获图像会读取当前 Photoshop 画面和选区位置；选区不是 1:1 时会提示，可立即清空后重选。</p><p>使用并发时会同时提交多份任务，等整批任务全部结束后再统一保存并回传；失败任务会显示在任务队列。</p></div>
                <div className="xl-popup-actions"><button type="button" className="xl-btn xl-btn-primary" onClick={() => setHelpOpen(false)}>知道了</button></div>
            </div></div>}
        </>
    );
}

function BananaQueueCard({ runs, onDismiss, onRetryPlace }) {
    const [open, setOpen] = useState(true);
    return <div className={`xlrh-card rh-queue-card ${open ? "" : "is-collapsed"}`}>
        <div className="card-header" onClick={() => setOpen((value) => !value)}><span className="header-title"><span className="title-icon">📋</span>任务队列 {runs.length ? `(${runs.length})` : ""}</span><div className={`collapse-arrow ${open ? "expanded" : "collapsed"}`}><span className="arrow-icon" /></div></div>
        <div className={`card-content ${open ? "" : "collapsed"}`}><div className="rh-task-queue">
            {!runs.length ? <div className="rh-task-empty">暂无任务</div> : runs.map((run) => {
                const platform = run.platform || "banana";
                const own = platform === "banana";
                const platformLabel = own ? "Banana" : platform === "runninghub" ? "RunningHub" : platform === "comfy" ? "Comfy UI" : "Forge UI";
                const name = own ? `${PROVIDER_LABELS[run.provider] || "Banana"} · ${run.model || ""}` : run.presetName || run.workflowName || run.platform;
                const pending = run.placeStatus === "pending";
                const submitTime = new Date(run.startTime);
                const time = `${submitTime.getHours().toString().padStart(2, "0")}:${submitTime.getMinutes().toString().padStart(2, "0")}`;
                const elapsed = run.elapsedSec || (run.completedAt ? (run.completedAt - run.startTime) / 1000 : 0);
                const duration = elapsed < 60 ? `${elapsed.toFixed(1)}秒` : `${Math.floor(elapsed / 60)}分${Math.round(elapsed % 60)}秒`;
                const batch = batchProgressText(run);
                return <div key={run.id} className="rh-task-item">
                    <TaskPreviewThumb src={run.pendingUploads?.main?.previewBase64} title="查看任务大图" />
                    <div className="rh-task-status-wrapper"><div className={`rh-task-status ${run.status === "success" ? "success" : run.status === "running" ? "running" : run.status === "cancelled" ? "warning" : "error"}`} /></div>
                    <div className="rh-task-info"><div className="rh-task-name">{name}</div><div className="rh-task-meta"><span className={`rh-task-platform-badge rh-task-platform-badge--${platform}`}>{platformLabel}</span><span className="rh-task-time">{time} 提交</span><span className="rh-task-duration">{duration}</span></div><div className="rh-task-progress">{formatRunStatus(run)}{batch && <span className="rh-task-stage" title={batch}>{batch}</span>}{run.stageText && <span className="rh-task-stage">{run.stageText}</span>}</div></div>
                    <div className="rh-task-actions">{pending && <button type="button" className="rh-task-retry" onClick={() => onRetryPlace?.(run.platform || "banana", run.id)} title="贴回图片">↗</button>}<button type="button" className="rh-task-close" onClick={() => onDismiss?.(run.platform || "banana", run.id)} title="关闭任务">×</button></div>
                </div>;
            })}
        </div></div>
    </div>;
}

function BananaPromptPresetMenu({ presets, presetName, setPresetName, currentPrompt, onSelect, onSave, onDelete }) {
    const items = Array.isArray(presets) ? presets : [];
    const canSave = String(currentPrompt || "").trim() && String(presetName || "").trim();
    return (
        <div className="banana-prompt-preset-menu" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            <div className="banana-prompt-preset-list">
                {!items.length ? (
                    <div className="banana-prompt-preset-empty">暂无提示词预设</div>
                ) : items.map((item) => (
                    <div key={item.id} className="banana-prompt-preset-item">
                        <button type="button" className="banana-prompt-preset-select" onClick={() => onSelect(item)} title={item.prompt || item.name}>
                            {item.name}
                        </button>
                        <button
                            type="button"
                            className="banana-prompt-preset-delete"
                            title="删除预设"
                            onClick={() => onDelete(item.id)}
                        >
                            ×
                        </button>
                    </div>
                ))}
            </div>
            <div className="banana-prompt-preset-save">
                <input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="预设名称" />
                <button type="button" disabled={!canSave} onClick={onSave}>保存</button>
            </div>
        </div>
    );
}

function BananaHome({ state, actions }) {
    const [paramsOpen, setParamsOpen] = useState(false);
    const [paramMenuStyle, setParamMenuStyle] = useState(null);
    const [captureOpen, setCaptureOpen] = useState(true);
    const [promptOpen, setPromptOpen] = useState(true);
    const [promptPresetOpen, setPromptPresetOpen] = useState(false);
    const [promptPresetMenuStyle, setPromptPresetMenuStyle] = useState(null);
    const [promptPresetName, setPromptPresetName] = useState("");
    const paramsRef = useRef(null);
    const paramsMenuRef = useRef(null);
    const promptPresetBtnRef = useRef(null);
    const promptPresetMenuRef = useRef(null);
    const models = state.models[state.provider] || [];
    const rawActiveModel = state.modelByProvider[state.provider] || "";
    const activeModel = state.provider === AJI ? toBananaAjiBaseModel(rawActiveModel) : rawActiveModel;
    const rawModelOptions = models.length ? models : (state.provider === GRS ? BANANA_GRS_MODELS : BANANA_AJI_MODELS);
    const modelOptions = state.provider === AJI
        ? [...new Set(rawModelOptions.map(toBananaAjiBaseModel).filter(Boolean))]
        : rawModelOptions;
    useEffect(() => {
        if (!paramsOpen) return undefined;
        const onMouseDown = (event) => {
            const target = event.target;
            if (paramsRef.current?.contains(target)) return;
            if (paramsMenuRef.current?.contains(target)) return;
            if (target?.closest?.(".xlrh-param-select-menu")) return;
            setParamsOpen(false);
        };
        document.addEventListener("mousedown", onMouseDown);
        return () => document.removeEventListener("mousedown", onMouseDown);
    }, [paramsOpen]);
    useEffect(() => {
        if (!promptPresetOpen) return undefined;
        const onMouseDown = (event) => {
            const target = event.target;
            if (promptPresetBtnRef.current?.contains(target)) return;
            if (promptPresetMenuRef.current?.contains(target)) return;
            setPromptPresetOpen(false);
        };
        document.addEventListener("mousedown", onMouseDown);
        return () => document.removeEventListener("mousedown", onMouseDown);
    }, [promptPresetOpen]);
    const refreshParamMenuStyle = useCallback(() => {
        setParamMenuStyle(bananaParamMenuStyle(paramsRef.current));
    }, []);
    const refreshPromptPresetMenuStyle = useCallback(() => {
        setPromptPresetMenuStyle(bananaPromptMenuStyle(promptPresetBtnRef.current));
    }, []);
    useLayoutEffect(() => {
        if (!paramsOpen) {
            setParamMenuStyle(null);
            return undefined;
        }
        refreshParamMenuStyle();
        window.addEventListener("scroll", refreshParamMenuStyle, true);
        window.addEventListener("resize", refreshParamMenuStyle);
        return () => {
            window.removeEventListener("scroll", refreshParamMenuStyle, true);
            window.removeEventListener("resize", refreshParamMenuStyle);
        };
    }, [paramsOpen, refreshParamMenuStyle]);
    useLayoutEffect(() => {
        if (!promptPresetOpen) {
            setPromptPresetMenuStyle(null);
            return undefined;
        }
        refreshPromptPresetMenuStyle();
        window.addEventListener("scroll", refreshPromptPresetMenuStyle, true);
        window.addEventListener("resize", refreshPromptPresetMenuStyle);
        return () => {
            window.removeEventListener("scroll", refreshPromptPresetMenuStyle, true);
            window.removeEventListener("resize", refreshPromptPresetMenuStyle);
        };
    }, [promptPresetOpen, refreshPromptPresetMenuStyle]);
    const paramsMenu = (
        <div ref={paramsMenuRef} className="banana-param-menu banana-param-menu--portal" style={paramMenuStyle}>
            <div className="banana-controls">
                <CustomSelect label="供应商" value={state.provider} displayValue={PROVIDER_LABELS[state.provider]} options={[AJI, GRS]} getItemLabel={(item) => PROVIDER_LABELS[item]} onChange={actions.setProvider} dropdownPlacement="down" useDropdownPortal />
                <CustomSelect label="模型" value={activeModel || modelOptions[0] || ""} displayValue={activeModel || modelOptions[0] || "请刷新模型"} options={modelOptions} onChange={actions.setModel} dropdownPlacement="down" useDropdownPortal />
                <CustomSelect label="尺寸" value={state.size} options={["1K", "2K", "4K"]} onChange={actions.setSize} dropdownPlacement="down" useDropdownPortal />
                <Stepper label="并发" value={state.concurrency} min={1} max={8} onChange={actions.setConcurrency} />
                <Stepper label="超时" value={state.timeoutSec} min={60} max={1800} onChange={actions.setTimeoutSec} suffix="s" />
            </div>
        </div>
    );
    const promptPresetMenu = (
        <div ref={promptPresetMenuRef} style={promptPresetMenuStyle}>
            <BananaPromptPresetMenu
                presets={state.promptPresets}
                presetName={promptPresetName}
                setPresetName={setPromptPresetName}
                currentPrompt={state.prompt}
                onSelect={(item) => {
                    actions.setPrompt(item.prompt || "");
                    setPromptPresetOpen(false);
                }}
                onSave={async () => {
                    if (await actions.savePromptPreset(promptPresetName)) setPromptPresetName("");
                }}
                onDelete={actions.deletePromptPreset}
            />
        </div>
    );
    return <div className="banana-home">
        <div ref={paramsRef} className={"banana-param-dropdown" + (paramsOpen ? " is-open" : "")}>
            <button type="button" className="banana-param-trigger" onClick={() => setParamsOpen((value) => !value)} aria-expanded={paramsOpen}>
                <span className="banana-param-trigger-label">参数设置</span>
                <span className={"banana-param-trigger-caret" + (paramsOpen ? " is-open" : "")} />
            </button>
            <BananaLatencyToast result={state.probeResult} />
            {paramsOpen && paramMenuStyle && typeof document !== "undefined" && document.body
                ? createPortal(paramsMenu, document.body)
                : null}
        </div>
        <div className="rh-run-section">
            <button type="button" className={`rh-run-btn ${state.submitting ? "running" : ""}`} disabled={state.submitting} onClick={actions.run}>
                {state.submitting ? <span className="rh-run-btn-spinner" /> : <PlayIcon />}
                {state.submitting ? "正在提交..." : "开始运行"}
            </button>
            <div className="rh-upload-status-bar banana-status-bar">
                <div className="rh-status-text">{state.statusText || "就绪"}</div>
                <div className="banana-status-route">当前线路：{state.endpointLabel}</div>
                <div className="rh-progress-bar"><div className="rh-progress-fill" style={{ width: `${state.progress}%` }} /></div>
            </div>
        </div>
        <div className={`xlrh-card banana-capture-card ${captureOpen ? "" : "is-collapsed"}`}>
            <div className="card-header" onClick={() => setCaptureOpen((value) => !value)}>
                <span className="header-title"><span className="title-icon">📸</span>捕获图像</span>
                <div className={`collapse-arrow ${captureOpen ? "expanded" : "collapsed"}`}><span className="arrow-icon" /></div>
            </div>
            <div className={`card-content ${captureOpen ? "" : "collapsed"}`}><RhImagePreviewField label="图像" pending={state.pendingUpload} busy={state.capturing} onCapture={actions.capture} onClear={actions.clearCapture} /></div>
        </div>
        <div className={`xlrh-card banana-prompt-card ${promptOpen ? "" : "is-collapsed"}`}>
            <div className="card-header" onClick={() => setPromptOpen((value) => !value)}>
                <span className="header-title"><span className="title-icon">📝</span>提示词</span>
                <button
                    ref={promptPresetBtnRef}
                    type="button"
                    className={`banana-prompt-preset-btn ${promptPresetOpen ? "is-open" : ""}`}
                    title="提示词预设"
                    aria-label="提示词预设"
                    onClick={(event) => {
                        event.stopPropagation();
                        setPromptPresetOpen((value) => !value);
                    }}
                >
                    预设
                </button>
                <div className={`collapse-arrow ${promptOpen ? "expanded" : "collapsed"}`}><span className="arrow-icon" /></div>
            </div>
            {promptPresetOpen && promptPresetMenuStyle && typeof document !== "undefined" && document.body
                ? createPortal(promptPresetMenu, document.body)
                : null}
            <div className={`card-content ${promptOpen ? "" : "collapsed"}`}><textarea className="banana-prompt-textarea" value={state.prompt} onChange={(event) => actions.setPrompt(event.target.value)} placeholder="描述想要生成或修改的图像效果..." /></div>
        </div>
        <BananaQueueCard runs={state.queueRuns} onDismiss={actions.dismiss} onRetryPlace={actions.retryPlace} />
    </div>;
}

function BananaAccountSettings({ state, actions }) {
    const isAji = state.provider === AJI;
    const stopNestedButtonEvent = useCallback((event) => {
        event?.stopPropagation?.();
    }, []);
    const handleOpenKeyPage = useCallback(async (event, item) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (!item?.keyUrl) return;
        const opened = await safeOpenExternal(item.keyUrl, { pushStatus: actions.pushStatus });
        if (opened && typeof actions.pushStatus === "function") actions.pushStatus(`已打开 ${item.label} API Key 页面`, 3000);
    }, [actions.pushStatus]);
    const handleContactQq = useCallback(async (event, item) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (!item?.contactQq) return;
        try {
            await navigator.clipboard.writeText(item.contactQq);
            actions.pushStatus?.(`已复制 AJI 联系 QQ：${item.contactQq}`, 3000);
        } catch (error) {
            actions.pushStatus?.(`AJI 联系 QQ：${item.contactQq}`, 5000);
        }
    }, [actions.pushStatus]);
    const providers = [
        {
            id: AJI,
            label: "AJI",
            title: "AJI API Key",
            value: state.ajiApiKey,
            placeholder: "填写 AJI API Key",
            route: BANANA_AJI_ENDPOINTS.map((item) => item.replace(/^https?:\/\//, "")).join(" / "),
            setValue: actions.setAjiApiKey,
            contactQq: BANANA_AJI_CONTACT_QQ,
        },
        {
            id: GRS,
            label: "GRS",
            title: "GRS API Key",
            value: state.grsApiKey,
            placeholder: "填写 GRS API Key",
            route: BANANA_GRS_ENDPOINT.replace(/^https?:\/\//, "").replace(/\/$/, ""),
            setValue: actions.setGrsApiKey,
            keyUrl: BANANA_GRS_API_KEY_URL,
        },
    ];
    return <SettingsCard cardClass="rh-config-card banana-account-card" icon="🔑" title="账户管理" defaultOpen>
        <div className="rh-config-content banana-account-stack">
            <BananaLatencyToast result={state.probeResult} />
            <div className="rh-config-row1"><label className="rh-config-label">供应商</label></div>
            <div className="rh-key-mode-switch" role="tablist" aria-label="Banana 供应商">
                <button type="button" className={`rh-key-mode-btn ${isAji ? "is-active" : ""}`} onClick={() => actions.setProvider(AJI)} role="tab" aria-selected={isAji}>AJI</button>
                <button type="button" className={`rh-key-mode-btn ${!isAji ? "is-active" : ""}`} onClick={() => actions.setProvider(GRS)} role="tab" aria-selected={!isAji}>GRS</button>
            </div>
            <div className="rh-config-row1"><label className="rh-config-label">API Key</label></div>
            <div className="rh-key-field-list">
                {providers.map((item) => {
                    const active = state.provider === item.id;
                    return <div key={item.id} className={`rh-key-field-card banana-key-card ${active ? "is-active" : ""}`} onClick={() => actions.setProvider(item.id)}>
                        <div className="rh-key-field-head">
                            <div className="rh-key-field-title-wrap">
                                <span className="rh-key-field-title">{item.title}</span>
                                {item.keyUrl && <button
                                    type="button"
                                    className="rh-key-field-link-btn"
                                    onPointerDown={stopNestedButtonEvent}
                                    onMouseDown={stopNestedButtonEvent}
                                    onTouchStart={stopNestedButtonEvent}
                                    onClick={(event) => handleOpenKeyPage(event, item)}
                                    title={`打开${item.label} API Key 页面`}
                                    aria-label={`打开${item.label} API Key 页面`}
                                >
                                    <span className="rh-key-field-link-text">跳转</span>
                                    <IconExternalLink />
                                </button>}
                                {item.keyUrl && <span className="banana-vpn-note">需VPN</span>}
                                {item.contactQq && <button
                                    type="button"
                                    className="rh-key-field-link-btn"
                                    onPointerDown={stopNestedButtonEvent}
                                    onMouseDown={stopNestedButtonEvent}
                                    onTouchStart={stopNestedButtonEvent}
                                    onClick={(event) => handleContactQq(event, item)}
                                    title={`联系 QQ${item.contactQq}`}
                                    aria-label={`联系 QQ${item.contactQq}`}
                                >
                                    <span className="rh-key-field-link-text">联系 QQ</span>
                                </button>}
                            </div>
                            {active && <span className="rh-key-field-badge">当前使用</span>}
                        </div>
                        <RhSecureKeyField value={item.value} onValueChange={item.setValue} placeholder={item.placeholder} />
                        <div className="banana-fixed-route">固定地址：{item.route}</div>
                    </div>;
                })}
            </div>
            <button type="button" className="rh-settings-test-btn rh-account-refresh banana-query-btn" disabled={state.refreshing} onClick={actions.refresh}>{state.refreshing ? "查询中" : "查询余额并刷新模型"}</button>
        </div>
    </SettingsCard>;
}

export function BananaShell({ activeProduct = "banana", onChangeProduct, sharedSettings, onRunsChange, sharedTaskRuns, onDismissSharedRun, onRetrySharedPlace, onRegisterTaskActions }) {
    const { pushStatus } = sharedSettings;
    const [page, setPage] = useState("home");
    const [provider, setProvider] = usePersistedState("banana_provider", AJI);
    const [ajiApiKey, setAjiApiKey] = usePersistedState("banana_aji_api_key", "");
    const [grsApiKey, setGrsApiKey] = usePersistedState("banana_grs_api_key", "");
    const [models, setModels] = usePersistedState("banana_models", { [AJI]: BANANA_AJI_MODELS, [GRS]: BANANA_GRS_MODELS });
    const [modelByProvider, setModelByProvider] = usePersistedState("banana_model_by_provider", { [AJI]: "AJbanana3", [GRS]: "nano-banana-pro" });
    const [size, setSize] = usePersistedState("banana_size", "2K");
    const [concurrency, setConcurrency] = usePersistedState("banana_concurrency", 1);
    const [timeoutSec, setTimeoutSec] = usePersistedState("banana_timeout_sec", 600);
    const [prompt, setPrompt] = useState("");
    const [promptPresets, setPromptPresets] = useState([]);
    const [pendingUpload, setPendingUpload] = usePersistedState("banana_pending_upload", null);
    const [balanceByProvider, setBalanceByProvider] = usePersistedState("banana_balance_by_provider", { [AJI]: null, [GRS]: null });
    const [runs, setRuns] = useState([]);
    const [capturing, setCapturing] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [statusText, setStatusText] = useState("");
    const [activeEndpointByProvider, setActiveEndpointByProvider] = usePersistedState("banana_active_endpoint_by_provider", { [AJI]: "", [GRS]: "" });
    const [probeResult, setProbeResult] = useState(null);
    const cancelRefs = useRef({});
    const autoPlaceQueueRef = useRef(Promise.resolve());
    const { confirmCaptureSelection, warningDialog } = useSquareSelectionWarning(pushStatus);
    const isHome = page === "home";
    const config = useMemo(() => ({ provider, baseUrl: provider === GRS ? BANANA_GRS_ENDPOINT : BANANA_AJI_ENDPOINTS[0], apiKey: provider === GRS ? grsApiKey : ajiApiKey }), [provider, ajiApiKey, grsApiKey]);
    const normalizedPromptPresets = useMemo(() => (Array.isArray(promptPresets) ? promptPresets : []).filter((item) => item?.id && item?.name && item?.prompt), [promptPresets]);
    const updateRun = useCallback((id, patch) => setRuns((items) => items.map((item) => item.id === id ? { ...item, ...patch, elapsedSec: elapsedSeconds(item.startTime) } : item)), []);

    useEffect(() => { removeCompatLocalStorage("banana_prompt"); }, []);
    useEffect(() => {
        let alive = true;
        loadBananaPromptPresets()
            .then((items) => { if (alive) setPromptPresets(items); })
            .catch((error) => pushStatus(`提示词预设读取失败：${error?.message || error}`, 3500));
        return () => { alive = false; };
    }, [pushStatus]);
    useEffect(() => { onRunsChange?.(runs); }, [onRunsChange, runs]);
    useEffect(() => {
        const id = setInterval(() => setRuns((items) => items.map((run) => run.status === "running" ? { ...run, elapsedSec: elapsedSeconds(run.startTime) } : run)), 500);
        return () => clearInterval(id);
    }, []);
    useEffect(() => {
        const id = setInterval(() => setRuns((items) => pruneCompletedRhRuns(items)), 15000);
        return () => clearInterval(id);
    }, []);

    const showProbeResult = useCallback((result) => {
        const id = Date.now();
        setProbeResult({ ...result, id });
        setTimeout(() => {
            setProbeResult((current) => current?.id === id ? null : current);
        }, 1900);
    }, []);

    const refresh = useCallback(async () => {
        if (!String(config.apiKey || "").trim()) return pushStatus("请先在账户管理中填写 API Key", 3500);
        setRefreshing(true);
        try {
            let checkedConfig = config;
            try {
                const probe = await probeBananaProvider(config, { model: modelByProvider[provider] || "" });
                checkedConfig = { ...config, baseUrl: probe.baseUrl };
                setActiveEndpointByProvider((current) => ({ ...current, [provider]: probe.label || probe.baseUrl }));
                const result = { ok: true, latencyMs: probe.latencyMs, label: probe.label || probe.baseUrl };
                showProbeResult(result);
            } catch (error) {
                const result = { ok: false, latencyMs: error?.latencyMs, label: error?.baseUrl || provider };
                showProbeResult(result);
                throw error;
            }
            const [balanceResult, modelResult] = await Promise.allSettled([fetchBananaBalance(checkedConfig), fetchBananaModels(checkedConfig)]);
            if (balanceResult.status === "fulfilled") setBalanceByProvider((current) => ({ ...current, [provider]: balanceResult.value }));
            if (modelResult.status === "fulfilled") {
                const list = modelResult.value;
                setModels((current) => ({ ...current, [provider]: list }));
                setModelByProvider((current) => {
                    const currentModel = provider === AJI ? toBananaAjiBaseModel(current[provider]) : current[provider];
                    return { ...current, [provider]: currentModel && list.includes(currentModel) ? currentModel : list[0] || "" };
                });
            }
            const balanceError = balanceResult.reason?.message || String(balanceResult.reason || "未知错误");
            const modelError = modelResult.reason?.message || String(modelResult.reason || "未知错误");
            if (balanceResult.status === "fulfilled" && modelResult.status === "fulfilled") {
                pushStatus("余额和模型已刷新", 3000);
            } else if (balanceResult.status === "fulfilled") {
                pushStatus(`余额已刷新，模型刷新失败：${modelError}`, 6000);
            } else if (modelResult.status === "fulfilled") {
                pushStatus(`模型已刷新，余额查询失败：${balanceError}`, 6000);
            } else {
                throw new Error(`余额查询失败：${balanceError}；模型刷新失败：${modelError}`);
            }
        } catch (error) { pushStatus(`查询失败：${error?.message || error}`, 6000); }
        finally { setRefreshing(false); }
    }, [config, modelByProvider, provider, pushStatus, setActiveEndpointByProvider, setBalanceByProvider, setModelByProvider, setModels, showProbeResult]);

    const clearCapture = useCallback(() => {
        releaseUploadRecord(pendingUpload);
        setPendingUpload(null);
    }, [pendingUpload, setPendingUpload]);

    const savePromptPreset = useCallback(async (name) => {
        const presetName = String(name || "").trim();
        const presetPrompt = String(prompt || "").trim();
        if (!presetPrompt) return pushStatus("请先填写提示词", 2500);
        if (!presetName) return pushStatus("请先填写预设名称", 2500);
        const existing = normalizedPromptPresets.find((item) => item?.name === presetName);
        const next = { id: existing?.id || `banana_prompt_${Date.now()}`, name: presetName, prompt: presetPrompt, updatedAt: Date.now(), fileName: existing?.fileName };
        try {
            await saveBananaPromptPresetFile(next);
            setPromptPresets(await loadBananaPromptPresets());
        } catch (error) {
            pushStatus(`提示词预设保存失败：${error?.message || error}`, 4500);
            return false;
        }
        pushStatus(`已保存提示词预设：${presetName}`, 2500);
        return true;
    }, [normalizedPromptPresets, prompt, pushStatus]);

    const deletePromptPreset = useCallback(async (id) => {
        const preset = normalizedPromptPresets.find((item) => item?.id === id);
        try {
            await deleteBananaPromptPresetFile(preset);
            setPromptPresets(await loadBananaPromptPresets());
        } catch (error) {
            pushStatus(`提示词预设删除失败：${error?.message || error}`, 4500);
            return;
        }
        pushStatus("已删除提示词预设", 2200);
    }, [normalizedPromptPresets, pushStatus]);

    const capture = useCallback(async () => {
        if (capturing) return;
        const okay = await confirmCaptureSelection({ mode: "canvas", clearCapture, requireSelection: true });
        if (!okay) return;
        setCapturing(true);
        try {
            const item = uploadFromCapture(await captureBananaImage(sharedSettings.uploadLongEdgeMax, sharedSettings.uploadImageFormat), pendingUpload);
            if (!item) throw new Error("图像捕获失败");
            releaseUploadRecord(pendingUpload);
            setPendingUpload(item);
            pushStatus("图像已捕获", 2000);
        } catch (error) { pushStatus(`捕获失败：${error?.message || error}`, 5000); }
        finally { setCapturing(false); }
    }, [capturing, clearCapture, confirmCaptureSelection, pendingUpload, pushStatus, setPendingUpload, sharedSettings.uploadImageFormat, sharedSettings.uploadLongEdgeMax]);

    const enqueueAutoPlace = useCallback((savedFileNames, groupName, bounds, placeToken, docId, options = {}) => {
        const prev = autoPlaceQueueRef.current.catch(() => {});
        const next = prev.then(() => performAutoPlace(savedFileNames, groupName, bounds, placeToken, docId, { force: true, group: options.group !== false }));
        autoPlaceQueueRef.current = next.catch(() => {});
        return next;
    }, []);

    const run = useCallback(async () => {
        const fallbackModels = provider === GRS ? BANANA_GRS_MODELS : BANANA_AJI_MODELS;
        const storedModel = modelByProvider[provider] || fallbackModels[0] || "";
        const model = provider === AJI ? toBananaAjiBaseModel(storedModel) : storedModel;
        if (!String(config.apiKey || "").trim()) return pushStatus("请先在账户管理中填写 API Key", 3500);
        if (!model) return pushStatus("请先刷新并选择模型", 3500);
        if (submitting) return;
        let image = pendingUpload;
        if (!image?.base64 && !image?.uploadSessionId) {
            const okay = await confirmCaptureSelection({ mode: "canvas", clearCapture, requireSelection: true });
            if (!okay) return;
            setCapturing(true);
            try { image = uploadFromCapture(await captureBananaImage(sharedSettings.uploadLongEdgeMax, sharedSettings.uploadImageFormat), pendingUpload); }
            finally { setCapturing(false); }
            if (!image) return pushStatus("图像捕获失败", 4000);
            releaseUploadRecord(pendingUpload);
            setPendingUpload(image);
        }
        try {
            image = await materializeUploadRecord(image);
            setPendingUpload(image);
        } catch (error) {
            return pushStatus(`图像编码失败：${error?.message || error}`, 5000);
        }
        if (!image?.base64) return pushStatus("图像编码失败", 4000);
        const runId = `banana_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const total = Math.max(1, Math.min(8, Number(concurrency) || 1));
        const timeoutMs = Math.max(60, Number(timeoutSec) || 600) * 1000;
        const placeContext = normalizePlaceContext({ docId: image?.docId, bounds: image?.bounds }) || await recordPlaceContext();
        const promptSnapshot = String(prompt || "");
        const task = { model, size, prompt: promptSnapshot, timeoutMs };
        setPrompt("");
        cancelRefs.current[runId] = false;
        setSubmitting(true);
        setStatusText(total > 1 ? `并发执行中 0/${total}` : "正在提交");
        setRuns((items) => [...items, { id: runId, status: "running", progress: 5, stageText: "准备任务", startTime: Date.now(), elapsedSec: 0, provider, model, total, doneCount: 0, failedCount: 0, batchTotal: total, batchImageTotal: total, batchDone: 0, pendingUploads: { main: image } }]);
        try {
            const runConfig = await resolveBananaRunConfig(config, task);
            setActiveEndpointByProvider((current) => ({ ...current, [provider]: runConfig.endpointLabel || runConfig.baseUrl }));
            showProbeResult({ ok: true, latencyMs: runConfig.latencyMs, label: runConfig.endpointLabel || runConfig.baseUrl });
            updateRun(runId, { stageText: `线路 ${runConfig.endpointLabel || runConfig.baseUrl}`, progress: 10 });
            let settled = 0;
            const requests = Array.from({ length: total }, (_, index) => runBananaImage(runConfig, task, image)
                .then((urls) => ({ index, urls }), (error) => ({ index, error }))
                .then((result) => {
                    settled += 1;
                    updateRun(runId, { stageText: total > 1 ? `并发执行中 ${settled}/${total}` : "执行中", progress: Math.min(70, 12 + Math.round(settled * 48 / total)) });
                    setStatusText(total > 1 ? `并发执行中 ${settled}/${total}` : "执行中");
                    return result;
                }));
            const results = await Promise.all(requests);
            if (cancelRefs.current[runId]) throw new Error("已取消");
            updateRun(runId, { stageText: total > 1 ? "并发结束，统一保存回图" : "保存回图", progress: 74 });
            setStatusText(total > 1 ? "并发结束，统一回传" : "保存回图");
            const token = getEffectiveResultFolderToken(RESULT_WORKBENCH_BANANA);
            const folder = token ? await uxpFs.getEntryForPersistentToken(token) : await getTempResultFolder();
            const placeToken = token || folder?.token || null;
            if (!folder || !placeToken) throw new Error("无法访问回图缓存目录");
            const saved = [];
            let complete = 0;
            let failed = 0;
            for (const result of results) {
                if (cancelRefs.current[runId]) throw new Error("已取消");
                if (result.error) { failed += 1; updateRun(runId, { failedCount: failed, stageText: result.error?.message || "子任务失败" }); continue; }
                for (const url of result.urls) {
                    const file = await saveImageWithBounds(folder, url, saved.length + 1, { bounds: placeContext?.bounds ?? null, docId: placeContext?.docId ?? null, runningHubAppName: "Banana", resultSidecar: { platform: "banana", provider, model } });
                    saved.push(file.fileName);
                }
                complete += 1;
                notifyResultFilesChanged({ folderToken: placeToken });
                updateRun(runId, { progress: Math.min(92, 75 + Math.round(complete * 17 / total)), doneCount: complete, failedCount: failed, batchDone: saved.length, batchImageTotal: Math.max(total, saved.length), stageText: total > 1 ? `统一保存 ${complete}/${total}` : "保存回图" });
            }
            if (!saved.length) throw results.find((item) => item.error)?.error || new Error("没有成功返回图片");
            const autoReturn = readAutoReturnEnabled();
            const concurrentGroupOn = readConcurrentReturnGroupEnabled();
            let placePatch = { placeStatus: autoReturn ? "placed" : "pending", placeSavedFileNames: saved, placeToken, placeBounds: placeContext?.bounds ?? null, placeDocId: placeContext?.docId ?? null, placeGroupName: "Banana 生成", placeGroupEnabled: total > 1 ? concurrentGroupOn : true };
            if (autoReturn) {
                updateRun(runId, { stageText: "统一回传到 PS", progress: 95 });
                try { await enqueueAutoPlace(saved, "Banana 生成", placeContext?.bounds ?? null, placeToken, placeContext?.docId ?? null, { group: total > 1 ? concurrentGroupOn : true }); }
                catch (error) { placePatch = { ...placePatch, placeStatus: error?.canRetry ? "pending" : "failed", placeError: error?.reason || error?.message || String(error) }; }
            }
            updateRun(runId, { status: "success", progress: 100, doneCount: complete, failedCount: failed, batchDone: saved.length, batchImageTotal: Math.max(total, saved.length), stageText: failed ? `完成 ${complete}/${total}，部分失败` : "已完成", completedAt: Date.now(), ...placePatch });
            setStatusText(failed ? `完成 ${complete}/${total}，部分失败` : "已完成");
            playSound({ fileName: readSuccessSoundFile(sharedSettings.successSoundFile) });
            fetchBananaBalance(runConfig).then((value) => setBalanceByProvider((current) => ({ ...current, [provider]: value }))).catch(() => {});
        } catch (error) {
            const cancelled = cancelRefs.current[runId] === true || String(error?.message || "") === "已取消";
            updateRun(runId, { status: cancelled ? "cancelled" : "error", progress: 100, stageText: error?.message || String(error), completedAt: Date.now() });
            setStatusText(cancelled ? "已取消" : `运行失败：${error?.message || error}`);
            if (!cancelled) playSoundFail({ fileName: readFailSoundFile(sharedSettings.failSoundFile) });
        } finally {
            delete cancelRefs.current[runId];
            setSubmitting(false);
        }
    }, [clearCapture, concurrency, config, confirmCaptureSelection, enqueueAutoPlace, modelByProvider, pendingUpload, prompt, provider, pushStatus, setActiveEndpointByProvider, setBalanceByProvider, setPendingUpload, sharedSettings.failSoundFile, sharedSettings.successSoundFile, sharedSettings.uploadImageFormat, sharedSettings.uploadLongEdgeMax, showProbeResult, size, submitting, timeoutSec, updateRun]);

    const dismiss = useCallback((id) => {
        cancelRefs.current[id] = true;
        setRuns((items) => items.filter((item) => item.id !== id));
    }, []);
    const retryPlace = useCallback(async (id) => {
        const run = runs.find((item) => item.id === id);
        if (!run?.placeSavedFileNames?.length || !run.placeToken) return;
        try {
            await enqueueAutoPlace(run.placeSavedFileNames, run.placeGroupName || "Banana 生成", run.placeBounds, run.placeToken, run.placeDocId, { group: run.placeGroupEnabled !== false });
            updateRun(id, { placeStatus: "placed", placeError: null });
            pushStatus("贴回成功", 2500);
        } catch (error) { updateRun(id, { placeError: error?.reason || error?.message || String(error) }); pushStatus(`贴回失败：${error?.reason || error?.message || error}`, 5000); }
    }, [enqueueAutoPlace, pushStatus, runs, updateRun]);
    useEffect(() => onRegisterTaskActions?.({ dismiss, retryPlace }), [dismiss, onRegisterTaskActions, retryPlace]);

    const queueRuns = sharedTaskRuns || runs;
    const dismissQueue = useCallback((platform, id) => onDismissSharedRun ? onDismissSharedRun(platform, id) : dismiss(id), [dismiss, onDismissSharedRun]);
    const retryQueue = useCallback((platform, id) => onRetrySharedPlace ? onRetrySharedPlace(platform, id) : retryPlace(id), [onRetrySharedPlace, retryPlace]);
    const setModel = useCallback((value) => setModelByProvider((current) => ({ ...current, [provider]: provider === AJI ? toBananaAjiBaseModel(value) : value })), [provider, setModelByProvider]);
    const balanceDisplay = formatBananaBalance(provider, balanceByProvider[provider]);
    const endpointLabel = providerEndpointLabel(provider, { label: activeEndpointByProvider[provider] });
    const state = { provider, ajiApiKey, grsApiKey, models, modelByProvider, size, concurrency, timeoutSec, prompt, promptPresets: normalizedPromptPresets, pendingUpload, capturing, submitting, refreshing, statusText, progress: [...runs].reverse().find((run) => run.status === "running")?.progress || 0, queueRuns, balance: balanceDisplay, endpointLabel, probeResult };
    const actions = { setProvider, setAjiApiKey, setGrsApiKey, setModel, setSize, setConcurrency, setTimeoutSec, setPrompt, savePromptPreset, deletePromptPreset, refresh, capture, clearCapture, run, dismiss: dismissQueue, retryPlace: retryQueue, pushStatus };
    return <>
        {warningDialog}
        <BananaTopBar balance={state.balance} loading={refreshing} onRefresh={refresh} isSettingsOpen={!isHome} onToggleView={() => setPage((current) => current === "home" ? "settings" : "home")} />
        <div className="banana-home-panel" style={{ display: isHome ? "flex" : "none", flex: "0 0 auto", minHeight: 0, flexDirection: "column" }}><BananaHome state={state} actions={actions} /></div>
        <div style={{ display: isHome ? "none" : "block", flex: 1, minHeight: 0 }}><div className="forge-settings-wrap"><BananaAccountSettings state={state} actions={actions} /><ComfySettings props={sharedSettings} workbenchId={RESULT_WORKBENCH_BANANA} productLabel="Banana" /></div></div>
    </>;
}
