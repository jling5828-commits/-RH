import React, { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from "react";
import ReactDOM from "react-dom";
import { createPortal } from "react-dom";
import { usePersistedState } from "../../hooks/usePersistedState.js";
import { useStatus } from "../../utils/StatusContext.jsx";
import { readCompatLocalStorage, writeCompatLocalStorage } from "../../utils/storageKeyCompat.js";
import { ComfyShell } from "../../comfy/ComfyShell.jsx";
import { ForgeShell } from "../../forge/ForgeShell.jsx";
import { BananaShell } from "../../banana/BananaShell.jsx";

function hexToRgb(hex) {
    const h = hex.replace("#", "");
    return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)].join(", ");
}

import {
    appendMissingRhBuiltinApps,
    applyDefaultRhAppBundle,
    computeAddOrUpdate,
    computeRemove,
    createRhAppBundle,
    mergeRhAppBundleKeepingLocal,
    mergeMissingRhBuiltinApps,
    parseRhAppBundle,
    refreshRhSavedAppNamesFromApi,
    savedAppsNeedsNameSyncFromApi,
    syncRhBuiltinMigrationsToLocalStorage,
    RH_DEFAULT_APP_BUNDLE_NAME,
    RH_DEFAULT_APP_BUNDLE_APPLIED_KEY,
    RH_SAVED_APPS_KEY,
} from "../rhAppStorage.js";
import { RH_APP_PRESETS_STORAGE_KEY } from "../rhPresetStorage.js";
import { formatRhError } from "../rhErrorCodes.js";
import { notifyPlaceEdgeFeatherChanged } from "../../utils/placeEdgeFeatherOpts.js";
import {
    RESULT_WORKBENCH_RUNNINGHUB,
    migrateRunningHubResultFolderToImageCacheDefault,
} from "../../utils/resultFolderTokens.js";

syncRhBuiltinMigrationsToLocalStorage();
import { SortableContainer, SortableElement, SortableHandle, arrayMove } from "react-sortable-hoc";

function rhShellErrorMessage(error) {
    const message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
    return formatRhError({
        status: error?.status,
        code: error?.code,
        message,
        rawBody: error?.rawBody,
    });
}
import "../../components/TopBar.css";
import "../../components/WorkPanel/WorkPanel.css";
import "../../components/Settings.css";
import "./RunninghubShell.css";
import { RhWorkPanel } from "./RhWorkPanel.jsx";
import { RhAppearanceSettings } from "./RhAppearanceSettings.jsx";
import { SettingsCard } from "../../components/settings/SettingsCard.jsx";
import {
    SharedInteractionSettingsContent,
    SharedPersonalizationSettingsContent,
} from "../../components/settings/SharedInteractionSettingsCard.jsx";
import { ProductModeButton } from "../../components/ProductModeButton.jsx";
import { rhFetchAccountStatus } from "../taskApi.js";
import { webappIdToCanonicalString, fetchAiAppInputs } from "../appDemo.js";
import { RH_DEFAULT_BASE_URL } from "../constants.js";
import { formatRhAppDisplayLabel, requestCloseRhAppDropdowns, useDropdownPosition, RH_APP_MENU_MAX_HEIGHT_PX, RH_CLOSE_APP_DROPDOWNS_EVENT, RH_DROPDOWN_OUTSIDE_EVENTS } from "./runninghubDropdownUtils.js";
import { useRhApiKey } from "../hooks/useRhApiKey.js";
import { RhApiKeySettingsBlock } from "./RhApiKeySettingsBlock.jsx";
import { IconRhGlyph } from "../../components/ProductSwitcherMenu.jsx";
import { isInWebView, shell as bridgeShell, storage as bridgeStorage } from "../../bridge/uxpBridge.js";
import { DEFAULT_FAIL_SOUND, DEFAULT_SUCCESS_SOUND, listSoundFiles, openSoundFolder } from "../../utils/playSound.js";
import {
    RH_PS_CAPTURE_UPLOAD_FORMAT,
    RH_UPLOAD_DEFAULT_LONG_EDGE,
} from "./xlrhRhWorkPanelLogic.js";

const uxpStorage = require("uxp").storage;
const uxpShell = require("uxp").shell;
const uxpFs = uxpStorage.localFileSystem;
const uxpFormats = uxpStorage.formats;

const ACCOUNT_CACHE_MS = 60 * 1000;
const RH_DEFAULT_OPACITY = 0.25;
const RH_DEFAULT_BLUR = 0;
const RH_OLD_DEFAULT_OPACITY = 1;
const RH_OLD_DEFAULT_BLUR = 19;
const RH_APPEARANCE_DEFAULTS_MIGRATED_KEY = "rh_appearance_defaults_v2";
const RH_SOUND_DEFAULTS_MIGRATED_KEY = "rh_sound_defaults_v2";
const RH_UPLOAD_LONG_EDGE_DEFAULT_MIGRATED_KEY = "rh_image_long_edge_default_original_v1";
const RH_EDGE_FEATHER_DEFAULT_MIGRATED_KEY = "xlrh_place_edge_feather_default_off_v1";
const RH_LEGACY_UPLOAD_LONG_EDGE = 2048;
const RH_LEGACY_SUCCESS_SOUND = "小梁图修好了.mp3";
const RH_LEGACY_FAIL_SOUND = "做咩啊.mp3";
const DEFAULT_RH_SETTINGS_CARD_ORDER = ["config", "interaction", "personalization"];
const RH_SETTINGS_CARD_IDS = ["config", "interaction", "personalization"];
const LEGACY_RH_SETTINGS_CARD_ORDER = ["appearance", "account", "config"];
const RH_CARD_ORDER_APPEARANCE_BOTTOM_FLAG = "rh_card_order_appearance_bottom_applied";

const TOPBAR_HEIGHT_RH = 46;

function migrateRhAppearanceDefaults() {
    try {
        if (readCompatLocalStorage(RH_APPEARANCE_DEFAULTS_MIGRATED_KEY) === "1") return;
        const opacityRaw = readCompatLocalStorage("rh_opacity");
        const blurRaw = readCompatLocalStorage("rh_blur");
        if (opacityRaw == null || Number(opacityRaw) === RH_OLD_DEFAULT_OPACITY) {
            writeCompatLocalStorage("rh_opacity", JSON.stringify(RH_DEFAULT_OPACITY));
        }
        if (blurRaw == null || Number(blurRaw) === RH_OLD_DEFAULT_BLUR) {
            writeCompatLocalStorage("rh_blur", JSON.stringify(RH_DEFAULT_BLUR));
        }
        writeCompatLocalStorage(RH_APPEARANCE_DEFAULTS_MIGRATED_KEY, "1");
    } catch (_) {
        /* keep stored appearance unchanged if localStorage is unavailable */
    }
}

migrateRhAppearanceDefaults();

function formatRhTopBarDateTime(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

const IconTrash = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
);

const IconArrowLeft = () => (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5" />
        <polyline points="12 19 5 12 12 5" />
    </svg>
);

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

const IconHelp = () => (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.1 9a3 3 0 1 1 4.9 2.3c-.9.7-1.5 1.2-1.5 2.2" />
        <path d="M12 17h.01" />
    </svg>
);

const RUNNINGHUB_API_KEY_URL = "https://www.runninghub.cn/enterprise-api/sharedApi";

