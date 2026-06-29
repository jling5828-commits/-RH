/**
 * RunningHub 工作台：拉取应用参数、编辑 nodeInfoList、运行任务、展示结果
 * RH 生成图片保存到返图文件夹后刷新展示。
 * 玻璃卡片可拖拽排序。
 */
import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import ReactDOM from "react-dom";
import { core, app } from "photoshop";
import { RH_DEFAULT_BASE_URL, RH_LIST_ALLOW_EMPTY_SELECTION } from "../constants.js";
import { rhFetchAccountStatus } from "../taskApi.js";
import { buildRhCostLine, buildRhSuccessSecondaryLine } from "../rhAccountDelta.js";
import { fetchAiAppInputs } from "../appDemo.js";
import { runAiAppAndWait } from "../aiAppRunner.js";
import { formatRhError, isRhPermissionError } from "../rhErrorCodes.js";
import {
    normalizeRhInputList,
    rhInputRowKey,
    parseRhListOptions,
    buildRhRunPayload,
    validateRhMediaReady,
    validateRhImageUploadPayloadReady,
    validateRhImageSlotUploadMappings,
    isRhNumericFieldTypeUpper,
} from "../rhInputUtils.js";
import {
    captureAll,
    captureForPreview,
    computeRhPlaceContextBoundsSync,
    applyTaskPlaceContextBeforeCapture,
} from "../../components/ImageUpload/captureUtils.js";
import { useSquareSelectionWarning } from "../../components/ImageUpload/SquareSelectionWarning.jsx";
import {
    MAIN_PREVIEW_MIN_HEIGHT,
} from "../../components/ImageUpload/constants.js";
import { scaleDataUrlToMaxSize } from "../../utils/imageEncoder.js";
import { isInWebView, photoshop } from "../../bridge/uxpBridge.js";
import { isXiaoLiangRhHostCaptureEnabled } from "../../config/xiaoliangRhHostCapture.js";
import { performAutoPlace } from "../../utils/autoPlace.js";
import { readAutoReturnEnabled } from "../../utils/sharedInteractionSettings.js";
import { Results } from "../../features/results/index.js";
import { Operation } from "../../features/operation/index.js";
import { CollapsibleCard } from "../../components/WorkPanel/CollapsibleCard.jsx";
import { TaskPreviewThumb } from "../../components/shared/TaskPreviewLightbox.jsx";
import { saveImageWithBounds, getTempResultFolder } from "../../utils/imageSaver.js";
import {
    getEffectiveResultFolderToken,
    getGlobalResultFolderToken,
    RESULT_WORKBENCH_RUNNINGHUB,
} from "../../utils/resultFolderTokens.js";
import { notifyResultFilesChanged } from "../../utils/resultFilesSync.js";
import { usePersistedState } from "../../hooks/usePersistedState.js";
import { computeAddOrUpdate, computeRemove } from "../rhAppStorage.js";
import {
    listRhAppPresets,
    addRhAppPreset,
    removeRhAppPreset,
    updateRhAppPreset,
    mergeRhPresetApplied,
} from "../rhPresetStorage.js";
import { useRhParallelRunner, RH_MAX_CONCURRENT } from "../hooks/useRhParallelRunner.js";
import { useStatus } from "../../utils/StatusContext.jsx";
import { marked } from "marked";
import "../../components/WorkPanel/WorkPanel.css";
import "../../components/ImageUpload/ImageUpload.css";
import { CustomSelect } from "../../components/CustomSelect.jsx";
import { EditableSliderValue } from "../../components/EditableSliderValue.jsx";
import "../../components/OptionalParams.css";
import "../../components/PromptSection.css";
import "./RhWorkPanel.css";
import { RH_CLOSE_APP_DROPDOWNS_EVENT, RH_DROPDOWN_OUTSIDE_EVENTS, useDropdownPosition, formatRhAppDisplayLabel, RH_APP_MENU_MAX_HEIGHT_PX } from "./runninghubDropdownUtils.js";
import {
    RhParamNumericStepper,
    parseNumericStepFromFieldData,
    parseNumericMinFromFieldData,
    parseNumericMaxFromFieldData,
    parseNumericDefaultFromFieldData,
} from "./RhParamNumericStepper.jsx";
import { RhParamAutoGrowTextarea } from "./RhParamAutoGrowTextarea.jsx";
import { RhImagePreviewField } from "./RhImagePreviewField.jsx";
import { RhImageUploadStatusBadge } from "./RhImageUploadStatusBadge.jsx";
import { normalizeRhImageLongEdgeMax } from "../rhImageLongEdge.js";
import { buildRhUploadEstimate, buildRhUploadEstimateInfo, formatRhUploadBytes } from "../rhUploadEstimate.js";
import {
    RH_PS_CAPTURE_JPEG_QUALITY,
    RH_PS_CAPTURE_UPLOAD_FORMAT,
    RH_UPLOAD_DEFAULT_LONG_EDGE,
    normalizeRhUploadImageFormat,
    base64ByteLength,
    buildRhSuccessDisplayMessage,
    buildRhUploadWarning,
    isRhRunBeforeSubmitDone,
    pickRhListDefaultFromFieldData,
    rhCaptureFileName,
    rhDisplayPhase,
    stripBase64FromDataUrl,
} from "./xlrhRhWorkPanelLogic.js";

const storage = require("uxp").storage;
const fs = storage.localFileSystem;

/**
 * 256px 快速预览截取
 * @param {"canvas"|"layer"} mode
 */
async function doPreviewCapture(mode) {
    if (isInWebView()) {
        return captureForPreview(mode);
    }
    let res;
    await core.executeAsModal(
        async () => {
            res = await captureForPreview(mode);
        },
        { commandName: "RunningHub 预览截取" }
    );
    return res;
}

/**
 * 完整截取（用于运行前）
 * @param {"canvas"|"layer"} mode
 * @param {number} [longEdgeMax]
 * @param {"jpeg"|"png"} [uploadImageFormat]
 * @param {{ __hostUploadSession?: boolean }} [bridgeOpts] 批处理冻结需传 `__hostUploadSession: false`，避免会话 TTL 内无法持久化队列
 */
async function doFullCapture(mode, longEdgeMax = RH_UPLOAD_DEFAULT_LONG_EDGE, uploadImageFormat = RH_PS_CAPTURE_UPLOAD_FORMAT, bridgeOpts = {}) {
    const max = normalizeRhImageLongEdgeMax(longEdgeMax);
    const format = normalizeRhUploadImageFormat(uploadImageFormat);
    const allowHostSession =
        bridgeOpts.__hostUploadSession !== false && isXiaoLiangRhHostCaptureEnabled() && isInWebView();
    const captureOpts = {
        longEdgeMax: max,
        uploadEncodeFormat: format,
        jpegQuality: RH_PS_CAPTURE_JPEG_QUALITY,
    };
    if (isInWebView()) {
        return captureAll(mode, {
            ...captureOpts,
            ...(allowHostSession ? { __hostUploadSession: true } : {}),
        });
    }
    let res;
    await core.executeAsModal(
        async (executionContext) => {
            const hostControl = executionContext.hostControl;
            const docId = app.activeDocument?.id;
            if (!docId) throw new Error("[NO_DOC]无活动文档");
            const suspensionID = await hostControl.suspendHistory({
                documentID: docId,
                name: "RunningHub capture",
            });
            try {
                res = await captureAll(mode, captureOpts);
            } finally {
                await hostControl.resumeHistory(suspensionID);
            }
        },
        { commandName: "RunningHub 截取" }
    );
    return res;
}

/** 首个画布/图层 IMAGE 槽位的模式，用于与 captureAll 一致的贴回 bounds 语义；纯 file 时为 undefined */
function rhFirstCanvasOrLayerMode(/** @type {{ mediaRows?: unknown[], imageModes?: Record<string, string> }} */ snap) {
    const rows = snap.mediaRows || [];
    for (const row of rows) {
        if (!row || row.fieldType !== "IMAGE") continue;
        const key = rhInputRowKey(row.nodeId, row.fieldName);
        const mode = snap.imageModes?.[key] ?? "canvas";
        if (mode === "file") continue;
        return mode;
    }
    return undefined;
}

/**
 * 首个画布/图层 IMAGE 槽位（批处理右键冻结只更新该槽；无选区时宿主 bounds 为整幅文档，与全画布一致）
 * @param {{ mediaRows?: unknown[], imageModes?: Record<string, string> }} snap
 * @returns {{ key: string, mode: "canvas" | "layer", row: unknown } | null}
 */
function rhFirstCanvasOrLayerImageKey(snap) {
    const rows = Array.isArray(snap?.mediaRows) ? snap.mediaRows : [];
    const imageModes = snap?.imageModes || {};
    const picked = rows.find((row) => {
        if (!row || row.fieldType !== "IMAGE") return false;
        return imageModes[rhInputRowKey(row.nodeId, row.fieldName)] !== "file";
    });
    if (!picked) return null;
    const key = rhInputRowKey(picked.nodeId, picked.fieldName);
    return { key, mode: imageModes[key] === "layer" ? "layer" : "canvas", row: picked };
}

function normalizeRhPlaceContext(ctx) {
    const bounds = ctx?.bounds;
    const hasBounds = bounds && ["left", "top", "right", "bottom"].every((key) => typeof bounds[key] === "number");
    return hasBounds && ctx.docId != null ? { docId: ctx.docId, bounds } : null;
}

async function recordRhRunPlaceContextAtRunStart(refMode) {
    if (isInWebView()) {
        try {
            return normalizeRhPlaceContext(await photoshop.commands.recordRhRunPlaceContext(refMode));
        } catch (error) {
            console.warn("[RhWorkPanel] recordRhRunPlaceContext failed:", error);
            return null;
        }
    }
    const box = { value: null };
    try {
        await core.executeAsModal(
            async () => {
                box.value = computeRhPlaceContextBoundsSync(refMode);
            },
            { commandName: "RunningHub 记录贴回上下文" }
        );
    } catch (error) {
        console.warn("[RhWorkPanel] local place context capture failed:", error);
    }
    return box.value;
}

const ADD_NEW_APP_VALUE = "__rh_add_new__";
const RhIconTrash = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
);

/** @typedef {{ kind?: "single"|"batch"; items?: unknown[]; apiKeyTrim: string; webappIdTrim: string; appMetaName: string; normalizedRows: unknown[]; fieldValues: Record<string, string>; pendingUploads: Record<string, unknown>; imageModes: Record<string, string>; mediaRows: unknown[]; imageLongEdgeMax?: number; uploadImageFormat?: string; runSelectionBounds?: { left: number, top: number, right: number, bottom: number } | null; runPlaceDocId?: number | null; rhFrozenAtEnqueue?: boolean; captureDocId?: number | null; captureSelectionBounds?: { left: number, top: number, right: number, bottom: number } | null }} RhRunSnapshot */

const XLRH_RUN_PHASE_PROGRESS = Object.freeze({
    upload: 0,
    submit: 20,
    poll_status: 30,
    fetch_result: 100,
    fetch_result_fallback: 100,
    failed: 100,
});

function xlrhProgressPatchForPhase(phase, detail, extra, startTime) {
    const stage = rhDisplayPhase(phase, detail, extra);
    let progress = XLRH_RUN_PHASE_PROGRESS[phase] ?? 50;
    if (extra?.displayMode === "node") progress = extra.progress ?? null;
    return {
        statusText: stage,
        runPatch: {
            phase,
            progress: progress ?? 0,
            stageText: stage || "运行中…",
            message: stage,
            displayStage: stage,
            elapsedSec: (Date.now() - startTime) / 1000,
        },
    };
}

function clonePendingUploads(src) {
    const o = {};
    if (!src || typeof src !== "object") return o;
    for (const [k, v] of Object.entries(src)) {
        if (v && typeof v === "object") o[k] = { ...v };
        else o[k] = v;
    }
    return o;
}

function xlrhBatchFreezeBlocker({ apiKeyTrim, webappIdTrim, normalizedRows, fieldValues, pendingUploads, imageModes }) {
    if (!apiKeyTrim) return { message: "请先在「设置」中填写 API Key", ms: 4000 };
    if (!webappIdTrim) return { message: "请先在工作台顶部选择 AI 应用", ms: 4000 };
    if (!Array.isArray(normalizedRows) || normalizedRows.length === 0) {
        return { message: "请等待应用加载完成后再加入批处理", ms: 4000 };
    }
    const media = validateRhMediaReady(normalizedRows, fieldValues, pendingUploads, imageModes);
    return media.ok ? null : { message: media.message || "请先完成必填媒体后再加入批处理", ms: 4000 };
}

async function xlrhActiveDocumentBrief() {
    try {
        const doc = await photoshop.app.getActiveDocument();
        return { docId: doc?.id ?? null, docName: doc?.name ?? "未命名" };
    } catch (_) {
        return { docId: null, docName: "未命名" };
    }
}

function xlrhPlainBounds(bounds) {
    if (!bounds || typeof bounds !== "object") return null;
    const { left, top, right, bottom } = bounds;
    return [left, top, right, bottom].every(Number.isFinite) ? { left, top, right, bottom } : null;
}

