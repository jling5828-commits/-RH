import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./Results.css";
import { useStatus } from "../utils/StatusContext.jsx";
import { storage } from "../bridge/uxpShim.js";
import { photoshop } from "../bridge/uxpBridge.js";
import { getFromCache, injectToCache, putToCache } from "../utils/imageCache.js";
import { PLUGIN_PANEL_TITLE } from "../pluginMeta.js";
import {
    getPlaceEdgeFeatherOptsFromStorage,
    PLACE_EDGE_FEATHER_CHANGED,
    readPlaceEdgeFeatherEnabledFromStorage,
    readPlaceKeepSelectionFromStorage,
    notifyPlaceEdgeFeatherChanged,
} from "../utils/placeEdgeFeatherOpts.js";
import {
    isCompatStorageKey,
    readCompatLocalStorage,
    writeCompatLocalStorage,
} from "../utils/storageKeyCompat.js";
import { RESULT_FILES_CHANGED } from "../utils/resultFilesSync.js";
import {
    getEffectiveResultFolderToken,
    getGlobalResultFolderToken,
    getOverrideResultFolderToken,
    setGlobalResultFolderToken,
    setOverrideResultFolderToken,
    clearOverrideResultFolderToken,
    clearGlobalResultFolderToken,
    setWorkbenchFolderOptOut,
    RESULT_FOLDER_STORAGE_CHANGED,
    RESULT_WORKBENCH_RUNNINGHUB,
} from "../utils/resultFolderTokens.js";
import { useResultPopover } from "./results/useResultPopover.js";
import { XlrhResultsView } from "./results/XlrhResultsView.jsx";
import {
    cleanupResultManifestOrphans,
    clearResultViewer,
    clampCounterJump,
    collectResultImageFiles,
    defaultRhResultFolder,
    deleteResultSidecarIfExists,
    folderFromToken,
    formatFolderPathPrefixForBar,
    getResultCacheFolder,
    isXiaoLiangResultFile,
    makeViewerStateFromFiles,
    readResultPlaceSidecar,
    readResultFileAsDataUrl,
    removeResultManifestEntries,
} from "./results/xlrhResultFiles.js";

const fs = storage.localFileSystem;

function shouldFollowResultEvent(workbenchId, eventFolderToken) {
    const currentToken = getEffectiveResultFolderToken(workbenchId);
    if (eventFolderToken != null && eventFolderToken !== "") {
        return currentToken ? currentToken === eventFolderToken : workbenchId === RESULT_WORKBENCH_RUNNINGHUB;
    }
    return Boolean(currentToken) || workbenchId === RESULT_WORKBENCH_RUNNINGHUB;
}

function useResultFileBroadcasts(workbenchId, refreshFileList) {
    useEffect(() => {
        const onResultFilesChanged = (event) => {
            const token = event?.detail?.folderToken ?? null;
            if (shouldFollowResultEvent(workbenchId, token)) void refreshFileList(true);
        };
        window.addEventListener(RESULT_FILES_CHANGED, onResultFilesChanged);
        return () => window.removeEventListener(RESULT_FILES_CHANGED, onResultFilesChanged);
    }, [workbenchId, refreshFileList]);
}

function usePlacePreferences(setEdgeFeatherEnabled, setKeepSelection) {
    useEffect(() => {
        const onEdgeFeatherChanged = (event) => {
            const enabled = event?.detail?.enabled;
            const keepSelection = event?.detail?.keepSelection;
            setEdgeFeatherEnabled(typeof enabled === "boolean" ? enabled : readPlaceEdgeFeatherEnabledFromStorage());
            if (typeof keepSelection === "boolean") setKeepSelection(keepSelection);
        };
        window.addEventListener(PLACE_EDGE_FEATHER_CHANGED, onEdgeFeatherChanged);
        return () => window.removeEventListener(PLACE_EDGE_FEATHER_CHANGED, onEdgeFeatherChanged);
    }, [setEdgeFeatherEnabled, setKeepSelection]);

    useEffect(() => {
        const onCompatStorageChanged = (event) => {
            if (isCompatStorageKey(event?.key, "xlrh_place_edge_feather_enabled")) {
                setEdgeFeatherEnabled(readPlaceEdgeFeatherEnabledFromStorage());
            }
            if (isCompatStorageKey(event?.key, "xlrh_place_keep_selection")) {
                setKeepSelection(readPlaceKeepSelectionFromStorage());
            }
        };
        window.addEventListener("storage", onCompatStorageChanged);
        return () => window.removeEventListener("storage", onCompatStorageChanged);
    }, [setEdgeFeatherEnabled, setKeepSelection]);
}

