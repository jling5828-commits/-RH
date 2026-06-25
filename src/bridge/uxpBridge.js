import { readCompatLocalStorage } from "../utils/storageKeyCompat.js";

const EVENT_UPLOAD_SESSIONS_INVALIDATED = "xiaoliangRh-upload-sessions-invalidated";
const MESSAGE_UPLOAD_SESSIONS_INVALIDATED = "xiaoliangRh.uploadSessionsInvalidated";
const MESSAGE_PS_NOTIFICATION = "ps.notification";
const MESSAGE_DOWNLOAD_PROGRESS = "network.downloadProgress";
const MESSAGE_UXP_PROGRESS = "uxp.progress";
const DEBUG_UPLOAD_SESSION_KEY = "xlrh_xiaoliangRh_probe_debug";

const state = {
    rpcSeq: 0,
    listenerSeq: 0,
    pending: new Map(),
    notifications: new Map(),
    progress: new Map(),
};

function currentWindow() {
    return typeof window === "undefined" ? null : window;
}

function hostEndpoint() {
    const target = currentWindow()?.uxpHost;
    return target && typeof target.postMessage === "function" ? target : null;
}

function hasHostEndpoint() {
    return Boolean(hostEndpoint());
}

function unavailableError(method = "UXP API") {
    return new Error(`[Bridge] ${method} \u4ec5\u652f\u6301 WebView \u73af\u5883`);
}

function nextRpcId() {
    state.rpcSeq += 1;
    return state.rpcSeq;
}

function nextListenerId() {
    state.listenerSeq += 1;
    return `xlrh_listener_${state.listenerSeq}`;
}

function safeCall(fn, payload, label) {
    try {
        fn(payload);
    } catch (error) {
        console.error(label, error);
    }
}

function postToHost(message) {
    const endpoint = hostEndpoint();
    if (!endpoint) throw unavailableError(message?.method);
    endpoint.postMessage(message);
}

function rpc(method, args = [], onProgress) {
    if (!hasHostEndpoint()) {
        return { requestId: 0, promise: Promise.reject(unavailableError(method)) };
    }

    const requestId = nextRpcId();
    if (typeof onProgress === "function") state.progress.set(requestId, onProgress);

    const promise = new Promise((resolve, reject) => {
        state.pending.set(requestId, { resolve, reject });
        try {
            postToHost({ id: requestId, method, args });
        } catch (error) {
            state.pending.delete(requestId);
            state.progress.delete(requestId);
            reject(error);
        }
    });

    promise.finally(() => state.progress.delete(requestId)).catch(() => {});
    return { requestId, promise };
}

export function invoke(method, ...args) {
    return rpc(method, args).promise;
}

function progressPayloadFromDownload(data) {
    return {
        domain: "download",
        phase: String(data.phase || "downloading"),
        detail: "",
        extra: {
            loaded: Number(data.loaded || 0),
            total: Number(data.total || 0),
            percent: Number(data.percent || 0),
        },
    };
}

function progressPayloadFromUx(data) {
    return {
        domain: data.domain || "uxp",
        phase: data.phase || "",
        detail: data.detail || "",
        extra: data.extra ?? null,
    };
}

function parseProgressMessage(data) {
    if (data?.type === MESSAGE_DOWNLOAD_PROGRESS) {
        return { requestId: data.requestId, payload: progressPayloadFromDownload(data) };
    }
    if (data?.type === MESSAGE_UXP_PROGRESS) {
        return { requestId: data.requestId, payload: progressPayloadFromUx(data) };
    }
    return null;
}

function deliverProgress(data) {
    const parsed = parseProgressMessage(data);
    if (!parsed) return false;
    const listener = state.progress.get(parsed.requestId);
    if (listener) safeCall(listener, parsed.payload, "[XiaoLiangRH bridge progress]");
    return true;
}

function deliverPhotoshopNotification(data) {
    if (data?.type !== MESSAGE_PS_NOTIFICATION || !data.listenerId) return false;
    const listener = state.notifications.get(data.listenerId);
    if (listener) safeCall(listener, data.event, "[XiaoLiangRH photoshop notification]");
    return true;
}

