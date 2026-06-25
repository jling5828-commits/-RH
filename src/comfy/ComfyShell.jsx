import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { core, app } from "photoshop";
import { usePersistedState } from "../hooks/usePersistedState.js";
import {
    isInWebView,
    photoshop,
    storage as bridgeStorage,
    shell as bridgeShell,
    xiaoliangRhPeekUploadSessionRawBase64,
    xiaoliangRhReleaseUploadSession,
} from "../bridge/uxpBridge.js";
import { captureAll, computeRhPlaceContextBoundsSync } from "../components/ImageUpload/captureUtils.js";
import { useSquareSelectionWarning } from "../components/ImageUpload/SquareSelectionWarning.jsx";
import { CustomSelect } from "../components/CustomSelect.jsx";
import { EditableSliderValue } from "../components/EditableSliderValue.jsx";
import { RhImagePreviewField } from "../runninghub/ui/RhImagePreviewField.jsx";
import { RhParamAutoGrowTextarea } from "../runninghub/ui/RhParamAutoGrowTextarea.jsx";
import { SettingsCard } from "../components/settings/SettingsCard.jsx";
import { normalizeRhImageLongEdgeMax, RH_IMAGE_LONG_EDGE_OPTIONS } from "../runninghub/rhImageLongEdge.js";
import { buildRhUploadEstimate } from "../runninghub/rhUploadEstimate.js";
import {
    RH_PS_CAPTURE_JPEG_QUALITY,
    RH_PS_CAPTURE_UPLOAD_FORMAT,
    RH_UPLOAD_DEFAULT_LONG_EDGE,
    RH_UPLOAD_IMAGE_FORMAT_OPTIONS,
    base64ByteLength,
    normalizeRhUploadImageFormat,
    rhCaptureFileName,
    stripBase64FromDataUrl,
} from "../runninghub/ui/xlrhRhWorkPanelLogic.js";
import { saveImageWithBounds, getTempResultFolder, clearResultImageCache } from "../utils/imageSaver.js";
import { performAutoPlace } from "../utils/autoPlace.js";
import { notifyResultFilesChanged } from "../utils/resultFilesSync.js";
import {
    RESULT_FOLDER_STORAGE_CHANGED,
    RESULT_WORKBENCH_COMFY,
    clearOverrideResultFolderToken,
    getEffectiveResultFolderToken,
    hasWorkbenchFolderOverride,
    setOverrideResultFolderToken,
} from "../utils/resultFolderTokens.js";
import {
    PLACE_EDGE_FEATHER_CHANGED,
    notifyPlaceEdgeFeatherChanged,
    readPlaceEdgeFeatherEnabledFromStorage,
    readPlaceKeepSelectionFromStorage,
} from "../utils/placeEdgeFeatherOpts.js";
import { DEFAULT_FAIL_SOUND, DEFAULT_SUCCESS_SOUND, playSound, playSoundFail } from "../utils/playSound.js";
import {
    cancelComfyPrompt,
    ensureComfyReady,
    fetchComfyWorkflowJson,
    fetchComfyWorkflowList,
    fetchComfyObjectInfo,
    normalizeComfyBaseUrl,
    queueComfyPrompt,
    testComfyConnection,
    uploadComfyImage,
    waitForComfyImages,
} from "./comfyApi.js";
import {
    analyzeComfyPrompt,
    buildComfyPromptForRun,
    comfyRowKey,
    firstComfyImageMissing,
    initialComfyFieldValues,
    parseComfyWorkflowJson,
    randomizeComfyPromptSeeds,
    workflowOptionLabel,
} from "./comfyWorkflow.js";
import "../components/WorkPanel/WorkPanel.css";
import "../components/ImageUpload/ImageUpload.css";
import "../runninghub/ui/RhWorkPanel.css";
import "./ComfyShell.css";

const uxpStorage = require("uxp").storage;
const uxpShell = require("uxp").shell;
const uxpFs = uxpStorage.localFileSystem;

const COMFY_CLIENT_ID = `xlrh-comfy-${Date.now().toString(36)}`;
const COMFY_RUN_REPEAT_OPTIONS = [3, 6, 9];
const XIANGONGYUN_COMFY_IMAGE_URL = "https://www.xiangongyun.com/image/detail/26eefbcd-cc48-4372-b762-5d7140f20cc4?r=2B7Q6T";

function formatUploadLongEdgeLabel(value) {
    return Number(value) === 0 ? "原比例" : `${value}px`;
}

function formatCacheBytes(bytes) {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return "0 MB";
    if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function normalizePlaceContext(ctx) {
    const bounds = ctx?.bounds;
    const hasBounds = bounds && ["left", "top", "right", "bottom"].every((key) => typeof bounds[key] === "number");
    return hasBounds && ctx.docId != null ? { docId: ctx.docId, bounds } : null;
}

function plainComfyBounds(bounds) {
    if (!bounds || typeof bounds !== "object") return null;
    const left = Number(bounds.left);
    const top = Number(bounds.top);
    const right = Number(bounds.right);
    const bottom = Number(bounds.bottom);
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null;
    return { left, top, right, bottom };
}

function normalizeComfyDocId(value) {
    const docId = Number(value);
    return Number.isFinite(docId) ? docId : null;
}

function comfyPlaceContextFromUpload(record) {
    const bounds = plainComfyBounds(record?.captureBounds || record?.bounds);
    if (!bounds) return null;
    return { bounds, docId: normalizeComfyDocId(record?.captureDocId ?? record?.docId) };
}

function comfyRunFileName(fileName, runId, key) {
    const text = String(fileName || "comfy-capture.png").trim();
    const dot = text.lastIndexOf(".");
    const stem = dot > 0 ? text.slice(0, dot) : text;
    const ext = dot > 0 ? text.slice(dot) : ".png";
    const suffix = `${runId}_${String(key || "").replace(/[^a-zA-Z0-9_-]+/g, "_")}`.slice(0, 80);
    return `${stem}_${suffix}${ext}`;
}

function comfySafeRunSuffix(...parts) {
    return parts
        .map((part) => String(part || "").trim())
        .filter(Boolean)
        .join("_")
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .slice(0, 80);
}

function comfyResultFileSuffix(runId, itemIndex, imageIndex) {
    const shortRunId = String(runId || "").replace(/^comfy_/, "").slice(-24);
    return comfySafeRunSuffix(shortRunId, itemIndex, imageIndex).slice(0, 48);
}

function isComfyLinkedImageInput(name, value) {
    return /images?/i.test(String(name || "")) && Array.isArray(value) && value.length >= 2;
}

function isComfyOutputLikeNode(node) {
    const text = `${node?.class_type || ""} ${node?._meta?.title || ""}`;
    return /(preview.*image|save.*image|image.*save|output.*image|image.*output)/i.test(text);
}

function nextComfyPromptNodeId(prompt) {
    const ids = Object.keys(prompt || {}).map(Number).filter(Number.isFinite);
    return String((ids.length ? Math.max(...ids) : 0) + 1);
}

function isolateComfyOutputNames(prompt, suffix) {
    const safeSuffix = comfySafeRunSuffix(suffix);
    if (!safeSuffix) return { prompt, outputSuffix: "", outputNodeIds: [] };
    const imageLinks = [];
    for (const node of Object.values(prompt || {})) {
        const inputs = node.inputs && typeof node.inputs === "object" ? node.inputs : null;
        if (!inputs) continue;
        if (isComfyOutputLikeNode(node)) {
            for (const [name, value] of Object.entries(inputs)) {
                if (isComfyLinkedImageInput(name, value)) imageLinks.push(value);
            }
        }
    }
    const seen = new Set();
    const outputNodeIds = [];
    for (const link of imageLinks) {
        const key = JSON.stringify(link);
        if (seen.has(key)) continue;
        seen.add(key);
        const nodeId = nextComfyPromptNodeId(prompt);
        prompt[nodeId] = {
            class_type: "SaveImage",
            inputs: { images: link, filename_prefix: `xlrh_${safeSuffix}` },
            _meta: { title: "XLRH isolated output" },
        };
        outputNodeIds.push(nodeId);
    }
    return { prompt, outputSuffix: outputNodeIds.length > 0 ? safeSuffix : "", outputNodeIds };
}

function comfyResultImageName(image) {
    return String(image?.filename || image?.name || image?.url || "").trim();
}

function filterComfyResultBySuffix(result, suffix) {
    const safeSuffix = comfySafeRunSuffix(suffix);
    const urls = Array.isArray(result?.urls) ? result.urls : [];
    const images = Array.isArray(result?.images) ? result.images : [];
    if (!safeSuffix || images.length === 0) return result;
    const keptUrls = [];
    const keptImages = [];
    const keptRemoteUrls = [];
    const remoteUrls = Array.isArray(result?.remoteUrls) ? result.remoteUrls : [];
    for (let i = 0; i < images.length; i += 1) {
        const name = comfyResultImageName(images[i]);
        if (!name.includes(safeSuffix)) continue;
        if (urls[i]) keptUrls.push(urls[i]);
        keptImages.push(images[i]);
        if (remoteUrls[i]) keptRemoteUrls.push(remoteUrls[i]);
    }
    return { ...result, urls: keptUrls, images: keptImages, remoteUrls: keptRemoteUrls };
}

async function doComfyFullCapture(longEdgeMax, uploadImageFormat) {
    const max = normalizeRhImageLongEdgeMax(longEdgeMax);
    const format = normalizeRhUploadImageFormat(uploadImageFormat);
    const opts = { longEdgeMax: max, uploadEncodeFormat: format, jpegQuality: RH_PS_CAPTURE_JPEG_QUALITY, __retainUploadSession: true };
    if (isInWebView()) return captureAll("canvas", opts);
    let res;
    await core.executeAsModal(async (executionContext) => {
        const docId = app.activeDocument?.id;
        if (!docId) throw new Error("[NO_DOC]请先打开一个文档");
        const suspensionID = await executionContext.hostControl.suspendHistory({ documentID: docId, name: "Comfy UI capture" });
        try {
            res = await captureAll("canvas", opts);
        } finally {
            await executionContext.hostControl.resumeHistory(suspensionID);
        }
    }, { commandName: "Comfy UI 截取" });
    return res;
}

async function recordComfyPlaceContext() {
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
        }, { commandName: "Comfy UI 记录贴回上下文" });
    } catch (_) {}
    return box.value;
}

