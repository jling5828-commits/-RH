import { storage } from "../../bridge/uxpShim.js";
import { getTempResultFolder } from "../../utils/imageSaver.js";
import { RESULT_WORKBENCH_RUNNINGHUB } from "../../utils/resultFolderTokens.js";

const fs = storage.localFileSystem;
const formats = storage.formats;
const RESULT_MANIFEST_FILE_NAME = "results-manifest.json";
const XLRH_RESULT_IMAGE_RE = /(^\u5c0f\u6881RH_|_\u5c0f\u6881RH_).*\.(jpg|jpeg|png|webp|gif)$/i;

export function isXiaoLiangResultFile(fileOrName) {
    const name = typeof fileOrName === "string" ? fileOrName : fileOrName?.name;
    return XLRH_RESULT_IMAGE_RE.test(String(name || ""));
}

export function formatFolderPathPrefixForBar(nativePath, folderNameFallback) {
    const fallback = String(folderNameFallback || "").trim();
    const rawPath = typeof nativePath === "string" ? nativePath.trim() : "";
    if (!rawPath) return fallback ? `${fallback}/` : "";
    const segments = rawPath.replace(/\\/g, "/").split("/").map((part) => part.trim()).filter(Boolean);
    const folder = segments.pop() || fallback;
    if (!folder) return "";
    const parent = segments.pop() || "";
    if (!parent) return `${folder}/`;
    return segments.length ? `.../${parent}/${folder}/` : `${parent}/${folder}/`;
}

export function clearResultViewer(setters) {
    setters.setUserFolder?.(null);
    setters.setFileList?.([]);
    setters.setCurrentIndex?.(-1);
    setters.setCurrentImgUrl?.(null);
}

export function clampCounterJump(rawValue, count) {
    const text = String(rawValue || "").trim();
    if (!text) return { empty: true, value: 0 };
    const parsed = Number.parseInt(text, 10);
    if (!Number.isFinite(parsed)) return { invalid: true, value: 0 };
    return { value: Math.min(Math.max(parsed, 1), Math.max(1, count)) };
}

export async function deleteResultSidecarIfExists(folder, imageFileName) {
    if (!folder || !imageFileName) return false;
    try {
        const sidecar = await folder.getEntry(`${imageFileName}.bounds.json`);
        if (!sidecar?.isFile) return false;
        await sidecar.delete();
        return true;
    } catch (_) {
        return false;
    }
}

function sidecarNumber(value) {
    if (value == null) return NaN;
    if (typeof value === "object" && "_value" in value) return Number(value._value);
    return Number(value);
}

function normalizeSidecarBounds(raw) {
    if (!raw || typeof raw !== "object") return null;
    const left = sidecarNumber(raw.left);
    const top = sidecarNumber(raw.top);
    const right = sidecarNumber(raw.right);
    const bottom = sidecarNumber(raw.bottom);
    return [left, top, right, bottom].every(Number.isFinite) && right > left && bottom > top
        ? { left, top, right, bottom }
        : null;
}

export async function readResultPlaceSidecar(folder, imageFileName) {
    if (!folder || !imageFileName) return null;
    try {
        const sidecar = await folder.getEntry(`${imageFileName}.bounds.json`);
        if (!sidecar?.isFile) return null;
        const parsed = JSON.parse(String(await sidecar.read({ format: formats.utf8 }) || "{}"));
        const place = parsed?.place && typeof parsed.place === "object" ? parsed.place : parsed;
        const bounds = normalizeSidecarBounds(place?.bounds || place);
        const docId = sidecarNumber(place?.docId ?? parsed?.docId);
        if (!bounds && !Number.isFinite(docId)) return null;
        return { bounds, docId: Number.isFinite(docId) ? docId : null };
    } catch (_) {
        return null;
    }
}

export async function removeResultManifestEntries(folder, removedNames) {
    const names = new Set((removedNames || []).map((x) => String(x || "")).filter(Boolean));
    if (!folder || names.size === 0) return false;
    const manifest = await readResultManifest(folder);
    if (!manifest.entries.length) return false;
    const next = manifest.entries.filter((entry) => !names.has(String(entry?.fileName || "")));
    return next.length === manifest.entries.length ? false : writeResultManifest(folder, next);
}