function deliverUploadSessionInvalidation(data) {
    if (data?.type !== MESSAGE_UPLOAD_SESSIONS_INVALIDATED) return false;
    const target = currentWindow();
    if (!target) return true;

    const detail = {
        reason: data.reason || "",
        scope: data.scope != null ? String(data.scope) : "global",
    };

    try {
        target.dispatchEvent(new CustomEvent(EVENT_UPLOAD_SESSIONS_INVALIDATED, { detail }));
        if (typeof localStorage !== "undefined" && readCompatLocalStorage(DEBUG_UPLOAD_SESSION_KEY) === "1") {
            console.warn("[XiaoLiangRH:probe] uploadSessionsInvalidated", detail);
        }
    } catch (error) {
        console.warn("[XiaoLiangRH] uploadSessionsInvalidated", error);
    }
    return true;
}

function resolveRpc(data) {
    if (!data || typeof data !== "object" || !("id" in data)) return false;
    const pending = state.pending.get(data.id);
    if (!pending) return false;

    state.pending.delete(data.id);
    state.progress.delete(data.id);
    if (data.error) pending.reject(new Error(data.error.message || "Bridge error"));
    else pending.resolve(data.result);
    return true;
}

function onHostMessage(event) {
    const data = event?.data;
    if (!data || typeof data !== "object") return;
    if (deliverProgress(data)) return;
    if (deliverPhotoshopNotification(data)) return;
    if (deliverUploadSessionInvalidation(data)) return;
    resolveRpc(data);
}

const bootWindow = currentWindow();
if (bootWindow && typeof bootWindow.addEventListener === "function") {
    bootWindow.addEventListener("message", onHostMessage);
}

const call = (method, ...args) => invoke(method, ...args);

function buildSimpleCalls(methods) {
    return Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, (...args) => call(method, ...args)]));
}

const localFileSystem = {
    ...buildSimpleCalls({
        getFolder: "storage.getFolder",
        getDataFolder: "storage.getDataFolder",
        getTemporaryFolder: "storage.getTemporaryFolder",
        getPluginFolder: "storage.getPluginFolder",
        getEntryForPersistentToken: "storage.getEntryForPersistentToken",
        createSessionTokenForFile: "storage.createSessionTokenForFile",
        folderGetEntries: "storage.folderGetEntries",
        folderGetEntriesBySessionToken: "storage.folderGetEntriesBySessionToken",
        folderGetEntry: "storage.folderGetEntry",
        folderCreateFile: "storage.folderCreateFile",
        folderCreateFolder: "storage.folderCreateFolder",
        fileRead: "storage.fileRead",
        fileDeleteInFolder: "storage.fileDeleteInFolder",
        fileDelete: "storage.fileDelete",
        readPluginFile: "storage.readPluginFile",
        getResultImageCacheInfo: "storage.getResultImageCacheInfo",
        openResultImageCacheFolder: "storage.openResultImageCacheFolder",
        openForgePresetFolder: "storage.openForgePresetFolder",
        openSoundFolder: "storage.openSoundFolder",
        clearResultImageCache: "storage.clearResultImageCache",
        saveTextFile: "storage.saveTextFile",
    }),
    getFileForOpening: (opts) => call("storage.getFileForOpening", opts?.types),
    createPersistentToken: (folder) => call("storage.createPersistentToken", folder?.token ?? folder),
    fileReadInFolder: (folderToken, fileName, format = "binary") => call("storage.fileReadInFolder", folderToken, fileName, format),
    openTextFile: (types) => call("storage.openTextFile", types || ["json"]),
};

export const storage = {
    localFileSystem,
    formats: { binary: "binary", utf8: "utf8" },
    readSettings: () => call("storage.readSettings"),
    writeSettings: (content) => call("storage.writeSettings", content),
    getManifestVersion: () => call("storage.getManifestVersion"),
    quarantineAndResetSettings: () => call("storage.quarantineAndResetSettings"),
};

function addPhotoshopNotificationListener(events, callback) {
    const listenerId = nextListenerId();
    state.notifications.set(listenerId, callback);
    call("ps.addNotificationListener", events, listenerId).catch(() => state.notifications.delete(listenerId));
    return {
        remove: () => {
            state.notifications.delete(listenerId);
            call("ps.removeNotificationListener", listenerId).catch(() => {});
        },
    };
}