function uploadRecordFromCapture(capture, previousUpload, prefix, placeContext = null) {
    if (!capture?.uploadBase64 && !capture?.uploadSessionId) return null;
    const prior = previousUpload && typeof previousUpload === "object" ? previousUpload : {};
    const mimeType = capture.mimeType || prior.mimeType || "image/png";
    const bounds = plainComfyBounds(capture.bounds || placeContext?.bounds || prior.captureBounds);
    const docId = normalizeComfyDocId(capture.docId ?? placeContext?.docId ?? prior.captureDocId);
    const aspectRatio = bounds
        ? (bounds.right - bounds.left) / (bounds.bottom - bounds.top)
        : prior.aspectRatio;
    const common = {
        ...prior,
        fileName: rhCaptureFileName(prefix, mimeType),
        mimeType,
        previewBase64: capture.previewBase64 ?? prior.previewBase64,
        aspectRatio,
        uploadWidth: capture.uploadWidth ?? prior.uploadWidth,
        uploadHeight: capture.uploadHeight ?? prior.uploadHeight,
        uploadFormat: capture.uploadFormat ?? prior.uploadFormat,
        uploadByteLength: capture.uploadByteLength ?? prior.uploadByteLength,
        captureBounds: bounds ?? prior.captureBounds,
        captureDocId: docId ?? prior.captureDocId,
    };
    const sessionId = String(capture.uploadSessionId || "").trim();
    if (sessionId) return { ...common, uploadSessionId: sessionId, base64: "" };
    const base64 = stripBase64FromDataUrl(capture.uploadBase64);
    return { ...common, uploadSessionId: "", base64, uploadByteLength: capture.uploadByteLength ?? base64ByteLength(base64) };
}

function comfyWorkflowUploadId(workflowDetail, selectedWorkflowId) {
    return workflowDetail?.id || selectedWorkflowId || "";
}

function scopedComfyUpload(record, workflowId, workflowName, rowKey) {
    if (!record) return null;
    return { ...record, workflowId: workflowId || "", workflowName: workflowName || "", rowKey: rowKey || "" };
}

async function freezeComfyUploadRecord(record) {
    if (!record || typeof record !== "object") return record;
    const base64 = String(record.base64 || "").trim();
    if (base64) return { ...record, base64, uploadSessionId: "" };
    const sessionId = String(record.uploadSessionId || "").trim();
    if (!sessionId) return { ...record };
    const raw = await xiaoliangRhPeekUploadSessionRawBase64(sessionId);
    if (!raw?.ok || !raw.rawBase64) throw new Error(raw?.message || "捕获图缓存已失效，请重新捕获图像");
    return {
        ...record,
        base64: String(raw.rawBase64 || ""),
        uploadSessionId: "",
        mimeType: raw.mimeType || record.mimeType || "image/png",
        uploadByteLength: record.uploadByteLength || base64ByteLength(raw.rawBase64),
    };
}

async function materializeComfyCapture(capture) {
    const sessionId = String(capture?.uploadSessionId || "").trim();
    if (!sessionId) return capture;
    try {
        if (capture?.uploadBase64) return { ...capture, uploadSessionId: "" };
        const raw = await xiaoliangRhPeekUploadSessionRawBase64(sessionId);
        if (!raw?.ok || !raw.rawBase64) throw new Error(raw?.message || "捕获图缓存已失效，请重新捕获图像");
        const mimeType = raw.mimeType || capture.mimeType || "image/png";
        return {
            ...capture,
            uploadSessionId: "",
            uploadBase64: `data:${mimeType};base64,${raw.rawBase64}`,
            mimeType,
            uploadByteLength: capture.uploadByteLength || base64ByteLength(raw.rawBase64),
        };
    } finally {
        await xiaoliangRhReleaseUploadSession(sessionId).catch(() => {});
    }
}

async function freezeComfyUploadsForRun(pendingUploads) {
    const next = {};
    for (const [key, record] of Object.entries(pendingUploads || {})) {
        next[key] = await freezeComfyUploadRecord(record);
    }
    return next;
}

function shortTextHash(value) {
    const text = String(value || "");
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

function comfyUploadDebug(upload) {
    const base64 = String(upload?.base64 || "");
    return {
        fileName: upload?.fileName || "",
        mimeType: upload?.mimeType || "",
        base64Length: base64.length,
        base64Hash: shortTextHash(base64),
        uploadSessionId: upload?.uploadSessionId ? "[present]" : "",
        captureBounds: upload?.captureBounds || null,
        captureDocId: upload?.captureDocId ?? null,
    };
}

function comfyPromptImageInputDebug(prompt) {
    const rows = [];
    for (const [nodeId, node] of Object.entries(prompt || {})) {
        const inputs = node?.inputs && typeof node.inputs === "object" ? node.inputs : null;
        if (!inputs) continue;
        const classType = String(node?.class_type || "");
        for (const [fieldName, value] of Object.entries(inputs)) {
            if (Array.isArray(value)) continue;
            if (!/(load.*image|image)/i.test(`${classType} ${fieldName}`)) continue;
            rows.push({ nodeId, classType, fieldName, value: String(value ?? "") });
        }
    }
    return rows;
}

const COMFY_UPLOAD_KEY_DELIMITER = "@@xlrh@@";

function comfyUploadStorageKey(workflowId, rowKey) {
    const workflow = String(workflowId || "");
    const row = String(rowKey || "");
    return workflow ? `${workflow}${COMFY_UPLOAD_KEY_DELIMITER}${row}` : row;
}

function comfyUploadRowKey(storageKey, upload) {
    if (upload?.rowKey) return upload.rowKey;
    const key = String(storageKey || "");
    const at = key.indexOf(COMFY_UPLOAD_KEY_DELIMITER);
    return at >= 0 ? key.slice(at + COMFY_UPLOAD_KEY_DELIMITER.length) : key;
}

function filterComfyUploadsForWorkflow(pendingUploads, workflowId) {
    const next = {};
    const wanted = String(workflowId || "");
    for (const [key, upload] of Object.entries(pendingUploads || {})) {
        const scopedKey = String(key || "").includes(COMFY_UPLOAD_KEY_DELIMITER);
        const uploadWorkflowId = String(upload?.workflowId || "");
        if (wanted) {
            if (scopedKey && uploadWorkflowId === wanted) next[comfyUploadRowKey(key, upload)] = upload;
        } else if (!scopedKey && !uploadWorkflowId) {
            next[key] = upload;
        }
    }
    return next;
}

function buildComfyUploadEstimate(imageRows, pendingUploads) {
    const rows = (imageRows || []).map((row) => {
        const key = row?.key || comfyRowKey(row?.nodeId, row?.fieldName);
        const at = key.indexOf("::");
        return at >= 0 ? { ...row, nodeId: key.slice(0, at), fieldName: key.slice(at + 2), fieldType: "IMAGE" } : row;
    });
    return buildRhUploadEstimate(rows, pendingUploads || {});
}

function elapsedSeconds(startTime) {
    return (Date.now() - startTime) / 1000;
}

function normalizeComfyRepeatCount(value) {
    const count = Number(value);
    return COMFY_RUN_REPEAT_OPTIONS.includes(count) ? count : 1;
}

function clampComfySliderValue(value, row, min, max) {
    const parsed = row.fieldType === "INT" ? parseInt(value, 10) : parseFloat(value);
    if (!Number.isFinite(parsed)) return "";
    const lower = Number.isFinite(Number(min)) ? Number(min) : parsed;
    const upper = Number.isFinite(Number(max)) ? Number(max) : parsed;
    return Math.max(lower, Math.min(upper, parsed));
}

function comfyBatchProgressText(run) {
    const total = Number(run?.batchImageTotal || run?.batchTotal || 0);
    if (total <= 1) return "";
    return `返回 ${Number(run?.batchDone || 0)} 张/共 ${total} 张`;
}

function runStatusText(run) {
    if (!run) return "暂无任务";
    if (run.status === "running") return run.stageText || "运行中";
    if (run.status === "success") return run.placeStatus === "pending" ? "已完成 · 待返回" : "已完成";
    if (run.status === "cancelled") return "已取消";
    return "失败";
}

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
        <button
            type="button"
            className="icon-btn xlrh-product-mode-btn"
            onClick={() => onChange?.(target)}
            title={title}
            aria-label={title}
        >
            {label}
        </button>
    );
}

