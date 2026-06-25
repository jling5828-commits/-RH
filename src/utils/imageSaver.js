/**
 * imageSaver.js
 * 图片下载与保存（合并 download.js + backgroundSaver.js）
 */

import { hostFetch } from "../bridge/hostNetwork.js";
import { downloadAndSaveImageInHost, isInWebView } from "../bridge/uxpBridge.js";

const storage = require("uxp").storage;
const formats = storage.formats;
export const RESULT_IMAGE_CACHE_FOLDER_NAME = "image_cache";
const RESULT_MANIFEST_FILE_NAME = "results-manifest.json";
const RESULT_MANIFEST_MAX_ENTRIES = 500;

async function getOrCreateChildFolder(parentFolder, folderName) {
    if (!parentFolder) return null;
    try {
        const existing = await parentFolder.getEntry(folderName);
        if (existing && existing.isFile === false) return existing;
    } catch (_) {
        /* create below */
    }
    try {
        return await parentFolder.createFolder(folderName);
    } catch (e) {
        try {
            const retry = await parentFolder.getEntry(folderName);
            if (retry && retry.isFile === false) return retry;
        } catch (_) {
            /* ignore */
        }
        throw e;
    }
}

export async function getResultImageCacheFolder() {
    const lfs = storage.localFileSystem;
    if (typeof lfs.getDataFolder !== "function") return null;
    try {
        const dataFolder = await lfs.getDataFolder();
        return await getOrCreateChildFolder(dataFolder, RESULT_IMAGE_CACHE_FOLDER_NAME);
    } catch (e) {
        console.warn("[imageSaver] get result image_cache failed:", e);
        return null;
    }
}

async function deleteFolderEntries(sourceFolder) {
    const entries = await sourceFolder.getEntries();
    let files = 0;
    let folders = 0;
    let bytes = 0;
    for (const entry of entries || []) {
        if (entry.isFile === false) {
            const child = await deleteFolderEntries(entry);
            files += child.files;
            folders += child.folders + 1;
            bytes += child.bytes;
            try {
                await entry.delete();
            } catch (_) {
                /* ignore */
            }
            continue;
        }
        const data = await entry.read({ format: formats.binary });
        const uint8 = new Uint8Array(data);
        await entry.delete();
        files += 1;
        bytes += uint8.length;
    }
    return { files, folders, bytes };
}

export async function clearResultImageCache() {
    const lfs = storage.localFileSystem;
    if (typeof lfs.getDataFolder !== "function") {
        throw new Error("data folder unavailable");
    }
    const dataFolder = await lfs.getDataFolder();
    let cacheFolder = null;
    try {
        cacheFolder = await dataFolder.getEntry(RESULT_IMAGE_CACHE_FOLDER_NAME);
    } catch (_) {
        cacheFolder = await getOrCreateChildFolder(dataFolder, RESULT_IMAGE_CACHE_FOLDER_NAME);
    }
    if (!cacheFolder || cacheFolder.isFile !== false) {
        throw new Error("image_cache unavailable");
    }
    const summary = await deleteFolderEntries(cacheFolder);
    return { ok: true, ...summary };
}

/** 无持久返图目录时用于保存/置入的临时文件夹（宿主临时目录 session token） */
export async function getTempResultFolder() {
    const lfs = storage.localFileSystem;
    const cacheFolder = await getResultImageCacheFolder();
    if (cacheFolder) return cacheFolder;
    if (typeof lfs.getTemporaryFolder !== "function") return null;
    try {
        return await lfs.getTemporaryFolder();
    } catch (e) {
        console.warn("[imageSaver] getTempResultFolder failed:", e);
        return null;
    }
}