function useRefreshWhenProductReturns(isActiveProduct, refreshFileList) {
    const previousActiveRef = useRef(isActiveProduct);
    useEffect(() => {
        const wasActive = previousActiveRef.current;
        previousActiveRef.current = isActiveProduct;
        if (!wasActive && isActiveProduct) void refreshFileList(true);
    }, [isActiveProduct, refreshFileList]);
}

function placeGroupName(inputName) {
    const name = typeof inputName === "string" ? inputName.trim() : "";
    return name || `${PLUGIN_PANEL_TITLE} 生成`;
}

function tokenForPlaceTarget({ workbenchId, userFolder, overrideToken }) {
    if (overrideToken) return overrideToken;
    const stored = getEffectiveResultFolderToken(workbenchId);
    if (stored) return stored;
    return userFolder?.token ? String(userFolder.token) : null;
}

async function placeResultFile({ userFolder, fileName, preferSavedBounds, pushStatus }) {
    const entries = await userFolder.getEntries();
    const file = (entries || []).find((entry) => entry?.isFile && entry.name === fileName);
    if (!file) {
        pushStatus(`File not found: ${fileName}`);
        return;
    }
    const placeInfo = preferSavedBounds ? await readResultPlaceSidecar(userFolder, fileName) : null;
    const token = await fs.createSessionToken(file);
    const placeOpts = {
        ...getPlaceEdgeFeatherOptsFromStorage(),
        ...(preferSavedBounds ? { useSavedPlaceContext: true } : {}),
    };
    if (placeInfo?.docId != null) {
        await photoshop.commands.placeToDocument(placeInfo.docId, token, placeInfo.bounds, placeOpts);
    } else {
        await photoshop.commands.placeFileToCanvas(token, placeInfo?.bounds ?? null, preferSavedBounds, placeOpts);
    }
}

async function autoPlaceSingle({ enabled, userFolder, fileName, placeFileToCanvas }) {
    if (!enabled || !userFolder || !fileName) return;
    try {
        console.log(`[XiaoLiangRH ResultPlace] 置入单张: ${fileName}`);
        await placeFileToCanvas(fileName, true);
    } catch (error) {
        console.warn("[XiaoLiangRH ResultPlace] 单张置入失败:", error);
    }
}

async function autoPlaceGroup({ enabled, fileNames, groupName, savedBoundsParam, folderTokenOverride, workbenchId, userFolder, pushStatus }) {
    if (!enabled || !Array.isArray(fileNames) || fileNames.length === 0) return;
    const token = tokenForPlaceTarget({ workbenchId, userFolder, overrideToken: folderTokenOverride });
    if (!token) return;
    const savedBounds = savedBoundsParam ?? null;
    try {
        await photoshop.commands.placeFilesIntoNewGroup?.(
            token,
            fileNames,
            savedBounds,
            placeGroupName(groupName),
            { ...getPlaceEdgeFeatherOptsFromStorage(), useSavedPlaceContext: true }
        );
        pushStatus(`已置入 ${fileNames.length} 张到图层组`);
    } catch (error) {
        console.warn("[XiaoLiangRH ResultPlace] 批量置入失败:", error);
    }
}

function makeRefreshBridge(context) {
    const isAutoPlace = () => Boolean(context.autoPlace);
    return {
        refresh: context.refreshFileList,
        injectToCache,
        autoPlaceByName: (fileName) => autoPlaceSingle({
            enabled: isAutoPlace(),
            userFolder: context.userFolder,
            fileName,
            placeFileToCanvas: context.placeFileToCanvas,
        }),
        autoPlaceManyIntoGroup: (fileNames, groupName, savedBoundsParam = null, folderTokenOverride = null) => autoPlaceGroup({
            enabled: isAutoPlace(),
            fileNames,
            groupName,
            savedBoundsParam,
            folderTokenOverride,
            workbenchId: context.workbenchId,
            userFolder: context.userFolder,
            pushStatus: context.pushStatus,
        }),
        isAutoPlace,
    };
}

