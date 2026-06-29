import React, { useCallback, useEffect, useRef, useState } from "react";
import { isInWebView, storage as bridgeStorage } from "../../bridge/uxpBridge.js";
import { clearResultImageCache } from "../../utils/imageSaver.js";
import {
    RESULT_FOLDER_STORAGE_CHANGED,
    clearOverrideResultFolderToken,
    getEffectiveResultFolderToken,
    hasWorkbenchFolderOverride,
    setOverrideResultFolderToken,
} from "../../utils/resultFolderTokens.js";
import {
    PLACE_EDGE_FEATHER_CHANGED,
    notifyPlaceEdgeFeatherChanged,
    readPlaceCreateMaskEnabledFromStorage,
    readPlaceEdgeFeatherEnabledFromStorage,
    readPlaceKeepSelectionFromStorage,
    writePlaceCreateMaskEnabledToStorage,
    writePlaceEdgeFeatherEnabledToStorage,
    writePlaceKeepSelectionToStorage,
} from "../../utils/placeEdgeFeatherOpts.js";
import { writeCompatLocalStorage } from "../../utils/storageKeyCompat.js";
import { writeAutoReturnEnabled, writeConcurrentReturnGroupEnabled, writeSoundMuted } from "../../utils/sharedInteractionSettings.js";
import { DEFAULT_FAIL_SOUND, DEFAULT_SUCCESS_SOUND } from "../../utils/playSound.js";
import { normalizeRhImageLongEdgeMax, RH_IMAGE_LONG_EDGE_OPTIONS } from "../../runninghub/rhImageLongEdge.js";
import {
    RH_UPLOAD_IMAGE_FORMAT_OPTIONS,
    normalizeRhUploadImageFormat,
} from "../../runninghub/ui/xlrhRhWorkPanelLogic.js";
import { SettingsCard } from "./SettingsCard.jsx";

const uxpStorage = require("uxp").storage;
const uxpShell = require("uxp").shell;
const uxpFs = uxpStorage.localFileSystem;

function formatUploadLongEdgeLabel(value) {
    return Number(value) === 0 ? "原比例" : `${value}px`;
}