const photoshopCommands = {
    ...buildSimpleCalls({
        openDocument: "ps.commandOpenDocument",
        placeFileToCanvas: "ps.commandPlaceFileToCanvas",
        placeToDocument: "ps.commandPlaceToDocument",
        placeFilesIntoNewGroup: "ps.commandPlaceFilesIntoNewGroup",
        placeFilesIntoNewGroupInDocument: "ps.commandPlaceFilesIntoNewGroupInDocument",
        psGaussianBlur: "ps.commandPsGaussianBlur",
        getSelectionBounds: "ps.getSelectionBounds",
        getActiveSelectionBounds: "ps.getActiveSelectionBounds",
        clearActiveSelection: "ps.clearActiveSelection",
        recordRhRunPlaceContext: "ps.rhRecordRunPlaceContext",
        applyTaskPlaceContext: "ps.applyTaskPlaceContext",
        cloneUploadSession: "ps.cloneUploadSession",
        upscaleRemoveGuides: "ps.upscaleRemoveGuides",
        upscaleAddGuides: "ps.upscaleAddGuides",
    }),
    upscaleBeginUpscale: (payload) => call("ps.upscaleBeginUpscale", typeof payload === "string" ? { groupName: payload } : payload),
};

export const photoshop = {
    action: {
        batchPlay: (actions, opts) => call("ps.batchPlay", actions, opts),
        addNotificationListener: addPhotoshopNotificationListener,
        removeNotificationListener: () => {},
    },
    core: {},
    app: {
        getActiveDocument: () => call("ps.app.activeDocument"),
    },
    imaging: {
        getLayerMask: (opts) => call("ps.imaging.getLayerMask", opts),
    },
    captureSelection: (mode, sizeOpts) => call("ps.captureSelection", mode, sizeOpts),
    commands: photoshopCommands,
    captureBoundsForPreviewInHost: (bounds, maxSize) => call("ps.captureBoundsForPreviewInHost", bounds, maxSize),
};

export const shell = buildSimpleCalls({
    openPath: "shell.openPath",
    openExternal: "shell.openExternal",
    openPluginFile: "shell.openPluginFile",
});

export function ensureHwMonitorRunning(force = false) {
    return call("hwMonitor.ensureRunning", force);
}

export function stopHwMonitorServer() {
    return call("hwMonitor.shutdown");
}

export function runtimeWriteLog(entries) {
    if (!hasHostEndpoint()) return Promise.resolve({ ok: false, skipped: "not_webview" });
    return call("runtime.writeLog", Array.isArray(entries) ? entries : []);
}

function bytesToBase64(bytes) {
    const parts = [];
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, offset + chunkSize);
        parts.push(String.fromCharCode(...chunk));
    }
    return btoa(parts.join(""));
}

async function fetchDirect(url, opts = {}) {
    const response = await fetch(url, {
        method: opts.method || "GET",
        headers: opts.headers || {},
        body: opts.body,
    });

    if (opts.returnBinary) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText || "",
            bodyBase64: bytesToBase64(bytes),
            contentType: response.headers?.get?.("content-type") || "",
        };
    }

    return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText || "",
        body: await response.text(),
    };
}

export async function fetchProxy(url, opts = {}) {
    if (!hasHostEndpoint()) return fetchDirect(url, opts);
    const { method = "GET", headers = {}, body, returnBinary, timeoutMs } = opts;
    return call("network.fetch", url, { method, headers, body, returnBinary, timeoutMs });
}

function safeFormFieldName(value) {
    return String(value || "file").trim() || "file";
}

function multipartHeaders(headers) {
    const copy = { ...(headers || {}) };
    delete copy["Content-Type"];
    delete copy["content-type"];
    return copy;
}

function appendTextFields(formData, fields) {
    for (const [key, value] of Object.entries(fields || {})) {
        if (value != null) formData.append(key, String(value));
    }
}