function asViewPopover(popover) {
    return {
        rootRef: popover.rootRef,
        visible: popover.visible,
        closing: popover.closing,
        toggle: popover.toggleFromClick,
        close: popover.close,
        wrapHoverProps: popover.wrapHoverProps,
        menuHoverProps: popover.menuHoverProps,
    };
}

export const Results = ({
    newImageBase64,
    onRefreshRef,
    workbenchId = "runninghub",
    isActiveProduct = true,
}) => {
    const { pushStatus } = useStatus();
    const [fileList, setFileList] = useState([]);
    const [currentImgUrl, setCurrentImgUrl] = useState(null);
    const [currentIndex, setCurrentIndex] = useState(-1);
    const [isLoadingImg, setIsLoadingImg] = useState(false);
    const [errorMsg, setErrorMsg] = useState(null);
    const [userFolder, setUserFolder] = useState(null);
    const [isHovered, setIsHovered] = useState(false);
    const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
    const [counterEdit, setCounterEdit] = useState(false);
    const [counterDraft, setCounterDraft] = useState("");
    const counterInputRef = useRef(null);

    const deletePopover = useResultPopover();
    const folderPopover = useResultPopover();
    const featherPopover = useResultPopover();

    const [autoPlace, setAutoPlace] = useState(() => {
        const saved = readCompatLocalStorage("xlrh_auto_place");
        return saved === null ? true : saved === "true";
    });
    const [placeEdgeFeatherEnabled, setPlaceEdgeFeatherEnabled] = useState(() => readPlaceEdgeFeatherEnabledFromStorage());
    const [placeKeepSelection, setPlaceKeepSelection] = useState(() => readPlaceKeepSelectionFromStorage());

    useEffect(() => writeCompatLocalStorage("xlrh_auto_place", String(autoPlace)), [autoPlace]);
    useEffect(() => writeCompatLocalStorage("xlrh_place_edge_feather_enabled", String(placeEdgeFeatherEnabled)), [placeEdgeFeatherEnabled]);
    useEffect(() => writeCompatLocalStorage("xlrh_place_keep_selection", String(placeKeepSelection)), [placeKeepSelection]);

    const loadFolderFiles = useCallback(async (folder) => {
        if (!folder) return;
        try {
            const nextState = makeViewerStateFromFiles(await collectResultImageFiles(folder, workbenchId));
            setFileList(nextState.fileList);
            setCurrentIndex(nextState.currentIndex);
            if (nextState.clearPreview) setCurrentImgUrl(null);
            setErrorMsg(null);
        } catch (error) {
            console.error("读取文件夹失败:", error);
            setErrorMsg("读取目录失败");
        }
    }, [workbenchId]);

    const bindFolderAndLoad = useCallback(async (folder, statusMsg) => {
        setUserFolder(folder);
        await loadFolderFiles(folder);
        if (statusMsg) pushStatus(statusMsg);
    }, [loadFolderFiles, pushStatus]);

    const resetViewerFolderState = useCallback(() => {
        clearResultViewer({ setUserFolder, setFileList, setCurrentIndex, setCurrentImgUrl });
    }, []);

    const restoreFromStorage = useCallback(async (quiet, isCancelled) => {
        const bindRestoredFolder = async (folder, shouldNotify) => {
            if (isCancelled() || !folder) return false;
            setUserFolder(folder);
            await loadFolderFiles(folder);
            if (shouldNotify && !quiet) pushStatus(`已恢复: ${folder.name}`);
            return true;
        };

        const effectiveToken = getEffectiveResultFolderToken(workbenchId);
        if (!effectiveToken) {
            const defaultFolder = await defaultRhResultFolder(workbenchId);
            if (await bindRestoredFolder(defaultFolder, false)) return;
            if (!isCancelled()) setUserFolder(null);
            return;
        }
        if (await bindRestoredFolder(await folderFromToken(effectiveToken), true)) return;
        if (isCancelled()) return;
        if (getOverrideResultFolderToken(workbenchId)) {
            clearOverrideResultFolderToken(workbenchId);
            if (await bindRestoredFolder(await folderFromToken(getGlobalResultFolderToken()), true)) return;
        }
        if (!isCancelled()) {
            clearGlobalResultFolderToken();
            clearOverrideResultFolderToken(workbenchId);
            setUserFolder(null);
        }
    }, [loadFolderFiles, pushStatus, workbenchId]);

    useEffect(() => {
        let cancelled = false;
        void restoreFromStorage(false, () => cancelled);
        return () => {
            cancelled = true;
        };
    }, [restoreFromStorage, workbenchId]);

    useEffect(() => {
        const onFolderStorageChanged = () => void restoreFromStorage(true, () => false);
        window.addEventListener(RESULT_FOLDER_STORAGE_CHANGED, onFolderStorageChanged);
        return () => window.removeEventListener(RESULT_FOLDER_STORAGE_CHANGED, onFolderStorageChanged);
    }, [restoreFromStorage]);

    const handleSwitchLocalFolder = useCallback(async () => {
        try {
            const pickedFolder = await fs.getFolder();
            if (!pickedFolder) return;
            const token = await fs.createPersistentToken(pickedFolder);
            if (getGlobalResultFolderToken()) {
                setOverrideResultFolderToken(workbenchId, token);
                await bindFolderAndLoad(pickedFolder, `本工作台存储：${pickedFolder.name}`);
            } else {
                setGlobalResultFolderToken(token, workbenchId);
                await bindFolderAndLoad(pickedFolder, `已绑定本地存储：${pickedFolder.name}`);
            }
            folderPopover.close();
        } catch (error) {
            console.log("[XLRH Results] choose folder cancelled or failed:", error);
        }
    }, [bindFolderAndLoad, folderPopover, workbenchId]);

    const handleRestoreInitialFolder = useCallback(async () => {
        try {
            clearOverrideResultFolderToken(workbenchId);
            const token = getGlobalResultFolderToken();
            if (!token) {
                resetViewerFolderState();
                folderPopover.close();
                return;
            }
            const folder = await folderFromToken(token);
            if (folder) {
                await bindFolderAndLoad(folder, "已恢复初始文件夹");
            } else {
                clearGlobalResultFolderToken();
                resetViewerFolderState();
                pushStatus("全局目录失效，请重新选择");
            }
        } catch (error) {
            console.warn("[XLRH Results] restore initial folder failed:", error);
            pushStatus("恢复失败");
        }
        folderPopover.close();
    }, [bindFolderAndLoad, folderPopover, pushStatus, resetViewerFolderState, workbenchId]);

    const handleUnbindFolder = useCallback(async () => {
        try {
            if (getGlobalResultFolderToken()) setWorkbenchFolderOptOut(workbenchId);
            else clearOverrideResultFolderToken(workbenchId);
            resetViewerFolderState();
            pushStatus("本工作台已取消绑定");
        } catch (error) {
            console.warn("[XLRH Results] unbind folder failed:", error);
            pushStatus("取消绑定失败");
        }
        folderPopover.close();
    }, [folderPopover, pushStatus, resetViewerFolderState, workbenchId]);

    const refreshFileList = useCallback(async (quiet = false) => {
        const token = getEffectiveResultFolderToken(workbenchId);
        let folder = userFolder;
        try {
            if (!token && workbenchId === RESULT_WORKBENCH_RUNNINGHUB) {
                folder = await getResultCacheFolder();
                if (folder) setUserFolder(folder);
            }
            if (!folder && token) {
                folder = await folderFromToken(token);
                if (folder) setUserFolder(folder);
            }
            if (!folder && !token) {
                folder = await getResultCacheFolder();
                if (folder) setUserFolder(folder);
            }
            if (!folder) return;
            await loadFolderFiles(folder);
            if (workbenchId === RESULT_WORKBENCH_RUNNINGHUB) {
                const cleaned = await cleanupResultManifestOrphans(folder);
                if (!quiet && (cleaned.manifestRemoved || cleaned.sidecars)) {
                    pushStatus(`已刷新 (${folder.name})，清理失效记录 ${cleaned.manifestRemoved} 条${cleaned.sidecars ? `，孤儿附加文件 ${cleaned.sidecars} 个` : ""}`);
                    return;
                }
            }
            if (!quiet) pushStatus(`已刷新 (${folder.name})`);
        } catch (error) {
            console.error("刷新失败:", error);
            if (!quiet) pushStatus(`刷新失败: ${error?.message || error}`);
        }
    }, [loadFolderFiles, pushStatus, userFolder, workbenchId]);

    const placeFileToCanvas = useCallback(async (targetFileOrName, preferSavedBounds = false) => {
        const doc = await photoshop.app.getActiveDocument();
        if (!doc) {
            pushStatus("请先打开一个文档");
            return;
        }
        if (!userFolder) return;
        const fileName = typeof targetFileOrName === "string" ? targetFileOrName : targetFileOrName?.name;
        if (!fileName) return;
        try {
            await placeResultFile({ userFolder, fileName, preferSavedBounds, pushStatus });
            pushStatus(`已置入: ${fileName}`);
        } catch (error) {
            console.error("置入失败:", error);
            pushStatus(`置入失败: ${error?.message || error}`);
        }
    }, [pushStatus, userFolder]);

    const handleOpenNewDoc = useCallback(async () => {
        const file = currentIndex >= 0 ? fileList[currentIndex] : null;
        if (!file) return;
        try {
            await photoshop.commands.openDocument(await fs.createSessionToken(file));
            pushStatus(`已打开: ${file.name}`);
        } catch (error) {
            console.error("[XLRH Results] open as document failed:", error);
            pushStatus(`打开失败: ${error?.message || error}`);
        }
    }, [currentIndex, fileList, pushStatus]);

    const handlePlaceToCanvas = useCallback(async () => {
        const file = currentIndex >= 0 ? fileList[currentIndex] : null;
        if (file?.name) await placeFileToCanvas(file.name, false);
    }, [currentIndex, fileList, placeFileToCanvas]);

    const handleDeleteCurrent = useCallback(async () => {
        const file = currentIndex >= 0 ? fileList[currentIndex] : null;
        if (!file) return;
        if (!isXiaoLiangResultFile(file)) {
            pushStatus("不是小梁RH返图，已阻止删除");
            return;
        }
        try {
            await file.delete();
            const sidecarDeleted = await deleteResultSidecarIfExists(userFolder, file.name);
            await removeResultManifestEntries(userFolder, [file.name]);
            const nextList = fileList.filter((_, index) => index !== currentIndex);
            setFileList(nextList);
            if (nextList.length === 0) {
                setCurrentIndex(-1);
                setCurrentImgUrl(null);
            } else {
                setCurrentIndex(Math.min(currentIndex, nextList.length - 1));
            }
            pushStatus(`已删除小梁RH返图: ${file.name}${sidecarDeleted ? "（含附加文件）" : ""}`);
        } catch (error) {
            console.error("删除失败:", error);
            pushStatus(`删除失败: ${error?.message || error}`);
        }
    }, [currentIndex, fileList, pushStatus, userFolder]);

    const handleConfirmClearAll = useCallback(async () => {
        if (!userFolder || fileList.length === 0) return;
        try {
            const ownedFiles = fileList.filter(isXiaoLiangResultFile);
            if (ownedFiles.length === 0) {
                pushStatus("没有可清理的小梁RH返图");
                return;
            }
            let imageCount = 0;
            let sidecarCount = 0;
            for (const file of ownedFiles) {
                await file.delete();
                imageCount += 1;
                if (await deleteResultSidecarIfExists(userFolder, file.name)) sidecarCount += 1;
            }
            await removeResultManifestEntries(userFolder, ownedFiles.map((file) => file.name));
            const cleaned = await cleanupResultManifestOrphans(userFolder);
            sidecarCount += cleaned.sidecars || 0;
            const nextList = fileList.filter((file) => !isXiaoLiangResultFile(file));
            setFileList(nextList);
            setCurrentIndex(nextList.length ? 0 : -1);
            if (!nextList.length) setCurrentImgUrl(null);
            pushStatus(`已清理小梁RH返图：${imageCount} 张${sidecarCount ? `，附加文件 ${sidecarCount} 个` : ""}`);
        } catch (error) {
            console.error("清空失败:", error);
            pushStatus(`清空失败: ${error?.message || error}`);
        } finally {
            setShowClearAllConfirm(false);
        }
    }, [fileList, pushStatus, userFolder]);

    const navCount = fileList.length;
    const canNavigateLoop = navCount > 1;
    const fromNewestDisplay = navCount > 0 ? navCount - currentIndex : 0;
    const counterInputValue = counterEdit ? counterDraft : String(fromNewestDisplay);
    const counterInputSize = Math.min(4, Math.max(1, String(counterInputValue).length || 1));

    const jumpToLatest = useCallback(() => {
        if (fileList.length > 0) setCurrentIndex(0);
    }, [fileList.length]);

    const jumpToOldest = useCallback(() => {
        if (fileList.length > 0) setCurrentIndex(fileList.length - 1);
    }, [fileList.length]);

    const moveLeft = useCallback(() => {
        if (!canNavigateLoop) return;
        setCurrentIndex((index) => (index < navCount - 1 ? index + 1 : 0));
    }, [canNavigateLoop, navCount]);

    const moveRight = useCallback(() => {
        if (!canNavigateLoop) return;
        setCurrentIndex((index) => (index > 0 ? index - 1 : navCount - 1));
    }, [canNavigateLoop, navCount]);

    const beginCounterEdit = useCallback(() => {
        if (counterEdit) return;
        setCounterDraft(String(fromNewestDisplay));
        setCounterEdit(true);
    }, [counterEdit, fromNewestDisplay]);

    const cancelCounterEdit = useCallback(() => {
        setCounterEdit(false);
        setCounterDraft("");
    }, []);

    const submitCounterJump = useCallback(() => {
        const jump = clampCounterJump(counterDraft, navCount);
        if (jump.empty) {
            cancelCounterEdit();
            return;
        }
        if (jump.invalid) {
            pushStatus("请输入有效数字（从旧到新序号，1=最旧）");
            return;
        }
        const position = jump.value === 1 ? "最旧" : jump.value === navCount ? "最新" : "中间";
        setCurrentIndex(navCount - jump.value);
        cancelCounterEdit();
        pushStatus(`已跳转：序号 ${jump.value}（${position}）`);
        counterInputRef.current?.blur();
    }, [cancelCounterEdit, counterDraft, navCount, pushStatus]);

    const toggleAutoPlace = useCallback(() => {
        setAutoPlace((enabled) => {
            pushStatus(enabled ? "已关闭自动置入" : "已开启自动置入");
            return !enabled;
        });
    }, [pushStatus]);

    const setFeatherEnabled = useCallback((enabled) => {
        setPlaceEdgeFeatherEnabled(enabled);
        notifyPlaceEdgeFeatherChanged({ enabled });
    }, []);
    const setKeepSelectionEnabled = useCallback((enabled) => {
        setPlaceKeepSelection(enabled);
        notifyPlaceEdgeFeatherChanged({ keepSelection: enabled });
    }, []);

    useResultFileBroadcasts(workbenchId, refreshFileList);
    usePlacePreferences(setPlaceEdgeFeatherEnabled, setPlaceKeepSelection);
    useRefreshWhenProductReturns(isActiveProduct, refreshFileList);

    useEffect(() => {
        if (!onRefreshRef) return;
        onRefreshRef.current = makeRefreshBridge({
            refreshFileList,
            autoPlace,
            userFolder,
            workbenchId,
            pushStatus,
            placeFileToCanvas,
        });
    }, [autoPlace, onRefreshRef, placeFileToCanvas, pushStatus, refreshFileList, userFolder, workbenchId]);

    useEffect(() => {
        if (!newImageBase64) return;
        console.debug("[XLRH Results] legacy base64 result hook ignored; host result sync handles saved files.");
    }, [newImageBase64]);

    useEffect(() => {
        let mounted = true;
        const previousPreviewUrl = currentImgUrl;
        const file = currentIndex >= 0 ? fileList[currentIndex] : null;

        const loadPreview = async () => {
            if (!file) {
                if (!mounted) return;
                setCurrentImgUrl(null);
                setIsLoadingImg(false);
                setErrorMsg(null);
                return;
            }
            const cachedDataUrl = getFromCache(file.name);
            if (cachedDataUrl) {
                if (!mounted) return;
                setCurrentImgUrl(cachedDataUrl);
                setIsLoadingImg(false);
                setErrorMsg(null);
                return;
            }
            if (mounted) {
                setIsLoadingImg(true);
                setErrorMsg(null);
            }
            try {
                const dataUrl = await readResultFileAsDataUrl(file);
                putToCache(file.name, dataUrl);
                if (!mounted) return;
                setCurrentImgUrl(dataUrl);
                setIsLoadingImg(false);
            } catch (error) {
                if (!mounted) return;
                setIsLoadingImg(false);
                setErrorMsg(`无法读取: ${error?.message || error}`);
            }
        };

        void loadPreview();
        return () => {
            mounted = false;
            if (previousPreviewUrl && !previousPreviewUrl.startsWith("data:")) {
                try { URL.revokeObjectURL(previousPreviewUrl); } catch (_) {}
            }
        };
    }, [currentIndex, fileList]);

    const effectiveToken = getEffectiveResultFolderToken(workbenchId);
    const folderPathPrefix = useMemo(
        () => (userFolder ? formatFolderPathPrefixForBar(userFolder.nativePath, userFolder.name) : ""),
        [userFolder]
    );

    const viewModel = {
        userFolder,
        fileCount: fileList.length,
        currentImgUrl,
        isLoadingImg,
        errorMsg,
        isHovered,
        autoPlace,
        showClearConfirm: showClearAllConfirm,
        currentFileName: fileList[currentIndex]?.name || "",
        folderPathPrefix,
        folderTitle: userFolder?.nativePath ? String(userFolder.nativePath) : userFolder?.name || "",
        isTemporaryFolder: !effectiveToken,
        canRestoreInitialFolder: Boolean(getOverrideResultFolderToken(workbenchId)),
        counterInputRef,
    };

    const navigation = {
        canLoop: canNavigateLoop,
        leftOnBoundary: canNavigateLoop && currentIndex === navCount - 1,
        rightOnBoundary: canNavigateLoop && currentIndex === 0,
        showOldestJump: currentIndex < navCount - 1,
        showNewestJump: currentIndex > 0,
        leftTitle: canNavigateLoop && currentIndex === navCount - 1 ? "更旧（尾张，点击跳到最新）" : "更旧",
        rightTitle: canNavigateLoop && currentIndex === 0 ? "更新（首张，点击跳到最旧）" : "更新",
        moveLeft,
        moveRight,
        jumpOldest: jumpToOldest,
        jumpNewest: jumpToLatest,
    };

    const counter = {
        editing: counterEdit,
        value: counterInputValue,
        size: counterInputSize,
        total: navCount,
        fromNewest: fromNewestDisplay,
        beginEdit: beginCounterEdit,
        cancel: cancelCounterEdit,
        submit: submitCounterJump,
        setDraft: setCounterDraft,
    };

    const popovers = {
        feather: {
            popover: asViewPopover(featherPopover),
            enabled: placeEdgeFeatherEnabled,
            keepSelection: placeKeepSelection,
            onEnabledChange: setFeatherEnabled,
            onKeepSelectionChange: setKeepSelectionEnabled,
        },
        deleteMenu: {
            popover: asViewPopover(deletePopover),
            onDeleteCurrent: () => {
                void handleDeleteCurrent();
                deletePopover.close();
            },
            onClearAll: () => {
                deletePopover.close();
                setShowClearAllConfirm(true);
            },
        },
        folder: asViewPopover(folderPopover),
    };

    const actions = {
        hoverOn: () => setIsHovered(true),
        hoverOff: () => setIsHovered(false),
        refreshFiles: () => void refreshFileList(),
        pickFolder: () => void handleSwitchLocalFolder(),
        restoreInitialFolder: () => void handleRestoreInitialFolder(),
        unbindFolder: () => void handleUnbindFolder(),
        placeToCanvas: () => void handlePlaceToCanvas(),
        openNewDoc: () => void handleOpenNewDoc(),
        toggleAutoPlace,
        cancelClearAll: () => setShowClearAllConfirm(false),
        confirmClearAll: () => void handleConfirmClearAll(),
    };

    return (
        <XlrhResultsView
            model={viewModel}
            navigation={navigation}
            counter={counter}
            popovers={popovers}
            actions={actions}
        />
    );
};