function formatCacheBytes(bytes) {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return "0 MB";
    if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function openResultCacheFolderWithStatus(pushStatus) {
    pushStatus("已收到打开缓存指令，正在获取路径...", 10000);
    try {
        if (isInWebView()) {
            pushStatus("正在请求打开回图缓存...", 15000);
            const res = await bridgeStorage.localFileSystem.openResultImageCacheFolder();
            const path = String(res?.nativePath || "").trim();
            const via = res?.opener ? ` · ${res.opener}` : "";
            pushStatus(path ? `已请求打开回图缓存：${path}${via}` : "已请求打开回图缓存文件夹", 10000);
            return;
        }

        const folder = await uxpFs.getDataFolder();
        let cacheFolder = null;
        try {
            cacheFolder = await folder.getEntry("image_cache");
        } catch (_) {
            cacheFolder = await folder.createFolder("image_cache");
        }
        const path = cacheFolder?.nativePath || "";
        if (!path) throw new Error("无法获取缓存文件夹路径");
        pushStatus(`正在请求打开回图缓存：${path}`, 15000);
        await uxpShell.openPath(path);
        pushStatus(`已请求打开回图缓存：${path}`, 10000);
    } catch (e) {
        const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
        pushStatus(`打开回图缓存失败：${msg}`, 20000);
    }
}

export function SharedInteractionSettingsContent({
    pushStatus,
    workbenchId,
    rhAutoReturnEnabled,
    setRhAutoReturnEnabled,
    concurrentReturnGroupEnabled,
    setConcurrentReturnGroupEnabled,
    uploadLongEdgeMax,
    setUploadLongEdgeMax,
    uploadImageFormat,
    setUploadImageFormat,
    soundMuted,
    setSoundMuted,
    soundFileOptions,
    successSoundFile,
    setSuccessSoundFile,
    failSoundFile,
    setFailSoundFile,
    onOpenSoundFolder,
    onRefreshSoundFiles,
}) {
    const [placeCreateMaskEnabled, setPlaceCreateMaskEnabled] = useState(() => readPlaceCreateMaskEnabledFromStorage());
    const [placeEdgeFeatherEnabled, setPlaceEdgeFeatherEnabled] = useState(() => readPlaceEdgeFeatherEnabledFromStorage());
    const [placeKeepSelection, setPlaceKeepSelection] = useState(() => readPlaceKeepSelectionFromStorage());
    const [folderName, setFolderName] = useState("默认 image_cache");
    const [hasOverride, setHasOverride] = useState(false);
    const [clearStep, setClearStep] = useState(0);
    const [clearing, setClearing] = useState(false);
    const openResultCacheGateRef = useRef(0);

    const autoReturnOn = rhAutoReturnEnabled !== false && rhAutoReturnEnabled !== "false";
    const concurrentGroupOn = concurrentReturnGroupEnabled !== false && concurrentReturnGroupEnabled !== "false";
    const voiceEnabled = soundMuted !== true && soundMuted !== "true";
    const normalizedUploadLongEdgeMax = normalizeRhImageLongEdgeMax(uploadLongEdgeMax);
    const uploadLongEdgeIndex = Math.max(0, RH_IMAGE_LONG_EDGE_OPTIONS.findIndex((n) => n === normalizedUploadLongEdgeMax));
    const uploadImageFormatValue = normalizeRhUploadImageFormat(uploadImageFormat);
    const uploadImageFormatLabel = uploadImageFormatValue === "png" ? "PNG" : "JPG";
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
        window.addEventListener("storage", h);
        return () => {
            window.removeEventListener(RESULT_FOLDER_STORAGE_CHANGED, h);
            window.removeEventListener("storage", h);
        };
    }, [refreshFolderName]);

    useEffect(() => {
        writeCompatLocalStorage("xlrh_place_edge_feather_enabled", String(placeEdgeFeatherEnabled));
    }, [placeEdgeFeatherEnabled]);

    useEffect(() => {
        writeCompatLocalStorage("xlrh_place_create_mask_enabled", String(placeCreateMaskEnabled));
    }, [placeCreateMaskEnabled]);

    useEffect(() => {
        writeCompatLocalStorage("xlrh_place_keep_selection", String(placeKeepSelection));
    }, [placeKeepSelection]);

    useEffect(() => {
        const handler = (e) => {
            if (e?.detail && typeof e.detail.createMask === "boolean") {
                setPlaceCreateMaskEnabled(e.detail.createMask);
            } else {
                setPlaceCreateMaskEnabled(readPlaceCreateMaskEnabledFromStorage());
            }
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
            setHasOverride(true);
            setFolderName(folder.name || "已选择回图文件夹");
            pushStatus(`回图文件夹已设置：${folder.name || "已选择文件夹"}`, 3000);
        } catch (error) {
            pushStatus(`选择回图文件夹失败：${error?.message || error}`, 5000);
        }
    }, [pushStatus, workbenchId]);

    const handleDefaultFolder = useCallback(() => {
        clearOverrideResultFolderToken(workbenchId);
        setHasOverride(false);
        refreshFolderName();
        pushStatus("已切换为默认回图缓存 image_cache", 3000);
    }, [pushStatus, refreshFolderName, workbenchId]);

    const handleOpenCache = useCallback(async (event) => {
        event?.preventDefault?.();
        const now = Date.now();
        if (now - openResultCacheGateRef.current < 900) return;
        openResultCacheGateRef.current = now;
        await openResultCacheFolderWithStatus(pushStatus);
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

    const handleUploadLongEdgeIndexChange = useCallback((rawIndex) => {
        const idx = Math.max(0, Math.min(RH_IMAGE_LONG_EDGE_OPTIONS.length - 1, Number(rawIndex) || 0));
        setUploadLongEdgeMax(RH_IMAGE_LONG_EDGE_OPTIONS[idx]);
    }, [setUploadLongEdgeMax]);

    const handleUploadImageFormatChange = useCallback((format) => {
        const next = normalizeRhUploadImageFormat(format);
        setUploadImageFormat(next);
        pushStatus(`上传图片格式已切换为 ${next === "png" ? "PNG" : "JPG"}`, 3000);
    }, [pushStatus, setUploadImageFormat]);

    const handleAutoReturnChange = useCallback((checked) => {
        setRhAutoReturnEnabled(checked);
        writeAutoReturnEnabled(checked);
        pushStatus(
            checked ? "已开启自动回传" : "已关闭自动回传，回图会停在任务队列等待手动贴回",
            checked ? 3000 : 5000
        );
    }, [pushStatus, setRhAutoReturnEnabled]);

    const handleConcurrentGroupChange = useCallback((checked) => {
        setConcurrentReturnGroupEnabled?.(checked);
        writeConcurrentReturnGroupEnabled(checked);
        pushStatus(checked ? "并发回图将打入同一个图层组" : "并发回图将逐张贴入，不新建图层组", 3500);
    }, [pushStatus, setConcurrentReturnGroupEnabled]);

    const handlePlaceCreateMaskChange = useCallback((checked) => {
        setPlaceCreateMaskEnabled(checked);
        writePlaceCreateMaskEnabledToStorage(checked);
        notifyPlaceEdgeFeatherChanged({ createMask: checked });
    }, []);

    const handlePlaceEdgeFeatherChange = useCallback((checked) => {
        setPlaceEdgeFeatherEnabled(checked);
        writePlaceEdgeFeatherEnabledToStorage(checked);
        notifyPlaceEdgeFeatherChanged({ enabled: checked });
    }, []);

    const handlePlaceKeepSelectionChange = useCallback((checked) => {
        setPlaceKeepSelection(checked);
        writePlaceKeepSelectionToStorage(checked);
        notifyPlaceEdgeFeatherChanged({ keepSelection: checked });
    }, []);

    const handleVoiceEnabledChange = useCallback((checked) => {
        const muted = !checked;
        setSoundMuted(muted);
        writeSoundMuted(muted);
    }, [setSoundMuted]);

    return (
        <>
            <div className="rh-interaction-content">
                <div className="rh-interaction-section rh-interaction-section-box">
                    <div className="rh-interaction-row rh-upload-setting-row">
                        <div className="rh-upload-setting-block">
                            <div className="rh-upload-setting-head">
                                <label className="rh-interaction-label" htmlFor="rh-upload-longedge-slider">
                                    <span>上传长边</span>
                                    <span className="rh-interaction-desc">截图上传前按长边压到指定尺寸</span>
                                </label>
                                <span className="rh-upload-setting-value">{formatUploadLongEdgeLabel(normalizedUploadLongEdgeMax)}</span>
                            </div>
                            <input
                                id="rh-upload-longedge-slider"
                                className="rh-upload-setting-slider"
                                type="range"
                                min="0"
                                max={RH_IMAGE_LONG_EDGE_OPTIONS.length - 1}
                                step="1"
                                value={uploadLongEdgeIndex}
                                onChange={(e) => handleUploadLongEdgeIndexChange(e.target.value)}
                                aria-label="上传长边"
                            />
                            <div className="rh-longedge-marks" aria-hidden="true">
                                {RH_IMAGE_LONG_EDGE_OPTIONS.map((n) => (
                                    <span key={n} className={`rh-longedge-mark ${n === normalizedUploadLongEdgeMax ? "active" : ""}`}>
                                        {formatUploadLongEdgeLabel(n)}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="rh-interaction-row rh-upload-format-row">
                        <label className="rh-interaction-label">
                            <span>上传图片格式</span>
                            <span className="rh-interaction-desc">当前 {uploadImageFormatLabel}，JPG 更小，PNG 保留透明通道</span>
                        </label>
                        <div className="rh-interaction-tone-switch rh-upload-format-switch" role="group" aria-label="上传图片格式">
                            {RH_UPLOAD_IMAGE_FORMAT_OPTIONS.map((item) => (
                                <button
                                    key={item.value}
                                    type="button"
                                    className={`rh-interaction-tone-btn ${uploadImageFormatValue === item.value ? "active" : ""}`}
                                    onClick={() => handleUploadImageFormatChange(item.value)}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="rh-interaction-section rh-interaction-section-box">
                    <div className="rh-interaction-row">
                        <label className="rh-interaction-label">
                            <span>自动回传</span>
                            <span className="rh-interaction-desc">{autoReturnOn ? "任务完成后自动贴回 PS" : "关闭后停在任务队列等待手动贴回"}</span>
                        </label>
                        <label className="rh-toggle">
                            <input type="checkbox" checked={autoReturnOn} onChange={(e) => handleAutoReturnChange(e.target.checked)} />
                            <span className="rh-toggle-slider" />
                        </label>
                    </div>
                    <div className="rh-interaction-row">
                        <label className="rh-interaction-label">
                            <span>并发回传图片打组</span>
                            <span className="rh-interaction-desc">{concurrentGroupOn ? "并发回图放入同一个图层组" : "并发回图逐张贴入"}</span>
                        </label>
                        <label className="rh-toggle">
                            <input type="checkbox" checked={concurrentGroupOn} onChange={(e) => handleConcurrentGroupChange(e.target.checked)} />
                            <span className="rh-toggle-slider" />
                        </label>
                    </div>
                    <div className="rh-interaction-row">
                        <label className="rh-interaction-label">
                            <span>回图创建蒙版</span>
                            <span className="rh-interaction-desc">贴回选区时创建硬边蒙版</span>
                        </label>
                        <label className="rh-toggle">
                            <input
                                type="checkbox"
                                checked={placeCreateMaskEnabled}
                                onChange={(e) => handlePlaceCreateMaskChange(e.target.checked)}
                            />
                            <span className="rh-toggle-slider" />
                        </label>
                    </div>
                    <div className="rh-interaction-row">
                        <label className="rh-interaction-label">
                            <span>边缘软边</span>
                            <span className="rh-interaction-desc">贴入返图时自动添加渐变蒙版，使边缘自然过渡</span>
                        </label>
                        <label className="rh-toggle">
                            <input
                                type="checkbox"
                                checked={placeEdgeFeatherEnabled}
                                onChange={(e) => handlePlaceEdgeFeatherChange(e.target.checked)}
                            />
                            <span className="rh-toggle-slider" />
                        </label>
                    </div>
                    <div className="rh-interaction-row">
                        <label className="rh-interaction-label">
                            <span>保留选区</span>
                            <span className="rh-interaction-desc">贴入完成后恢复矩形选区</span>
                        </label>
                        <label className="rh-toggle">
                            <input
                                type="checkbox"
                                checked={placeKeepSelection}
                                onChange={(e) => handlePlaceKeepSelectionChange(e.target.checked)}
                            />
                            <span className="rh-toggle-slider" />
                        </label>
                    </div>
                    <div className="rh-interaction-row rh-result-folder-row" onDoubleClick={handleOpenCache}>
                        <label className="rh-interaction-label">
                            <span>回图文件夹</span>
                            <span className="rh-interaction-desc">{hasOverride ? folderName : "默认 PluginData / image_cache"}</span>
                        </label>
                        <div className="rh-folder-actions">
                            <button type="button" className="rh-folder-btn" onClick={handleChooseFolder}>选择</button>
                            <button type="button" className="rh-folder-btn rh-folder-btn-muted" onClick={handleDefaultFolder}>默认</button>
                        </div>
                    </div>
                    <div className="rh-interaction-row rh-result-folder-row">
                        <label className="rh-interaction-label">
                            <span>回图缓存</span>
                            <span className="rh-interaction-desc">默认 image_cache，可打开查看或直接清空</span>
                        </label>
                        <div className="rh-folder-actions">
                            <button
                                type="button"
                                className="rh-folder-btn rh-folder-btn-muted rh-folder-btn-open"
                                onPointerDownCapture={handleOpenCache}
                                onMouseDownCapture={handleOpenCache}
                                onClick={handleOpenCache}
                                disabled={clearing}
                            >
                                打开
                            </button>
                            <button type="button" className="rh-folder-btn rh-folder-btn-danger" onClick={() => setClearStep(1)} disabled={clearing}>
                                {clearing ? "清理中" : "清空"}
                            </button>
                        </div>
                    </div>
                </div>
                <div className="rh-interaction-section rh-interaction-section-box">
                    <div className="rh-interaction-row">
                        <label className="rh-interaction-label">
                            <span>语音开关</span>
                            <span className="rh-interaction-desc">{voiceEnabled ? "回图完成后播放成功/失败音效" : "关闭后不播放成功/失败音效"}</span>
                        </label>
                        <label className="rh-toggle">
                            <input type="checkbox" checked={voiceEnabled} onChange={(e) => handleVoiceEnabledChange(e.target.checked)} />
                            <span className="rh-toggle-slider" />
                        </label>
                    </div>
                    <div className="rh-interaction-row rh-sound-row">
                        <label className="rh-interaction-label">
                            <span>回图成功音效</span>
                            <span className="rh-interaction-desc">{successSoundFile}</span>
                        </label>
                        <select className="rh-sound-select" value={successSoundFile} onFocus={onRefreshSoundFiles} onChange={(e) => setSuccessSoundFile(e.target.value)}>
                            {soundOptions.map((name) => <option key={`ok-${name}`} value={name}>{name}</option>)}
                        </select>
                    </div>
                    <div className="rh-interaction-row rh-sound-row">
                        <label className="rh-interaction-label">
                            <span>回图失败音效</span>
                            <span className="rh-interaction-desc">{failSoundFile}</span>
                        </label>
                        <select className="rh-sound-select" value={failSoundFile} onFocus={onRefreshSoundFiles} onChange={(e) => setFailSoundFile(e.target.value)}>
                            {soundOptions.map((name) => <option key={`fail-${name}`} value={name}>{name}</option>)}
                        </select>
                    </div>
                    <div className="rh-interaction-row rh-result-folder-row">
                        <label className="rh-interaction-label">
                            <span>语音文件夹</span>
                            <span className="rh-interaction-desc">插件安装目录 / voices</span>
                        </label>
                        <div className="rh-folder-actions">
                            <button type="button" className="rh-folder-btn rh-folder-btn-muted rh-folder-btn-open" onClick={onOpenSoundFolder}>打开</button>
                        </div>
                    </div>
                </div>
            </div>

            {clearStep > 0 && (
                <div className="xl-popup-overlay" onClick={() => !clearing && setClearStep(0)}>
                    <div className="xl-popup-dialog xl-popup-dialog-danger" onClick={(e) => e.stopPropagation()}>
                        <div className="xl-popup-icon">!</div>
                        <div className="xl-popup-title">确认清空回图缓存 {clearStep}/3</div>
                        <div className="xl-popup-subtitle">将直接删除 PluginData / image_cache 内的缓存文件。</div>
                        <div className="xl-popup-body">
                            <div className="xl-danger-note">第三次确认后才会执行。自定义回图文件夹不会被清理。</div>
                        </div>
                        <div className="xl-popup-actions">
                            <button className="xl-btn xl-btn-secondary" onClick={() => !clearing && setClearStep(0)} disabled={clearing}>取消</button>
                            <button className={`xl-btn xl-btn-danger ${clearing ? "is-loading" : ""}`} onClick={handleClearCacheConfirm} disabled={clearing}>
                                {clearing ? "清理中..." : clearStep >= 3 ? "第三次确认并清理" : "继续确认"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export function SharedInteractionSettingsCard({ defaultOpen = true, dragHandle, ...props }) {
    return (
        <SettingsCard cardClass="rh-interaction-card" icon="⚡" title="交互" defaultOpen={defaultOpen} dragHandle={dragHandle}>
            <SharedInteractionSettingsContent {...props} />
        </SettingsCard>
    );
}

export function SharedPersonalizationSettingsContent({
    themeMode,
    setThemeMode,
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
}) {
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

    const handleClearCustomBg = useCallback(() => {
        setCustomBgImage("");
        setCustomBgEnabled(false);
    }, [setCustomBgEnabled, setCustomBgImage]);

    const applyThemeMode = useCallback((mode) => {
        const nextMode = mode === "light" ? "light" : "dark";
        setThemeMode?.(nextMode);
        if (nextMode === "light") {
            setThemeColorStart?.("#38d7c8");
            setThemeColorEnd?.("#8b7cff");
            setOpacity?.(0.25);
            setBlur?.(0);
            setTextColor?.("#ffffff");
            return;
        }
        setThemeColorStart?.("#78e4d3");
        setThemeColorEnd?.("#7fa9ff");
        setOpacity?.(0.08);
        setBlur?.(0);
        setTextColor?.("#eef5f7");
    }, [setBlur, setOpacity, setTextColor, setThemeColorEnd, setThemeColorStart, setThemeMode]);

    const activeThemeMode = themeMode === "light" ? "light" : "dark";

    return (
        <div className="rh-personalization-content">
            <div className="rh-personalization-section">
                <div className="rh-personalization-section-title">主题色</div>
                <div className="rh-theme-mode-row" role="group" aria-label="主题色">
                    <button
                        type="button"
                        className={`rh-theme-mode-btn ${activeThemeMode === "dark" ? "is-active" : ""}`}
                        onClick={() => applyThemeMode("dark")}
                    >
                        暗色
                    </button>
                    <button
                        type="button"
                        className={`rh-theme-mode-btn ${activeThemeMode === "light" ? "is-active" : ""}`}
                        onClick={() => applyThemeMode("light")}
                    >
                        亮色
                    </button>
                </div>
            </div>
            <div className="rh-personalization-section">
                <div className="rh-personalization-section-title">自定义背景</div>
                <div className="rh-personalization-bg-controls">
                    <div className="rh-personalization-bg-toggle">
                        <label className="rh-toggle">
                            <input type="checkbox" checked={customBgEnabled} onChange={(e) => setCustomBgEnabled(e.target.checked)} />
                            <span className="rh-toggle-slider" />
                        </label>
                        <span className="rh-personalization-bg-label">启用自定义背景</span>
                    </div>
                    {customBgEnabled && (
                        <>
                            <div className="rh-personalization-bg-preview-wrapper">
                                {customBgImage ? (
                                    <div className="rh-personalization-bg-preview">
                                        <img src={customBgImage} alt="背景预览" />
                                        <button className="rh-personalization-bg-clear" onClick={handleClearCustomBg} title="清除背景">×</button>
                                    </div>
                                ) : (
                                    <button className="rh-personalization-bg-select" onClick={handleCustomBgImageSelect}>
                                        <span className="rh-personalization-bg-icon">🖼️</span>
                                        <span>选择图片</span>
                                    </button>
                                )}
                            </div>
                            {customBgImage && (
                                <>
                                    <div className="rh-personalization-slider-item">
                                        <label>背景透明度: {Math.round(customBgOpacity * 100)}%</label>
                                        <div className="rh-personalization-slider-wrapper">
                                            <input type="range" min="0.05" max="1" step="0.05" value={customBgOpacity} onChange={(e) => setCustomBgOpacity(parseFloat(e.target.value))} className="xlrh-slider" />
                                        </div>
                                    </div>
                                    <div className="rh-personalization-slider-item">
                                        <label>背景模糊: {customBgBlur}px</label>
                                        <div className="rh-personalization-slider-wrapper">
                                            <input type="range" min="0" max="20" step="1" value={customBgBlur} onChange={(e) => setCustomBgBlur(parseInt(e.target.value, 10))} className="xlrh-slider" />
                                        </div>
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </div>
            </div>
            <div className="rh-personalization-section">
                <div className="rh-personalization-section-title">主渐变</div>
                <div className="rh-personalization-color-row">
                    <div className="rh-personalization-color-item">
                        <label>起始颜色</label>
                        <input type="color" value={themeColorStart} onChange={(e) => setThemeColorStart(e.target.value)} className="rh-color-picker" />
                    </div>
                    <div className="rh-personalization-color-item">
                        <label>结束颜色</label>
                        <input type="color" value={themeColorEnd} onChange={(e) => setThemeColorEnd(e.target.value)} className="rh-color-picker" />
                    </div>
                </div>
            </div>
            <div className="rh-personalization-section">
                <div className="rh-personalization-section-title">字体颜色</div>
                <div className="rh-personalization-color-row">
                    <div className="rh-personalization-color-item">
                        <label>全局字体颜色</label>
                        <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="rh-color-picker" />
                    </div>
                </div>
            </div>
            <div className="rh-personalization-section">
                <div className="rh-personalization-section-title">玻璃效果</div>
                <div className="rh-personalization-slider-item">
                    <label>透明度: {Math.round(opacity * 100)}%</label>
                    <div className="rh-personalization-slider-wrapper">
                        <input type="range" min="0" max="1" step="0.05" value={opacity} onChange={(e) => setOpacity(parseFloat(e.target.value))} className="xlrh-slider" />
                    </div>
                </div>
                <div className="rh-personalization-slider-item">
                    <label>模糊程度: {blur}px</label>
                    <div className="rh-personalization-slider-wrapper">
                        <input type="range" min="0" max="30" step="1" value={blur} onChange={(e) => setBlur(parseInt(e.target.value, 10))} className="xlrh-slider" />
                    </div>
                </div>
            </div>
        </div>
    );
}

export function SharedPersonalizationSettingsCard({ defaultOpen = true, dragHandle, ...props }) {
    return (
        <SettingsCard cardClass="rh-personalization-card" icon="🎨" title="个性化" defaultOpen={defaultOpen} dragHandle={dragHandle}>
            <SharedPersonalizationSettingsContent {...props} />
        </SettingsCard>
    );
}