/** 文件名非法字符替换为下划线，并截断长度 */
const FILE_SAFE_RE = /[/\\:*?"<>|\s]+/g;
const PRESET_MAX_LEN = 20;
const CHANNEL_MAX_LEN = 15;

function sanitizePreset(str) {
    if (str == null || String(str).trim() === "") return "自定义";
    const s = String(str).replace(FILE_SAFE_RE, "_").trim();
    return (s || "自定义").slice(0, PRESET_MAX_LEN);
}

function sanitizeChannel(str) {
    if (str == null || String(str).trim() === "") return "-";
    const s = String(str).trim();
    try {
        if (/^https?:\/\//i.test(s)) {
            const u = new URL(s);
            let host = (u.hostname || "").replace(/^www\./i, "");
            host = host.replace(/\./g, "-").slice(0, CHANNEL_MAX_LEN);
            return host || "api";
        }
    } catch (_) {}
    return s.replace(FILE_SAFE_RE, "_").slice(0, CHANNEL_MAX_LEN) || "-";
}

function sanitizeSize(size) {
    if (size == null || String(size).trim() === "") return "-";
    return String(size).replace(FILE_SAFE_RE, "_").trim().slice(0, 8) || "-";
}

function shouldWriteResultSidecar(bounds, docId, resultSidecar) {
    const hasBounds = bounds && typeof bounds === "object";
    const hasResult = resultSidecar && typeof resultSidecar === "object" && Object.keys(resultSidecar).length > 0;
    return !!(hasBounds || docId != null || hasResult);
}

function buildResultManifestEntry(fileName, byteLength, options = {}, extra = {}) {
    const {
        bounds,
        docId,
        presetName,
        channel,
        size,
        runningHubAppName,
        resultSidecar,
        duckDecodeEnabled,
    } = options;
    const source = runningHubAppName || presetName || "小梁RH";
    return {
        v: 1,
        fileName,
        boundsSidecarName: shouldWriteResultSidecar(bounds, docId, resultSidecar) ? `${fileName}.bounds.json` : "",
        byteLength: Number(byteLength || 0) || 0,
        savedAt: new Date().toISOString(),
        source,
        presetName: presetName || "",
        channel: channel || "",
        size: size || "",
        runningHubAppName: runningHubAppName || "",
        duckDecodeEnabled: !!duckDecodeEnabled,
        duckDecode: extra.duckDecode || null,
    };
}

async function appendResultManifest(folder, entry) {
    if (!folder || !entry?.fileName) return;
    try {
        let manifest = { v: 1, entries: [] };
        try {
            const existing = await folder.getEntry(RESULT_MANIFEST_FILE_NAME);
            if (existing?.isFile) {
                const text = await existing.read({ format: formats.utf8 });
                const parsed = JSON.parse(String(text || "{}"));
                if (parsed && typeof parsed === "object") {
                    manifest = {
                        v: Number(parsed.v || 1) || 1,
                        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
                    };
                }
            }
        } catch (_) {
            /* create below */
        }
        const entries = manifest.entries.filter((x) => x?.fileName !== entry.fileName);
        entries.push(entry);
        manifest.entries = entries.slice(-RESULT_MANIFEST_MAX_ENTRIES);
        const mf = await folder.createFile(RESULT_MANIFEST_FILE_NAME, { overwrite: true });
        await mf.write(JSON.stringify(manifest, null, 2), { format: formats.utf8 });
    } catch (e) {
        console.warn("[Save] result manifest 写入失败:", e);
    }
}

const XIAOLIANG_RESULT_MARK = "小梁RH";
const RESULT_APP_PREFIX_CHARS = 6;

function hasNameValue(value) {
    return value != null && String(value).trim() !== "";
}

function safeNamePiece(value, fallback, limit) {
    const raw = String(value ?? "").trim();
    const cleaned = raw.replace(FILE_SAFE_RE, "_").trim();
    const picked = cleaned && cleaned !== "—" ? cleaned : fallback;
    return String(picked || fallback).slice(0, limit);
}

function resultNameParts(options) {
    const { presetName, channel, size, runningHubAppName } = options || {};
    if (runningHubAppName !== undefined && runningHubAppName !== null) {
        return [safeNamePiece(runningHubAppName, XIAOLIANG_RESULT_MARK, RESULT_APP_PREFIX_CHARS), XIAOLIANG_RESULT_MARK];
    }
    if (![presetName, channel, size].some(hasNameValue)) return [XIAOLIANG_RESULT_MARK];
    return [sanitizePreset(presetName), sanitizeChannel(channel), sanitizeSize(size), XIAOLIANG_RESULT_MARK];
}

function safeFileNameSuffix(value) {
    const text = String(value || "").trim().replace(FILE_SAFE_RE, "_").replace(/[^a-zA-Z0-9_-]+/g, "_");
    return text ? text.slice(0, 64) : "";
}

function buildFileName(ts, index, ext, options = {}) {
    const suffix = safeFileNameSuffix(options.fileNameSuffix);
    const stem = [...resultNameParts(options), ts, index, suffix].filter((part) => String(part || "").trim()).join("_");
    return `${stem}.${ext}`;
}

/**
 * 下载并保存图片到文件夹
 * @param {Folder} folder - UXP 文件夹句柄
 * @param {string} imageUrl - 图片 URL（data URL 或远程 URL）
 * @param {number} index - 序号（用于文件名）
 * @param {Object} options - { bounds?, docId?, presetName?, channel?, size?, runningHubAppName?, resultSidecar?: Record<string, unknown>, onDownloadProgress?: (p:{loaded:number,total:number,percent:number,phase:string})=>void }
 * @returns {Promise<{ fileName: string, byteLength: number }>}
 */
export async function saveImageWithBounds(folder, imageUrl, index, options = {}) {
    const { bounds, docId, presetName, channel, size, runningHubAppName, onDownloadProgress, resultSidecar, duckDecodeEnabled, fileNameSuffix } = options;

    if (!folder) {
        throw new Error("目标文件夹不存在");
    }

    // 1. WebView 场景优先走宿主直下直存（避免 Base64 桥接开销）
    if (!imageUrl.startsWith("data:") && isInWebView() && typeof folder?.token === "string") {
        try {
            const hostRes = await downloadAndSaveImageInHost(
                {
                    imageUrl,
                    folderToken: folder.token,
                    index,
                    presetName,
                    channel,
                    size,
                    runningHubAppName,
                    fileNameSuffix,
                    bounds,
                    docId,
                    resultSidecar,
                    duckDecodeEnabled: !!duckDecodeEnabled,
                },
                onDownloadProgress
                    ? (evt) => {
                          if (evt.domain === "duckDecode") {
                              onDownloadProgress(evt);
                              return;
                          }
                          if (evt.domain !== "download" || !evt.extra || typeof evt.extra !== "object") return;
                          const ex = /** @type {Record<string, number>} */ (evt.extra);
                          onDownloadProgress({
                              loaded: Number(ex.loaded || 0),
                              total: Number(ex.total || 0),
                              percent: Number(ex.percent || 0),
                              phase: String(evt.phase || "downloading"),
                          });
                      }
                    : undefined
            );
            if (hostRes?.ok && hostRes.fileName) {
                await appendResultManifest(
                    folder,
                    buildResultManifestEntry(
                        hostRes.fileName,
                        Number(hostRes.byteLength || 0),
                        { bounds, docId, presetName, channel, size, runningHubAppName, resultSidecar, duckDecodeEnabled },
                        { duckDecode: hostRes.duckDecode || null }
                    )
                );
                return {
                    fileName: hostRes.fileName,
                    byteLength: Number(hostRes.byteLength || 0),
                    duckDecode: hostRes.duckDecode || null,
                };
            }
            throw new Error(hostRes?.error || "宿主下载保存失败");
        } catch (e) {
            // 保留旧链路兜底，避免宿主接口异常导致保存中断
            console.warn("[Save] host downloadAndSave 回退旧链路:", e?.message || e);
            if (duckDecodeEnabled && typeof onDownloadProgress === "function") {
                onDownloadProgress({
                    domain: "duckDecode",
                    phase: "failed",
                    detail: "小黄鸭解码未执行，已回传原图",
                    extra: {
                        ok: false,
                        reason: "host_download_fallback",
                        error: e?.message || String(e),
                    },
                });
            }
        }
    }

    // 2. 下载图片
    const { buffer, ext } = await loadResultImageBytes(imageUrl);
    const uint8 = new Uint8Array(buffer);

    // 3. 生成文件名（应用名6字_小梁RH_…）
    const ts = new Date().toISOString().replace(/[-:TZ.]/g, "");
    const fileName = buildFileName(ts, index, ext, { presetName, channel, size, runningHubAppName, fileNameSuffix });

    // 4. 写入文件
    const file = await folder.createFile(fileName, { overwrite: true });
    await file.write(uint8, { format: formats.binary });

    // 5. 写入 bounds sidecar
    try {
        if (shouldWriteResultSidecar(bounds, docId, resultSidecar)) {
            const boundsFileName = `${fileName}.bounds.json`;
            const boundsObj =
                resultSidecar && typeof resultSidecar === "object"
                    ? {
                          v: 2,
                          place: {
                              bounds: bounds && typeof bounds === "object" ? bounds : null,
                              ...(docId != null ? { docId } : {}),
                          },
                          result: resultSidecar,
                      }
                    : docId != null && bounds && typeof bounds === "object"
                      ? { ...bounds, docId }
                      : bounds && typeof bounds === "object"
                        ? bounds
                        : { docId };
            const boundsFile = await folder.createFile(boundsFileName, { overwrite: true });
            await boundsFile.write(JSON.stringify(boundsObj), { format: formats.utf8 });
        }
    } catch (e) {
        console.warn("[Save] bounds 写入失败:", e);
    }

    await appendResultManifest(
        folder,
        buildResultManifestEntry(fileName, uint8.length, {
            bounds,
            docId,
            presetName,
            channel,
            size,
            runningHubAppName,
            resultSidecar,
            duckDecodeEnabled,
        })
    );

    return { fileName, byteLength: uint8.length };
}

/**
 * 下载图片（支持 data URL 和远程 URL）
 * @returns {Promise<{ buffer: ArrayBuffer, ext: string }>}
 */
function bytesFromBase64(base64Text) {
    const binary = atob(String(base64Text || ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
    return bytes;
}

function imageExtFromMimeOrPath(value, fallback = "png") {
    const text = String(value || "").toLowerCase();
    if (text.includes("jpeg") || text.includes("jpg") || text.endsWith(".jpeg") || text.endsWith(".jpg")) return "jpg";
    if (text.includes("webp") || text.endsWith(".webp")) return "webp";
    if (text.includes("png") || text.endsWith(".png")) return "png";
    return fallback || "png";
}

function readDataUrlImage(dataUrl) {
    const match = String(dataUrl || "").match(/^data:image\/([^;,]+);base64,(.*)$/s);
    if (!match) throw new Error("无效的图片 data URL");
    const bytes = bytesFromBase64(match[2]);
    return { buffer: bytes.buffer, ext: imageExtFromMimeOrPath(match[1]) };
}

async function fetchImageBytesViaHost(imageUrl, fallbackExt) {
    const reply = await hostFetch(imageUrl, { method: "GET", returnBinary: true });
    if (!reply?.ok) throw new Error(`hostFetch HTTP ${reply?.status || 0}`);
    const bytes = bytesFromBase64(reply.bodyBase64 || "");
    return { buffer: bytes.buffer, ext: imageExtFromMimeOrPath(reply.contentType, fallbackExt) };
}

function requestImageBytesViaXHR(url, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.responseType = "arraybuffer";
        xhr.timeout = timeoutMs;
        xhr.addEventListener("load", () => {
            const status = Number(xhr.status || 0);
            if (status < 200 || status >= 300) {
                reject(new Error(`XHR HTTP ${status}`));
                return;
            }
            resolve({ buffer: xhr.response, contentType: xhr.getResponseHeader("content-type") || "" });
        });
        xhr.addEventListener("error", () => reject(new Error("XHR 网络错误")));
        xhr.addEventListener("timeout", () => reject(new Error("XHR 超时")));
        xhr.open("GET", url, true);
        xhr.send();
    });
}

async function loadResultImageBytes(imageUrl) {
    const urlText = String(imageUrl || "");
    if (urlText.startsWith("data:")) return readDataUrlImage(urlText);
    const cleanPath = urlText.split("?")[0];
    let ext = imageExtFromMimeOrPath(cleanPath, "png");
    try {
        return await fetchImageBytesViaHost(urlText, ext);
    } catch (error) {
        console.warn("[XiaoLiangRH Save] hostFetch 下载失败，改用 XHR:", error?.message || error);
    }
    try {
        const xhrImage = await requestImageBytesViaXHR(urlText);
        ext = imageExtFromMimeOrPath(xhrImage.contentType, ext);
        return { buffer: xhrImage.buffer, ext };
    } catch (error) {
        console.warn("[XiaoLiangRH Save] XHR 下载失败:", error?.message || error);
        throw new Error(`图片下载失败: ${urlText.substring(0, 80)}...`);
    }
}