function xlrhUploadRecordFromCapture(capture, previousUpload, prefix) {
    if (!capture?.uploadBase64 && !capture?.uploadSessionId) return null;
    const prior = previousUpload && typeof previousUpload === "object" ? previousUpload : {};
    const mimeType = capture.mimeType || prior.mimeType || "image/png";
    const bounds = xlrhPlainBounds(capture.bounds);
    const aspectRatio = bounds && bounds.right > bounds.left && bounds.bottom > bounds.top
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
    };
    const sessionId = String(capture.uploadSessionId || "").trim();
    if (sessionId) return { ...common, uploadSessionId: sessionId, frozenUploadSessionId: sessionId, base64: "" };
    const base64 = stripBase64FromDataUrl(capture.uploadBase64);
    return {
        ...common,
        uploadSessionId: "",
        frozenUploadSessionId: "",
        base64,
        uploadByteLength: capture.uploadByteLength ?? base64ByteLength(base64) ?? prior.uploadByteLength,
    };
}

function xlrhBuildFrozenBatchItem({ baseSnapshot, slot, capture, placeContext, documentBrief, appName }) {
    const bounds = xlrhPlainBounds(placeContext?.bounds);
    const docId = placeContext?.docId ?? null;
    if (!slot?.key || docId == null || !bounds) return null;
    const pendingUploads = clonePendingUploads(baseSnapshot.pendingUploads);
    const uploadRecord = xlrhUploadRecordFromCapture(capture, pendingUploads[slot.key], "rh-batch");
    if (!uploadRecord) return null;
    pendingUploads[slot.key] = uploadRecord;
    return {
        pendingUploads,
        queueItem: {
            docId: documentBrief.docId,
            docName: documentBrief.docName,
            presetName: appName || "—",
            frozenSnapshot: {
                ...baseSnapshot,
                kind: "single",
                pendingUploads,
                rhFrozenAtEnqueue: true,
                captureDocId: docId,
                captureSelectionBounds: bounds,
                runPlaceDocId: docId,
                runSelectionBounds: bounds,
            },
        },
    };
}

function xlrhBuildRunPayloadOrFailure(snapshot) {
    const imagePayload = validateRhImageUploadPayloadReady(snapshot.normalizedRows, snapshot.pendingUploads);
    if (!imagePayload.ok) return { ok: false, message: imagePayload.message || "图片上传数据未就绪" };
    const payload = buildRhRunPayload(snapshot.normalizedRows, snapshot.fieldValues, snapshot.pendingUploads);
    const mapping = validateRhImageSlotUploadMappings(snapshot.normalizedRows, payload.uploads);
    if (!mapping.ok) return { ok: false, message: mapping.message || "图像槽位映射校验失败" };
    return { ok: true, nodeInfoList: payload.nodeInfoList, uploads: payload.uploads };
}

async function xlrhResolveRunPlaceTarget(snapshot) {
    const knownBounds = xlrhPlainBounds(snapshot?.runSelectionBounds);
    let docId = snapshot?.runPlaceDocId ?? null;
    if (knownBounds && docId != null) return { bounds: knownBounds, docId };
    console.warn("[XiaoLiangRH RunPlace] 贴回上下文不完整，读取当前文档兜底");
    try {
        const doc = await photoshop.app.getActiveDocument();
        if (docId == null) docId = doc?.id ?? null;
    } catch (_) {}
    return { bounds: knownBounds, docId };
}

async function xlrhFetchAccountSnapshot(apiKeyTrim) {
    try {
        return await rhFetchAccountStatus(RH_DEFAULT_BASE_URL, apiKeyTrim, { timeoutMs: 6000 });
    } catch (_) {
        return null;
    }
}

function xlrhPinAccountBaseline(ref, apiKeyTrim, account) {
    if (!account || !ref?.current) return;
    if (ref.current.apiKey === apiKeyTrim && ref.current.account) return;
    ref.current = { apiKey: apiKeyTrim, account };
}

function savedRhAppsWithoutTarget(rawList, targetAppId) {
    return computeRemove(Array.isArray(rawList) ? rawList : [], targetAppId);
}

function nextRhAppIdAfterRemoval(currentId, removedId, remainingApps) {
    if (String(currentId) !== String(removedId)) return currentId;
    const firstUsable = (Array.isArray(remainingApps) ? remainingApps : []).find((item) => item?.webappId);
    return firstUsable?.webappId ?? "";
}

function clearRhMediaUploads(uploadMap, mediaRows) {
    const clean = clonePendingUploads(uploadMap);
    for (const row of Array.isArray(mediaRows) ? mediaRows : []) {
        if (!row) continue;
        delete clean[rhInputRowKey(row.nodeId, row.fieldName)];
    }
    return clean;
}

function xlrhPresetChoiceId(optionValue) {
    if (optionValue === RH_PRESET_SELECT_NONE || optionValue == null) return "";
    return String(optionValue);
}

function findRhPresetById(presets, presetId) {
    return (Array.isArray(presets) ? presets : []).find((preset) => String(preset?.id) === String(presetId));
}

function xlrhPresetBlocker({ action, webappIdTrim, rowCount, presetId }) {
    if (action === "delete") return presetId ? null : { text: "请先选择要删除的预设", ms: 3000 };
    if (!webappIdTrim) return { text: "请先选择 AI 应用", ms: 3000 };
    if (rowCount === 0) {
        return action === "create"
            ? { text: "请等待应用加载完成后再新增预设", ms: 4000 }
            : { text: "请先加载应用参数", ms: 4000 };
    }
    if (action === "overwrite" && !presetId) return { text: "请先在预设列表中选择要覆盖的一项", ms: 4000 };
    return null;
}

function xlrhPresetSnapshot(name, fieldValues, imageModes) {
    return { name, fieldValues, imageModes };
}

function xlrhRefreshPresetList(setTick) {
    setTick((tick) => tick + 1);
}

function resetXlrhLoadedAppState(actions) {
    actions.loadedDefSigRef.current = "";
    actions.setAppMeta(null);
    actions.setRows([]);
    actions.setFieldValues({});
    actions.setPendingUploads({});
    actions.setImageModes({});
    actions.setLoadError("");
    actions.setRunError("");
    actions.setNodeErrors([]);
    actions.setTaskIdLast("");
    actions.setIntroExpanded(false);
    actions.setBatchQueue([]);
}

function xlrhParamModel(row) {
    const fieldType = row.fieldType;
    const fieldTypeText = String(fieldType || "");
    const intLike = /^(INT|INTEGER|LONG)$/.test(fieldTypeText);
    return {
        key: rhInputRowKey(row.nodeId, row.fieldName),
        title: row.description || row.nodeName || row.fieldName,
        nodeName: row.nodeName || row.fieldName,
        fieldType,
        isList: fieldType === "LIST",
        isNumeric: /^(INT|INTEGER|LONG|FLOAT|NUMBER|DOUBLE)$/.test(fieldTypeText),
        numericVariant: intLike ? "int" : "float",
    };
}

function xlrhFieldStoredValue(values, model, row) {
    return values && Object.prototype.hasOwnProperty.call(values, model.key) ? values[model.key] : row.fieldValue ?? "";
}

function xlrhClampNumber(value, variant, min, max) {
    let next = Number.parseFloat(String(value).replace(/,/g, ".").trim());
    if (!Number.isFinite(next)) return null;
    if (variant === "int") next = Math.round(next);
    if (Number.isFinite(min)) next = Math.max(Number(min), next);
    if (Number.isFinite(max)) next = Math.min(Number(max), next);
    return next;
}

function xlrhNumericBounds(row, variant) {
    return {
        min: parseNumericMinFromFieldData(row.fieldData),
        max: parseNumericMaxFromFieldData(row.fieldData),
        step: parseNumericStepFromFieldData(row.fieldData) ?? (variant === "int" ? 1 : 0.01),
    };
}

function xlrhClampNumericRowValue(row, value) {
    const model = xlrhParamModel(row);
    if (!model.isNumeric) return value;
    const bounds = xlrhNumericBounds(row, model.numericVariant);
    const clamped = xlrhClampNumber(value, model.numericVariant, bounds.min, bounds.max);
    return clamped == null ? value : clamped;
}

function RhParamCaption({ model, side = false }) {
    const tooltip = `${model.title}\n节点: ${model.nodeName}`;
    return (
        <div className={side ? "rh-param-label-col" : "rh-param-meta"} title={tooltip}>
            <span className="rh-param-name">{model.title}</span>
        </div>
    );
}

function xlrhListFieldState(row, selectedRaw) {
    const choices = parseRhListOptions(row.fieldData);
    const rawText = selectedRaw === "" || selectedRaw == null ? "" : String(selectedRaw);
    const firstChoice = choices[0] ? String(choices[0].index) : "";
    const value = rawText === "" && choices.length > 0 && !RH_LIST_ALLOW_EMPTY_SELECTION ? firstChoice : rawText;
    const labelFor = (idx) => {
        if (idx === "" || idx == null) return "无选项";
        const hit = choices.find((choice) => String(choice.index) === String(idx));
        if (!hit) return String(idx);
        return hit.description ? `${hit.name} — ${hit.description}` : hit.name;
    };
    return {
        choices,
        value,
        optionIds: RH_LIST_ALLOW_EMPTY_SELECTION && choices.length > 0 ? ["", ...choices.map((choice) => choice.index)] : choices.map((choice) => choice.index),
        labelFor,
    };
}

function RhListParamRow({ model, row, fieldValues, setField }) {
    const listState = xlrhListFieldState(row, xlrhFieldStoredValue(fieldValues, model, row));
    const update = (value) => setField(model.key, value === "" || value == null ? "" : String(value));
    return (
        <div className="rh-param-row rh-param-row--numeric rh-param-row--list">
            <RhParamCaption model={model} side />
            <div className="rh-param-control-col rh-param-control-col--list">
                <div className="rh-param-list-select">
                    <CustomSelect
                        label=" "
                        value={listState.value}
                        displayValue={listState.choices.length === 0 ? "无选项" : listState.labelFor(listState.value)}
                        options={listState.optionIds}
                        getItemLabel={(value) => (value === "" ? "请选择" : listState.labelFor(value))}
                        compareValue={listState.value}
                        onChange={update}
                        disabled={listState.choices.length === 0}
                        dropdownPlacement="down"
                    />
                </div>
            </div>
        </div>
    );
}

function RhNumberParamRow({ model, row, fieldValues, setField }) {
    const raw = xlrhFieldStoredValue(fieldValues, model, row);
    const fallback = parseNumericDefaultFromFieldData(row.fieldData);
    const effectiveValue = raw !== "" && raw != null ? raw : fallback;
    const bounds = xlrhNumericBounds(row, model.numericVariant);
    const clampedValue = xlrhClampNumber(effectiveValue, model.numericVariant, bounds.min, bounds.max);
    const sliderValue = clampedValue ?? bounds.min ?? 0;
    const displayValue = clampedValue ?? "";
    const parseNext = (value) => (model.numericVariant === "int" ? parseInt(value, 10) : parseFloat(value));
    return (
        <div className="rh-param-row rh-param-row--numeric rh-param-row--slider">
            <RhParamCaption model={model} side />
            <div className="rh-param-control-col rh-param-control-col--slider">
                <div className="rh-param-slider-wrapper">
                    <input
                        type="range"
                        min={bounds.min ?? 0}
                        max={bounds.max ?? 100}
                        step={bounds.step}
                        value={sliderValue}
                        onChange={(event) => setField(model.key, xlrhClampNumber(parseNext(event.target.value), model.numericVariant, bounds.min, bounds.max) ?? "")}
                        className="xlrh-slider"
                    />
                    <EditableSliderValue
                        value={displayValue}
                        parseValue={(next) => xlrhClampNumber(parseNext(next), model.numericVariant, bounds.min, bounds.max) ?? ""}
                        onCommit={(next) => setField(model.key, next)}
                    />
                </div>
            </div>
        </div>
    );
}

function RhTextParamRow({ model, fieldValues, setField }) {
    return (
        <div className="rh-param-row">
            <RhParamCaption model={model} />
            <RhParamAutoGrowTextarea
                className="rh-param-input rh-param-textarea rh-param-textarea-autogrow"
                value={fieldValues[model.key] ?? ""}
                onChange={(value) => setField(model.key, value)}
                placeholder="文本参数"
            />
        </div>
    );
}

/**
 * 工作台顶栏：调用参数 CustomSelect（标签 | 值 + 下拉）
 * @param {{ disabled?: boolean }} props.disabled — 无 API Key 时暗淡且不可展开
 */