function appendBase64Blob(formData, part) {
    if (!part?.base64) return;
    const binary = atob(String(part.base64 || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    formData.append(part.field, new Blob([bytes], { type: part.mimeType }), part.fileName);
}

function normalizeUploadPart(part) {
    return {
        field: safeFormFieldName(part?.field),
        base64: String(part?.base64 || "").trim(),
        fileName: String(part?.fileName || "image.png").trim() || "image.png",
        mimeType: String(part?.mimeType || "image/png").trim() || "image/png",
    };
}

async function postMultipartDirect(url, fields, files, headers) {
    const formData = new FormData();
    appendTextFields(formData, fields);
    for (const part of files) appendBase64Blob(formData, part);
    const response = await fetch(url, { method: "POST", body: formData, headers: multipartHeaders(headers) });
    return { ok: response.ok, status: response.status, statusText: response.statusText || "", body: await response.text() };
}

export function fetchProxyFormData(
    url,
    formFields,
    fileBase64,
    fileName = "image.png",
    mimeType = "image/png",
    extraHeaders,
    fileFieldName
) {
    const filePart = normalizeUploadPart({ field: fileFieldName, base64: fileBase64, fileName, mimeType });
    if (!hasHostEndpoint()) return postMultipartDirect(url, formFields || {}, [filePart], extraHeaders || {});
    return call("network.fetchFormData", url, formFields || {}, fileBase64, fileName, mimeType, extraHeaders || {}, filePart.field);
}

export function fetchProxyFormDataMultiFiles(url, formFields, fileParts, extraHeaders) {
    const parts = (Array.isArray(fileParts) ? fileParts : []).map(normalizeUploadPart).filter((part) => part.base64);
    if (!hasHostEndpoint()) return postMultipartDirect(url, formFields || {}, parts, extraHeaders || {});
    return call("network.fetchFormDataMultiFiles", url, formFields || {}, parts, extraHeaders || {});
}

export function fetchProxyFormDataFromUploadSession(
    url,
    formFields,
    uploadSessionId,
    fileName = "image.png",
    mimeType = "image/png",
    extraHeaders,
    fileFieldName
) {
    if (!hasHostEndpoint()) return Promise.reject(unavailableError("fetchProxyFormDataFromUploadSession"));
    return call(
        "network.fetchFormDataFromUploadSession",
        url,
        formFields || {},
        uploadSessionId,
        fileName,
        mimeType,
        extraHeaders || {},
        safeFormFieldName(fileFieldName)
    );
}

export function rhUploadBinaryInHost(payload) {
    return call("runninghub.uploadBinary", payload || {});
}

export function xiaoliangRhPutUploadSessionFromRawBase64(payload) {
    return call("xiaoliangRh.putUploadSessionFromRawBase64", payload || {});
}

export function xiaoliangRhPeekUploadSessionRawBase64(uploadSessionId) {
    return call("xiaoliangRh.peekUploadSessionRawBase64", String(uploadSessionId || "").trim());
}

export function xiaoliangRhProbeUploadSession(uploadSessionId) {
    return call("xiaoliangRh.probeUploadSession", String(uploadSessionId || "").trim());
}

export function xiaoliangRhReleaseUploadSession(uploadSessionId) {
    const id = String(uploadSessionId || "").trim();
    return id ? call("xiaoliangRh.releaseUploadSession", id) : Promise.resolve();
}

export function xiaoliangRhPickImageFileToUploadSession(payload = {}) {
    return call("xiaoliangRh.pickImageFileToUploadSession", payload || {});
}

function rpcWithSinglePayload(method, payload, onProgress) {
    return rpc(method, [payload || {}], onProgress);
}

export function downloadAndSaveImageInHost(payload, onProgress) {
    if (!hasHostEndpoint()) return Promise.reject(unavailableError("downloadAndSaveImageInHost"));
    return rpcWithSinglePayload("network.downloadAndSave", payload, onProgress).promise;
}

export function runRunningHubAiAppInHost(payload, onProgress) {
    if (!hasHostEndpoint()) {
        return { requestId: 0, promise: Promise.reject(unavailableError("runRunningHubAiAppInHost")) };
    }
    const { requestId, promise } = rpcWithSinglePayload("runninghub.runAiApp", payload, onProgress);
    return { requestId, promise };
}

export function cancelRunningHubAiAppRequest(requestId) {
    return call("runninghub.runAiAppCancel", requestId);
}

export function subscribeUxProgress(requestId, fn) {
    if (requestId == null || typeof fn !== "function") return () => {};
    state.progress.set(requestId, fn);
    return () => state.progress.delete(requestId);
}

export const isInWebView = hasHostEndpoint;

export function getAboutRuntimeInfo() {
    return call("about.getRuntimeInfo");
}

export function getCachedThemeCssVariables() {
    return call("theme.getCachedCssVariables");
}