export async function cleanupResultManifestOrphans(folder) {
    if (!folder) return { manifestRemoved: 0, sidecars: 0 };
    const manifest = await readResultManifest(folder);
    const nextManifestEntries = [];
    let manifestRemoved = 0;

    for (const entry of manifest.entries) {
        const name = String(entry?.fileName || "");
        if (!name || !(await folderHasFile(folder, name))) {
            manifestRemoved += 1;
        } else {
            nextManifestEntries.push(entry);
        }
    }
    if (manifestRemoved > 0) await writeResultManifest(folder, nextManifestEntries);

    let sidecars = 0;
    try {
        const entries = await folder.getEntries();
        for (const entry of entries || []) {
            if (!entry?.isFile || !String(entry.name || "").endsWith(".bounds.json")) continue;
            const imageName = String(entry.name).replace(/\.bounds\.json$/i, "");
            if (!isXiaoLiangResultFile(imageName) || await folderHasFile(folder, imageName)) continue;
            await entry.delete();
            sidecars += 1;
        }
    } catch (_) {
        // Best-effort cache hygiene; list refresh should not fail because cleanup failed.
    }
    return { manifestRemoved, sidecars };
}

export async function readResultFileAsDataUrl(file) {
    const bytes = await file.read({ format: formats.binary });
    const blob = new Blob([bytes], { type: mimeFromFileName(file?.name) });
    return blobToDataUrl(blob);
}

export async function collectResultImageFiles(folder, workbenchId) {
    if (!folder) return [];
    if (workbenchId === RESULT_WORKBENCH_RUNNINGHUB) {
        const manifestFiles = await loadFilesFromResultManifest(folder);
        if (manifestFiles.length) return manifestFiles;
    }
    const entries = await folder.getEntries();
    return sortNewestFirst((entries || []).filter(isImageEntry));
}

export function makeViewerStateFromFiles(files) {
    const fileList = Array.isArray(files) ? files : [];
    return {
        fileList,
        currentIndex: fileList.length ? 0 : -1,
        clearPreview: fileList.length === 0,
    };
}

export async function folderFromToken(token) {
    if (!token) return null;
    try {
        return await fs.getEntryForPersistentToken(token);
    } catch (_) {
        return null;
    }
}

export async function defaultRhResultFolder(workbenchId) {
    return workbenchId === RESULT_WORKBENCH_RUNNINGHUB ? getTempResultFolder() : null;
}

export async function getResultCacheFolder() {
    return getTempResultFolder();
}

async function readResultManifest(folder) {
    if (!folder) return { v: 1, entries: [] };
    try {
        const file = await folder.getEntry(RESULT_MANIFEST_FILE_NAME);
        if (!file?.isFile) return { v: 1, entries: [] };
        const text = await file.read({ format: formats.utf8 });
        const parsed = JSON.parse(String(text || "{}"));
        return {
            v: Number(parsed?.v || 1) || 1,
            entries: Array.isArray(parsed?.entries) ? parsed.entries : [],
        };
    } catch (_) {
        return { v: 1, entries: [] };
    }
}

async function writeResultManifest(folder, entries) {
    if (!folder) return false;
    try {
        const file = await folder.createFile(RESULT_MANIFEST_FILE_NAME, { overwrite: true });
        await file.write(JSON.stringify({ v: 1, entries: Array.isArray(entries) ? entries : [] }, null, 2), { format: formats.utf8 });
        return true;
    } catch (error) {
        console.warn("[XLRH Results] write manifest failed:", error);
        return false;
    }
}

async function loadFilesFromResultManifest(folder) {
    const manifest = await readResultManifest(folder);
    if (!manifest.entries.length) return [];

    const files = [];
    const keptEntries = [];
    const seen = new Set();
    for (const entry of manifest.entries.slice().reverse()) {
        const name = String(entry?.fileName || "");
        if (!name || seen.has(name) || !isXiaoLiangResultFile(name)) continue;
        seen.add(name);
        try {
            const file = await folder.getEntry(name);
            if (!file?.isFile) continue;
            files.push(file);
            keptEntries.unshift(entry);
        } catch (_) {
            // Stale manifest entries are trimmed below.
        }
    }
    if (keptEntries.length !== manifest.entries.length) await writeResultManifest(folder, keptEntries);
    return files;
}

async function folderHasFile(folder, name) {
    try {
        const entry = await folder.getEntry(name);
        return Boolean(entry?.isFile);
    } catch (_) {
        return false;
    }
}

function isImageEntry(entry) {
    return Boolean(entry?.isFile && /\.(jpg|jpeg|png|webp|gif)$/i.test(String(entry.name || "")));
}

function sortNewestFirst(files) {
    return files.slice().sort((a, b) => {
        const byTime = Number(b.dateModifiedMs || 0) - Number(a.dateModifiedMs || 0);
        return byTime || String(b.name || "").localeCompare(String(a.name || ""));
    });
}

function mimeFromFileName(fileName) {
    const ext = String(fileName || "").split(".").pop().toLowerCase();
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "webp") return "image/webp";
    if (ext === "gif") return "image/gif";
    return "image/png";
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(reader.result));
        reader.addEventListener("error", () => reject(reader.error || new Error("preview read failed")));
        reader.readAsDataURL(blob);
    });
}