function RhTopBar({
    isSettingsOpen,
    onToggleView,
    onRefresh,
    onRefreshApps,
    onRefreshDefinition,
    duckDecodeEnabled,
    onToggleDuckDecode,
    accountStatus,
    currentKey,
    isActiveProduct,
    onPopupOpenFetchAccount,
}) {
    const { pushStatus } = useStatus();
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [showHelpPopup, setShowHelpPopup] = useState(false);
    const [rhHistory, setRhHistory] = usePersistedState("rh_topbar_history", []);

    useEffect(() => {
        const h = (e) => {
            if (e.detail?.taskSource === "runninghub") {
                setRhHistory((prev) => {
                    const next = [{ timestamp: Date.now(), ...e.detail }];
                    while (next.length > 20) next.pop();
                    return next;
                });
            }
        };
        window.addEventListener("xlrh-task-finished", h);
        return () => window.removeEventListener("xlrh-task-finished", h);
    }, []);

    const handleRefresh = useCallback(async () => {
        if (!currentKey && typeof onRefreshApps !== "function" && typeof onRefreshDefinition !== "function") {
            pushStatus("请先配置 API Key", 3000);
            return;
        }
        setIsRefreshing(true);
        setRefreshKey((k) => k + 1);
        try {
            if (currentKey) await Promise.resolve(onRefresh?.());
            if (typeof onRefreshApps === "function") {
                await onRefreshApps();
            }
        } finally {
            try {
                if (typeof onRefreshDefinition === "function") {
                    await onRefreshDefinition();
                }
            } finally {
                setIsRefreshing(false);
            }
        }
    }, [currentKey, onRefresh, onRefreshApps, onRefreshDefinition, pushStatus]);

    const handleSettingsClick = () => {
        onToggleView();
        if (!isSettingsOpen && onPopupOpenFetchAccount) {
            onPopupOpenFetchAccount();
        }
    };

    const handleOpenApiKeyUrl = useCallback(async (event) => {
        event.preventDefault();
        try {
            if (isInWebView()) await bridgeShell.openExternal(RUNNINGHUB_API_KEY_URL);
            else if (typeof uxpShell.openExternal === "function") await uxpShell.openExternal(RUNNINGHUB_API_KEY_URL);
            else await uxpShell.openPath(RUNNINGHUB_API_KEY_URL);
        } catch (err) {
            const msg = err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
            pushStatus(`打开链接失败：${msg || RUNNINGHUB_API_KEY_URL}`, 5000);
        }
    }, [pushStatus]);

    const balanceMoney = accountStatus?.remainMoney || "-";
    const balanceCoins = accountStatus?.remainCoins || "-";
    const showBalance = !accountStatus?.loading || balanceMoney !== "-" || balanceCoins !== "-" || !!accountStatus?.error;

    return (
        <>
        <div className="rh-balance-bar">
            <div className="rh-balance-content">
                <img src="icons/eye.png" className="rh-balance-icon" alt="" />
                <div className="rh-balance-info">
                    {accountStatus?.loading && !showBalance && <span className="rh-balance-loading">加载中...</span>}
                    {showBalance ? (
                        <>
                            <span className="rh-balance-item">余额 <span className="rh-balance-value">{balanceMoney}</span></span>
                            <span className="rh-balance-item">RH币 <span className="rh-balance-value">{balanceCoins}</span></span>
                        </>
                    ) : (
                        <span className="rh-balance-empty">点击刷新</span>
                    )}
                </div>
            </div>
            <div className="rh-balance-bar-right">
                <button
                    type="button"
                    className={`icon-btn rh-duck-toggle ${duckDecodeEnabled ? "is-on" : ""}`}
                    onClick={onToggleDuckDecode}
                    title={duckDecodeEnabled ? "关闭小黄鸭解码" : "开启小黄鸭解码"}
                    aria-pressed={!!duckDecodeEnabled}
                >
                    <img src="icons/duck_toggle.png" alt="" className="rh-duck-toggle-img" />
                </button>
                <div className="icon-btn" onClick={handleRefresh} title="刷新余额、AI应用和参数设置" key={`refresh-btn-${refreshKey}`}> 
                    <IconRefresh className={isRefreshing ? "rh-spinning" : ""} key={refreshKey} />
                </div>
                <div className="icon-btn rh-help-btn" onClick={() => setShowHelpPopup(true)} title="使用说明">
                    <IconHelp />
                </div>
                <div className="icon-btn" onClick={handleSettingsClick} title={isSettingsOpen ? "返回主页" : "打开设置"}>
                    {isSettingsOpen ? <IconArrowLeft /> : <IconSettings />}
                </div>
            </div>
        </div>
            {showHelpPopup && (
                <div className="xl-popup-overlay" onClick={() => setShowHelpPopup(false)}>
                    <div className="xl-popup-dialog rh-help-dialog" role="dialog" aria-modal="true" aria-label="使用说明" onClick={(e) => e.stopPropagation()}>
                        <div className="xl-popup-icon rh-help-icon">?</div>
                        <div className="xl-popup-title">使用说明</div>
                        <div className="xl-popup-body rh-help-body">
                            <p className="rh-help-intro">小梁RH用于在 Photoshop 内调用 RunningHub AI 应用。选择应用后，插件会自动读取该应用需要的图片和参数，并把生成结果保存到回图缓存，支持自动贴回 PS。</p>
                            <div className="rh-help-section-title">基础流程</div>
                            <ol className="rh-help-list">
                                <li>
                                    <span>在设置中填写 RunningHub API Key。</span>
                                    <button type="button" className="rh-help-link" onClick={handleOpenApiKeyUrl}>{RUNNINGHUB_API_KEY_URL}</button>
                                </li>
                                <li>在顶栏选择要调用的 AI 应用。</li>
                                <li>在捕获图像中点击图1获取当前 PS 图像；图2及更多图片按需单独捕获。</li>
                                <li>在参数设置中按需修改提示词、尺寸、数量等应用参数。</li>
                                <li>点击开始运行，插件会提交任务并等待 RunningHub 生成结果。</li>
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

function RhAppSelect({ options, value, onChange, placeholder, disabled = false, onDeleteApp, savedApps, onReorderApps }) {
    const validSavedApps = Array.isArray(savedApps) ? savedApps : [];
    const [isOpen, setIsOpen] = useState(false);
    const [isClosing, setIsClosing] = useState(false);
    const [isSorting, setIsSorting] = useState(false);
    const [draggedAppId, setDraggedAppId] = useState(null);
    const [dragOverAppId, setDragOverAppId] = useState(null);
    const containerRef = useRef(null);
    const itemsRef = useRef({});
    const isVisible = isOpen || isClosing;
    const dropdownStyle = useDropdownPosition(containerRef, isVisible, false, RH_APP_MENU_MAX_HEIGHT_PX);

    useEffect(() => {
        if (!isVisible) return undefined;
        const h = (e) => {
            if (e.target && containerRef.current?.contains(e.target)) return;
            const dd = document.querySelector(".rh-app-select-dropdown-portal");
            if (e.target && dd?.contains(e.target)) return;
            if (isOpen) setIsClosing(true);
            resetSortState();
        };
        const blur = () => {
            if (isOpen) setIsClosing(true);
            resetSortState();
        };
        const key = (e) => {
            if (e.key !== "Escape") return;
            setIsClosing(true);
            resetSortState();
        };
        RH_DROPDOWN_OUTSIDE_EVENTS.forEach((type) => document.addEventListener(type, h, true));
        document.addEventListener("keydown", key, true);
        window.addEventListener("blur", blur);
        return () => {
            RH_DROPDOWN_OUTSIDE_EVENTS.forEach((type) => document.removeEventListener(type, h, true));
            document.removeEventListener("keydown", key, true);
            window.removeEventListener("blur", blur);
        };
    }, [isOpen, isVisible]);

    useEffect(() => {
        const h = () => {
            setIsClosing(false);
            setIsOpen(false);
            resetSortState();
        };
        window.addEventListener(RH_CLOSE_APP_DROPDOWNS_EVENT, h);
        return () => window.removeEventListener(RH_CLOSE_APP_DROPDOWNS_EVENT, h);
    }, []);

    useEffect(() => {
        if (isClosing) {
            const t = setTimeout(() => {
                setIsClosing(false);
                setIsOpen(false);
            }, 200);
            return () => clearTimeout(t);
        }
    }, [isClosing]);

    useEffect(() => {
        let animationFrameId = null;
        let lastTargetAppId = null;

        const handleMouseMove = (e) => {
            if (!isSorting || !draggedAppId) return;

            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }

            animationFrameId = requestAnimationFrame(() => {
                let foundTarget = null;
                for (const [appId, element] of Object.entries(itemsRef.current)) {
                    if (!element) continue;
                    const rect = element.getBoundingClientRect();
                    if (
                        e.clientX >= rect.left &&
                        e.clientX <= rect.right &&
                        e.clientY >= rect.top &&
                        e.clientY <= rect.bottom
                    ) {
                        foundTarget = appId;
                        break;
                    }
                }

                if (foundTarget && foundTarget !== draggedAppId && foundTarget !== lastTargetAppId) {
                    handleReorder(draggedAppId, foundTarget);
                    lastTargetAppId = foundTarget;
                }
            });
        };

        const handleMouseUp = () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
            lastTargetAppId = null;
            resetSortState();
        };

        if (isSorting) {
            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
        }

        return () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    }, [isSorting, draggedAppId, validSavedApps]);

    const resetSortState = () => {
        setIsSorting(false);
        setDraggedAppId(null);
        setDragOverAppId(null);
    };

    const handleReorder = (draggedId, targetId) => {
        if (typeof onReorderApps === "function" && draggedId && targetId && draggedId !== targetId) {
            const fromIndex = validSavedApps.findIndex(a => a.webappId === draggedId);
            const toIndex = validSavedApps.findIndex(a => a.webappId === targetId);
            if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
                onReorderApps(fromIndex, toIndex);
            }
        }
    };

    const display = options.find((o) => o.id === value)?.label || placeholder || "选择应用";

    const dropdownContent = (
        <div className={`rh-app-select-dropdown ${isVisible ? "open" : ""}`} style={dropdownStyle}>
            <div className="rh-app-select-dropdown-scroll">
                {options.map((opt) => {
                const isAdd = opt.id === "__add_app__";
                if (isAdd) {
                    return (
                        <div
                            key={opt.id}
                            className={`rh-app-select-item rh-app-select-item-add ${value === opt.id ? "selected" : ""}`}
                            onClick={() => {
                                onChange(opt.id);
                                setIsClosing(true);
                            }}
                        >
                            <span className="rh-app-select-add-icon">+</span>
                            <span className="rh-app-select-add-text">添加应用</span>
                        </div>
                    );
                }
                const appIndex = validSavedApps.findIndex((a) => String(a.webappId) === String(opt.id));
                const app = validSavedApps.find((a) => String(a.webappId) === String(opt.id));
                const appName = app?.name || "未命名应用";
                const appId = opt.id;
                const coverUrl = app?.coverUrl;
                
                const handleMouseDown = (e) => {
                    if (e.target.closest(".rh-app-card-delete")) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setIsSorting(true);
                    setDraggedAppId(opt.id);
                };
                
                return (
                    <div
                        key={opt.id}
                        ref={(el) => { itemsRef.current[opt.id] = el; }}
                        className={`rh-app-select-item rh-app-select-item-card ${value === opt.id ? "selected" : ""} ${isSorting ? "sorting" : ""} ${draggedAppId === opt.id ? "dragging" : ""}`}
                        onClick={() => {
                            if (!isSorting) {
                                onChange(opt.id);
                                setIsClosing(true);
                            }
                        }}
                        onMouseDown={handleMouseDown}
                    >
                        <div className="rh-app-card-thumbnail">
                            {coverUrl ? (
                                <img 
                                    src={coverUrl} 
                                    alt={appName} 
                                    className="rh-app-card-cover"
                                    loading="lazy"
                                    onError={(e) => {
                                        e.target.style.display = 'none';
                                        const fallback = document.createElement('span');
                                        fallback.className = 'rh-app-card-icon';
                                        fallback.textContent = '🎨';
                                        e.target.parentElement.appendChild(fallback);
                                    }}
                                />
                            ) : (
                                <span className="rh-app-card-icon">🎨</span>
                            )}
                        </div>
                        <div className="rh-app-card-info">
                            <span className="rh-app-card-name">{appName}</span>
                            <span className="rh-app-card-id">{appId}</span>
                        </div>
                        {typeof onDeleteApp === "function" && (
                            <span className="rh-app-card-delete" onClick={(ev) => {
                                ev.preventDefault();
                                ev.stopPropagation();
                                onDeleteApp(String(opt.id));
                                setIsClosing(false);
                                setIsOpen(true);
                            }} title="从列表移除">
                                ×
                            </span>
                        )}
                    </div>
                );
            })}
            </div>
        </div>
    );

    return (<div className="rh-app-select-wrap">
            <div className={`rh-app-select-trigger-wrap ${isVisible ? "open" : ""} ${disabled ? "is-disabled" : ""}`} ref={containerRef}>
                <div className="rh-app-select-trigger" onClick={() => !disabled && (isOpen ? setIsClosing(true) : setIsOpen(true))}>
                    <span className="rh-app-select-value">{display}</span>
                    <span className="rh-app-select-caret">▼</span>
                </div>
                {isVisible && typeof document !== "undefined" && document.body && ReactDOM.createPortal(
                    <div className="rh-app-select-dropdown-portal">{dropdownContent}</div>,
                    document.body
                )}
            </div>
        </div>);
}

const SettingsDragHandle = SortableHandle(({ icon }) => (
    <span className="title-icon" aria-label="拖拽调整" title="拖拽调整" onClick={(e) => e.stopPropagation()}>
        {icon}
    </span>
));

const SortableSettingsCard = SortableElement(({ children }) => (
    <div className="sortable-card-item">{children}</div>
));

const SortableSettingsList = SortableContainer(({ children, className }) => (
    <div className={`sortable-card-list ${className || ""}`}>{children}</div>
));

function RhSettingsPlaceholder({
    pushStatus,
    accountStatus,
    onRefreshAccount,
    savedApps,
    setSavedApps,
    apiKey,
    apiKeys,
    apiKeyMode,
    setApiKeyForMode,
    setApiKeyMode,
    webappId,
    setWebappId,
    orderedIds,
    cardConfig,
    onSortEnd,
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
    themeMode,
    setThemeMode,
    rhAutoReturnEnabled,
    setRhAutoReturnEnabled,
    concurrentReturnGroupEnabled,
    setConcurrentReturnGroupEnabled,
    uploadLongEdgeMax,
    setUploadLongEdgeMax,
    uploadImageFormat,
    setUploadImageFormat,
    soundFileOptions,
    successSoundFile,
    setSuccessSoundFile,
    failSoundFile,
    setFailSoundFile,
    soundMuted,
    setSoundMuted,
    onOpenSoundFolder,
    onRefreshSoundFiles,
    textColor,
    setTextColor,
}) {
    const [showAddAppPopup, setShowAddAppPopup] = useState(false);
    const [showExportBundlePopup, setShowExportBundlePopup] = useState(false);
    const [exportBundleName, setExportBundleName] = useState(RH_DEFAULT_APP_BUNDLE_NAME);
    const [exportingBundle, setExportingBundle] = useState(false);
    const [rhSettingsCardListSorting, setRhSettingsCardListSorting] = useState(false);
    const [newAppInput, setNewAppInput] = useState("");
    const [addingApp, setAddingApp] = useState(false);

    useEffect(() => {
        if (migrateRunningHubResultFolderToImageCacheDefault()) {
            pushStatus("已切换为默认回图缓存 image_cache", 5000);
        }
    }, [pushStatus]);

    const currentKey = (apiKey || "").trim();
    const keyValid = !!currentKey && !accountStatus?.error && !accountStatus?.loading;
    const validSavedApps = Array.isArray(savedApps) ? savedApps : [];

    const appOptions = [
        { id: "__add_app__", label: "+ 添加应用" },
        ...validSavedApps.reduce((acc, a) => {
            if (!acc.some(item => item.id === a.webappId)) {
                acc.push({ id: a.webappId, label: formatRhAppDisplayLabel(a.name, a.webappId) });
            }
            return acc;
        }, []),
    ];
    const selectedAppId = webappId || "";

    const handleAppSelect = useCallback((id) => {
        if (id === "__add_app__") {
            setShowAddAppPopup(true);
        } else {
            setWebappId(id || "");
        }
    }, [setWebappId]);

    const handleDeleteApp = useCallback((appId) => {
        setSavedApps((prev) => {
            const next = computeRemove(prev, appId);
            setWebappId((wid) => (String(wid) === String(appId) ? next[0]?.webappId ?? "" : wid));
            return next;
        });
        pushStatus("已移除", 2500);
    }, [setSavedApps, setWebappId, pushStatus]);

    const handleSaveApp = useCallback(async () => {
        const raw = String(newAppInput || "").trim();
        if (!raw) {
            pushStatus("请输入应用 ID 或完整链接", 4000);
            return false;
        }
        const id = webappIdToCanonicalString(raw);
        if (!id) {
            pushStatus("无法解析应用 ID", 4000);
            return false;
        }
        if (!currentKey) {
            pushStatus("请先选择有效的 API Key", 4000);
            return false;
        }
        setAddingApp(true);
        try {
            const def = await fetchAiAppInputs(RH_DEFAULT_BASE_URL, currentKey, id, {});
            const name = (def && def.name) ? String(def.name).trim() : "未命名应用";
            setSavedApps((prev) => computeAddOrUpdate(prev, id, name, def?.coverUrl, def?.iconUrl, def?.inputs));
            setWebappId(id);
            setNewAppInput("");
            setShowAddAppPopup(false);
            pushStatus(def?.coverUrl ? `已添加应用并获取封面：${name}` : `已添加应用：${name}`, 3500);
            return true;
        } catch (e) {
            const msg = rhShellErrorMessage(e);
            pushStatus(`添加失败：${msg}`, 6000);
            return false;
        } finally {
            setAddingApp(false);
        }
    }, [newAppInput, currentKey, setSavedApps, setWebappId, pushStatus]);

    const handleImportAppBundle = useCallback(async () => {
        try {
            pushStatus("正在选择集合包...", 0);
            let raw = "";
            if (isInWebView()) {
                const picked = await bridgeStorage.localFileSystem.openTextFile(["json"]);
                if (!picked) return;
                raw = picked.text || "";
            } else {
                const file = await uxpFs.getFileForOpening({
                    types: ["json"],
                    allowMultiple: false,
                });
                if (!file) return;
                raw = await file.read({ format: uxpFormats.utf8 });
            }
            pushStatus("正在导入集合包...", 0);
            const apps = parseRhAppBundle(raw);
            let mergedApps = apps;
            setSavedApps((prev) => {
                mergedApps = mergeRhAppBundleKeepingLocal(prev, apps);
                return mergedApps;
            });
            setWebappId(apps[0]?.webappId || mergedApps[0]?.webappId || "");
            pushStatus(`已导入 ${apps.length} 个 AI 应用，保留 ${Math.max(0, mergedApps.length - apps.length)} 个本地应用`, 4000);
            if (currentKey) {
                refreshRhSavedAppNamesFromApi(currentKey, mergedApps, setSavedApps).then((r) => {
                    pushStatus(`封面获取完成：${r.coverOk || 0} 张，应用 ${r.ok} 个${r.fail ? `，${r.fail} 个失败` : ""}`, r.fail ? 5500 : 4000);
                }).catch(() => {});
            }
        } catch (e) {
            const msg = e && typeof e === "object" && "message" in e ? e.message : String(e);
            if (!/cancel/i.test(msg)) pushStatus(`导入失败：${msg}`, 6000);
        }
    }, [setSavedApps, setWebappId, pushStatus, currentKey]);

    const handleExportAppBundle = useCallback(async () => {
        if (exportingBundle) return;
        const bundleName = String(exportBundleName || "").trim() || RH_DEFAULT_APP_BUNDLE_NAME;
        const fileName = `${bundleName.replace(/\.json$/i, "")}.json`;
        const bundle = createRhAppBundle(validSavedApps, bundleName);
        const content = JSON.stringify(bundle, null, 2);
        setExportingBundle(true);
        try {
            if (isInWebView()) {
                const res = await bridgeStorage.localFileSystem.saveTextFile(fileName, content);
                if (!res) return;
            } else {
                const file = await uxpFs.getFileForSaving(fileName, { types: ["json"] });
                if (!file) return;
                await file.write(content, { format: uxpFormats.utf8 });
            }
            setShowExportBundlePopup(false);
            setExportBundleName(RH_DEFAULT_APP_BUNDLE_NAME);
            pushStatus(`已导出 ${bundle.apps.length} 个 AI 应用`, 4000);
        } catch (e) {
            const msg = e && typeof e === "object" && "message" in e ? e.message : String(e);
            if (!/cancel/i.test(msg)) pushStatus(`导出失败：${msg}`, 6000);
        } finally {
            setExportingBundle(false);
        }
    }, [exportBundleName, validSavedApps, pushStatus, exportingBundle]);

    return (
        <div className="rh-settings-wrap settings-container">
            <SortableSettingsList
                onSortStart={() => setRhSettingsCardListSorting(true)}
                onSortEnd={(sort) => {
                    setRhSettingsCardListSorting(false);
                    onSortEnd(sort);
                }}
                className={rhSettingsCardListSorting ? "sortable-card-list--sorting" : undefined}
                useDragHandle
                transitionDuration={280}
                distance={5}
                axis="y"
                lockAxis="y"
                disableAutoscroll
            >
                {orderedIds.map((cardId, index) => {
                    const cfg = cardConfig[cardId] || { icon: "?", title: cardId, cardClass: "" };
                    if (cardId === "interaction") {
                        return (
                            <SortableSettingsCard key={cardId} index={index}>
                                <SettingsCard
                                    cardClass={cfg.cardClass}
                                    icon={cfg.icon}
                                    title={cfg.title}
                                    defaultOpen={true}
                                    dragHandle={<SettingsDragHandle icon={cfg.icon} />}
                                >
                                    <SharedInteractionSettingsContent
                                        pushStatus={pushStatus}
                                        workbenchId={RESULT_WORKBENCH_RUNNINGHUB}
                                        rhAutoReturnEnabled={rhAutoReturnEnabled}
                                        setRhAutoReturnEnabled={setRhAutoReturnEnabled}
                                        concurrentReturnGroupEnabled={concurrentReturnGroupEnabled}
                                        setConcurrentReturnGroupEnabled={setConcurrentReturnGroupEnabled}
                                        uploadLongEdgeMax={uploadLongEdgeMax}
                                        setUploadLongEdgeMax={setUploadLongEdgeMax}
                                        uploadImageFormat={uploadImageFormat}
                                        setUploadImageFormat={setUploadImageFormat}
                                        soundMuted={soundMuted}
                                        setSoundMuted={setSoundMuted}
                                        soundFileOptions={soundFileOptions}
                                        successSoundFile={successSoundFile}
                                        setSuccessSoundFile={setSuccessSoundFile}
                                        failSoundFile={failSoundFile}
                                        setFailSoundFile={setFailSoundFile}
                                        onOpenSoundFolder={onOpenSoundFolder}
                                        onRefreshSoundFiles={onRefreshSoundFiles}
                                    />
                                </SettingsCard>
                            </SortableSettingsCard>
                        );
                    }
                    if (cardId === "personalization") {
                        return (
                            <SortableSettingsCard key={cardId} index={index}>
                                <SettingsCard
                                    cardClass={cfg.cardClass}
                                    icon={cfg.icon}
                                    title={cfg.title}
                                    defaultOpen={true}
                                    dragHandle={<SettingsDragHandle icon={cfg.icon} />}
                                >
                                    <SharedPersonalizationSettingsContent
                                        themeMode={themeMode}
                                        setThemeMode={setThemeMode}
                                        themeColorStart={themeColorStart}
                                        setThemeColorStart={setThemeColorStart}
                                        themeColorEnd={themeColorEnd}
                                        setThemeColorEnd={setThemeColorEnd}
                                        opacity={opacity}
                                        setOpacity={setOpacity}
                                        blur={blur}
                                        setBlur={setBlur}
                                        customBgEnabled={customBgEnabled}
                                        setCustomBgEnabled={setCustomBgEnabled}
                                        customBgImage={customBgImage}
                                        setCustomBgImage={setCustomBgImage}
                                        customBgOpacity={customBgOpacity}
                                        setCustomBgOpacity={setCustomBgOpacity}
                                        customBgBlur={customBgBlur}
                                        setCustomBgBlur={setCustomBgBlur}
                                        textColor={textColor}
                                        setTextColor={setTextColor}
                                    />
                                </SettingsCard>
                            </SortableSettingsCard>
                        );
                    }
                    return (
                        <SortableSettingsCard key={cardId} index={index}>
                            <SettingsCard
                                cardClass={cfg.cardClass}
                                icon={cfg.icon}
                                title={cfg.title}
                                defaultOpen={true}
                                dragHandle={<SettingsDragHandle icon={cfg.icon} />}
                            >
                                {cardId === "config" && (
                                    <div className="rh-config-content">
                                        <RhApiKeySettingsBlock
                                            apiKeys={apiKeys}
                                            apiKeyMode={apiKeyMode}
                                            setApiKeyForMode={setApiKeyForMode}
                                            setApiKeyMode={setApiKeyMode}
                                            pushStatus={pushStatus}
                                        />
                                        <div className="rh-config-app-block">
                                            <div className="rh-config-row3">
                                                <label className="rh-config-label">AI 应用</label>
                                            </div>
                                            <div className={`rh-config-row4 ${!keyValid ? "is-disabled" : ""}`}>
                                                <RhAppSelect
                                                    options={appOptions}
                                                    value={selectedAppId}
                                                    onChange={handleAppSelect}
                                                    placeholder="选择应用"
                                                    disabled={!keyValid}
                                                    onDeleteApp={handleDeleteApp}
                                                    savedApps={savedApps}
                                                    onReorderApps={(fromIndex, toIndex) => {
                                                        setSavedApps((prev) => {
                                                            const validPrev = Array.isArray(prev) ? prev : [];
                                                            const next = [...validPrev];
                                                            const [removed] = next.splice(fromIndex, 1);
                                                            next.splice(toIndex, 0, removed);
                                                            return next;
                                                        });
                                                    }}
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                className="rh-config-reset-btn rh-config-add-app-btn"
                                                onClick={() => setShowAddAppPopup(true)}
                                                disabled={!keyValid}
                                            >
                                                添加 AI 应用
                                            </button>
                                            <div className="rh-app-bundle-actions">
                                                <button type="button" className="rh-config-reset-btn" onClick={handleImportAppBundle}>导入集合包</button>
                                                <button type="button" className="rh-config-reset-btn" onClick={() => setShowExportBundlePopup(true)}>导出集合包</button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </SettingsCard>
                        </SortableSettingsCard>
                    );
                })}
            </SortableSettingsList>

            {showExportBundlePopup && (
                <div className="xl-popup-overlay" onClick={() => setShowExportBundlePopup(false)}>
                    <div className="xl-popup-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="xl-popup-icon">📦</div>
                        <div className="xl-popup-title">导出 AI 应用集合包</div>
                        <div className="xl-popup-subtitle">输入导出的 JSON 文件名</div>
                        <div className="xl-popup-body">
                            <div className="xl-input-wrapper">
                                <span className="xl-input-icon">✎</span>
                                <input
                                    className="xl-input-field"
                                    type="text"
                                    value={exportBundleName}
                                    onChange={(e) => setExportBundleName(e.target.value)}
                                    placeholder={RH_DEFAULT_APP_BUNDLE_NAME}
                                    autoFocus
                                />
                            </div>
                        </div>
                        <div className="xl-popup-actions">
                            <button className="xl-btn xl-btn-secondary" onClick={() => setShowExportBundlePopup(false)}>
                                取消
                            </button>
                            <button className={`xl-btn xl-btn-primary ${exportingBundle ? "is-loading" : ""}`} onClick={exportingBundle ? undefined : handleExportAppBundle} disabled={exportingBundle}>
                                {exportingBundle ? "导出中..." : "导出"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showAddAppPopup && (
                <div className="xl-popup-overlay" onClick={() => !addingApp && setShowAddAppPopup(false)}>
                    <div className="xl-popup-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="xl-popup-icon">🎨</div>
                        <div className="xl-popup-title">添加新应用</div>
                        <div className="xl-popup-subtitle">输入应用ID或链接来添加</div>
                        <div className="xl-popup-body">
                            <div className="xl-input-wrapper">
                                <span className="xl-input-icon">🔗</span>
                                <input
                                    className="xl-input-field"
                                    type="text"
                                    value={newAppInput}
                                    onChange={(e) => setNewAppInput(e.target.value)}
                                    placeholder="输入应用ID或粘贴链接..."
                                    autoFocus
                                />
                            </div>
                        </div>
                        <div className="xl-popup-actions">
                            <button className="xl-btn xl-btn-secondary" onClick={() => !addingApp && setShowAddAppPopup(false)} disabled={addingApp}>
                                取消
                            </button>
                            <button className={`xl-btn xl-btn-primary ${addingApp ? "is-loading" : ""}`} onClick={addingApp ? undefined : () => handleSaveApp()} disabled={addingApp}>
                                {addingApp ? (
                                    <>
                                        <span className="xl-btn-spinner"></span>
                                        解析中...
                                    </>
                                ) : (
                                    "添加应用"
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export function RunninghubShell({ isActiveProduct = true }) {
    const { pushStatus } = useStatus();
    const [activeProduct, setActiveProduct] = usePersistedState("xlrh_active_product", "runninghub");
    const activeProductMode = activeProduct === "banana" ? "banana" : activeProduct === "forge" ? "forge" : activeProduct === "comfy" ? "comfy" : "runninghub";
    const changeProduct = useCallback((mode) => {
        const next = mode === "banana" ? "banana" : mode === "forge" ? "forge" : mode === "comfy" ? "comfy" : "runninghub";
        requestCloseRhAppDropdowns();
        setActiveProduct(next);
        pushStatus(next === "banana" ? "已切换到 Banana" : next === "forge" ? "已切换到 Forge UI" : next === "comfy" ? "已切换到 Comfy UI" : "已切换到 RunningHub", 2500);
    }, [pushStatus, setActiveProduct]);
    const [inputFontSize, setInputFontSize] = useState(13);
    const loadFontSize = useCallback(() => {
        const savedFontSize = readCompatLocalStorage("xlrh_input_font_size");
        const fs = savedFontSize != null ? parseInt(savedFontSize, 10) : 13;
        setInputFontSize(fs >= 10 && fs <= 22 ? fs : 13);
    }, []);

    const [cardOrder, setCardOrder] = usePersistedState("rh_settings_card_order", DEFAULT_RH_SETTINGS_CARD_ORDER);
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [currentPage, setCurrentPage] = useState("home");
    const [accountStatus, setAccountStatus] = useState(null);
    const [accountStatusCacheUntil, setAccountStatusCacheUntil] = useState(0);
    const accountStatusCacheKeyRef = useRef("");
    const [savedApps, setSavedApps] = usePersistedState(RH_SAVED_APPS_KEY, []);
    const [webappId, setWebappId] = usePersistedState("rh_webapp_id", "");
    const [rhDefinitionRefreshTick, setRhDefinitionRefreshTick] = useState(0);

    const { apiKey, apiKeys, apiKeyMode, setApiKeyForMode, setApiKeyMode } = useRhApiKey();
    const [themeColorStart, setThemeColorStart] = usePersistedState("rh_theme_color_start", "#38d7c8");
    const [themeColorEnd, setThemeColorEnd] = usePersistedState("rh_theme_color_end", "#8b7cff");
    const [opacity, setOpacity] = usePersistedState("rh_opacity", RH_DEFAULT_OPACITY);
    const [blur, setBlur] = usePersistedState("rh_blur", RH_DEFAULT_BLUR);
    const [customBgEnabled, setCustomBgEnabled] = usePersistedState("rh_custom_bg_enabled", false);
    const [customBgImage, setCustomBgImage] = usePersistedState("rh_custom_bg_image", "");
    const [customBgOpacity, setCustomBgOpacity] = usePersistedState("rh_custom_bg_opacity", 0.3);
    const [customBgBlur, setCustomBgBlur] = usePersistedState("rh_custom_bg_blur", 5);
    const [textColor, setTextColor] = usePersistedState("rh_text_color", "#ffffff");
    const [themeMode, setThemeMode] = usePersistedState("rh_theme_mode", "dark");
    const [duckDecodeEnabled, setDuckDecodeEnabled] = usePersistedState("rh_duck_decode_enabled", false);
    const [rhAutoReturnEnabled, setRhAutoReturnEnabled] = usePersistedState("rh_auto_return_enabled", true);
    const [concurrentReturnGroupEnabled, setConcurrentReturnGroupEnabled] = usePersistedState("xlrh_concurrent_return_group_enabled", true);
    const [uploadLongEdgeMax, setUploadLongEdgeMax] = usePersistedState("rh_image_long_edge_max", RH_UPLOAD_DEFAULT_LONG_EDGE);
    const [uploadImageFormat, setUploadImageFormat] = usePersistedState("rh_upload_image_format", RH_PS_CAPTURE_UPLOAD_FORMAT);
    const [soundFileOptions, setSoundFileOptions] = useState([DEFAULT_SUCCESS_SOUND, DEFAULT_FAIL_SOUND]);
    const [successSoundFile, setSuccessSoundFile] = usePersistedState("rh_success_sound_file", DEFAULT_SUCCESS_SOUND);
    const [failSoundFile, setFailSoundFile] = usePersistedState("rh_fail_sound_file", DEFAULT_FAIL_SOUND);
    const [soundMuted, setSoundMuted] = usePersistedState("xlrh_sound_muted", false);
    const [rhTaskRuns, setRhTaskRuns] = useState([]);
    const [comfyTaskRuns, setComfyTaskRuns] = useState([]);
    const [forgeTaskRuns, setForgeTaskRuns] = useState([]);
    const [bananaTaskRuns, setBananaTaskRuns] = useState([]);
    const taskActionRefs = useRef({});
    const sharedTaskRuns = useMemo(() => {
        const tagRuns = (runs, platform) => (Array.isArray(runs) ? runs : []).map((run) => ({ ...run, platform }));
        return [...tagRuns(rhTaskRuns, "runninghub"), ...tagRuns(comfyTaskRuns, "comfy"), ...tagRuns(forgeTaskRuns, "forge"), ...tagRuns(bananaTaskRuns, "banana")].sort((a, b) => (Number(a.startTime || 0) - Number(b.startTime || 0)));
    }, [rhTaskRuns, comfyTaskRuns, forgeTaskRuns, bananaTaskRuns]);
    const registerTaskActions = useCallback((platform, handlers) => {
        taskActionRefs.current[platform] = handlers || {};
        return () => {
            if (taskActionRefs.current[platform] === handlers) delete taskActionRefs.current[platform];
        };
    }, []);
    const registerRunningHubTaskActions = useCallback((handlers) => registerTaskActions("runninghub", handlers), [registerTaskActions]);
    const registerComfyTaskActions = useCallback((handlers) => registerTaskActions("comfy", handlers), [registerTaskActions]);
    const registerForgeTaskActions = useCallback((handlers) => registerTaskActions("forge", handlers), [registerTaskActions]);
    const registerBananaTaskActions = useCallback((handlers) => registerTaskActions("banana", handlers), [registerTaskActions]);
    const handleDismissSharedRun = useCallback((platform, runId) => {
        taskActionRefs.current[platform]?.dismiss?.(runId);
    }, []);
    const handleRetrySharedPlace = useCallback((platform, runId) => {
        taskActionRefs.current[platform]?.retryPlace?.(runId);
    }, []);

    useEffect(() => {
        if (readCompatLocalStorage(RH_SOUND_DEFAULTS_MIGRATED_KEY) === "1") return;
        setSuccessSoundFile((current) => current === RH_LEGACY_SUCCESS_SOUND ? DEFAULT_SUCCESS_SOUND : current);
        setFailSoundFile((current) => current === RH_LEGACY_FAIL_SOUND ? DEFAULT_FAIL_SOUND : current);
        writeCompatLocalStorage(RH_SOUND_DEFAULTS_MIGRATED_KEY, "1");
    }, [setFailSoundFile, setSuccessSoundFile]);

    useEffect(() => {
        if (readCompatLocalStorage(RH_UPLOAD_LONG_EDGE_DEFAULT_MIGRATED_KEY) === "1") return;
        const raw = readCompatLocalStorage("rh_image_long_edge_max");
        let stored = raw;
        try {
            stored = raw == null ? raw : JSON.parse(raw);
        } catch (_) {
            stored = raw;
        }
        if (raw == null || stored === RH_LEGACY_UPLOAD_LONG_EDGE || stored === String(RH_LEGACY_UPLOAD_LONG_EDGE)) {
            setUploadLongEdgeMax(RH_UPLOAD_DEFAULT_LONG_EDGE);
        }
        writeCompatLocalStorage(RH_UPLOAD_LONG_EDGE_DEFAULT_MIGRATED_KEY, "1");
    }, [setUploadLongEdgeMax]);

    useEffect(() => {
        if (readCompatLocalStorage(RH_EDGE_FEATHER_DEFAULT_MIGRATED_KEY) === "1") return;
        const stored = readCompatLocalStorage("xlrh_place_edge_feather_enabled");
        if (stored == null || stored === "" || stored === "true") {
            writeCompatLocalStorage("xlrh_place_edge_feather_enabled", "false");
            notifyPlaceEdgeFeatherChanged({ enabled: false });
        }
        writeCompatLocalStorage(RH_EDGE_FEATHER_DEFAULT_MIGRATED_KEY, "1");
    }, []);

    const toggleDuckDecode = useCallback(() => {
        setDuckDecodeEnabled((prev) => {
            const next = !prev;
            pushStatus(next ? "已开启小黄鸭解码" : "已关闭小黄鸭解码", 3000);
            return next;
        });
    }, [pushStatus, setDuckDecodeEnabled]);

    const refreshSoundFileOptions = useCallback(async () => {
        const files = await listSoundFiles();
        setSoundFileOptions(files);
        setSuccessSoundFile((current) => files.includes(current) ? current : (files.includes(DEFAULT_SUCCESS_SOUND) ? DEFAULT_SUCCESS_SOUND : files[0] || DEFAULT_SUCCESS_SOUND));
        setFailSoundFile((current) => files.includes(current) ? current : (files.includes(DEFAULT_FAIL_SOUND) ? DEFAULT_FAIL_SOUND : files[0] || DEFAULT_FAIL_SOUND));
    }, []);

    const handleOpenSoundFolder = useCallback(async () => {
        try {
            const res = await openSoundFolder();
            const path = String(res?.nativePath || "").trim();
            pushStatus(path ? `已打开语音文件夹：${path}` : "已打开语音文件夹", 4000);
            await refreshSoundFileOptions();
        } catch (error) {
            pushStatus(`打开语音文件夹失败：${error?.message || error}`, 5000);
        }
    }, [pushStatus, refreshSoundFileOptions]);

    useEffect(() => {
        refreshSoundFileOptions();
        const timer = window.setInterval(refreshSoundFileOptions, 5000);
        return () => window.clearInterval(timer);
    }, [refreshSoundFileOptions]);

    useEffect(() => {
        if (customBgEnabled && customBgImage && Number(customBgOpacity) <= 0) {
            setCustomBgOpacity(0.3);
            return;
        }

        const root = document.documentElement;
        root.style.setProperty('--rh-theme-start', themeColorStart);
        root.style.setProperty('--rh-theme-end', themeColorEnd);
        root.style.setProperty('--rh-theme-start-rgb', hexToRgb(themeColorStart));
        root.style.setProperty('--rh-theme-end-rgb', hexToRgb(themeColorEnd));
        root.style.setProperty('--rh-opacity', opacity);
        root.style.setProperty('--rh-blur', `${blur}px`);
        root.style.setProperty('--rh-text-color', textColor);
    }, [themeColorStart, themeColorEnd, opacity, blur, textColor, customBgEnabled, customBgImage, customBgOpacity, setCustomBgOpacity]);

    const showCustomBackground = customBgEnabled && !!customBgImage;

    useEffect(() => {
        loadFontSize();
        const validSavedApps = Array.isArray(savedApps) ? savedApps : [];
        const shouldApplyDefaultBundle = !localStorage.getItem(RH_DEFAULT_APP_BUNDLE_APPLIED_KEY);
        const nextApps = shouldApplyDefaultBundle ? applyDefaultRhAppBundle(validSavedApps) : mergeMissingRhBuiltinApps(validSavedApps);
        if (shouldApplyDefaultBundle) {
            localStorage.setItem(RH_DEFAULT_APP_BUNDLE_APPLIED_KEY, "1");
        }
        if (JSON.stringify(nextApps) !== JSON.stringify(validSavedApps)) {
            setSavedApps(nextApps);
        }
        const appsForRefresh = nextApps;
        const needsAppInfoSync = savedAppsNeedsNameSyncFromApi(appsForRefresh) || appsForRefresh.some((a) => !a?.coverUrl && !a?.iconUrl);
        if (needsAppInfoSync) {
            const key = apiKey || "";
            if (key) {
                pushStatus("正在从 RunningHub 获取应用封面图...", 0);
                refreshRhSavedAppNamesFromApi(key, appsForRefresh, setSavedApps).then((r) => {
                    pushStatus(`封面获取完成：${r.coverOk || 0} 张，应用 ${r.ok} 个${r.fail ? `，${r.fail} 个解析失败` : ""}`, r.fail ? 5500 : 4000);
                }).catch((e) => {
                    const msg = rhShellErrorMessage(e);
                    pushStatus(`获取应用封面失败：${msg}`, 6000);
                });
            }
        }
        const storedOrder = localStorage.getItem("rh_settings_card_order");
        if (storedOrder) {
            try {
                const parsed = JSON.parse(storedOrder);
                if (Array.isArray(parsed)) {
                    const migrated = parsed.includes("appearance") ? DEFAULT_RH_SETTINGS_CARD_ORDER : parsed;
                    if (JSON.stringify(migrated) !== JSON.stringify(cardOrder)) {
                        setCardOrder(migrated);
                    }
                }
            } catch (e) {
                console.error("[RhSettings] Failed to parse card order:", e);
            }
        }
    }, []);

    const fetchAccountStatus = useCallback((force) => {
        const now = Date.now();
        const key = apiKey || "";
        if (!force && accountStatusCacheKeyRef.current === key && now < accountStatusCacheUntil) return;
        if (!key) {
            accountStatusCacheKeyRef.current = "";
            setAccountStatus(null);
            return;
        }
        accountStatusCacheKeyRef.current = key;
        setAccountStatus((prev) => ({ ...(prev || {}), loading: true, error: "" }));
        rhFetchAccountStatus(RH_DEFAULT_BASE_URL, key).then((status) => {
            setAccountStatus({ ...status, loading: false });
            setAccountStatusCacheUntil(Date.now() + ACCOUNT_CACHE_MS);
        }).catch((e) => {
            setAccountStatus((prev) => ({ ...(prev || {}), error: rhShellErrorMessage(e), loading: false }));
        });
    }, [apiKey, accountStatusCacheUntil]);

    useEffect(() => {
        fetchAccountStatus(false);
    }, [apiKey, fetchAccountStatus]);

    const toggleSettings = useCallback(() => {
        requestCloseRhAppDropdowns();
        setCurrentPage((p) => (p === "home" ? "settings" : "home"));
    }, []);

    const isHome = currentPage === "home";
    const themeModeClass = themeMode === "dark" ? "rh-theme-dark" : "rh-theme-light";

    useEffect(() => {
        requestCloseRhAppDropdowns();
    }, [activeProductMode, currentPage]);

    const orderedIds = (() => {
        const ids = Array.isArray(cardOrder) ? cardOrder : DEFAULT_RH_SETTINGS_CARD_ORDER;
        const valid = ids.filter((id) => RH_SETTINGS_CARD_IDS.includes(id));
        const missing = RH_SETTINGS_CARD_IDS.filter((id) => !valid.includes(id));
        return [...valid, ...missing];
    })();

    const cardConfig = {
        config: { icon: "🔑", title: "AI 应用管理", cardClass: "rh-config-card" },
        interaction: { icon: "⚡", title: "交互", cardClass: "rh-interaction-card" },
        personalization: { icon: "🎨", title: "个性化", cardClass: "rh-personalization-card" },
    };

    const handleSortEnd = useCallback((sort) => {
        const next = arrayMove(cardOrder, sort.oldIndex, sort.newIndex);
        setCardOrder(next);
        localStorage.setItem("rh_settings_card_order", JSON.stringify(next));
    }, [cardOrder, setCardOrder]);

    return (
        <div
            className={`rh-shell-container rh-custom-text-color ${themeModeClass}`}
            style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                overflowY: "auto",
                overflowX: "hidden",
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                "--topbar-height": "46px",
                "--xlrh-input-font-size": `${inputFontSize}px`,
            }}
        >
            {showCustomBackground && (
                <div className="rh-custom-bg-layer" aria-hidden="true">
                    <img
                        src={customBgImage}
                        alt=""
                        className="rh-custom-bg-image"
                        style={{
                            opacity: customBgOpacity,
                            filter: `blur(${customBgBlur}px)`,
                        }}
                    />
                </div>
            )}
            <ProductModeButton activeProduct={activeProductMode} onChange={changeProduct} />
            <div style={{ display: activeProductMode === "comfy" ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column" }}>
                <ComfyShell
                    activeProduct={activeProductMode}
                    onChangeProduct={changeProduct}
                    sharedSettings={{
                        pushStatus,
                        rhAutoReturnEnabled,
                        setRhAutoReturnEnabled,
                        concurrentReturnGroupEnabled,
                        setConcurrentReturnGroupEnabled,
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
                        themeMode,
                        setThemeMode,
                        textColor,
                        setTextColor,
                        soundFileOptions,
                        successSoundFile,
                        setSuccessSoundFile,
                        failSoundFile,
                        setFailSoundFile,
                        soundMuted,
                        setSoundMuted,
                        onOpenSoundFolder: handleOpenSoundFolder,
                        onRefreshSoundFiles: refreshSoundFileOptions,
                    }}
                    onRunsChange={setComfyTaskRuns}
                    sharedTaskRuns={sharedTaskRuns}
                    onDismissSharedRun={handleDismissSharedRun}
                    onRetrySharedPlace={handleRetrySharedPlace}
                    onRegisterTaskActions={registerComfyTaskActions}
                />
            </div>
            <div style={{ display: activeProductMode === "forge" ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column" }}>
                <ForgeShell
                    activeProduct={activeProductMode}
                    onChangeProduct={changeProduct}
                    sharedSettings={{
                        pushStatus,
                        rhAutoReturnEnabled,
                        setRhAutoReturnEnabled,
                        concurrentReturnGroupEnabled,
                        setConcurrentReturnGroupEnabled,
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
                        themeMode,
                        setThemeMode,
                        textColor,
                        setTextColor,
                        soundFileOptions,
                        successSoundFile,
                        setSuccessSoundFile,
                        failSoundFile,
                        setFailSoundFile,
                        soundMuted,
                        setSoundMuted,
                        onOpenSoundFolder: handleOpenSoundFolder,
                        onRefreshSoundFiles: refreshSoundFileOptions,
                    }}
                    onRunsChange={setForgeTaskRuns}
                    sharedTaskRuns={sharedTaskRuns}
                    onDismissSharedRun={handleDismissSharedRun}
                    onRetrySharedPlace={handleRetrySharedPlace}
                    onRegisterTaskActions={registerForgeTaskActions}
                />
            </div>
            <div className="banana-product-panel" style={{ display: activeProductMode === "banana" ? "flex" : "none", flex: "0 0 auto", minHeight: "100%", flexDirection: "column" }}>
                <BananaShell
                    activeProduct={activeProductMode}
                    onChangeProduct={changeProduct}
                    sharedSettings={{
                        pushStatus,
                        rhAutoReturnEnabled,
                        setRhAutoReturnEnabled,
                        concurrentReturnGroupEnabled,
                        setConcurrentReturnGroupEnabled,
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
                        themeMode,
                        setThemeMode,
                        textColor,
                        setTextColor,
                        soundFileOptions,
                        successSoundFile,
                        setSuccessSoundFile,
                        failSoundFile,
                        setFailSoundFile,
                        soundMuted,
                        setSoundMuted,
                        onOpenSoundFolder: handleOpenSoundFolder,
                        onRefreshSoundFiles: refreshSoundFileOptions,
                    }}
                    onRunsChange={setBananaTaskRuns}
                    sharedTaskRuns={sharedTaskRuns}
                    onDismissSharedRun={handleDismissSharedRun}
                    onRetrySharedPlace={handleRetrySharedPlace}
                    onRegisterTaskActions={registerBananaTaskActions}
                />
            </div>
            <div style={{ display: activeProductMode === "runninghub" ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column" }}>
            <RhTopBar
                isSettingsOpen={!isHome}
                onToggleView={toggleSettings}
                onRefresh={() => fetchAccountStatus(true)}
                onRefreshDefinition={() => setRhDefinitionRefreshTick((tick) => tick + 1)}
                onRefreshApps={() => {
                    const key = apiKey || "";
                    const validSavedApps = Array.isArray(savedApps) ? savedApps : [];
                    const restoredApps = appendMissingRhBuiltinApps(validSavedApps);
                    const restoredCount = restoredApps.length - validSavedApps.length;
                    if (restoredCount > 0) setSavedApps(restoredApps);
                    if (!key) {
                        pushStatus(restoredCount > 0 ? `已恢复默认AI应用：${restoredCount} 个` : "请先配置 API Key", 3000);
                        return Promise.resolve();
                    }
                    pushStatus("正在获取全部AI应用封面图...", 0);
                    return refreshRhSavedAppNamesFromApi(key, restoredApps, setSavedApps).then((r) => {
                        const restoredText = restoredCount > 0 ? `已恢复 ${restoredCount} 个默认应用；` : "";
                        pushStatus(`${restoredText}封面获取完成：${r.coverOk || 0} 张，应用 ${r.ok} 个${r.fail ? `，${r.fail} 个失败` : ""}`, r.fail ? 5500 : 4000);
                    }).catch((e) => {
                        const msg = rhShellErrorMessage(e);
                        pushStatus(`获取封面失败：${msg}`, 6000);
                        throw e;
                    });
                }}
                duckDecodeEnabled={duckDecodeEnabled}
                onToggleDuckDecode={toggleDuckDecode}
                accountStatus={accountStatus}
                currentKey={apiKey}
                isActiveProduct={isActiveProduct}
                onPopupOpenFetchAccount={() => fetchAccountStatus(false)}
            />
            <div
                key="rh-work"
                style={{
                    flex: 1,
                    minHeight: 0,
                    overflow: "visible",
                    display: isHome ? "flex" : "none",
                    flexDirection: "column",
                    background: "transparent",
                }}
            >
                <RhWorkPanel
                    pushStatus={pushStatus}
                    savedApps={savedApps}
                    setSavedApps={setSavedApps}
                    onOpenSettings={() => setCurrentPage("settings")}
                    currentKey={apiKey}
                    apiKeyMode={apiKeyMode}
                    isActiveProduct={isActiveProduct && activeProductMode === "runninghub" && isHome}
                    duckDecodeEnabled={duckDecodeEnabled}
                    autoReturnEnabled={rhAutoReturnEnabled}
                    uploadLongEdgeMax={uploadLongEdgeMax}
                    uploadImageFormat={uploadImageFormat}
                    successSoundFile={successSoundFile}
                    failSoundFile={failSoundFile}
                    definitionRefreshTick={rhDefinitionRefreshTick}
                    onRefreshAccount={() => fetchAccountStatus(true)}
                    onRunsChange={setRhTaskRuns}
                    sharedTaskRuns={sharedTaskRuns}
                    onDismissSharedRun={handleDismissSharedRun}
                    onRetrySharedPlace={handleRetrySharedPlace}
                    onRegisterTaskActions={registerRunningHubTaskActions}
                />
            </div>
            <div
                style={{
                    flex: 1,
                    minHeight: 0,
                    overflow: "visible",
                    display: isHome ? "none" : "block",
                    background: "transparent",
                }}
            >
                <RhSettingsPlaceholder
                    pushStatus={pushStatus}
                    accountStatus={accountStatus}
                    onRefreshAccount={() => fetchAccountStatus(true)}
                    savedApps={savedApps}
                    setSavedApps={setSavedApps}
                    apiKey={apiKey}
                    apiKeys={apiKeys}
                    apiKeyMode={apiKeyMode}
                    setApiKeyForMode={setApiKeyForMode}
                    setApiKeyMode={setApiKeyMode}
                    webappId={webappId}
                    setWebappId={setWebappId}
                    orderedIds={orderedIds}
                    cardConfig={cardConfig}
                    onSortEnd={handleSortEnd}
                    themeColorStart={themeColorStart}
                    setThemeColorStart={setThemeColorStart}
                    themeColorEnd={themeColorEnd}
                    setThemeColorEnd={setThemeColorEnd}
                    opacity={opacity}
                    setOpacity={setOpacity}
                    blur={blur}
                    setBlur={setBlur}
                    customBgEnabled={customBgEnabled}
                    setCustomBgEnabled={setCustomBgEnabled}
                    customBgImage={customBgImage}
                    setCustomBgImage={setCustomBgImage}
                    customBgOpacity={customBgOpacity}
                    setCustomBgOpacity={setCustomBgOpacity}
                    customBgBlur={customBgBlur}
                    setCustomBgBlur={setCustomBgBlur}
                    themeMode={themeMode}
                    setThemeMode={setThemeMode}
                    rhAutoReturnEnabled={rhAutoReturnEnabled}
                    setRhAutoReturnEnabled={setRhAutoReturnEnabled}
                    concurrentReturnGroupEnabled={concurrentReturnGroupEnabled}
                    setConcurrentReturnGroupEnabled={setConcurrentReturnGroupEnabled}
                    uploadLongEdgeMax={uploadLongEdgeMax}
                    setUploadLongEdgeMax={setUploadLongEdgeMax}
                    uploadImageFormat={uploadImageFormat}
                    setUploadImageFormat={setUploadImageFormat}
                    soundFileOptions={soundFileOptions}
                    successSoundFile={successSoundFile}
                    setSuccessSoundFile={setSuccessSoundFile}
                    failSoundFile={failSoundFile}
                    setFailSoundFile={setFailSoundFile}
                    soundMuted={soundMuted}
                    setSoundMuted={setSoundMuted}
                    onOpenSoundFolder={handleOpenSoundFolder}
                    onRefreshSoundFiles={refreshSoundFileOptions}
                    textColor={textColor}
                    setTextColor={setTextColor}
                />
            </div>
            </div>
        </div>
    );
}
