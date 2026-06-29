import { photoshop, storage } from "../bridge/uxpBridge.js";
import { PLUGIN_PANEL_TITLE } from "../pluginMeta.js";
import { getPlaceEdgeFeatherOptsFromStorage } from "./placeEdgeFeatherOpts.js";
import { readAutoReturnEnabled } from "./sharedInteractionSettings.js";

function isAutoPlaceEnabled(options = {}) {
    if (options?.force) return true;
    return readAutoReturnEnabled();
}

function hasFiles(list) {
    return Array.isArray(list) && list.some((item) => item && String(item.fileName || item).trim());
}

function normalizeFileNameList(savedFileNames) {
    return (Array.isArray(savedFileNames) ? savedFileNames : [])
        .map((name) => String(name || "").trim())
        .filter(Boolean);
}

async function sessionToken(folderToken, fileName) {
    return storage.localFileSystem.createSessionTokenForFile(folderToken, fileName);
}

function normalizePlaceFailure(error) {
    const message = error?.message || error?.reason || String(error || "自动贴回失败");
    const retryable = /cannot be placed|unavailable|busy|Camera Raw|modal|dialog/i.test(message);
    return {
        canRetry: retryable,
        reason: message,
        originalError: error,
    };
}

function targetDocKey(docId) {
    return docId == null ? "__current__" : String(docId);
}

function groupEntriesByDocument(entries) {
    const groups = new Map();
    for (const item of Array.isArray(entries) ? entries : []) {
        if (!item || !String(item.fileName || "").trim()) continue;
        const key = targetDocKey(item.docId);
        if (!groups.has(key)) groups.set(key, { docId: item.docId == null ? null : item.docId, files: [] });
        groups.get(key).files.push({
            fileName: String(item.fileName).trim(),
            bounds: item.bounds,
        });
    }
    return [...groups.values()];
}

async function placeCurrentDocumentOne(folderToken, fileName, bounds, placeOpts) {
    const token = await sessionToken(folderToken, fileName);
    await photoshop.commands.placeFileToCanvas(token, bounds, true, placeOpts);
}

async function placeExternalDocumentOne(docId, folderToken, fileName, bounds, placeOpts) {
    const token = await sessionToken(folderToken, fileName);
    await photoshop.commands.placeToDocument(docId, token, bounds, placeOpts);
}

async function placeFilesOneByOne({ docId, folderToken, files, placeOpts }) {
    for (const file of files) {
        if (docId == null) await placeCurrentDocumentOne(folderToken, file.fileName, file.bounds, placeOpts);
        else await placeExternalDocumentOne(docId, folderToken, file.fileName, file.bounds, placeOpts);
    }
}

async function placeSingleOrGroup({ docId, folderToken, files, groupName, placeOpts, groupEnabled = true }) {
    if (!files.length) return;
    if (files.length > 1 && groupEnabled === false) {
        await placeFilesOneByOne({ docId, folderToken, files, placeOpts });
        return;
    }
    if (docId == null) {
        if (files.length === 1) {
            await placeCurrentDocumentOne(folderToken, files[0].fileName, files[0].bounds, placeOpts);
        } else {
            await photoshop.commands.placeFilesIntoNewGroup(
                folderToken,
                files.map((item) => item.fileName),
                files[0]?.bounds,
                groupName,
                placeOpts
            );
        }
        return;
    }

    if (files.length === 1) {
        await placeExternalDocumentOne(docId, folderToken, files[0].fileName, files[0].bounds, placeOpts);
        return;
    }
    await photoshop.commands.placeFilesIntoNewGroupInDocument(docId, folderToken, files, groupName, placeOpts);
}

export async function performAutoPlace(savedFileNames, groupName, savedBounds, folderToken, docId, options = {}) {
    const names = normalizeFileNameList(savedFileNames);
    if (!isAutoPlaceEnabled(options) || !folderToken || names.length === 0) return;

    const files = names.map((fileName) => ({ fileName, bounds: savedBounds }));
    const placeOpts = { ...getPlaceEdgeFeatherOptsFromStorage(), useSavedPlaceContext: true };
    try {
        await placeSingleOrGroup({
            docId: docId == null ? null : docId,
            folderToken,
            files,
            groupName,
            placeOpts,
            groupEnabled: options.group !== false,
        });
    } catch (error) {
        console.warn("[XiaoLiangRH AutoPlace] 贴回失败:", error);
        throw normalizePlaceFailure(error);
    }
}

export async function performAutoPlaceBatch(savedEntries, folderToken, groupNameBase = `${PLUGIN_PANEL_TITLE} 批处理`, options = {}) {
    if (!isAutoPlaceEnabled(options) || !folderToken || !hasFiles(savedEntries)) return;
    const placeOpts = { ...getPlaceEdgeFeatherOptsFromStorage(), useSavedPlaceContext: true };
    try {
        for (const group of groupEntriesByDocument(savedEntries)) {
            await placeSingleOrGroup({
                docId: group.docId,
                folderToken,
                files: group.files,
                groupName: groupNameBase,
                placeOpts,
                groupEnabled: options.group !== false,
            });
        }
    } catch (error) {
        console.warn("[XiaoLiangRH AutoPlace] 批量贴回失败:", error);
        throw normalizePlaceFailure(error);
    }
}