function ComfyTopBar({ activeProduct, onChangeProduct, isSettingsOpen, onToggleView, onRefresh }) {
    const [showHelpPopup, setShowHelpPopup] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const handleOpenXiangongyunUrl = useCallback(async (event) => {
        event.preventDefault();
        try {
            if (isInWebView()) await bridgeShell.openExternal(XIANGONGYUN_COMFY_IMAGE_URL);
            else if (typeof uxpShell.openExternal === "function") await uxpShell.openExternal(XIANGONGYUN_COMFY_IMAGE_URL);
            else await uxpShell.openPath(XIANGONGYUN_COMFY_IMAGE_URL);
        } catch (error) {
            console.warn("[xiaoliang-rh openExternal] failed:", error);
        }
    }, []);
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
            <div className="rh-balance-bar comfy-topbar">
                <div className="rh-balance-content comfy-topbar-left">
                    <img src="icons/eye.png" className="rh-balance-icon" alt="" />
                </div>
                <div className="rh-balance-bar-right">
                    <ProductModeButton activeProduct={activeProduct} onChange={onChangeProduct} />
                    <div className="icon-btn" onClick={handleRefresh} title="刷新工作流">
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
                    <div className="xl-popup-dialog rh-help-dialog" role="dialog" aria-modal="true" aria-label="Comfy UI 使用说明" onClick={(e) => e.stopPropagation()}>
                        <div className="xl-popup-icon rh-help-icon">?</div>
                        <div className="xl-popup-title">Comfy UI 使用说明</div>
                        <div className="xl-popup-body rh-help-body">
                            <p className="rh-help-intro">Comfy UI 模式用于连接你已经启动的 Comfy UI 服务，在 Photoshop 内提交工作流并保存生成结果。</p>
                            <div className="rh-help-section-title">基础流程</div>
                            <ol className="rh-help-list">
                                <li>
                                    <span>Comfy UI 云端推荐仙宫云的实例 </span>
                                    <button type="button" className="rh-help-link" onClick={handleOpenXiangongyunUrl}>{XIANGONGYUN_COMFY_IMAGE_URL}</button>
                                    <span>等待实例创建完成点击控制台【ComfyUI】 蓝色按钮进入界面，复制浏览器顶部的地址到插件即可链接。Comfy UI 本地地址则默认为 http://127.0.0.1:8188 的格式。</span>
                                </li>
                                <li>连接成功后插件会读取云端节点，并显示服务器工作流列表。</li>
                                <li>在捕获图像中点击图1获取当前 PS 图像；图2及更多图片按需单独捕获。</li>
                                <li>在参数设置中按需修改提示词、尺寸、seed、steps、cfg 等参数。</li>
                                <li>点击开始运行，插件会上传图片、提交工作流、等待结果并保存到回图缓存。</li>
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

function ComfyWorkflowSelect({ workflows, value, onChange, disabled }) {
    return (
        <div className={`comfy-workflow-select ${disabled ? "is-disabled" : ""}`}>
            <select className="comfy-select-input" value={value || ""} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
                <option value="">选择工作流</option>
                {workflows.map((item) => (
                    <option key={item.id} value={item.id}>{workflowOptionLabel(item)}</option>
                ))}
            </select>
            <span className="comfy-select-caret">▼</span>
        </div>
    );
}

function ComfyParamRow({ row, value, onChange }) {
    const name = row.description || row.fieldName;
    const numberValue = value === "" || value == null ? row.fieldValue || 0 : value;
    const numberStep = row.step ?? (row.fieldType === "INT" ? 1 : 0.01);
    const numberMin = row.min ?? 0;
    const numberMax = row.max ?? 100;
    if (row.fieldType === "BOOLEAN") {
        return (
            <div className="rh-param-row rh-param-row--numeric">
                <div className="rh-param-label-col"><span className="rh-param-name">{name}</span></div>
                <label className="rh-toggle comfy-param-toggle">
                    <input type="checkbox" checked={value === true || value === "true"} onChange={(e) => onChange(e.target.checked)} />
                    <span className="rh-toggle-slider" />
                </label>
            </div>
        );
    }
    if (row.fieldType === "LIST") {
        return (
            <div className="rh-param-row rh-param-row--list">
                <div className="rh-param-label-col"><span className="rh-param-name">{name}</span></div>
                <div className="rh-param-control-col rh-param-control-col--list">
                    <CustomSelect
                        label=" "
                        value={value ?? ""}
                        displayValue={value ?? ""}
                        options={row.options || []}
                        onChange={(next) => onChange(next)}
                        dropdownPlacement="down"
                        useDropdownPortal
                    />
                </div>
            </div>
        );
    }
    if (row.fieldType === "INT" || row.fieldType === "FLOAT") {
        return (
            <div className="rh-param-row rh-param-row--numeric rh-param-row--slider">
                <div className="rh-param-label-col"><span className="rh-param-name">{name}</span></div>
                <div className="rh-param-control-col rh-param-control-col--slider">
                    <div className="rh-param-slider-wrapper comfy-param-slider-wrapper">
                        <input
                            type="range"
                            min={numberMin}
                            max={numberMax}
                            step={numberStep}
                            value={numberValue}
                            onChange={(e) => onChange(row.fieldType === "INT" ? parseInt(e.target.value, 10) : parseFloat(e.target.value))}
                            className="xlrh-slider"
                        />
                        <EditableSliderValue
                            value={numberValue}
                            parseValue={(next) => clampComfySliderValue(next, row, numberMin, numberMax)}
                            onCommit={onChange}
                        />
                    </div>
                </div>
            </div>
        );
    }
    return (
        <div className="rh-param-row">
            <div className="rh-param-meta"><span className="rh-param-name">{name}</span></div>
            <RhParamAutoGrowTextarea className="rh-param-textarea rh-param-textarea-autogrow" value={value ?? ""} onChange={onChange} />
        </div>
    );
}

function ComfyHome({ state, actions }) {
    const latest = state.runs[state.runs.length - 1];
    const connected = state.comfyConnected;
    const statusText = state.connectError || (latest ? runStatusText(latest) : connected ? "已连接" : "请先连接 Comfy UI");
    const running = state.runs.some((run) => run.status === "running");
    const progress = latest?.status === "running" ? Number(latest.progress || 0) : 0;
    const lowerStatusText = latest || state.connectError ? statusText : (state.workflowMessage || statusText);
    return (
        <div className="rh-work comfy-work">
            <div className="rh-work-toolbar comfy-toolbar">
                <ComfyWorkflowSelect workflows={state.workflowList} value={state.selectedWorkflowId} onChange={actions.selectWorkflow} disabled={!connected} />
                <input
                    className="comfy-url-input"
                    value={state.comfyBaseUrl}
                    onChange={(e) => actions.setComfyBaseUrl(e.target.value)}
                    placeholder="http://127.0.0.1:8188"
                />
                <button type="button" className="rh-work-btn-primary comfy-connect-btn" onClick={actions.connect} disabled={state.connecting}>
                    {state.connecting ? "链接中" : "链接"}
                </button>
            </div>
            <div className="rh-run-section">
                <div className="comfy-run-wrap">
                    <button className={`rh-run-btn ${state.submitting ? "running" : ""}`} disabled={!connected || !state.workflowDetail || state.submitting} onClick={() => actions.run(1)}>
                        {state.submitting ? <span className="rh-run-btn-spinner" /> : <PlayIcon />}
                        {state.submitting ? "提交中..." : "开始运行"}
                    </button>
                    <div className="comfy-run-multipliers" aria-label="重复提交次数">
                        {COMFY_RUN_REPEAT_OPTIONS.map((count) => (
                            <button key={count} type="button" className="comfy-run-multiplier-btn" disabled={!connected || !state.workflowDetail || state.submitting} onClick={() => actions.run(count)}>
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
                <ComfyCaptureCard imageRows={state.imageRows} pendingUploads={state.pendingUploads} capturingImageKey={state.capturingImageKey} onCapture={actions.captureImage} onClear={actions.clearImage} />
                <ComfyParamCard paramRows={state.paramRows} fieldValues={state.fieldValues} setField={actions.setField} />
                <ComfyQueueCard runs={state.queueRuns} onDismiss={actions.dismissQueueRun} onRetryPlace={actions.retryQueuePlace} />
            </div>
        </div>
    );
}

function ComfyCaptureCard({ imageRows, pendingUploads, capturingImageKey, onCapture, onClear }) {
    const [open, setOpen] = useState(true);
    return (
        <div className={`xlrh-card rh-capture-card ${!open ? "is-collapsed" : ""}`}>
            <div className="card-header" onClick={() => setOpen((v) => !v)}>
                <span className="header-title"><span className="title-icon">📸</span>捕获图像</span>
                <div className={`collapse-arrow ${open ? "expanded" : "collapsed"}`}><span className="arrow-icon" /></div>
            </div>
            <div className={`card-content ${!open ? "collapsed" : ""}`}>
                {imageRows.length === 0 ? <p className="rh-field-empty">当前工作流暂无图片输入</p> : imageRows.map((row, index) => (
                    <RhImagePreviewField
                        key={row.key}
                        label={row.label ? `图${index + 1} · ${row.label}` : `图${index + 1}`}
                        pending={pendingUploads[row.key]}
                        busy={capturingImageKey === row.key}
                        onCapture={() => onCapture(row, index)}
                        onClear={() => onClear(row)}
                    />
                ))}
            </div>
        </div>
    );
}

function ComfyParamCard({ paramRows, fieldValues, setField }) {
    const [open, setOpen] = useState(true);
    return (
        <div className={`xlrh-card rh-param-card ${!open ? "is-collapsed" : ""}`}>
            <div className="card-header" onClick={() => setOpen((v) => !v)}>
                <span className="header-title"><span className="title-icon">⚙️</span>参数设置</span>
                <div className={`collapse-arrow ${open ? "expanded" : "collapsed"}`}><span className="arrow-icon" /></div>
            </div>
            <div className={`card-content ${!open ? "collapsed" : ""}`}>
                <div className="rh-param-card-stack"><div className="rh-work-fields rh-param-fields">
                    {paramRows.length === 0 ? <p className="rh-field-empty">暂无可识别参数</p> : paramRows.map((row, index) => (
                        <React.Fragment key={row.key}>
                            <ComfyParamRow row={row} value={fieldValues[row.key]} onChange={(value) => setField(row.key, value)} />
                            {index < paramRows.length - 1 && <div className="rh-param-divider" />}
                        </React.Fragment>
                    ))}
                </div></div>
            </div>
        </div>
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
    const ok = document.execCommand("copy");
    textarea.remove();
    if (!ok) throw new Error("copy failed");
}

function ComfyQueueCard({ runs, onDismiss, onRetryPlace }) {
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
                        const platform = run.platform === "runninghub" ? "runninghub" : run.platform === "forge" ? "forge" : "comfy";
                        const isRhRun = platform === "runninghub";
                        const isForgeRun = platform === "forge";
                        const platformLabel = isRhRun ? "RunningHub" : isForgeRun ? "Forge UI" : "Comfy UI";
                        const snap = run.snapshot && typeof run.snapshot === "object" ? run.snapshot : null;
                        const uploadsForPreview = isRhRun ? snap?.pendingUploads : run.pendingUploads;
                        const previewBase64 = Object.values(uploadsForPreview || {}).find((u) => u?.previewBase64)?.previewBase64;
                        const taskName = isRhRun ? (snap?.appMetaName || run.presetName || "RunningHub") : isForgeRun ? (run.presetName || "Forge UI") : (run.workflowName || "Comfy UI");
                        const submitTime = new Date(run.startTime);
                        const timeStr = `${submitTime.getHours().toString().padStart(2, "0")}:${submitTime.getMinutes().toString().padStart(2, "0")}`;
                        const elapsed = run.elapsedSec || 0;
                        const elapsedStr = elapsed < 60 ? `${elapsed.toFixed(1)}秒` : `${Math.floor(elapsed / 60)}分${Math.round(elapsed % 60)}秒`;
                        const statusClass = run.status === "running" ? "running" : run.status === "success" ? "success" : run.status === "cancelled" ? "warning" : "error";
                        const hasPendingPlace = run.placeStatus === "pending";
                        const uploadEstimate = run.uploadEstimate || snap?.uploadEstimate || "";
                        const errorList = Array.isArray(run.resultDetail?.errors) ? run.resultDetail.errors : [];
                        const detailLine = (run.status === "error" || run.status === "warning") ? String(errorList[0] || run.resultDetail?.message || run.message || "").trim() : "";
                        const statusText = run.status === "running" ? "运行中" : runStatusText(run);
                        const stageLine = detailLine || (run.stageText && run.stageText !== statusText ? run.stageText : "");
                        const batchLine = !isRhRun ? comfyBatchProgressText(run) : "";
                        const canCopyError = !isRhRun && (run.status === "error" || run.status === "warning") && stageLine;
                        const copyLabel = copyState.id === run.id && copyState.status ? copyState.status : "复制";
                        const handleCopyError = async (event) => {
                            event.stopPropagation();
                            try {
                                await copyTextToClipboard(stageLine);
                                setCopyState({ id: run.id, status: "已" });
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
                                    <div className="rh-task-progress">{statusText}{batchLine && <span className="rh-task-stage" title={batchLine}>{batchLine}</span>}{stageLine && <span className="rh-task-stage" title={stageLine}>{stageLine}</span>}{uploadEstimate && <span className="rh-task-upload-estimate" title={uploadEstimate}>上传 {uploadEstimate}</span>}</div>
                                </div>
                                <div className="rh-task-actions">
                                    {canCopyError && <button className="rh-task-copy" onClick={handleCopyError} title={stageLine}>{copyLabel}</button>}
                                    {hasPendingPlace && <button className="rh-task-retry" onClick={(e) => { e.stopPropagation(); onRetryPlace(run.id); }} title="贴回图片">↻</button>}
                                    <button className="rh-task-close" onClick={(e) => { e.stopPropagation(); onDismiss(run.id); }} title="关闭任务">×</button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export function ComfySettings({ props, workbenchId = RESULT_WORKBENCH_COMFY, productLabel = "Comfy" }) {
    const {
        pushStatus,
        rhAutoReturnEnabled,
        setRhAutoReturnEnabled,
        uploadLongEdgeMax,
        setUploadLongEdgeMax,
        uploadImageFormat,
        setUploadImageFormat,
        themeColorStart,
        setThemeColorStart,
        themeColorEnd,
        setThemeColorEnd,
        opacity,
        setOpacity,
        blur,
        setBlur,
        customBgEnabled,
        setCustomBgEnabled,
        customBgImage,
        setCustomBgImage,
        customBgOpacity,
        setCustomBgOpacity,
        customBgBlur,
        setCustomBgBlur,
        textColor,
        setTextColor,
        soundFileOptions,
        successSoundFile,
        setSuccessSoundFile,
        failSoundFile,
        setFailSoundFile,
        onOpenSoundFolder,
        onRefreshSoundFiles,
    } = props;
    const [placeEdgeFeatherEnabled, setPlaceEdgeFeatherEnabled] = useState(() => readPlaceEdgeFeatherEnabledFromStorage());
    const [placeKeepSelection, setPlaceKeepSelection] = useState(() => readPlaceKeepSelectionFromStorage());
    const [folderName, setFolderName] = useState("默认 image_cache");
    const [hasOverride, setHasOverride] = useState(false);
    const [clearStep, setClearStep] = useState(0);
    const [clearing, setClearing] = useState(false);
    const normalizedUploadLongEdgeMax = normalizeRhImageLongEdgeMax(uploadLongEdgeMax);
    const uploadLongEdgeIndex = Math.max(0, RH_IMAGE_LONG_EDGE_OPTIONS.findIndex((n) => n === normalizedUploadLongEdgeMax));
    const uploadImageFormatValue = normalizeRhUploadImageFormat(uploadImageFormat);
    const soundOptions = Array.isArray(soundFileOptions) && soundFileOptions.length ? soundFileOptions : [DEFAULT_SUCCESS_SOUND, DEFAULT_FAIL_SOUND];

    const refreshFolderName = useCallback(async () => {
        const token = getEffectiveResultFolderToken(workbenchId);
        setHasOverride(hasWorkbenchFolderOverride(workbenchId));
        if (!token) {
            setFolderName("默认 image_cache");
            return;
        }
        try {
            const folder = await uxpFs.getEntryForPersistentToken(token);
            setFolderName(folder?.name || "已选择回图文件夹");
        } catch (_) {
            setFolderName("目录失效，请重新选择");
        }
    }, [workbenchId]);

    useEffect(() => {
        refreshFolderName();
        const h = () => refreshFolderName();
        window.addEventListener(RESULT_FOLDER_STORAGE_CHANGED, h);
        return () => window.removeEventListener(RESULT_FOLDER_STORAGE_CHANGED, h);
    }, [refreshFolderName]);

    useEffect(() => {
        writeLocal("xlrh_place_edge_feather_enabled", String(placeEdgeFeatherEnabled));
    }, [placeEdgeFeatherEnabled]);
    useEffect(() => {
        writeLocal("xlrh_place_keep_selection", String(placeKeepSelection));
    }, [placeKeepSelection]);
    useEffect(() => {
        const handler = (e) => {
            if (e?.detail && typeof e.detail.enabled === "boolean") {
                setPlaceEdgeFeatherEnabled(e.detail.enabled);
            } else {
                setPlaceEdgeFeatherEnabled(readPlaceEdgeFeatherEnabledFromStorage());
            }
            if (e?.detail && typeof e.detail.keepSelection === "boolean") {
                setPlaceKeepSelection(e.detail.keepSelection);
            } else {
                setPlaceKeepSelection(readPlaceKeepSelectionFromStorage());
            }
        };
        window.addEventListener(PLACE_EDGE_FEATHER_CHANGED, handler);
        return () => window.removeEventListener(PLACE_EDGE_FEATHER_CHANGED, handler);
    }, []);

    const handleChooseFolder = useCallback(async () => {
        try {
            const folder = await uxpFs.getFolder();
            if (!folder) return;
            const token = await uxpFs.createPersistentToken(folder);
            setOverrideResultFolderToken(workbenchId, token);
            setFolderName(folder.name || "已选择回图文件夹");
            setHasOverride(true);
            pushStatus(`${productLabel} 回图文件夹已设置：${folder.name || "已选择文件夹"}`, 3000);
        } catch (error) {
            pushStatus(`选择回图文件夹失败：${error?.message || error}`, 5000);
        }
    }, [productLabel, pushStatus, workbenchId]);

    const handleDefaultFolder = useCallback(() => {
        clearOverrideResultFolderToken(workbenchId);
        setHasOverride(false);
        refreshFolderName();
        pushStatus(`${productLabel} 已切换为默认回图缓存`, 3000);
    }, [productLabel, pushStatus, refreshFolderName, workbenchId]);

    const handleOpenCache = useCallback(async () => {
        try {
            if (isInWebView()) {
                await bridgeStorage.localFileSystem.openResultImageCacheFolder();
                pushStatus("已请求打开回图缓存", 3000);
                return;
            }
            const folder = await getTempResultFolder();
            if (!folder?.nativePath) throw new Error("无法获取缓存路径");
            await uxpShell.openPath(folder.nativePath);
            pushStatus("已请求打开回图缓存", 3000);
        } catch (error) {
            pushStatus(`打开回图缓存失败：${error?.message || error}`, 5000);
        }
    }, [pushStatus]);

    const handleClearCacheConfirm = useCallback(async () => {
        if (clearing) return;
        if (clearStep < 3) {
            setClearStep((n) => Math.min(3, n + 1));
            return;
        }
        setClearing(true);
        try {
            const res = isInWebView() ? await bridgeStorage.localFileSystem.clearResultImageCache() : await clearResultImageCache();
            setClearStep(0);
            pushStatus(`回图缓存已删除：${res?.files || 0} 个文件 / ${formatCacheBytes(res?.bytes || 0)}`, 6000);
        } catch (error) {
            pushStatus(`清理回图缓存失败：${error?.message || error}`, 6000);
        } finally {
            setClearing(false);
        }
    }, [clearStep, clearing, pushStatus]);

    const handleCustomBgImageSelect = useCallback(() => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                setCustomBgImage(event.target.result);
                setCustomBgEnabled(true);
            };
            reader.readAsDataURL(file);
        };
        input.click();
    }, [setCustomBgEnabled, setCustomBgImage]);

    return (
        <div className="rh-settings-wrap settings-container comfy-settings-wrap">
            <SettingsCard cardClass="rh-interaction-card" icon="⚡" title="交互" defaultOpen>
                <div className="rh-interaction-content"><div className="rh-interaction-section">
                    <div className="rh-interaction-section-title">回图贴入</div>
                    <div className="rh-interaction-row">
                        <label className="rh-interaction-label"><span>自动回传</span><span className="rh-interaction-desc">{rhAutoReturnEnabled !== false && rhAutoReturnEnabled !== "false" ? "任务完成后自动贴回 PS" : "关闭后停在任务队列等待手动贴回"}</span></label>
                        <label className="rh-toggle"><input type="checkbox" checked={rhAutoReturnEnabled !== false && rhAutoReturnEnabled !== "false"} onChange={(e) => setRhAutoReturnEnabled(e.target.checked)} /><span className="rh-toggle-slider" /></label>
                    </div>
                    <div className="rh-interaction-row rh-upload-setting-row"><div className="rh-upload-setting-block">
                        <div className="rh-upload-setting-head"><label className="rh-interaction-label"><span>上传长边</span><span className="rh-interaction-desc">截图上传前按长边压到指定尺寸</span></label><span className="rh-upload-setting-value">{formatUploadLongEdgeLabel(normalizedUploadLongEdgeMax)}</span></div>
                        <input className="rh-upload-setting-slider" type="range" min="0" max={RH_IMAGE_LONG_EDGE_OPTIONS.length - 1} step="1" value={uploadLongEdgeIndex} onChange={(e) => setUploadLongEdgeMax(RH_IMAGE_LONG_EDGE_OPTIONS[Math.max(0, Math.min(RH_IMAGE_LONG_EDGE_OPTIONS.length - 1, Number(e.target.value) || 0))])} />
                        <div className="rh-longedge-marks">{RH_IMAGE_LONG_EDGE_OPTIONS.map((n) => <span key={n} className={`rh-longedge-mark ${n === normalizedUploadLongEdgeMax ? "active" : ""}`}>{formatUploadLongEdgeLabel(n)}</span>)}</div>
                    </div></div>
                    <div className="rh-interaction-row rh-upload-format-row">
                        <label className="rh-interaction-label"><span>上传图片格式</span><span className="rh-interaction-desc">当前 {uploadImageFormatValue === "png" ? "PNG" : "JPG"}</span></label>
                        <div className="rh-interaction-tone-switch rh-upload-format-switch">{RH_UPLOAD_IMAGE_FORMAT_OPTIONS.map((item) => <button key={item.value} type="button" className={`rh-interaction-tone-btn ${uploadImageFormatValue === item.value ? "active" : ""}`} onClick={() => setUploadImageFormat(item.value)}>{item.label}</button>)}</div>
                    </div>
                    <div className="rh-interaction-row rh-sound-row">
                        <label className="rh-interaction-label"><span>回图成功音效</span><span className="rh-interaction-desc">{successSoundFile}</span></label>
                        <select className="rh-sound-select" value={successSoundFile} onFocus={onRefreshSoundFiles} onChange={(e) => setSuccessSoundFile(e.target.value)}>
                            {soundOptions.map((name) => <option key={`ok-${name}`} value={name}>{name}</option>)}
                        </select>
                    </div>
                    <div className="rh-interaction-row rh-sound-row">
                        <label className="rh-interaction-label"><span>回图失败音效</span><span className="rh-interaction-desc">{failSoundFile}</span></label>
                        <select className="rh-sound-select" value={failSoundFile} onFocus={onRefreshSoundFiles} onChange={(e) => setFailSoundFile(e.target.value)}>
                            {soundOptions.map((name) => <option key={`fail-${name}`} value={name}>{name}</option>)}
                        </select>
                    </div>
                    <div className="rh-interaction-row rh-result-folder-row">
                        <label className="rh-interaction-label"><span>语音文件夹</span><span className="rh-interaction-desc">插件安装目录 / voices</span></label>
                        <div className="rh-folder-actions"><button type="button" className="rh-folder-btn rh-folder-btn-muted rh-folder-btn-open" onClick={onOpenSoundFolder}>打开</button></div>
                    </div>
                    <div className="rh-interaction-row rh-result-folder-row">
                        <label className="rh-interaction-label"><span>回图文件夹</span><span className="rh-interaction-desc">{hasOverride ? folderName : "默认 PluginData / image_cache"}</span></label>
                        <div className="rh-folder-actions"><button type="button" className="rh-folder-btn" onClick={handleChooseFolder}>选择</button><button type="button" className="rh-folder-btn rh-folder-btn-muted" onClick={handleDefaultFolder}>默认</button></div>
                    </div>
                    <div className="rh-interaction-row rh-result-folder-row">
                        <label className="rh-interaction-label"><span>回图缓存</span><span className="rh-interaction-desc">默认 image_cache，可打开查看或清空</span></label>
                        <div className="rh-folder-actions"><button type="button" className="rh-folder-btn rh-folder-btn-muted" onClick={handleOpenCache}>打开</button><button type="button" className="rh-folder-btn rh-folder-btn-danger" onClick={() => setClearStep(1)} disabled={clearing}>{clearing ? "清理中" : "清空"}</button></div>
                    </div>
                    <div className="rh-interaction-row">
                        <label className="rh-interaction-label"><span>边缘软边</span><span className="rh-interaction-desc">贴入返图时自动添加渐变蒙版</span></label>
                        <label className="rh-toggle"><input type="checkbox" checked={placeEdgeFeatherEnabled} onChange={(e) => { setPlaceEdgeFeatherEnabled(e.target.checked); notifyPlaceEdgeFeatherChanged({ enabled: e.target.checked }); }} /><span className="rh-toggle-slider" /></label>
                    </div>
                    <div className="rh-interaction-row">
                        <label className="rh-interaction-label"><span>保留选区</span><span className="rh-interaction-desc">贴入完成后恢复矩形选区</span></label>
                        <label className="rh-toggle"><input type="checkbox" checked={placeKeepSelection} onChange={(e) => { setPlaceKeepSelection(e.target.checked); notifyPlaceEdgeFeatherChanged({ keepSelection: e.target.checked }); }} /><span className="rh-toggle-slider" /></label>
                    </div>
                </div></div>
            </SettingsCard>

            <SettingsCard cardClass="rh-personalization-card" icon="🎨" title="个性化" defaultOpen>
                <div className="rh-personalization-content">
                    <div className="rh-personalization-section"><div className="rh-personalization-section-title">自定义背景</div>
                        <div className="rh-personalization-bg-toggle"><label className="rh-toggle"><input type="checkbox" checked={customBgEnabled} onChange={(e) => setCustomBgEnabled(e.target.checked)} /><span className="rh-toggle-slider" /></label><span className="rh-personalization-bg-label">启用自定义背景</span></div>
                        {customBgEnabled && <div className="rh-personalization-bg-preview-wrapper">{customBgImage ? <div className="rh-personalization-bg-preview"><img src={customBgImage} alt="背景预览" /><button className="rh-personalization-bg-clear" onClick={() => { setCustomBgImage(""); setCustomBgEnabled(false); }}>×</button></div> : <button className="rh-personalization-bg-select" onClick={handleCustomBgImageSelect}><span>选择图片</span></button>}</div>}
                        {customBgEnabled && customBgImage && <><div className="rh-personalization-slider-item"><label>背景透明度: {Math.round(customBgOpacity * 100)}%</label><input type="range" min="0.05" max="1" step="0.05" value={customBgOpacity} onChange={(e) => setCustomBgOpacity(parseFloat(e.target.value))} className="xlrh-slider" /></div><div className="rh-personalization-slider-item"><label>背景模糊: {customBgBlur}px</label><input type="range" min="0" max="20" step="1" value={customBgBlur} onChange={(e) => setCustomBgBlur(parseInt(e.target.value, 10))} className="xlrh-slider" /></div></>}
                    </div>
                    <div className="rh-personalization-section"><div className="rh-personalization-section-title">主渐变</div><div className="rh-personalization-color-row"><div className="rh-personalization-color-item"><label>起始颜色</label><input type="color" value={themeColorStart} onChange={(e) => setThemeColorStart(e.target.value)} className="rh-color-picker" /></div><div className="rh-personalization-color-item"><label>结束颜色</label><input type="color" value={themeColorEnd} onChange={(e) => setThemeColorEnd(e.target.value)} className="rh-color-picker" /></div></div></div>
                    <div className="rh-personalization-section"><div className="rh-personalization-section-title">字体颜色</div><input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="rh-color-picker" /></div>
                    <div className="rh-personalization-section"><div className="rh-personalization-section-title">玻璃效果</div><div className="rh-personalization-slider-item"><label>透明度: {Math.round(opacity * 100)}%</label><input type="range" min="0" max="1" step="0.05" value={opacity} onChange={(e) => setOpacity(parseFloat(e.target.value))} className="xlrh-slider" /></div><div className="rh-personalization-slider-item"><label>模糊程度: {blur}px</label><input type="range" min="0" max="30" step="1" value={blur} onChange={(e) => setBlur(parseInt(e.target.value, 10))} className="xlrh-slider" /></div></div>
                </div>
            </SettingsCard>

            {clearStep > 0 && (
                <div className="xl-popup-overlay" onClick={() => !clearing && setClearStep(0)}>
                    <div className="xl-popup-dialog xl-popup-dialog-danger" onClick={(e) => e.stopPropagation()}>
                        <div className="xl-popup-icon">!</div><div className="xl-popup-title">确认清空回图缓存 {clearStep}/3</div><div className="xl-popup-body"><div className="xl-danger-note">第三次确认后才会执行。</div></div>
                        <div className="xl-popup-actions"><button className="xl-btn xl-btn-secondary" onClick={() => setClearStep(0)} disabled={clearing}>取消</button><button className={`xl-btn xl-btn-danger ${clearing ? "is-loading" : ""}`} onClick={handleClearCacheConfirm} disabled={clearing}>{clearStep >= 3 ? "第三次确认并清理" : "继续确认"}</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}

function writeLocal(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (_) {}
}

export function ComfyShell({
    activeProduct,
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
    const [currentPage, setCurrentPage] = useState("home");
    const [comfyBaseUrl, setComfyBaseUrl] = usePersistedState("comfy_base_url", "http://127.0.0.1:8188");
    const [comfyConnected, setComfyConnected] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [connectError, setConnectError] = useState("");
    const [serverWorkflows, setServerWorkflows] = useState([]);
    const [objectInfo, setObjectInfo] = useState(null);
    const [selectedWorkflowId, setSelectedWorkflowId] = usePersistedState("comfy_selected_workflow_id", "");
    const [workflowDetail, setWorkflowDetail] = useState(null);
    const [workflowMessage, setWorkflowMessage] = useState("");
    const [fieldValues, setFieldValues] = usePersistedState("comfy_field_values", {});
    const [pendingUploads, setPendingUploads] = usePersistedState("comfy_pending_uploads", {});
    const [capturingImageKey, setCapturingImageKey] = useState("");
    const [runs, setRuns] = useState([]);
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    const pendingUploadsRef = useRef(pendingUploads || {});
    const runAbortRefs = useRef({});
    const runCancelRefs = useRef({});
    const autoPlaceQueueRef = useRef(Promise.resolve());
    const workflowLoadSeqRef = useRef(0);
    const selectedWorkflowIdRef = useRef(selectedWorkflowId || "");
    const loadingWorkflowIdRef = useRef("");

    const workflowList = useMemo(() => serverWorkflows, [serverWorkflows]);
    const imageRows = useMemo(() => workflowDetail?.imageRows || [], [workflowDetail]);
    const paramRows = useMemo(() => workflowDetail?.paramRows || [], [workflowDetail]);
    const workflowUploadId = comfyWorkflowUploadId(workflowDetail, selectedWorkflowId);
    const activePendingUploads = useMemo(
        () => filterComfyUploadsForWorkflow(pendingUploads, workflowUploadId),
        [pendingUploads, workflowUploadId]
    );
    const hasRunningRuns = useMemo(() => runs.some((run) => run.status === "running"), [runs]);
    const taskRunsForQueue = Array.isArray(sharedTaskRuns) ? sharedTaskRuns : runs;

    const updateRun = useCallback((runId, patch) => {
        setRuns((prev) => prev.map((run) => (run.id === runId ? { ...run, ...patch } : run)));
    }, []);

    useEffect(() => {
        pendingUploadsRef.current = pendingUploads || {};
    }, [pendingUploads]);

    useEffect(() => {
        if (!hasRunningRuns) return undefined;
        const timer = setInterval(() => {
            setRuns((prev) => prev.map((run) => run.status === "running" ? { ...run, elapsedSec: elapsedSeconds(run.startTime) } : run));
        }, 150);
        return () => clearInterval(timer);
    }, [hasRunningRuns]);

    useEffect(() => {
        if (typeof onRunsChange === "function") onRunsChange(runs);
    }, [runs, onRunsChange]);

    useEffect(() => {
        selectedWorkflowIdRef.current = selectedWorkflowId || "";
    }, [selectedWorkflowId]);

    const buildWorkflowDetail = useCallback((raw, item, values, objectInfoOverride = objectInfo) => {
        const parsed = parseComfyWorkflowJson(raw, item?.name, objectInfoOverride, values || {});
        const analyzed = analyzeComfyPrompt(parsed.prompt, objectInfoOverride, parsed.selectorRows);
        return { id: item?.id || "", name: parsed.name || item?.name, prompt: parsed.prompt, raw: parsed.raw, ...analyzed };
    }, [objectInfo]);

    const loadWorkflowByItem = useCallback(async (item) => {
        const loadSeq = ++workflowLoadSeqRef.current;
        if (!item) {
            loadingWorkflowIdRef.current = "";
            setWorkflowDetail(null);
            setFieldValues({});
            return;
        }
        const itemId = item.id || "";
        loadingWorkflowIdRef.current = itemId;
        try {
            setWorkflowDetail(null);
            setFieldValues({});
            setWorkflowMessage("正在读取工作流...");
            const raw = await fetchComfyWorkflowJson(comfyBaseUrl, item.path);
            if (loadSeq !== workflowLoadSeqRef.current || selectedWorkflowIdRef.current !== itemId) return;
            loadingWorkflowIdRef.current = "";
            const detail = buildWorkflowDetail(raw, item, fieldValues);
            setWorkflowDetail(detail);
            setFieldValues(initialComfyFieldValues(detail.paramRows));
            setWorkflowMessage(`已加载：${detail.name}`);
            pushStatus(`已加载 Comfy 工作流：${detail.name}`, 3000);
        } catch (error) {
            if (loadSeq !== workflowLoadSeqRef.current || selectedWorkflowIdRef.current !== itemId) return;
            loadingWorkflowIdRef.current = "";
            const msg = error?.message || String(error);
            setWorkflowDetail(null);
            setWorkflowMessage(msg);
            pushStatus(`读取工作流失败：${msg}`, 6000);
        }
    }, [buildWorkflowDetail, comfyBaseUrl, fieldValues, pushStatus, setFieldValues]);

    const refreshCloudData = useCallback(async (baseUrlOverride) => {
        const targetBaseUrl = baseUrlOverride || comfyBaseUrl;
        if (!normalizeComfyBaseUrl(targetBaseUrl)) {
            setWorkflowMessage("请先填写 Comfy UI 地址");
            return null;
        }
        let nodeCount = 0;
        let nextObjectInfo = null;
        try {
            const info = await fetchComfyObjectInfo(targetBaseUrl);
            nextObjectInfo = info || null;
            setObjectInfo(nextObjectInfo);
            nodeCount = Object.keys(nextObjectInfo || {}).length;
            pushStatus(`已读取 Comfy 云端节点：${nodeCount} 个`, 3000);
        } catch (error) {
            setObjectInfo(null);
            pushStatus(`读取 Comfy 云端节点失败：${error?.message || error}`, 6000);
        }
        try {
            const res = await fetchComfyWorkflowList(targetBaseUrl);
            const workflows = res.workflows || [];
            setServerWorkflows(workflows);
            const nodeLine = nodeCount > 0 ? ` · 云端节点 ${nodeCount} 个` : "";
            setWorkflowMessage(res.ok ? `服务器工作流 ${workflows.length} 个${nodeLine}` : `未读取到服务器工作流${nodeLine}`);
            if (!res.ok && res.message) pushStatus(`工作流列表读取失败：${res.message}`, 5000);
            return { objectInfo: nextObjectInfo, workflows };
        } catch (error) {
            setWorkflowMessage(nodeCount > 0 ? `未读取到服务器工作流 · 云端节点 ${nodeCount} 个` : "未读取到服务器工作流");
            pushStatus(`刷新工作流失败：${error?.message || error}`, 5000);
            return { objectInfo: nextObjectInfo, workflows: [] };
        }
    }, [comfyBaseUrl, pushStatus]);

    const refreshCloudDataAndDefaults = useCallback(async () => {
        const cloud = await refreshCloudData();
        const baseUrl = normalizeComfyBaseUrl(comfyBaseUrl);
        if (!baseUrl || !selectedWorkflowId) return;
        const workflows = cloud?.workflows?.length ? cloud.workflows : workflowList;
        const item = workflows.find((w) => w.id === selectedWorkflowId) || workflowDetail;
        if (!item?.path) return;
        try {
            setWorkflowMessage("正在刷新工作流默认参数...");
            const raw = await fetchComfyWorkflowJson(baseUrl, item.path);
            const detail = buildWorkflowDetail(raw, item, {}, cloud?.objectInfo ?? objectInfo);
            setWorkflowDetail(detail);
            setFieldValues(initialComfyFieldValues(detail.paramRows));
            setWorkflowMessage(`已刷新默认参数：${detail.name}`);
            pushStatus(`已刷新默认参数：${detail.name}`, 3000);
        } catch (error) {
            const msg = error?.message || String(error);
            setWorkflowMessage(msg);
            pushStatus(`刷新默认参数失败：${msg}`, 6000);
        }
    }, [buildWorkflowDetail, comfyBaseUrl, objectInfo, pushStatus, refreshCloudData, selectedWorkflowId, setFieldValues, workflowDetail, workflowList]);

    const connect = useCallback(async () => {
        setConnecting(true);
        setConnectError("");
        try {
            const res = await testComfyConnection(comfyBaseUrl);
            setComfyBaseUrl(res.baseUrl);
            setComfyConnected(true);
            pushStatus(`Comfy UI 已连接：${res.baseUrl}`, 3000);
            await refreshCloudData(res.baseUrl);
        } catch (error) {
            const msg = error?.message || String(error);
            setComfyConnected(false);
            setConnectError(`连接失败：${msg}`);
            pushStatus(`Comfy UI 连接失败：${msg}`, 6000);
        } finally {
            setConnecting(false);
        }
    }, [comfyBaseUrl, pushStatus, refreshCloudData, setComfyBaseUrl]);

    const selectWorkflow = useCallback((id) => {
        const nextId = id || "";
        selectedWorkflowIdRef.current = nextId;
        setSelectedWorkflowId(nextId);
        const item = workflowList.find((w) => w.id === id);
        void loadWorkflowByItem(item || null);
    }, [loadWorkflowByItem, setSelectedWorkflowId, workflowList]);

    useEffect(() => {
        if (!comfyConnected || !selectedWorkflowId || workflowDetail?.id === selectedWorkflowId) return;
        if (loadingWorkflowIdRef.current === selectedWorkflowId) return;
        const item = workflowList.find((w) => w.id === selectedWorkflowId);
        if (item) void loadWorkflowByItem(item);
    }, [comfyConnected, selectedWorkflowId, workflowList, workflowDetail?.id, loadWorkflowByItem]);

    useEffect(() => {
        if (!objectInfo || !workflowDetail?.raw) return;
        const detail = buildWorkflowDetail(workflowDetail.raw, workflowDetail, fieldValues);
        setWorkflowDetail((prev) => (prev?.id === workflowDetail.id ? detail : prev));
        setFieldValues((prev) => {
            const next = initialComfyFieldValues(detail.paramRows);
            for (const key of Object.keys(next)) {
                if (Object.prototype.hasOwnProperty.call(prev || {}, key)) next[key] = prev[key];
            }
            return next;
        });
    }, [buildWorkflowDetail, objectInfo, workflowDetail?.id, workflowDetail?.raw, setFieldValues]);

    const setField = useCallback((key, value) => {
        const row = paramRows.find((item) => item.key === key);
        const next = { ...fieldValues };
        if (row?.comfyControl === "RGTHREE_GROUP_TOGGLE" && /^(max one|always one)$/i.test(String(row.toggleRestriction || "").trim()) && value) {
            for (const item of paramRows) {
                if (item.nodeId === row.nodeId && item.comfyControl === "RGTHREE_GROUP_TOGGLE") next[item.key] = false;
            }
        }
        next[key] = value;
        if (workflowDetail?.raw && row?.comfyControl) {
            const detail = buildWorkflowDetail(workflowDetail.raw, workflowDetail, next);
            setWorkflowDetail(detail);
            setFieldValues({ ...initialComfyFieldValues(detail.paramRows), ...next });
            return;
        }
        setFieldValues(next);
    }, [buildWorkflowDetail, fieldValues, paramRows, setFieldValues, workflowDetail]);

    const saveCapture = useCallback((key, capture, prefix, placeContext = null) => {
        const currentUploads = filterComfyUploadsForWorkflow(pendingUploadsRef.current, workflowUploadId);
        const record = scopedComfyUpload(
            uploadRecordFromCapture(capture, currentUploads[key], prefix, placeContext),
            workflowUploadId,
            workflowDetail?.name,
            key
        );
        if (!record) return false;
        const storageKey = comfyUploadStorageKey(workflowUploadId, key);
        setPendingUploads((prev) => {
            const next = { ...prev, [storageKey]: record };
            if (storageKey !== key) delete next[key];
            pendingUploadsRef.current = next;
            return next;
        });
        return true;
    }, [setPendingUploads, workflowDetail?.name, workflowUploadId]);

    const clearImageByKey = useCallback((key) => {
        const storageKey = comfyUploadStorageKey(workflowUploadId, key);
        setPendingUploads((prev) => {
            const next = { ...prev };
            delete next[storageKey];
            if (storageKey !== key) delete next[key];
            pendingUploadsRef.current = next;
            return next;
        });
    }, [setPendingUploads, workflowUploadId]);

    const captureImage = useCallback(async (row, index) => {
        const key = row.key || comfyRowKey(row.nodeId, row.fieldName);
        const label = `图${index + 1}`;
        const shouldCapture = await confirmCaptureSelection({ mode: "canvas", clearCapture: () => clearImageByKey(key) });
        if (!shouldCapture) return;
        setCapturingImageKey(key);
        try {
            pushStatus(`${label} 正在捕获图像...`, 0);
            const placeContext = await recordComfyPlaceContext();
            const capture = await doComfyFullCapture(sharedSettings.uploadLongEdgeMax, sharedSettings.uploadImageFormat);
            const frozenCapture = await materializeComfyCapture(capture);
            pushStatus(saveCapture(key, frozenCapture, "comfy-capture", placeContext) ? `${label} 捕获成功` : `${label} 捕获失败：未获取到图像`, 3000);
        } catch (error) {
            pushStatus(`${label} 捕获失败：${error?.message || error}`, 5000);
        } finally {
            setCapturingImageKey((current) => (current === key ? "" : current));
        }
    }, [clearImageByKey, confirmCaptureSelection, pushStatus, saveCapture, sharedSettings.uploadImageFormat, sharedSettings.uploadLongEdgeMax]);

    const clearImage = useCallback((row) => {
        const key = row.key || comfyRowKey(row.nodeId, row.fieldName);
        clearImageByKey(key);
    }, [clearImageByKey]);

    const enqueueAutoPlace = useCallback((savedFileNames, groupName, bounds, placeToken, docId) => {
        const prev = autoPlaceQueueRef.current.catch(() => {});
        const next = prev.then(() => performAutoPlace(savedFileNames, groupName, bounds, placeToken, docId, { force: true }));
        autoPlaceQueueRef.current = next.catch(() => {});
        return next;
    }, []);

    const run = useCallback(async (repeatCount = 1) => {
        if (submittingRef.current) return;
        const repeats = normalizeComfyRepeatCount(repeatCount);
        const baseUrl = normalizeComfyBaseUrl(comfyBaseUrl);
        if (!comfyConnected || !baseUrl) return pushStatus("请先连接 Comfy UI", 4000);
        if (!workflowDetail?.prompt) return pushStatus("请先选择工作流", 4000);
        if (selectedWorkflowId && workflowDetail.id && workflowDetail.id !== selectedWorkflowId) return pushStatus("工作流正在加载，请稍后再运行", 4000);
        const runFieldValues = { ...fieldValues };
        const runObjectInfo = objectInfo;
        const runDetail = workflowDetail?.raw ? buildWorkflowDetail(workflowDetail.raw, workflowDetail, runFieldValues) : workflowDetail;
        const runImageRows = runDetail?.imageRows || imageRows;
        const runParamRows = runDetail?.paramRows || paramRows;
        const runName = runDetail.name || workflowDetail.name || "Comfy UI";
        const runPendingUploads = filterComfyUploadsForWorkflow(pendingUploadsRef.current, workflowUploadId);
        const missing = firstComfyImageMissing(runImageRows, runPendingUploads);
        if (missing) return pushStatus(missing, 4000);
        submittingRef.current = true;
        setSubmitting(true);
        let submitLockReleased = false;
        const releaseSubmitLock = () => {
            if (submitLockReleased) return;
            submitLockReleased = true;
            submittingRef.current = false;
            setSubmitting(false);
        };
        const runId = `comfy_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const runClientId = `${COMFY_CLIENT_ID}-${runId}`;
        const startTime = Date.now();
        const abortController = typeof AbortController !== "undefined" ? new AbortController() : null;
        if (abortController) runAbortRefs.current[runId] = abortController;
        runCancelRefs.current[runId] = false;
        let initialUploads = {};
        try {
            initialUploads = await freezeComfyUploadsForRun(runPendingUploads);
        } catch (error) {
            releaseSubmitLock();
            delete runAbortRefs.current[runId];
            delete runCancelRefs.current[runId];
            return pushStatus(`捕获图冻结失败：${error?.message || error}`, 6000);
        }
        const initialUploadEstimate = buildComfyUploadEstimate(runImageRows, initialUploads);
        setRuns((prev) => [...prev, { id: runId, status: "running", progress: 0, stageText: "准备中", startTime, elapsedSec: 0, workflowName: runName, pendingUploads: initialUploads, uploadEstimate: initialUploadEstimate, batchTotal: repeats, batchImageTotal: repeats, batchDone: 0, batchIndex: 0, taskIds: [] }]);
        const queuedPromptIds = [];
        const savedAll = [];
        const pendingPlaceFileNames = [];
        const groupedAutoPlaceFileNames = [];
        let batchImageTotal = repeats;
        let hadPlaceFailure = false;
        const isCancelled = () => runCancelRefs.current[runId] === true || abortController?.signal?.aborted;
        const throwIfCancelled = () => {
            if (isCancelled()) throw new Error("已取消");
        };
        try {
            updateRun(runId, { stageText: "检查 Comfy 连接", progress: 2 });
            await ensureComfyReady(baseUrl);
            throwIfCancelled();
            const uploadsForRun = initialUploads;
            let placeContext = null;
            if (!placeContext && runImageRows[0]) placeContext = comfyPlaceContextFromUpload(uploadsForRun[runImageRows[0].key]);
            if (!placeContext) placeContext = await recordComfyPlaceContext();
            throwIfCancelled();
            updateRun(runId, { stageText: "上传图片", progress: 15 });
            const token = getEffectiveResultFolderToken(RESULT_WORKBENCH_COMFY);
            let folder = token ? await uxpFs.getEntryForPersistentToken(token) : null;
            let placeToken = token;
            if (!folder) {
                folder = await getTempResultFolder();
                placeToken = folder?.token ?? null;
            }
            if (!folder || !placeToken) throw new Error("无法访问回图缓存");
            const autoReturnOn = sharedSettings.rhAutoReturnEnabled !== false && sharedSettings.rhAutoReturnEnabled !== "false";
            const inputSubfolder = `xlrh_${comfySafeRunSuffix(runId)}`;
            const uploadedByKeyForRun = {};
            const uploadDebugByKeyForRun = {};
            for (const row of runImageRows) {
                throwIfCancelled();
                const slot = uploadsForRun[row.key];
                if (!slot?.base64 && !slot?.uploadSessionId) continue;
                uploadDebugByKeyForRun[row.key] = { frozen: comfyUploadDebug(slot) };
                uploadedByKeyForRun[row.key] = await uploadComfyImage(baseUrl, {
                    ...slot,
                    subfolder: inputSubfolder,
                    fileName: comfyRunFileName(slot.fileName, runId, row.key),
                }, {
                    onRetry: ({ nextAttempt, maxAttempts }) => updateRun(runId, { stageText: `上传图片重试 ${nextAttempt}/${maxAttempts}`, progress: 15 }),
                });
                uploadDebugByKeyForRun[row.key].uploaded = uploadedByKeyForRun[row.key];
            }
            updateRun(runId, { stageText: repeats > 1 ? `并发提交 ${repeats} 个任务` : "提交工作流", progress: 32 });
            const promptItems = await Promise.all(Array.from({ length: repeats }, async (_, batchIndex) => {
                throwIfCancelled();
                const itemIndex = batchIndex + 1;
                const itemClientId = `${runClientId}-${itemIndex}`;
                const uploadedByKey = { ...uploadedByKeyForRun };
                const uploadDebugByKey = Object.fromEntries(Object.entries(uploadDebugByKeyForRun).map(([key, value]) => [key, { ...value }]));
                const prompt = buildComfyPromptForRun(runDetail.prompt, runImageRows, runParamRows, runFieldValues, uploadedByKey, runObjectInfo);
                const isolatedPrompt = isolateComfyOutputNames(
                    randomizeComfyPromptSeeds(prompt, runObjectInfo).prompt,
                    comfySafeRunSuffix(runId, itemIndex)
                );
                const promptForQueue = isolatedPrompt.prompt;
                const outputSuffix = isolatedPrompt.outputSuffix;
                const outputNodeIds = isolatedPrompt.outputNodeIds || [];
                if (!outputSuffix) throw new Error("当前 Comfy 工作流没有可隔离的图片输出节点，请使用 SaveImage/PreviewImage 或带图片输出的保存节点");
                return { itemIndex, clientId: itemClientId, prompt: promptForQueue, outputSuffix, outputNodeIds, inputDebug: comfyPromptImageInputDebug(promptForQueue), uploadDebugByKey };
            }));
            const queuedList = [];
            const submitResults = await Promise.all(promptItems.map((promptItem, batchIndex) => (async () => {
                throwIfCancelled();
                const queued = await queueComfyPrompt(baseUrl, promptItem.prompt, promptItem.clientId, null);
                const item = { ...promptItem, promptId: queued.prompt_id };
                queuedList[batchIndex] = item;
                queuedPromptIds.push(item.promptId);
                updateRun(runId, { taskId: queuedPromptIds[0], taskIds: queuedPromptIds.slice(), stageText: repeats > 1 ? `已提交 ${queuedPromptIds.length}/${repeats}` : "已提交", progress: Math.min(45, 32 + Math.round(queuedPromptIds.length * 13 / repeats)) });
            })().then(() => null, (error) => error)));
            const submitError = submitResults.find(Boolean);
            if (submitError) throw submitError;
            const submittedList = queuedList.filter(Boolean);
            releaseSubmitLock();
            updateRun(runId, { taskId: queuedPromptIds[0], taskIds: queuedPromptIds.slice(), batchIndex: submittedList.length, stageText: repeats > 1 ? `等待云端 0/${repeats}` : "等待云端", progress: 45 });

            let completedRuns = 0;
            let resultQueue = Promise.resolve();
            const handleComfyResult = async ({ itemIndex, promptId, result, outputSuffix, inputDebug, uploadDebugByKey }) => {
                throwIfCancelled();
                completedRuns += 1;
                const ownedResult = filterComfyResultBySuffix(result, outputSuffix);
                if (Array.isArray(result?.images) && result.images.length > 0 && ownedResult.urls.length === 0) {
                    throw new Error(`Comfy 回图归属校验失败：任务 ${itemIndex}/${repeats} 没有拿到属于本次提交的图片`);
                }
                const resultUrls = ownedResult.urls || [];
                const resultImages = ownedResult.images || [];
                const resultRemoteUrls = ownedResult.remoteUrls || [];
                const resultCount = resultUrls.length;
                if (resultCount > 0) batchImageTotal = Math.max(batchImageTotal, resultCount * repeats);
                updateRun(runId, { batchImageTotal, stageText: repeats > 1 ? `保存回图 ${completedRuns}/${repeats}` : "保存回图", progress: Math.min(92, 68 + Math.round(completedRuns * 20 / repeats)) });
                const savedFileNames = [];
                for (let i = 0; i < resultUrls.length; i += 1) {
                    const image = resultImages[i] || null;
                    const saved = await saveImageWithBounds(folder, resultUrls[i], savedAll.length + i + 1, {
                        bounds: placeContext?.bounds ?? null,
                        docId: placeContext?.docId ?? null,
                        runningHubAppName: runName,
                        fileNameSuffix: comfyResultFileSuffix(runId, itemIndex, i + 1),
                        resultSidecar: {
                            platform: "comfy",
                            runId,
                            promptId,
                            itemIndex,
                            outputSuffix,
                            inputDebug,
                            uploadDebugByKey,
                            remoteUrl: resultRemoteUrls[i] || null,
                            output: image ? {
                                filename: image.filename || image.name || "",
                                type: image.type || "",
                                subfolder: image.subfolder || "",
                                nodeId: image.nodeId || "",
                                classType: image.classType || "",
                            } : null,
                        },
                    });
                    savedFileNames.push(saved.fileName);
                }
                savedAll.push(...savedFileNames);
                if (savedAll.length > batchImageTotal) batchImageTotal = savedAll.length;
                notifyResultFilesChanged({ folderToken: placeToken });
                const pendingForRun = pendingPlaceFileNames.concat(groupedAutoPlaceFileNames, savedFileNames);
                updateRun(runId, { batchDone: savedAll.length, batchImageTotal, placeSavedFileNames: pendingForRun, placeBounds: placeContext?.bounds ?? null, placeToken, placeDocId: placeContext?.docId ?? null, placeGroupName: `${runName} 生成` });
                if (!autoReturnOn) {
                    pendingPlaceFileNames.push(...savedFileNames);
                    updateRun(runId, { placeStatus: "pending", placeSavedFileNames: pendingPlaceFileNames.slice() });
                    return;
                }
                if (repeats > 1) {
                    groupedAutoPlaceFileNames.push(...savedFileNames);
                    updateRun(runId, { placeStatus: "pending", placeSavedFileNames: pendingPlaceFileNames.concat(groupedAutoPlaceFileNames) });
                    return;
                }
                try {
                    await enqueueAutoPlace(savedFileNames, `${runName} 生成`, placeContext?.bounds ?? null, placeToken, placeContext?.docId ?? null);
                    updateRun(runId, { placeStatus: pendingPlaceFileNames.length > 0 ? "pending" : "placed" });
                } catch (error) {
                    const canRetry = error && typeof error === "object" && error.canRetry === true;
                    hadPlaceFailure = true;
                    if (canRetry) {
                        pendingPlaceFileNames.push(...savedFileNames);
                        updateRun(runId, { placeStatus: "pending", placeError: error.reason, placeSavedFileNames: pendingPlaceFileNames.slice() });
                    } else {
                        updateRun(runId, { placeStatus: pendingPlaceFileNames.length > 0 ? "pending" : "failed", placeError: error?.reason || error?.message || String(error) });
                    }
                }
            };
            const enqueueComfyResult = (payload) => {
                resultQueue = resultQueue.then(() => handleComfyResult(payload));
                return resultQueue;
            };
            await Promise.all(submittedList.map(async ({ itemIndex, promptId, clientId, prompt: queuedPrompt, outputSuffix, outputNodeIds, inputDebug, uploadDebugByKey }) => {
                let reportedComfyProgress = false;
                const result = await waitForComfyImages(baseUrl, promptId, {
                    clientId,
                    prompt: queuedPrompt,
                    outputSuffix,
                    outputNodeIds,
                    onProgress: () => {
                        if (reportedComfyProgress) return;
                        reportedComfyProgress = true;
                        updateRun(runId, { stageText: repeats > 1 ? `云端执行中 ${completedRuns}/${repeats}` : "执行中", progress: Math.min(88, 55 + Math.round(completedRuns * 24 / repeats)) });
                    },
                    pollMs: 1500,
                    signal: abortController?.signal,
                });
                await enqueueComfyResult({ itemIndex, promptId, result, outputSuffix, inputDebug, uploadDebugByKey });
            }));
            if (autoReturnOn && repeats > 1 && groupedAutoPlaceFileNames.length > 0) {
                updateRun(runId, { stageText: "回传到 PS", progress: 95, placeSavedFileNames: pendingPlaceFileNames.concat(groupedAutoPlaceFileNames) });
                try {
                    await enqueueAutoPlace(groupedAutoPlaceFileNames.slice(), `${runName} 生成`, placeContext?.bounds ?? null, placeToken, placeContext?.docId ?? null);
                    groupedAutoPlaceFileNames.length = 0;
                    updateRun(runId, { placeStatus: pendingPlaceFileNames.length > 0 ? "pending" : "placed", placeSavedFileNames: pendingPlaceFileNames.slice() });
                } catch (error) {
                    const canRetry = error && typeof error === "object" && error.canRetry === true;
                    hadPlaceFailure = true;
                    if (canRetry) {
                        pendingPlaceFileNames.push(...groupedAutoPlaceFileNames);
                        groupedAutoPlaceFileNames.length = 0;
                        updateRun(runId, { placeStatus: "pending", placeError: error.reason, placeSavedFileNames: pendingPlaceFileNames.slice() });
                    } else {
                        updateRun(runId, { placeStatus: pendingPlaceFileNames.length > 0 ? "pending" : "failed", placeError: error?.reason || error?.message || String(error) });
                    }
                }
            }
            const placePatch = pendingPlaceFileNames.length > 0
                ? { placeStatus: "pending", placeSavedFileNames: pendingPlaceFileNames.slice(), placeBounds: placeContext?.bounds ?? null, placeToken, placeDocId: placeContext?.docId ?? null, placeGroupName: `${runName} 生成` }
                : { placeStatus: autoReturnOn ? (hadPlaceFailure ? "failed" : "placed") : "pending" };
            updateRun(runId, { status: "success", progress: 100, stageText: "已完成", completedAt: Date.now(), batchDone: savedAll.length, batchImageTotal, ...placePatch });
            pushStatus(autoReturnOn ? `Comfy 已完成并保存 ${savedAll.length} 张` : "Comfy 已完成，自动回传已关闭", 6000);
            playSound({ fileName: sharedSettings.successSoundFile });
        } catch (error) {
            const msg = error?.message || String(error);
            const cancelled = runCancelRefs.current[runId] === true;
            abortController?.abort?.();
            if (queuedPromptIds.length > 0) {
                queuedPromptIds.forEach((promptId) => cancelComfyPrompt(baseUrl, promptId).catch(() => {}));
            }
            updateRun(runId, { status: cancelled ? "cancelled" : "error", progress: 100, stageText: msg, completedAt: Date.now() });
            if (cancelled) pushStatus("Comfy 任务已取消", 3000);
            else {
                playSoundFail({ fileName: sharedSettings.failSoundFile });
                pushStatus(`Comfy 运行失败：${msg}`, 7000);
            }
        } finally {
            delete runAbortRefs.current[runId];
            delete runCancelRefs.current[runId];
            releaseSubmitLock();
        }
    }, [buildWorkflowDetail, comfyBaseUrl, comfyConnected, workflowDetail, imageRows, workflowUploadId, pushStatus, updateRun, sharedSettings.rhAutoReturnEnabled, sharedSettings.successSoundFile, sharedSettings.failSoundFile, paramRows, fieldValues, objectInfo, enqueueAutoPlace]);

    const dismissRun = useCallback((id) => {
        const runItem = runs.find((run) => run.id === id);
        if (runItem?.status === "running") runCancelRefs.current[id] = true;
        runAbortRefs.current[id]?.abort?.();
        delete runAbortRefs.current[id];
        if (runItem?.status === "running") {
            const ids = Array.from(new Set([...(Array.isArray(runItem.taskIds) ? runItem.taskIds : []), runItem.taskId].filter(Boolean)));
            ids.forEach((taskId) => cancelComfyPrompt(comfyBaseUrl, taskId).catch(() => {}));
        }
        setRuns((prev) => prev.filter((run) => run.id !== id));
    }, [comfyBaseUrl, runs]);

    const retryPlace = useCallback(async (id) => {
        const runItem = runs.find((run) => run.id === id);
        if (!runItem?.placeSavedFileNames || !runItem.placeToken) return;
        try {
            pushStatus("正在重试贴回图片...", 3000);
            await enqueueAutoPlace(runItem.placeSavedFileNames, runItem.placeGroupName || "Comfy UI 生成", runItem.placeBounds, runItem.placeToken, runItem.placeDocId);
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
        const platform = maybeRunId ? platformOrRunId : (taskRunsForQueue.find((run) => run.id === runId)?.platform || "comfy");
        if (onDismissSharedRun) onDismissSharedRun(platform, runId);
        else dismissRun(runId);
    }, [dismissRun, onDismissSharedRun, taskRunsForQueue]);

    const retryQueuePlace = useCallback((platformOrRunId, maybeRunId) => {
        const runId = maybeRunId ?? platformOrRunId;
        const platform = maybeRunId ? platformOrRunId : (taskRunsForQueue.find((run) => run.id === runId)?.platform || "comfy");
        if (onRetrySharedPlace) onRetrySharedPlace(platform, runId);
        else retryPlace(runId);
    }, [onRetrySharedPlace, retryPlace, taskRunsForQueue]);

    const state = { comfyBaseUrl, setComfyBaseUrl, comfyConnected, connecting, connectError, workflowList, workflowMessage, selectedWorkflowId, workflowDetail, imageRows, paramRows, fieldValues, pendingUploads: activePendingUploads, capturingImageKey, runs, queueRuns: taskRunsForQueue, submitting };
    const actions = { setComfyBaseUrl, connect, selectWorkflow, run, setField, captureImage, clearImage, dismissRun, retryPlace, dismissQueueRun, retryQueuePlace };
    const isHome = currentPage === "home";

    return (
        <>
            {squareSelectionWarningDialog}
            <ComfyTopBar activeProduct={activeProduct} onChangeProduct={onChangeProduct} isSettingsOpen={!isHome} onToggleView={() => setCurrentPage((p) => p === "home" ? "settings" : "home")} onRefresh={refreshCloudDataAndDefaults} />
            <div style={{ flex: 1, minHeight: 0, overflow: "visible", display: isHome ? "flex" : "none", flexDirection: "column", background: "transparent" }}>
                <ComfyHome state={state} actions={actions} />
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "visible", display: isHome ? "none" : "block", background: "transparent" }}>
                <ComfySettings props={sharedSettings} />
            </div>
        </>
    );
}