function RhWorkbenchAppSelect({ savedApps, webappId, setWebappId, onOpenSettings, onRemoveSavedApp, disabled = false, active = true }) {
    const [isOpen, setIsOpen] = useState(false);
    const [isClosing, setIsClosing] = useState(false);
    const containerRef = useRef(null);
    const closeTimerRef = useRef(0);
    const isVisible = active && !disabled && (isOpen || isClosing);
    const dropdownStyle = useDropdownPosition(containerRef, isVisible, false, RH_APP_MENU_MAX_HEIGHT_PX);
    const dropdownWidth = Number(dropdownStyle?.width || 0);
    const dropdownColumns = dropdownWidth > 0
        ? Math.max(2, Math.min(5, Math.floor((dropdownWidth - 8) / 126)))
        : 2;
    const dropdownTileSize = dropdownWidth > 0
        ? Math.max(96, Math.floor((dropdownWidth - 16 - 8 * (dropdownColumns - 1)) / dropdownColumns))
        : 140;
    const dropdownMenuStyle = dropdownStyle
        ? {
            ...dropdownStyle,
            "--rh-work-app-column-count": dropdownColumns,
            "--rh-work-app-tile-size": `${dropdownTileSize}px`,
        }
        : {};
    const validSavedApps = Array.isArray(savedApps) ? savedApps : [];

    const finishClose = useCallback(() => {
        window.clearTimeout(closeTimerRef.current);
        setIsOpen(false);
        setIsClosing(false);
    }, []);

    const closeDropdown = useCallback(() => {
        if (!isOpen && !isClosing) return;
        setIsClosing(true);
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = window.setTimeout(finishClose, 180);
    }, [finishClose, isClosing, isOpen]);

    useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);

    useEffect(() => {
        if (disabled || !active) {
            finishClose();
        }
    }, [active, disabled, finishClose]);

    useEffect(() => {
        const h = () => finishClose();
        window.addEventListener(RH_CLOSE_APP_DROPDOWNS_EVENT, h);
        return () => window.removeEventListener(RH_CLOSE_APP_DROPDOWNS_EVENT, h);
    }, [finishClose]);

    const options = useMemo(() => {
        const out = [];
        const validSavedApps = Array.isArray(savedApps) ? savedApps : [];
        for (const a of validSavedApps) {
            if (!a?.webappId) continue;
            out.push({
                id: String(a.webappId),
                label: formatRhAppDisplayLabel(a.name, a.webappId),
            });
        }
        const trim = (webappId || "").trim();
        if (trim && !validSavedApps.some((a) => String(a.webappId) === trim)) {
            out.push({ id: trim, label: formatRhAppDisplayLabel("当前", trim) });
        }
        out.push({ id: ADD_NEW_APP_VALUE, label: "添加新应用…" });
        return out;
    }, [savedApps, webappId]);

    const savedIdSet = useMemo(
        () => new Set((Array.isArray(savedApps) ? savedApps : []).map((a) => (a?.webappId != null ? String(a.webappId) : "")).filter(Boolean)),
        [savedApps]
    );

    useEffect(() => {
        if (!isVisible) return undefined;
        const h = (e) => {
            if (containerRef.current?.contains(e.target)) return;
            const dd = document.querySelector(".rh-work-app-select-portal");
            if (dd?.contains(e.target)) return;
            closeDropdown();
        };
        const key = (e) => {
            if (e.key === "Escape") closeDropdown();
        };
        RH_DROPDOWN_OUTSIDE_EVENTS.forEach((type) => document.addEventListener(type, h, true));
        document.addEventListener("keydown", key, true);
        window.addEventListener("blur", closeDropdown);
        return () => {
            RH_DROPDOWN_OUTSIDE_EVENTS.forEach((type) => document.removeEventListener(type, h, true));
            document.removeEventListener("keydown", key, true);
            window.removeEventListener("blur", closeDropdown);
        };
    }, [closeDropdown, isVisible]);

    const handleAnimationEnd = useCallback((e) => {
        if (e.target === e.currentTarget && e.animationName?.includes("out")) {
            finishClose();
        }
    }, [finishClose]);

    const openOrToggle = useCallback(() => {
        if (disabled) return;
        if (isOpen || isClosing) closeDropdown();
        else setIsOpen(true);
    }, [closeDropdown, disabled, isClosing, isOpen]);

    const webappIdTrim = (webappId || "").trim();
    const selected = options.find((o) => String(o.id) === String(webappIdTrim));
    const display = selected?.label ?? "请选择应用";

    const pick = useCallback(
        (id) => {
            if (id === ADD_NEW_APP_VALUE) {
                closeDropdown();
                onOpenSettings?.();
                return;
            }
            setWebappId(String(id));
        },
        [closeDropdown, onOpenSettings, setWebappId]
    );

    const dropdownContent = (
        <div
            className={`rh-work-app-dropdown ${dropdownStyle ? "open" : "opening"} ${isClosing ? "closing" : ""}`}
            style={dropdownMenuStyle}
            onAnimationEnd={handleAnimationEnd}
        >
            <div className="rh-work-app-dropdown-scroll">
                {options.map((opt) => {
                    const canDelete =
                        typeof onRemoveSavedApp === "function" &&
                        opt.id !== ADD_NEW_APP_VALUE &&
                        savedIdSet.has(String(opt.id));
                    if (opt.id === ADD_NEW_APP_VALUE) {
                        return (
                            <div
                                key={String(opt.id)}
                                className="rh-work-app-item rh-work-app-item-add"
                                onClick={(e) => {
                                    if (e.target.closest(".rh-work-app-item-delete")) return;
                                    pick(opt.id);
                                    closeDropdown();
                                }}
                            >
                                <span className="rh-work-app-add-icon">+</span>
                                <span className="rh-work-app-add-text">{opt.label}</span>
                            </div>
                        );
                    }
                    const app = validSavedApps.find((a) => String(a.webappId) === String(opt.id));
                    const appName = app?.name || "未命名应用";
                    const appId = opt.id;
                    const coverUrl = app?.coverUrl;
                    return (
                        <div
                            key={String(opt.id)}
                            className={`rh-work-app-item rh-work-app-item-card ${String(opt.id) === String(webappIdTrim) ? "active" : ""}`}
                            onClick={(e) => {
                                if (e.target.closest(".rh-work-app-item-delete")) return;
                                pick(opt.id);
                                closeDropdown();
                            }}
                        >
                            <div className="rh-work-app-card-thumbnail">
                                {coverUrl ? (
                                    <img 
                                        src={coverUrl} 
                                        alt={appName} 
                                        className="rh-work-app-card-cover"
                                        loading="lazy"
                                        onError={(e) => {
                                            e.target.style.display = 'none';
                                            const fallback = document.createElement('span');
                                            fallback.className = 'rh-work-app-card-icon';
                                            fallback.textContent = '🎨';
                                            e.target.parentElement.appendChild(fallback);
                                        }}
                                    />
                                ) : (
                                    <span className="rh-work-app-card-icon">🎨</span>
                                )}
                            </div>
                            <div className="rh-work-app-card-info">
                                <span className="rh-work-app-card-name">{appName}</span>
                                <span className="rh-work-app-card-id">{appId}</span>
                            </div>
                            {canDelete ? (
                                <span
                                    className="rh-work-app-card-delete"
                                    onClick={(ev) => {
                                        ev.stopPropagation();
                                        onRemoveSavedApp(String(opt.id));
                                        closeDropdown();
                                    }}
                                    title="从列表中移除此应用"
                                    role="button"
                                >
                                    ×
                                </span>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </div>
    );

    return (
        <div className={`rh-work-app-select-wrap${disabled ? " is-disabled" : ""}`}>
            <div
                ref={containerRef}
                className={`rh-work-app-control-box ${isVisible ? "is-dropdown-open" : ""}${disabled ? " is-disabled" : ""}`}
                title={disabled ? "请先在「设置」中填写 API Key" : undefined}
            >


                <div
                    className="rh-work-app-control-content"
                    role="button"
                    tabIndex={disabled ? -1 : 0}
                    aria-disabled={disabled}
                    onClick={openOrToggle}
                    onKeyDown={(e) => {
                        if (disabled) return;
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openOrToggle();
                        }
                    }}
                >
                    <div className="rh-work-app-control-value">{display}</div>
                    <div className={`rh-work-app-control-caret ${isVisible ? "open" : ""}`}>▼</div>
                </div>
            </div>
            {isVisible && typeof document !== "undefined" && document.body && ReactDOM.createPortal(
                <div className="rh-work-app-select-portal">{dropdownContent}</div>,
                document.body
            )}
        </div>
    );
}

const RH_PRESET_SELECT_NONE = "__rh_preset_none__";

const PRESET_DIALOG_CLOSE_DELAY_MS = 180;

function RhSavePresetDialog({ appDisplayName, onSave, onCancel }) {
    const [draftName, setDraftName] = useState("");
    const [closing, setClosing] = useState(false);
    const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const timerRef = useRef(0);

    useEffect(() => {
        timerRef.current = window.setTimeout(() => inputRef.current?.focus(), 40);
        return () => window.clearTimeout(timerRef.current);
    }, []);

    const closeAfterAnimation = useCallback((next) => {
        if (closing) return;
        setClosing(true);
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
            if (typeof next === "function") next();
            else onCancel();
        }, PRESET_DIALOG_CLOSE_DELAY_MS);
    }, [closing, onCancel]);

    const saveDraft = useCallback(() => {
        const name = draftName.trim();
        if (!name) return;
        closeAfterAnimation(() => Promise.resolve(onSave(name)).catch(() => {}));
    }, [closeAfterAnimation, draftName, onSave]);

    const closeFromBackdrop = useCallback((event) => {
        if (event.currentTarget === event.target) closeAfterAnimation();
    }, [closeAfterAnimation]);

    const dialogClass = closing ? "is-exiting" : "";
    return (
        <div className={`preset-editor-overlay preset-editor-overlay--in-card ${dialogClass}`} onClick={closeFromBackdrop}> 
            <form
                className={`preset-editor-panel preset-editor-panel--in-card rh-preset-save-dialog ${dialogClass}`}
                onSubmit={(event) => {
                    event.preventDefault();
                    saveDraft();
                }}
            >
                <div className="preset-editor-header-row">
                    <div className="preset-editor-title-wrap">
                        <span className="preset-editor-title-icon" aria-hidden="true">＋</span>
                        <div className="preset-editor-title">新增预设</div>
                    </div>
                    <div className="preset-editor-header-actions">
                        <button type="button" className="preset-editor-btn cancel preset-editor-btn--header" onClick={() => closeAfterAnimation()}>
                            取消
                        </button>
                        <button type="submit" className="preset-editor-btn save preset-editor-btn--header" disabled={!draftName.trim()}>
                            保存
                        </button>
                    </div>
                </div>
                <div className="preset-editor-fixed-top">
                    <div className="preset-editor-control-box rh-preset-save-dialog-readonly">
                        <label className="preset-editor-control-label" htmlFor="rh-preset-app-name">AI 应用</label>
                        <div className="preset-editor-control-divider" aria-hidden="true" />
                        <div className="preset-editor-control-content">
                            <input id="rh-preset-app-name" className="preset-editor-control-input" type="text" readOnly value={appDisplayName || "—"} />
                        </div>
                    </div>
                    <div className="preset-editor-control-box">
                        <label className="preset-editor-control-label" htmlFor="rh-preset-name-input">预设名称</label>
                        <div className="preset-editor-control-divider" aria-hidden="true" />
                        <div className="preset-editor-control-content">
                            <input
                                id="rh-preset-name-input"
                                ref={inputRef}
                                className="preset-editor-control-input"
                                type="text"
                                value={draftName}
                                placeholder="请填写预设名称"
                                autoComplete="off"
                                onChange={(event) => setDraftName(event.target.value)}
                            />
                        </div>
                    </div>
                </div>
            </form>
        </div>
    );
}

/**
 * @param {{ pushStatus: (t: string, d?: number) => void, savedApps: Array<{webappId:string,name:string}>, setSavedApps: (v:unknown) => void, onOpenSettings: () => void, currentKey?: string, apiKeyMode?: string, isActiveProduct?: boolean }} props
 */
export function RhWorkPanel({
    pushStatus,
    savedApps = [],
    setSavedApps,
    onOpenSettings,
    currentKey = "",
    apiKeyMode = "enterprise",
    isActiveProduct = true,
    duckDecodeEnabled = false,
    autoReturnEnabled = true,
    uploadLongEdgeMax = RH_UPLOAD_DEFAULT_LONG_EDGE,
    uploadImageFormat = RH_PS_CAPTURE_UPLOAD_FORMAT,
    successSoundFile = "",
    failSoundFile = "",
    definitionRefreshTick = 0,
    onRunsChange,
    sharedTaskRuns,
    onDismissSharedRun,
    onRetrySharedPlace,
    onRegisterTaskActions,
    /** 任务结束后刷新顶栏余额（与快照后展示一致） */
    onRefreshAccount,
}) {
    const { pushInvocation } = useStatus();
    const { confirmCaptureSelection, warningDialog: squareSelectionWarningDialog } = useSquareSelectionWarning(pushStatus);
    const duckDecodeEnabledRef = useRef(duckDecodeEnabled);
    const [webappId, setWebappId] = usePersistedState("rh_webapp_id", "");
    const apiKeyTrim = (currentKey || "").trim();
    const webappIdTrim = (webappId || "").trim();
    const apiKeyModeLabel = apiKeyMode === "consumer" ? "消费级-会员" : "企业级-共享";

    useEffect(() => {
        duckDecodeEnabledRef.current = duckDecodeEnabled;
    }, [duckDecodeEnabled]);
    const isDuckDecodeEnabledNow = useCallback(
        () => duckDecodeEnabledRef.current !== false && duckDecodeEnabledRef.current !== "false",
        []
    );

    const [appMeta, setAppMeta] = useState(/** @type {{ name: string, description: string } | null} */ (null));
    const [rows, setRows] = useState(/** @type {unknown[]} */ ([]));
    const [fieldValues, setFieldValues] = usePersistedState("rh_field_values", /** @type {Record<string, string>} */ ({}));
    const [pendingUploads, setPendingUploads] = usePersistedState("rh_pending_uploads",
        /** @type {Record<string, { base64: string, fileName: string, mimeType: string, previewBase64?: string }>} */ ({})
    );
    const [loadError, setLoadError] = useState("");
    const [runError, setRunError] = useState("");
    const [loadingDef, setLoadingDef] = useState(false);
    const [taskIdLast, setTaskIdLast] = useState("");
    const [nodeErrors, setNodeErrors] = useState(/** @type {string[]} */ ([]));
    /** 每个 IMAGE 字段的模式：canvas | layer | file */
    const [imageModes, setImageModes] = useState(/** @type {Record<string, "canvas"|"layer"|"file">} */ ({}));
    const imageLongEdgeMax = normalizeRhImageLongEdgeMax(uploadLongEdgeMax);
    const uploadImageFormatValue = normalizeRhUploadImageFormat(uploadImageFormat);
    const rhWorkRootRef = useRef(/** @type {HTMLDivElement | null} */ (null));
    /** 已成功加载应用定义的签名，避免切走 RH 再回来时重复 loadDefinition 冲掉表单 */
    const loadedDefSigRef = useRef("");
    const lastDefinitionRefreshTickRef = useRef(definitionRefreshTick);

    /** 应用介绍折叠状态，默认收起 */
    const [introExpanded, setIntroExpanded] = useState(false);

    /** RH 预设列表刷新（localStorage 变更后递增） */
    const [rhPresetListTick, setRhPresetListTick] = useState(0);
    const [selectedRhPresetId, setSelectedRhPresetId] = useState("");
    const [rhSavePresetOpen, setRhSavePresetOpen] = useState(false);
    const [rhDeletePresetConfirmOpen, setRhDeletePresetConfirmOpen] = useState(false);
    const [batchQueue, setBatchQueue] = useState(
        /** @type {Array<{ docId: unknown, docName: string, presetName: string, snapshot?: RhRunSnapshot, frozenSnapshot?: RhRunSnapshot }>} */ (
            []
        )
    );
    /** 右键入队时正在全幅截取并冻结，避免重复触发 */
    const [rhBatchFreezeBusy, setRhBatchFreezeBusy] = useState(false);
    const [capturingImageKey, setCapturingImageKey] = useState("");

    const resultRefreshRef = useRef(null);
    const rhAutoPlaceQueueRef = useRef(Promise.resolve());
    const rhAccountCostBaselineRef = useRef({ apiKey: "", account: null });
    const [rhSubmitBusy, setRhSubmitBusy] = useState(false);

    const setField = useCallback((key, value) => {
        setFieldValues((prev) => ({ ...prev, [key]: value }));
    }, []);

    const enqueueRhAutoPlace = useCallback((savedFileNames, groupName, bounds, placeToken, docId) => {
        const prev = rhAutoPlaceQueueRef.current.catch(() => {});
        const next = prev.then(() => performAutoPlace(savedFileNames, groupName, bounds, placeToken, docId, { force: true }));
        rhAutoPlaceQueueRef.current = next.catch(() => {});
        return next;
    }, []);

    const normalizedRows = useMemo(() => normalizeRhInputList(rows), [rows]);
    const mediaRows = useMemo(
        () => normalizedRows.filter((r) => r && ["IMAGE", "AUDIO", "VIDEO"].includes(r.fieldType)),
        [normalizedRows]
    );
    const imageRows = useMemo(
        () => mediaRows.filter((r) => r && r.fieldType === "IMAGE"),
        [mediaRows]
    );
    const paramRows = useMemo(
        () => normalizedRows.filter((r) => r && !["IMAGE", "AUDIO", "VIDEO"].includes(r.fieldType)),
        [normalizedRows]
    );

    const rhPresetOptions = useMemo(
        () => listRhAppPresets(webappIdTrim),
        [webappIdTrim, rhPresetListTick]
    );

    const rhPresetSelectOptions = useMemo(
        () => [RH_PRESET_SELECT_NONE, ...rhPresetOptions.map((p) => p.id)],
        [rhPresetOptions]
    );

    const rhPresetSelectLabel = useCallback(
        (opt) => {
            if (opt === RH_PRESET_SELECT_NONE) return "选择…";
            const p = rhPresetOptions.find((x) => x.id === opt);
            return p?.name ?? String(opt);
        },
        [rhPresetOptions]
    );

    const renderParamField = useCallback(
        (row) => {
            const model = xlrhParamModel(row);
            if (model.isList) return <RhListParamRow key={model.key} model={model} row={row} fieldValues={fieldValues} setField={setField} />;
            if (model.isNumeric) return <RhNumberParamRow key={model.key} model={model} row={row} fieldValues={fieldValues} setField={setField} />;
            return <RhTextParamRow key={model.key} model={model} fieldValues={fieldValues} setField={setField} />;
        },
        [fieldValues, setField]
    );

    const saveRhImageCapture = useCallback((key, capture, prefix) => {
        const record = xlrhUploadRecordFromCapture(capture, pendingUploads[key], prefix);
        if (!record) return false;
        setFieldValues((prev) => ({ ...prev, [key]: record.previewBase64 || "" }));
        setPendingUploads((prev) => ({ ...prev, [key]: record }));
        return true;
    }, [pendingUploads]);

    const clearRhImageByKey = useCallback((key) => {
        setFieldValues((prev) => ({ ...prev, [key]: "" }));
        setPendingUploads((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
    }, [setFieldValues, setPendingUploads]);

    const handleRhImageCapture = useCallback(async (row, index) => {
        const key = rhInputRowKey(row.nodeId, row.fieldName);
        const label = `图${index + 1}`;
        const shouldCapture = await confirmCaptureSelection({ mode: "canvas", clearCapture: () => clearRhImageByKey(key) });
        if (!shouldCapture) return;
        setCapturingImageKey(key);
        try {
            pushStatus(`${label} 正在捕获图像...`, 0);
            const result = await doFullCapture("canvas", imageLongEdgeMax, uploadImageFormatValue);
            pushStatus(saveRhImageCapture(key, result, "rh-capture") ? `${label} 捕获成功` : `${label} 捕获失败：未获取到图像数据`, 3000);
        } catch (err) {
            const msg = err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
            pushStatus(`${label} 捕获失败：${msg || "未知错误"}`, 5000);
        } finally {
            setCapturingImageKey((current) => (current === key ? "" : current));
        }
    }, [clearRhImageByKey, confirmCaptureSelection, imageLongEdgeMax, uploadImageFormatValue, pushStatus, saveRhImageCapture]);

    const handleRhImageClear = useCallback((row) => {
        const key = rhInputRowKey(row.nodeId, row.fieldName);
        clearRhImageByKey(key);
    }, [clearRhImageByKey]);

    /** 卡片顺序（可拖拽排序，持久化） */
    const [cardOrder, setCardOrder] = usePersistedState("rh_card_order", []);

    const resolveFullCapturesForSnapshot = useCallback(
        async (/** @type {RhRunSnapshot} */ snap) => {
            const idRaw = snap.captureDocId;
            const capId = idRaw != null && idRaw !== "" ? Number(idRaw) : NaN;
            const needsDocSwitch = Number.isFinite(capId) && snap.rhFrozenAtEnqueue !== true;
            if (needsDocSwitch) {
                const bnds = snap.captureSelectionBounds;
                const hasB =
                    bnds &&
                    typeof bnds === "object" &&
                    [bnds.left, bnds.top, bnds.right, bnds.bottom].every((x) => typeof x === "number");
                await applyTaskPlaceContextBeforeCapture({
                    docId: capId,
                    bounds: hasB ? bnds : null,
                });
            }
            let uploadsForRun = clonePendingUploads(snap.pendingUploads);
            const rows = snap.mediaRows || [];
            const maxEdge = normalizeRhImageLongEdgeMax(snap.imageLongEdgeMax);
            const captureFormat = normalizeRhUploadImageFormat(snap.uploadImageFormat);
            // 参考图若来自宿主冻结源 session，则每次运行前克隆一个新 session（原冻结源不消费）
            if (isInWebView() && photoshop.commands?.cloneUploadSession) {
                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    if (!row || row.fieldType !== "IMAGE") continue;
                    const refKey = rhInputRowKey(row.nodeId, row.fieldName);
                    const slot = uploadsForRun[refKey] || {};
                    const frozenSid = String(slot.frozenUploadSessionId || "").trim();
                    if (!frozenSid) continue;
                    try {
                        const renewed = await photoshop.commands.cloneUploadSession(frozenSid);
                        const renewedSid = String(renewed?.uploadSessionId || "").trim();
                        if (!renewedSid) continue;
                        uploadsForRun = {
                            ...uploadsForRun,
                            [refKey]: {
                                ...slot,
                                uploadSessionId: renewedSid,
                                base64: "",
                                mimeType: slot.mimeType || renewed?.mimeType || "image/png",
                                uploadByteLength: slot.uploadByteLength || renewed?.uploadByteLength,
                                uploadWidth: slot.uploadWidth || renewed?.uploadWidth,
                                uploadHeight: slot.uploadHeight || renewed?.uploadHeight,
                                uploadFormat: slot.uploadFormat || renewed?.uploadFormat,
                            },
                        };
                    } catch (e) {
                        const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
                        throw new Error(`参考图会话刷新失败：${row.nodeName || row.fieldName}（${msg}）`);
                    }
                }
            }
            const refMode = rhFirstCanvasOrLayerMode(snap);
            const placeCtx = await recordRhRunPlaceContextAtRunStart(refMode);
            /** @type {{ left: number, top: number, right: number, bottom: number } | null} */
            let runSelectionBounds = placeCtx?.bounds ?? null;
            /** @type {number | null} */
            let runPlaceDocId = placeCtx?.docId ?? null;
            /** 运行时仅更新主图（首个 IMAGE 槽位），参考图保持“点击获取时冻结”的数据 */
            const mainRow = rows.find((row) => row && row.fieldType === "IMAGE");
            if (!mainRow) {
                return { ...snap, pendingUploads: uploadsForRun, runSelectionBounds, runPlaceDocId };
            }
            const key = rhInputRowKey(mainRow.nodeId, mainRow.fieldName);
            const slotUp = uploadsForRun[key];
            const mode = snap.imageModes[key] ?? "canvas";

            if (mode === "file") {
                if (maxEdge > 0 && slotUp?.base64 && /^image\//i.test(slotUp.mimeType || "")) {
                    pushStatus(`正在压缩图像：${mainRow.nodeName || mainRow.fieldName}（长边 ${maxEdge}）...`, 0);
                    try {
                        const dataUrl = `data:${slotUp.mimeType || "image/png"};base64,${slotUp.base64}`;
                        const scaled = await scaleDataUrlToMaxSize(dataUrl, maxEdge);
                        const raw = stripBase64FromDataUrl(scaled);
                        uploadsForRun = {
                            ...uploadsForRun,
                            [key]: {
                                ...slotUp,
                                base64: raw,
                                uploadByteLength: base64ByteLength(raw),
                            },
                        };
                    } catch (e) {
                        const m = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
                        pushStatus(`图像压缩失败：${m}`, 5000);
                    }
                }
                return { ...snap, pendingUploads: uploadsForRun, runSelectionBounds, runPlaceDocId };
            }

            /** 主图为画布/图层时：点击运行前强制重抓主图 */
            const prevUp = uploadsForRun[key] || {};
            pushStatus(`正在截取完整图像：${mainRow.nodeName || mainRow.fieldName}…`, 0);
            const res = await doFullCapture(mode, maxEdge, captureFormat);
            if (!res?.uploadBase64 && !res?.uploadSessionId) {
                throw new Error(
                    `[NO_CAPTURE]${mainRow.nodeName || mainRow.fieldName || key}：无法从画布/图层截取图像（请检查活动文档与选区）`
                );
            }
            let aspectRatio = prevUp.aspectRatio;
            if (res.bounds && res.bounds.right > res.bounds.left && res.bounds.bottom > res.bounds.top) {
                aspectRatio = (res.bounds.right - res.bounds.left) / (res.bounds.bottom - res.bounds.top);
            }
            if (res.uploadSessionId) {
                const mimeType = res.mimeType || prevUp.mimeType || "image/png";
                uploadsForRun = {
                    ...uploadsForRun,
                    [key]: {
                        ...prevUp,
                        uploadSessionId: res.uploadSessionId,
                        base64: "",
                        fileName: rhCaptureFileName("ps-capture", mimeType),
                        mimeType,
                        previewBase64: res.previewBase64 ?? prevUp.previewBase64,
                        aspectRatio: aspectRatio ?? prevUp.aspectRatio,
                        uploadWidth: res.uploadWidth ?? prevUp.uploadWidth,
                        uploadHeight: res.uploadHeight ?? prevUp.uploadHeight,
                        uploadFormat: res.uploadFormat ?? prevUp.uploadFormat,
                        uploadByteLength: res.uploadByteLength ?? prevUp.uploadByteLength,
                    },
                };
            } else {
                const raw = stripBase64FromDataUrl(res.uploadBase64);
                const mimeType = res.mimeType || prevUp.mimeType || "image/png";
                uploadsForRun = {
                    ...uploadsForRun,
                    [key]: {
                        ...prevUp,
                        base64: raw,
                        fileName: rhCaptureFileName("ps-capture", mimeType),
                        mimeType,
                        previewBase64: res.previewBase64 ?? prevUp.previewBase64,
                        aspectRatio: aspectRatio ?? prevUp.aspectRatio,
                        uploadWidth: res.uploadWidth ?? prevUp.uploadWidth,
                        uploadHeight: res.uploadHeight ?? prevUp.uploadHeight,
                        uploadFormat: res.uploadFormat ?? prevUp.uploadFormat,
                        uploadByteLength: res.uploadByteLength ?? base64ByteLength(raw) ?? prevUp.uploadByteLength,
                    },
                };
            }
            return { ...snap, pendingUploads: uploadsForRun, runSelectionBounds, runPlaceDocId };
        },
        [pushStatus]
    );

    const buildRhRunSnapshot = useCallback(/** @returns {RhRunSnapshot} */ () => ({
        kind: "single",
        apiKeyTrim,
        webappIdTrim,
        appMetaName: appMeta?.name || "—",
        apiKeyMode: apiKeyMode === "consumer" ? "consumer" : "enterprise",
        apiKeyModeLabel,
        normalizedRows: normalizedRows.map((r) => (r ? { ...r } : r)),
        fieldValues: { ...fieldValues },
        pendingUploads: clonePendingUploads(pendingUploads),
        imageModes: {},
        mediaRows: [...mediaRows],
        imageLongEdgeMax,
        uploadImageFormat: uploadImageFormatValue,
    }), [apiKeyTrim, webappIdTrim, appMeta, apiKeyMode, apiKeyModeLabel, normalizedRows, fieldValues, pendingUploads, mediaRows, imageLongEdgeMax, uploadImageFormatValue]);

    const runRhPreflight = useCallback(async (snap, uploadInfo, runningCountForWarn = 0) => {
        if (!snap?.apiKeyTrim) return { ok: false, message: "请先在「设置」中填写 API Key" };
        if (!snap?.webappIdTrim) return { ok: false, message: "请先在工作台顶部选择 AI 应用" };
        if (!Array.isArray(snap.normalizedRows) || snap.normalizedRows.length === 0) {
            return { ok: false, message: "请等待应用加载完成" };
        }
        const mediaCheck = validateRhMediaReady(snap.normalizedRows, snap.fieldValues, snap.pendingUploads, snap.imageModes);
        if (!mediaCheck.ok) return { ok: false, message: mediaCheck.message || "媒体未就绪" };
        const uploadPayloadCheck = validateRhImageUploadPayloadReady(snap.normalizedRows, snap.pendingUploads);
        if (!uploadPayloadCheck.ok) return { ok: false, message: uploadPayloadCheck.message || "图片上传数据未就绪" };
        const token = getEffectiveResultFolderToken(RESULT_WORKBENCH_RUNNINGHUB);
        if (token) {
            try {
                await fs.getEntryForPersistentToken(token);
            } catch (_) {
                return { ok: false, message: "回图文件夹授权已失效，请重新选择回图文件夹" };
            }
        } else if (RESULT_WORKBENCH_RUNNINGHUB) {
            const folder = await getTempResultFolder();
            if (!folder) return { ok: false, message: "无法访问默认回图缓存文件夹" };
        }
        try {
            await photoshop.app.getActiveDocument();
        } catch (_) {
            return { ok: false, message: "请先打开一个 PS 文档" };
        }
        const warn = buildRhUploadWarning(uploadInfo, runningCountForWarn);
        return { ok: true, warning: warn };
    }, []);

    const runExecutor = useCallback(
        async ({ snapshot, signal, updateRun, startTime }) => {
            /**
             * @param {RhRunSnapshot} resolvedSnap
             */
            const runOneResolved = async (resolvedSnap) => {
                const payload = xlrhBuildRunPayloadOrFailure(resolvedSnap);
                if (!payload.ok) return { success: false, message: payload.message };
                const { bounds, docId } = await xlrhResolveRunPlaceTarget(resolvedSnap);
                const accountBefore = await xlrhFetchAccountSnapshot(resolvedSnap.apiKeyTrim);
                xlrhPinAccountBaseline(rhAccountCostBaselineRef, resolvedSnap.apiKeyTrim, accountBefore);
                const res = await runAiAppAndWait({
                    apiKey: resolvedSnap.apiKeyTrim,
                    webappId: resolvedSnap.webappIdTrim,
                    nodeInfoList: payload.nodeInfoList,
                    uploads: payload.uploads,
                    baseUrl: RH_DEFAULT_BASE_URL,
                    signal,
                    onProgress: (phase, detail, extra) => {
                        if (signal.aborted) return;
                        const progressState = xlrhProgressPatchForPhase(phase, detail, extra, startTime);
                        pushStatus(progressState.statusText, 0);
                        updateRun(progressState.runPatch);
                    },
                });
                if (res?.taskId) {
                    updateRun({ taskId: res.taskId });
                }

                if (signal.aborted || res.cancelled) {
                    return { cancelled: true, saved: 0, message: "已取消" };
                }
                if (res.success) {
                    setTaskIdLast(res.taskId || "");
                    setNodeErrors(res.nodeErrors || []);
                    const urls = res.fileUrls || [];
                    const token = getEffectiveResultFolderToken(RESULT_WORKBENCH_RUNNINGHUB);
                    let successMsg = "";
                    let saved = 0;
                    if (urls.length > 0) {
                        try {
                            let folder = null;
                            let placeToken = token;
                            let saveTargetLabel = token ? "自定义回图文件夹" : "image_cache";
                            if (token) {
                                folder = await fs.getEntryForPersistentToken(token);
                                saveTargetLabel = folder?.name ? `自定义回图文件夹 ${folder.name}` : "自定义回图文件夹";
                            }
                            if (!folder) {
                                folder = await getTempResultFolder();
                                placeToken = folder?.token ?? null;
                                saveTargetLabel = folder?.name || "image_cache";
                            }
                            if (folder && placeToken) {
                                const savedFileNames = [];
                                const duckDecodeResults = [];
                                const setDuckStatus = (msg, duration = 5000) => {
                                    pushStatus(msg, duration);
                                    updateRun({ message: msg, stageText: msg, progress: 100 });
                                };
                                if (isDuckDecodeEnabledNow()) {
                                    pushStatus("小黄鸭解码开关已开启，准备解码", 0);
                                }
                                if (isDuckDecodeEnabledNow()) {
                                    setDuckStatus("小黄鸭解码开关已开启，准备解码", 0);
                                }
                                for (let i = 0; i < urls.length; i++) {
                                    const duckDecodeOn = isDuckDecodeEnabledNow();
                                    const { fileName, duckDecode } = await saveImageWithBounds(folder, urls[i], i + 1, {
                                        bounds: bounds ?? null,
                                        docId: docId ?? null,
                                        runningHubAppName: resolvedSnap.appMetaName,
                                        duckDecodeEnabled: duckDecodeOn,
                                        onDownloadProgress: (evt) => {
                                            if (evt?.domain !== "duckDecode") return;
                                            if (evt.phase === "start") {
                                                setDuckStatus("小黄鸭解码中", 0);
                                                return;
                                            }
                                            if (evt.phase === "success") {
                                                setDuckStatus("小黄鸭解码成功", 5000);
                                                return;
                                            }
                                            if (evt.phase === "failed") {
                                                const ex = evt.extra || {};
                                                const reason = ex.reason ? String(ex.reason) : "decode_failed";
                                                const errText = ex.error ? ` / ${String(ex.error).slice(0, 160)}` : "";
                                                const src = ex.sourceExt ? `.${String(ex.sourceExt)}` : "";
                                                const ct = ex.contentType ? ` / ${String(ex.contentType)}` : "";
                                                setDuckStatus(`小黄鸭解码失败${src}${ct}：${reason}${errText}，已回传原图`, 15000);
                                                return;
                                            }
                                            if (evt.phase === "success") pushStatus("小黄鸭解码成功", 5000);
                                            else if (evt.phase === "failed") {
                                                const ex = evt.extra || {};
                                                const reason = ex.reason ? String(ex.reason) : "decode_failed";
                                                const src = ex.sourceExt ? `.${String(ex.sourceExt)}` : "";
                                                const ct = ex.contentType ? ` / ${String(ex.contentType)}` : "";
                                                pushStatus(`小黄鸭解码失败${src}${ct}：${reason}，已回传原图`, 7000);
                                            }
                                            else if (evt.phase === "start") pushStatus("小黄鸭解码中", 0);
                                        },
                                    });
                                    if (duckDecodeOn) {
                                        duckDecodeResults.push(duckDecode || { ok: false, reason: "no_decode_result" });
                                        if (duckDecode?.ok) {
                                            setDuckStatus("小黄鸭解码成功", 5000);
                                        } else {
                                            const reasonForStatus = duckDecode?.reason ? String(duckDecode.reason) : "no_decode_result";
                                            const errTextForStatus = duckDecode?.error ? ` / ${String(duckDecode.error).slice(0, 160)}` : "";
                                            const srcForStatus = duckDecode?.sourceExt ? `.${String(duckDecode.sourceExt)}` : "";
                                            const ctForStatus = duckDecode?.contentType ? ` / ${String(duckDecode.contentType)}` : "";
                                            setDuckStatus(`小黄鸭解码失败${srcForStatus}${ctForStatus}：${reasonForStatus}${errTextForStatus}，已回传原图`, 15000);
                                        }
                                        if (duckDecode?.ok) {
                                            pushStatus("小黄鸭解码成功", 5000);
                                        } else {
                                            const reason = duckDecode?.reason ? String(duckDecode.reason) : "no_decode_result";
                                            const src = duckDecode?.sourceExt ? `.${String(duckDecode.sourceExt)}` : "";
                                            const ct = duckDecode?.contentType ? ` / ${String(duckDecode.contentType)}` : "";
                                            pushStatus(`小黄鸭解码失败${src}${ct}：${reason}，已回传原图`, 7000);
                                        }
                                    }
                                    savedFileNames.push(fileName);
                                }
                                saved = urls.length;
                                if (resultRefreshRef.current?.refresh) {
                                    await resultRefreshRef.current.refresh();
                                }
                                if (placeToken) {
                                    notifyResultFilesChanged({ folderToken: placeToken });
                                }
                                successMsg = token
                                    ? `完成 · 已保存 ${urls.length} 张到${saveTargetLabel}`
                                    : `完成 · 已保存 ${urls.length} 张到${saveTargetLabel}`;
                                if (duckDecodeResults.length > 0) {
                                    const okCountForFinal = duckDecodeResults.filter((r) => r?.ok).length;
                                    const firstFailForFinal = duckDecodeResults.find((r) => !r?.ok);
                                    const firstFailErrForFinal = firstFailForFinal?.error ? ` / ${String(firstFailForFinal.error).slice(0, 160)}` : "";
                                    const firstFailSourceForFinal = [
                                        firstFailForFinal?.sourceExt ? `.${String(firstFailForFinal.sourceExt)}` : "",
                                        firstFailForFinal?.contentType ? String(firstFailForFinal.contentType) : "",
                                        firstFailForFinal?.width && firstFailForFinal?.height
                                            ? `${firstFailForFinal.width}x${firstFailForFinal.height}`
                                            : "",
                                    ].filter(Boolean).join(" / ");
                                    const firstFailSourceTextForFinal = firstFailSourceForFinal ? `（${firstFailSourceForFinal}）` : "";
                                    const duckFinalMsg = okCountForFinal > 0
                                        ? `小黄鸭解码成功 ${okCountForFinal}/${urls.length}`
                                        : `小黄鸭解码失败${firstFailSourceTextForFinal}：${firstFailForFinal?.reason || "no_decode_result"}${firstFailErrForFinal}，已回传原图`;
                                    successMsg = `${successMsg} · ${duckFinalMsg}`;
                                    setDuckStatus(duckFinalMsg, 15000);
                                }
                                const placeGroupName = resolvedSnap.appMetaName
                                    ? `${resolvedSnap.appMetaName} 生成`
                                    : "RunningHub 生成";
                                const autoReturnOn = readAutoReturnEnabled(autoReturnEnabled !== false && autoReturnEnabled !== "false");
                                if (!autoReturnOn) {
                                    successMsg = `${successMsg} · 自动回传已关闭，等待手动贴回`;
                                }
                                pushStatus(successMsg, duckDecodeResults.length > 0 ? 15000 : (autoReturnOn ? 5000 : 7000));
                                if (!autoReturnOn) {
                                    updateRun({
                                        placeStatus: "pending",
                                        placeError: "自动回传已关闭",
                                        placeSavedFileNames: savedFileNames,
                                        placeBounds: bounds,
                                        placeToken,
                                        placeDocId: docId,
                                        placeGroupName,
                                    });
                                    pushStatus("图片已保存，自动回传已关闭，请在任务队列手动贴回", 7000);
                                } else {
                                    try {
                                        await enqueueRhAutoPlace(savedFileNames, placeGroupName, bounds, placeToken, docId);
                                        // 贴回成功，标记状态
                                        updateRun({ placeStatus: "placed" });
                                    } catch (e) {
                                        console.warn("[RhAutoPlace] 自动贴回失败:", e);
                                        // 判断是否可重试
                                        const canRetry = e && typeof e === "object" && e.canRetry === true;
                                        const reason = e && typeof e === "object" && e.reason ? String(e.reason) : String(e);
                                        if (canRetry) {
                                            // PS 处于特殊状态，标记为待返回
                                            updateRun({
                                                placeStatus: "pending",
                                                placeError: reason,
                                                placeSavedFileNames: savedFileNames,
                                                placeBounds: bounds,
                                                placeToken,
                                                placeDocId: docId,
                                                placeGroupName,
                                            });
                                            pushStatus("图片已保存，但当前无法贴回（待返回）", 5000);
                                        } else {
                                            // 其他错误，不可重试
                                            updateRun({ placeStatus: "failed", placeError: reason });
                                        }
                                    }
                                }
                            } else {
                                successMsg = `完成 · ${urls.length} 个输出（无法写入临时目录）`;
                                pushStatus(successMsg, 5000);
                            }
                        } catch (saveErr) {
                            const m =
                                saveErr && typeof saveErr === "object" && "message" in saveErr
                                    ? String(saveErr.message)
                                    : String(saveErr);
                            successMsg = `完成但保存失败: ${m}`;
                            pushStatus(successMsg, 6000);
                        }
                    } else {
                        successMsg = "完成";
                        pushStatus(successMsg, 5000);
                    }
                    const elapsedFinal = (Date.now() - startTime) / 1000;
                    let accountAfter = null;
                    try {
                        accountAfter = await rhFetchAccountStatus(RH_DEFAULT_BASE_URL, resolvedSnap.apiKeyTrim, {
                            timeoutMs: 6000,
                        });
                    } catch (_) {
                        accountAfter = null;
                    }
                    const baseline =
                        rhAccountCostBaselineRef.current?.apiKey === resolvedSnap.apiKeyTrim &&
                        rhAccountCostBaselineRef.current?.account
                            ? rhAccountCostBaselineRef.current.account
                            : accountBefore;
                    const secondaryMessage = buildRhSuccessSecondaryLine(elapsedFinal, baseline || accountBefore, accountAfter);
                    const costMessage = buildRhCostLine(baseline || accountBefore, accountAfter);
                    if (accountAfter) {
                        rhAccountCostBaselineRef.current = {
                            apiKey: resolvedSnap.apiKeyTrim,
                            account: accountAfter,
                        };
                    }
                    const displaySuccessMsg = buildRhSuccessDisplayMessage(urls, successMsg);
                    if (typeof onRefreshAccount === "function") {
                        try {
                            onRefreshAccount();
                        } catch (_) {
                            /* ignore */
                        }
                    }
                    return {
                        cancelled: false,
                        saved,
                        message: displaySuccessMsg,
                        errors: res.nodeErrors || [],
                        resultDetail: {
                            message: displaySuccessMsg,
                            secondaryMessage,
                            cost: costMessage,
                            time: `${elapsedFinal.toFixed(1)}s`,
                            saved: urls.length,
                        },
                    };
                }
                setNodeErrors(res.nodeErrors || []);
                const failedMessage = formatRhError(res || {});
                const permissionDenied = res.permissionDenied || isRhPermissionError(res);
                if (permissionDenied) {
                    setRunError(failedMessage);
                    pushStatus(failedMessage, 8000);
                }
                return {
                    cancelled: false,
                    saved: 0,
                    message: failedMessage || res.message || "任务失败",
                    errors: res.nodeErrors || [],
                    failed: true,
                    permissionDenied,
                };
            };

            const elapsedNow = () => (Date.now() - startTime) / 1000;

            const sub = await runOneResolved(/** @type {RhRunSnapshot} */ (snapshot));
            if (sub.cancelled) {
                return { status: "cancelled", resultDetail: { message: "已取消" }, elapsedSec: elapsedNow() };
            }
            if (sub.failed) {
                return {
                    status: "error",
                    resultDetail: { message: sub.message, errors: sub.errors || [] },
                    elapsedSec: elapsedNow(),
                };
            }
            return {
                status: "success",
                resultDetail: sub.resultDetail || {
                    message: sub.message,
                    saved: sub.saved,
                    time: `${elapsedNow().toFixed(1)}s`,
                },
                elapsedSec: elapsedNow(),
            };
        },
        [pushStatus, resolveFullCapturesForSnapshot, setTaskIdLast, setNodeErrors, onRefreshAccount, isDuckDecodeEnabledNow, enqueueRhAutoPlace]
    );

    const {
        isRunning: rhIsRunning,
        runningCount: rhRunningCount,
        activeRuns: rhActiveRuns,
        runsForCompact,
        fakeProgressByRun,
        completedRetainSec,
        opState: rhOpState,
        cancelDialogOpen,
        dismissCancelDialog,
        confirmCancelRun,
        handleCancelRun,
        handleDismissRun,
        retryPlaceForRun,
        enqueueRun,
        enqueueBatchItemRuns,
        latestRunIdForCancel,
    } = useRhParallelRunner({ pushStatus, pushInvocation, runExecutor, successSoundFile, failSoundFile });
    const rhRunBeforeSubmitDone = rhActiveRuns.some(isRhRunBeforeSubmitDone);
    const rhCanSubmitAnotherRun =
        rhRunningCount < RH_MAX_CONCURRENT && !rhSubmitBusy && !rhRunBeforeSubmitDone;
    const rhRunButtonBusy = rhSubmitBusy || rhRunBeforeSubmitDone || rhRunningCount >= RH_MAX_CONCURRENT;
    const taskRunsForQueue = Array.isArray(sharedTaskRuns) ? sharedTaskRuns : rhActiveRuns;

    useEffect(() => {
        if (typeof onRunsChange === "function") onRunsChange(rhActiveRuns);
    }, [rhActiveRuns, onRunsChange]);

    useEffect(() => {
        if (typeof onRegisterTaskActions !== "function") return undefined;
        return onRegisterTaskActions({ dismiss: handleDismissRun, retryPlace: retryPlaceForRun });
    }, [handleDismissRun, onRegisterTaskActions, retryPlaceForRun]);

    /** 固定顺序卡片：返图 → 操作台 → 图像上传(常显) → 调用参数 */
    const defaultCardIds = useMemo(() => ["result", "operate", "input", "param"], []);

    /** 合并持久化顺序与当前列表：保留用户顺序，新卡片追加末尾 */
    const orderedCardIds = useMemo(() => {
        const orderSet = new Set(cardOrder);
        const defaultSet = new Set(defaultCardIds);
        const merged = cardOrder.filter((id) => defaultSet.has(id));
        for (const id of defaultCardIds) {
            if (!orderSet.has(id)) merged.push(id);
        }
        return merged;
    }, [cardOrder, defaultCardIds]);

    const handleCommitCardOrder = useCallback(
        (next) => {
            if (!Array.isArray(next) || next.length !== defaultCardIds.length) return;
            if (!next.every((id) => defaultCardIds.includes(id))) return;
            setCardOrder(next);
        },
        [defaultCardIds, setCardOrder]
    );

    const loadDefinition = useCallback(async () => {
        setLoadError("");
        setRunError("");
        if (!apiKeyTrim) {
            setLoadError("请先在设置中填写 API Key");
            return;
        }
        if (!webappIdTrim) {
            setLoadError("请先在设置中填写 WebAppId（应用 ID）");
            return;
        }
        setLoadingDef(true);
        try {
            const def = await fetchAiAppInputs(RH_DEFAULT_BASE_URL, apiKeyTrim, webappIdTrim, { timeoutMs: 15000 });
            const list = normalizeRhInputList(def.inputs);
            setAppMeta({ name: def.name, description: def.description });
            setRows(def.inputs);
            const init = {};
            for (const r of list) {
                if (!r) continue;
                const key = rhInputRowKey(r.nodeId, r.fieldName);
                /** IMAGE 不使用接口默认远程 URL，仅走本地画布/图层/文件 */
                if (r.fieldType === "IMAGE") {
                    init[key] = "";
                    continue;
                }
                if (r.fieldType === "LIST") {
                    const direct = String(r.fieldValue || "").trim();
                    if (direct) {
                        init[key] = direct;
                        continue;
                    }
                    const opts = parseRhListOptions(r.fieldData);
                    const defaultFromMeta = pickRhListDefaultFromFieldData(r.fieldData);
                    const hasDefault = defaultFromMeta && opts.some((o) => String(o.index) === defaultFromMeta);
                    if (hasDefault) {
                        init[key] = defaultFromMeta;
                    } else if (opts.length > 0 && !RH_LIST_ALLOW_EMPTY_SELECTION) {
                        init[key] = String(opts[0].index);
                    } else {
                        init[key] = "";
                    }
                    continue;
                }
                init[key] = r.fieldValue || "";
            }
            for (const r of list) {
                if (!r || !isRhNumericFieldTypeUpper(r.fieldType)) continue;
                const key = rhInputRowKey(r.nodeId, r.fieldName);
                init[key] = xlrhClampNumericRowValue(r, init[key]);
            }
            setFieldValues(init);
            setPendingUploads({});
            setTaskIdLast("");
            setNodeErrors([]);
            if (setSavedApps) {
                setSavedApps((prev) => computeAddOrUpdate(Array.isArray(prev) ? prev : [], webappIdTrim, def.name, def.coverUrl, def.iconUrl, def.inputs));
            }
            loadedDefSigRef.current = `${apiKeyTrim}\0${webappIdTrim}`;
            pushStatus(`已加载应用：${def.name}`, 3500);
        } catch (e) {
            const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
            const isCancelled = /取消|cancelled|aborted/i.test(msg);
            if (!isCancelled) {
                setLoadError(formatRhError({
                    status: e?.status,
                    code: e?.code,
                    message: msg,
                    rawBody: e?.rawBody,
                }));
                setAppMeta(null);
                setRows([]);
                setFieldValues({});
            }
        } finally {
            setLoadingDef(false);
        }
    }, [apiKeyTrim, webappIdTrim, pushStatus, setSavedApps]);

    const loadDefRef = useRef(loadDefinition);
    loadDefRef.current = loadDefinition;

    const handleReloadRhDefinition = useCallback(() => {
        loadedDefSigRef.current = "";
        void loadDefinition();
    }, [loadDefinition]);

    /** 进入工作区时加载应用定义：仅 Key/应用变化或首次成功前需要拉取；不因 isActiveProduct 从 false→true 重复覆盖表单 */
    useEffect(() => {
        if (!isActiveProduct) return;
        if (!apiKeyTrim || !webappIdTrim) {
            loadedDefSigRef.current = "";
            return;
        }
        const sig = `${apiKeyTrim}\0${webappIdTrim}`;
        if (loadedDefSigRef.current === sig) return;
        void loadDefRef.current();
    }, [isActiveProduct, apiKeyTrim, webappIdTrim]);

    useEffect(() => {
        if (lastDefinitionRefreshTickRef.current === definitionRefreshTick) return;
        lastDefinitionRefreshTickRef.current = definitionRefreshTick;
        if (!isActiveProduct || !apiKeyTrim || !webappIdTrim) return;
        loadedDefSigRef.current = "";
        void loadDefRef.current();
    }, [definitionRefreshTick, isActiveProduct, apiKeyTrim, webappIdTrim]);

    /** 已有 Key 但工作页清空应用选择时：参数/上传/批处理回到初始态，避免残留上一应用 UI */
    useEffect(() => {
        if (!isActiveProduct) return;
        if (!apiKeyTrim || webappIdTrim) return;
        resetXlrhLoadedAppState({
            loadedDefSigRef,
            setAppMeta,
            setRows,
            setFieldValues,
            setPendingUploads,
            setImageModes,
            setLoadError,
            setRunError,
            setNodeErrors,
            setTaskIdLast,
            setIntroExpanded,
            setBatchQueue,
        });
    }, [isActiveProduct, apiKeyTrim, webappIdTrim]);

    useEffect(() => {
        setSelectedRhPresetId("");
        setRhDeletePresetConfirmOpen(false);
    }, [webappIdTrim]);

    const handleClearBatch = useCallback(() => {
        setBatchQueue([]);
        pushStatus("已清空批处理", 2500);
    }, [pushStatus]);

    const handleRemoveFromBatch = useCallback(
        (index) => {
            setBatchQueue((q) => q.filter((_, i) => i !== index));
            pushStatus("已从批处理移除", 2500);
        },
        [pushStatus]
    );

    /** 右键运行钮：按当前选区截取（无选区时宿主为整幅文档=全画布），预览写入图像上传区，参数与 doc/bounds 一并冻结入队 */
    const handleAddToBatch = useCallback(async () => {
        if (rhBatchFreezeBusy) return;
        const blocked = xlrhBatchFreezeBlocker({ apiKeyTrim, webappIdTrim, normalizedRows, fieldValues, pendingUploads, imageModes });
        if (blocked) {
            pushStatus(blocked.message, blocked.ms);
            return;
        }
        const baseSnapshot = buildRhRunSnapshot();
        const captureSlot = rhFirstCanvasOrLayerImageKey(baseSnapshot);
        if (!captureSlot) {
            pushStatus("批处理冻结需要至少一个「画布」或「图层」图源；请先将主图改为画布/图层模式", 5000);
            return;
        }
        const documentBrief = await xlrhActiveDocumentBrief();
        setRhBatchFreezeBusy(true);
        try {
            pushStatus("正在按选区冻结图像与参数（无选区则为全画布）…", 0);
            const placeContext = await recordRhRunPlaceContextAtRunStart(captureSlot.mode);
            if (!placeContext?.bounds || placeContext.docId == null) {
                pushStatus("无法记录贴回上下文（请确认有活动文档）", 5000);
                return;
            }
            await applyTaskPlaceContextBeforeCapture({
                docId: placeContext.docId,
                bounds: placeContext.bounds,
            });
            const capture = await doFullCapture(captureSlot.mode, imageLongEdgeMax, uploadImageFormatValue, { __hostUploadSession: false });
            const frozen = xlrhBuildFrozenBatchItem({
                baseSnapshot,
                slot: captureSlot,
                capture,
                placeContext,
                documentBrief,
                appName: appMeta?.name,
            });
            if (!frozen) {
                pushStatus("截取失败：未得到上传图像", 5000);
                return;
            }
            setPendingUploads(clonePendingUploads(frozen.pendingUploads));
            setBatchQueue((q) => q.concat(frozen.queueItem));
            pushStatus("已加入批处理（已按选区/全画布冻结图像与参数）", 3500);
        } catch (e) {
            const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
            pushStatus(`加入批处理失败：${msg}`, 6000);
        } finally {
            setRhBatchFreezeBusy(false);
        }
    }, [
        rhBatchFreezeBusy,
        apiKeyTrim,
        webappIdTrim,
        normalizedRows,
        fieldValues,
        pendingUploads,
        imageModes,
        imageLongEdgeMax,
        uploadImageFormatValue,
        appMeta,
        buildRhRunSnapshot,
        pushStatus,
        setPendingUploads,
    ]);

    const handleRunSingle = useCallback(async () => {
        setRunError("");
        if (!apiKeyTrim) {
            setRunError("请先在「设置」中填写 API Key");
            return;
        }
        if (!webappIdTrim) {
            setRunError("请先在工作台顶部选择 AI 应用");
            return;
        }
        if (normalizedRows.length === 0) {
            setRunError("请等待应用加载完成");
            return;
        }
        const snap = buildRhRunSnapshot();
        const mediaCheck = validateRhMediaReady(
            snap.normalizedRows,
            snap.fieldValues,
            snap.pendingUploads,
            snap.imageModes
        );
        if (!mediaCheck.ok) {
            const m = mediaCheck.message || "媒体未就绪";
            setRunError(m);
            pushStatus(m, 4000);
            return;
        }
        if (!rhCanSubmitAnotherRun) {
            const msg =
                rhRunningCount >= RH_MAX_CONCURRENT
                    ? `最多同时 ${RH_MAX_CONCURRENT} 个 RunningHub 任务，请等待或取消后再试`
                    : "上个任务提交中，提交成功后可继续添加并发任务";
            pushStatus(msg, 4000);
            return;
        }
        setRhSubmitBusy(true);
        let docName = "未命名";
        try {
            try {
                const doc = await photoshop.app.getActiveDocument();
                docName = doc?.name ?? "未命名";
            } catch (_) {}
            const resolved = await resolveFullCapturesForSnapshot(snap);
            const uploadPayloadCheck = validateRhImageUploadPayloadReady(
                resolved.normalizedRows,
                resolved.pendingUploads
            );
            if (!uploadPayloadCheck.ok) {
                const msg = uploadPayloadCheck.message || "图片上传数据未就绪";
                setRunError(msg);
                pushStatus(msg, 5000);
                return;
            }
            const uploadEstimate = buildRhUploadEstimate(resolved.normalizedRows, resolved.pendingUploads);
            const uploadInfo = buildRhUploadEstimateInfo(resolved.normalizedRows, resolved.pendingUploads);
            const preflight = await runRhPreflight(resolved, uploadInfo, rhRunningCount);
            if (!preflight.ok) {
                const msg = preflight.message || "运行前体检失败";
                setRunError(msg);
                pushStatus(msg, 6000);
                return;
            }
            const resolvedWithEstimate = { ...resolved, uploadEstimate };
            if (uploadEstimate) {
                pushStatus(`上传预估：${uploadEstimate}`, 3500);
            }
            if (preflight.warning) {
                pushStatus(preflight.warning, 6500);
            } else {
                pushStatus("运行前体检通过", 1800);
            }
            setPendingUploads(clonePendingUploads(resolvedWithEstimate.pendingUploads));
            enqueueRun({
                snapshot: resolvedWithEstimate,
                docName,
                presetName: appMeta?.name || "—",
                size: "—",
                taskCount: 1,
                uploadEstimate,
                apiKeyModeLabel,
            });
        } catch (e) {
            const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
            setRunError(`截取失败：${msg}`);
            pushStatus(msg, 6000);
        } finally {
            setRhSubmitBusy(false);
        }
    }, [
        apiKeyTrim,
        webappIdTrim,
        normalizedRows,
        rhCanSubmitAnotherRun,
        rhRunningCount,
        buildRhRunSnapshot,
        resolveFullCapturesForSnapshot,
        runRhPreflight,
        setPendingUploads,
        enqueueRun,
        appMeta,
        apiKeyModeLabel,
        pushStatus,
    ]);

    const handleRunBatch = useCallback(
        (queue) => {
            if (!queue?.length) return;
            if (rhSubmitBusy || rhRunBeforeSubmitDone) {
                pushStatus("上个任务提交中，提交成功后可继续添加并发任务", 4000);
                return;
            }
            const n = queue.length;
            if (rhRunningCount + n > RH_MAX_CONCURRENT) {
                pushStatus(
                    `当前有 ${rhRunningCount} 个任务运行中，再提交 ${n} 项将超过并发上限 ${RH_MAX_CONCURRENT}，请等待或取消部分任务后再运行批处理`,
                    6000
                );
                return;
            }
            const metas = queue.map((x) => {
                const base = /** @type {RhRunSnapshot} */ (x.frozenSnapshot || x.snapshot);
                const uploadEstimate = buildRhUploadEstimate(base.normalizedRows, base.pendingUploads);
                return {
                    snapshot: { ...base, kind: "single", captureDocId: base.captureDocId ?? x.docId ?? null, uploadEstimate },
                    docName: x.docName || "—",
                    presetName: x.presetName || "—",
                    size: "—",
                    uploadEstimate,
                    apiKeyModeLabel: base.apiKeyModeLabel || apiKeyModeLabel,
                };
            });
            const batchKnownBytes = metas.reduce((sum, meta) => {
                const snap = meta.snapshot;
                const info = buildRhUploadEstimateInfo(snap.normalizedRows, snap.pendingUploads);
                return sum + (info.knownBytes || 0);
            }, 0);
            if (n >= 4 || batchKnownBytes >= RH_UPLOAD_BIG_WARN_BYTES) {
                const sizeText = batchKnownBytes > 0 ? `，本批已知上传约 ${formatRhUploadBytes(batchKnownBytes)}` : "";
                pushStatus(`批处理将并发提交 ${n} 个任务${sizeText}，网络和内存占用会升高`, 7000);
            }
            void (async () => {
                const started = await enqueueBatchItemRuns(metas, { staggerMs: 100 });
                if (started === 0) return;
                if (started === n) {
                    setBatchQueue([]);
                } else {
                    setBatchQueue((q) => q.slice(started));
                    pushStatus(`已启动 ${started}/${n} 项，其余仍留在批处理队列，请稍后继续运行`, 6000);
                }
            })();
        },
        [enqueueBatchItemRuns, rhRunningCount, rhRunBeforeSubmitDone, rhSubmitBusy, apiKeyModeLabel, pushStatus]
    );

    const handleRemoveSavedApp = useCallback(
        (appId) => {
            if (!setSavedApps) return;
            setSavedApps((prev) => {
                const remainingApps = savedRhAppsWithoutTarget(prev, appId);
                setWebappId((currentId) => nextRhAppIdAfterRemoval(currentId, appId, remainingApps));
                return remainingApps;
            });
            pushStatus("已从应用列表移除", 2500);
        },
        [setSavedApps, setWebappId, pushStatus]
    );

    const applyRhPresetPayload = useCallback(
        (p) => {
            if (!p || normalizedRows.length === 0) return;
            const merged = mergeRhPresetApplied(fieldValues, imageModes, p, normalizedRows);
            setFieldValues(merged.fieldValues);
            setImageModes(merged.imageModes);
            setPendingUploads((prevUploads) => clearRhMediaUploads(prevUploads, mediaRows));
            pushStatus("已切换预设；图片/音视频请重新截取或选择文件", 4500);
        },
        [normalizedRows, fieldValues, imageModes, mediaRows, pushStatus]
    );

    const handleRhPresetDropdownChange = useCallback(
        (opt) => {
            const id = xlrhPresetChoiceId(opt);
            setSelectedRhPresetId(id);
            if (!id || normalizedRows.length === 0) return;
            const p = findRhPresetById(rhPresetOptions, id);
            if (p) applyRhPresetPayload(p);
        },
        [normalizedRows.length, rhPresetOptions, applyRhPresetPayload]
    );

    const handleAddRhPreset = useCallback(() => {
        const blocked = xlrhPresetBlocker({ action: "create", webappIdTrim, rowCount: normalizedRows.length });
        if (blocked) return pushStatus(blocked.text, blocked.ms);
        setRhSavePresetOpen(true);
    }, [webappIdTrim, normalizedRows.length, pushStatus]);

    const commitRhPresetSave = useCallback(
        (name) => {
            const savedPreset = addRhAppPreset(webappIdTrim, xlrhPresetSnapshot(name, fieldValues, imageModes));
            xlrhRefreshPresetList(setRhPresetListTick);
            if (savedPreset?.id) setSelectedRhPresetId(savedPreset.id);
            pushStatus("已新增预设（不含大图）", 3500);
            setRhSavePresetOpen(false);
        },
        [webappIdTrim, fieldValues, imageModes, pushStatus]
    );

    const handleOverwriteRhPreset = useCallback(() => {
        const blocked = xlrhPresetBlocker({ action: "overwrite", webappIdTrim, rowCount: normalizedRows.length, presetId: selectedRhPresetId });
        if (blocked) return pushStatus(blocked.text, blocked.ms);
        const ok = updateRhAppPreset(webappIdTrim, selectedRhPresetId, { fieldValues, imageModes });
        if (!ok) {
            pushStatus("覆盖失败：预设可能已被删除", 4000);
            return;
        }
        xlrhRefreshPresetList(setRhPresetListTick);
        pushStatus("已用当前参数覆盖所选预设", 3500);
    }, [webappIdTrim, normalizedRows.length, selectedRhPresetId, fieldValues, imageModes, pushStatus]);

    const handleRequestDeleteRhPreset = useCallback(() => {
        const blocked = xlrhPresetBlocker({ action: "delete", webappIdTrim, rowCount: normalizedRows.length, presetId: selectedRhPresetId });
        if (blocked) return pushStatus(blocked.text, blocked.ms);
        setRhDeletePresetConfirmOpen(true);
    }, [webappIdTrim, normalizedRows.length, selectedRhPresetId, pushStatus]);

    const confirmDeleteRhPreset = useCallback(() => {
        if (!selectedRhPresetId) return;
        removeRhAppPreset(webappIdTrim, selectedRhPresetId);
        setSelectedRhPresetId("");
        xlrhRefreshPresetList(setRhPresetListTick);
        setRhDeletePresetConfirmOpen(false);
        pushStatus("已删除预设", 2500);
    }, [webappIdTrim, selectedRhPresetId, pushStatus]);

    const rhReloadDefinitionReady =
        !loadingDef && Boolean(apiKeyTrim) && Boolean(webappIdTrim) && normalizedRows.length > 0;

    const CaptureIcon = () => (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
            <line x1="7" y1="2" x2="7" y2="8"></line>
            <line x1="17" y1="2" x2="17" y2="8"></line>
            <line x1="2" y1="15" x2="8" y2="15"></line>
            <line x1="16" y1="15" x2="22" y2="15"></line>
            <circle cx="12" cy="10" r="3"></circle>
            <line x1="8" y1="22" x2="16" y2="22"></line>
        </svg>
    );

    const SettingsIcon = () => (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
            <circle cx="12" cy="12" r="3"></circle>
        </svg>
    );

    const QueueIcon = () => (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2"></path>
            <path d="M18 2h2a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-2"></path>
            <path d="M6 17a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2"></path>
            <line x1="6" y1="12" x2="18" y2="12"></line>
        </svg>
    );

    const PlayIcon = () => (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
    );

    const UploadIcon = () => (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
    );

    const [cardOpenStates, setCardOpenStates] = useState({
        capture: true,
        param: true,
        queue: true,
    });

    const toggleCard = (cardName) => {
        setCardOpenStates((prev) => ({
            ...prev,
            [cardName]: !prev[cardName],
        }));
    };

    return (
        <div className="rh-work" ref={rhWorkRootRef}>
            {squareSelectionWarningDialog}
            <div className="rh-work-toolbar">
                <RhWorkbenchAppSelect
                    savedApps={savedApps}
                    webappId={webappId}
                    setWebappId={setWebappId}
                    onOpenSettings={onOpenSettings}
                    onRemoveSavedApp={setSavedApps ? handleRemoveSavedApp : undefined}
                    disabled={!apiKeyTrim}
                    active={isActiveProduct}
                />
            </div>

            <div className="rh-run-section">
                <button
                    className={`rh-run-btn ${rhRunButtonBusy ? "running" : ""}`}
                    disabled={
                        !apiKeyTrim ||
                        !webappIdTrim ||
                        !rhCanSubmitAnotherRun ||
                        loadError ||
                        runError
                    }
                    onClick={
                        batchQueue.length > 0
                            ? () => handleRunBatch(batchQueue)
                            : handleRunSingle
                    }
                >
                    {rhRunButtonBusy ? (
                        <>
                            <div
                                className="rh-run-btn-spinner"
                                style={{
                                    width: "20px",
                                    height: "20px",
                                    border: "2px solid rgba(255,255,255,0.3)",
                                    borderTopColor: "#fff",
                                    borderRadius: "50%",
                                    animation: "spin 1s linear infinite",
                                }}
                            />
                            {rhRunningCount >= RH_MAX_CONCURRENT ? "并发已满" : "提交中..."}
                        </>
                    ) : rhIsRunning ? (
                        <>
                            <PlayIcon />
                            继续运行 ({rhRunningCount}/{RH_MAX_CONCURRENT})
                        </>
                    ) : (
                        <>
                            <PlayIcon />
                            开始运行
                        </>
                    )}
                </button>
                
                <div className="rh-upload-status-bar">
                    <div className="rh-status-text">
                        {rhIsRunning ? (rhOpState.statusText || "正在处理...") : (rhOpState.statusText || "就绪")}
                    </div>
                    <div className="rh-progress-bar">
                        <div
                            className="rh-progress-fill"
                            style={{ width: `${rhIsRunning ? rhOpState.progress : 0}%` }}
                        />
                    </div>
                </div>
                
                {!rhIsRunning &&
                    ((!apiKeyTrim || !webappIdTrim) || loadError || runError) && (
                        <div className="rh-status-text" style={{ color: "#e74c3c" }}>
                            {loadError ||
                                runError ||
                                (!apiKeyTrim
                                    ? "请先在「设置」中填写 API Key。"
                                    : "请先选择 AI 应用。")}
                        </div>
                    )}
            </div>

            <div className="rh-work-cards">
                <div className={`xlrh-card rh-capture-card ${!cardOpenStates.capture ? "is-collapsed" : ""}`}>
                    <div 
                        className="card-header" 
                        onClick={() => toggleCard("capture")}
                    >
                        <span className="header-title">
                            <span className="title-icon">📸</span>
                            捕获图像
                        </span>
                        <div className={`collapse-arrow ${cardOpenStates.capture ? "expanded" : "collapsed"}`}>
                            <span className="arrow-icon"></span>
                        </div>
                    </div>
                    <div className={`card-content ${!cardOpenStates.capture ? "collapsed" : ""}`}>
                        {loadingDef ? (
                            <p className="rh-field-empty">加载中...</p>
                        ) : imageRows.length === 0 ? (
                            <p className="rh-field-empty">暂无图片输入</p>
                        ) : (
                            imageRows.map((row, index) => {
                                const key = rhInputRowKey(row.nodeId, row.fieldName);
                                return (
                                    <RhImagePreviewField
                                        key={key}
                                        label={`图${index + 1}`}
                                        pending={pendingUploads[key]}
                                        busy={capturingImageKey === key}
                                        onCapture={() => handleRhImageCapture(row, index)}
                                        onClear={() => handleRhImageClear(row)}
                                    />
                                );
                            })
                        )}
                    </div>
                </div>

                <div className={`xlrh-card rh-param-card ${!cardOpenStates.param ? "is-collapsed" : ""}`}>
                    <div 
                        className="card-header" 
                        onClick={() => toggleCard("param")}
                    >
                        <span className="header-title">
                            <span className="title-icon">⚙️</span>
                            参数设置
                        </span>
                        <div className={`collapse-arrow ${cardOpenStates.param ? "expanded" : "collapsed"}`}>
                            <span className="arrow-icon"></span>
                        </div>
                    </div>
                    <div className={`card-content ${!cardOpenStates.param ? "collapsed" : ""}`}>
                        <div className="rh-param-card-stack">
                            <div className="rh-work-fields rh-param-fields">
                                {loadingDef ? (
                                    <p className="rh-field-empty">加载中...</p>
                                ) : paramRows.length === 0 ? (
                                    <p className="rh-field-empty">暂无调用参数</p>
                                ) : (
                                    paramRows.map((row, i) =>
                                        row ? (
                                            <React.Fragment key={rhInputRowKey(row.nodeId, row.fieldName)}>
                                                {renderParamField(row)}
                                                {i < paramRows.length - 1 && <div className="rh-param-divider"></div>}
                                            </React.Fragment>
                                        ) : null
                                    )
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className={`xlrh-card rh-queue-card ${!cardOpenStates.queue ? "is-collapsed" : ""}`}>
                    <div 
                        className="card-header" 
                        onClick={() => toggleCard("queue")}
                    >
                        <span className="header-title">
                            <span className="title-icon">📋</span>
                            任务队列 {taskRunsForQueue.length > 0 ? `(${taskRunsForQueue.length})` : ""}
                        </span>
                        <div className={`collapse-arrow ${cardOpenStates.queue ? "expanded" : "collapsed"}`}>
                            <span className="arrow-icon"></span>
                        </div>
                    </div>
                    <div className={`card-content ${!cardOpenStates.queue ? "collapsed" : ""}`}>
                        <div className="rh-task-queue">
                            {taskRunsForQueue.length === 0 ? (
                                <div className="rh-task-empty">暂无任务</div>
                            ) : (
                                taskRunsForQueue.map((run) => {
                                    const platform = run.platform === "forge" ? "forge" : run.platform === "comfy" ? "comfy" : run.platform === "banana" ? "banana" : "runninghub";
                                    const isComfyRun = platform === "comfy";
                                    const isForgeRun = platform === "forge";
                                    const isBananaRun = platform === "banana";
                                    const platformLabel = isForgeRun ? "Forge UI" : isComfyRun ? "Comfy UI" : isBananaRun ? "Banana" : "RunningHub";
                                    const snap = run.snapshot && typeof run.snapshot === "object" ? run.snapshot : null;
                                    const appName = isForgeRun ? (run.presetName || "Forge UI") : isComfyRun ? (run.workflowName || "Comfy UI") : isBananaRun ? (`${run.provider || "Banana"} · ${run.model || "Banana"}`) : (snap?.appMetaName || run.presetName || "RunningHub");
                                    const uploadsForPreview = (isComfyRun || isForgeRun || isBananaRun) ? run.pendingUploads : snap?.pendingUploads;
                                    const previewBase64 = uploadsForPreview ? Object.values(uploadsForPreview).find((u) => u?.previewBase64)?.previewBase64 : null;
                                    const submitTime = new Date(run.startTime);
                                    const timeStr = `${submitTime.getHours().toString().padStart(2, '0')}:${submitTime.getMinutes().toString().padStart(2, '0')}`;
                                    const elapsedSec = run.elapsedSec != null ? run.elapsedSec : (run.completedAt ? (run.completedAt - run.startTime) / 1000 : 0);
                                    const elapsedStr = elapsedSec < 60 
                                        ? `${elapsedSec.toFixed(1)}秒` 
                                        : `${Math.floor(elapsedSec / 60)}分${(elapsedSec % 60).toFixed(0)}秒`;
                                    const statusClass = run.status === "running" ? "running" : 
                                                      run.status === "success" ? (isComfyRun ? "success" : "completed") : 
                                                      run.status === "error" ? "error" : 
                                                      run.status === "cancelled" ? "cancelled" :
                                                      run.status === "warning" ? "warning" : "pending";
                                    const hasPendingPlace = run.placeStatus === "pending";
                                    const statusText = run.status === "running" ? "运行中" : 
                                                      run.status === "success" ? (hasPendingPlace ? "已完成 · 待返回" : "已完成") : 
                                                      run.status === "error" ? "失败" : 
                                                      run.status === "cancelled" ? "已取消" :
                                                      run.status === "warning" ? "待确认" : "等待中";

                                    const costLine = run.status !== "running" && run.resultDetail?.cost
                                        ? String(run.resultDetail.cost)
                                        : "";
                                    const uploadEstimate = run.uploadEstimate || snap?.uploadEstimate || "";
                                    const keyModeLine = run.apiKeyModeLabel || snap?.apiKeyModeLabel || "";
                                    const errorList = Array.isArray(run.resultDetail?.errors) ? run.resultDetail.errors : [];
                                    const detailLine = (run.status === "error" || run.status === "warning")
                                        ? String(errorList[0] || run.resultDetail?.message || run.message || "").trim()
                                        : "";
                                    const stageLine = run.status === "running" ? (run.displayStage || run.stageText || run.message || "") : detailLine;
                                    const batchTotal = Number(run.batchImageTotal || run.batchTotal || 0);
                                    const batchLine = (isComfyRun || isForgeRun || isBananaRun) && batchTotal > 1 ? `返回 ${Number(run.batchDone || 0)} 张/共 ${batchTotal} 张` : "";

                                    return (
                                        <div key={run.id} className="rh-task-item">
                                            {previewBase64 && <TaskPreviewThumb src={previewBase64} title="查看任务大图" />}
                                            <div className="rh-task-status-wrapper">
                                                <div className={`rh-task-status ${statusClass}`}></div>
                                            </div>
                                            <div className="rh-task-info">
                                                <div className="rh-task-name">{appName}</div>
                                                <div className="rh-task-meta">
                                                    <span className={`rh-task-platform-badge rh-task-platform-badge--${platform}`}>{platformLabel}</span>
                                                    <span className="rh-task-time">{timeStr} 提交</span>
                                                    <span className="rh-task-duration">{elapsedStr}</span>
                                                    {keyModeLine && <span className="rh-task-key-mode">{keyModeLine}</span>}
                                                </div>
                                                <div className="rh-task-progress">
                                                    {statusText}
                                                    {batchLine && (
                                                        <span className="rh-task-stage" title={batchLine}>{batchLine}</span>
                                                    )}
                                                    {stageLine && stageLine !== statusText && (
                                                        <span className="rh-task-stage" title={stageLine}>{stageLine}</span>
                                                    )}
                                                    {uploadEstimate && (
                                                        <span className="rh-task-upload-estimate" title={uploadEstimate}>上传 {uploadEstimate}</span>
                                                    )}
                                                    {costLine && (
                                                        <span className="rh-task-cost" title={costLine}>{costLine}</span>
                                                    )}
                                                    {hasPendingPlace && (
                                                        <span className="rh-task-pending-badge" title="图片已保存，等待贴回">📥</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="rh-task-actions">
                                            {hasPendingPlace && (
                                                <button
                                                    className="rh-task-retry"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (onRetrySharedPlace) onRetrySharedPlace(platform, run.id);
                                                        else retryPlaceForRun(run.id);
                                                    }}
                                                    title="贴回图片"
                                                >
                                                    ↻
                                                </button>
                                            )}
                                            <button
                                                className="rh-task-close"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (onDismissSharedRun) onDismissSharedRun(platform, run.id);
                                                    else handleDismissRun(run.id);
                                                }}
                                                title="关闭任务"
                                            >
                                                ×
                                            </button>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>

                {nodeErrors.length > 0 ? (
                    <div className="rh-work-results">
                        <div className="rh-work-results-title">
                            运行结果 {taskIdLast ? `· taskId ${taskIdLast}` : ""}
                        </div>
                        <div className="rh-work-node-errors">
                            {nodeErrors.map((err, i) => (
                                <div key={i} className="rh-work-node-err-item">
                                    {err}
                                </div>
                            ))}
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
