import { mapFolderEntriesWithMtime, resolveFolder } from "./xiaoliangRhHostFileTools.js";
import {
    clearResultImageCacheInHost,
    getResultImageCacheInfoInHost,
    openForgePresetFolderInHost,
    openResultImageCacheFolderInHost,
    openSoundFolderInHost,
    writeRuntimeLogsInHost,
} from "./xiaoliangRhHostRuntimeTools.js";

const storage = require("uxp").storage;
const fs = storage.localFileSystem;
const formats = storage.formats;

const STORAGE_METHOD_NAMES = Object.freeze([
    "storage.getFolder",
    "storage.getDataFolder",
    "storage.getTemporaryFolder",
    "runtime.writeLog",
    "storage.getPluginFolder",
    "storage.getFileForOpening",
    "storage.getEntryForPersistentToken",
    "storage.createPersistentToken",
    "storage.folderGetEntries",
    "storage.folderGetEntriesBySessionToken",
    "storage.folderGetEntry",
    "storage.folderCreateFile",
    "storage.getResultImageCacheInfo",
    "storage.openResultImageCacheFolder",
    "storage.openForgePresetFolder",
    "storage.openSoundFolder",
    "storage.clearResultImageCache",
    "storage.saveTextFile",
    "storage.openTextFile",
    "storage.folderCreateFolder",
    "storage.fileRead",
    "storage.fileReadInFolder",
    "storage.fileDeleteInFolder",
    "storage.fileDelete",
    "storage.createSessionTokenForFile",
    "storage.readPluginFile",
]);

export const XLRH_STORAGE_METHODS = new Set(STORAGE_METHOD_NAMES);

function bytesToBase64(bytes) {
    const chunkSize = 8192;
    const parts = [];
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    for (let offset = 0; offset < view.length; offset += chunkSize) {
        parts.push(String.fromCharCode(...view.subarray(offset, offset + chunkSize)));
    }
    return btoa(parts.join(""));
}

function base64ToBytes(text) {
    const binary = atob(String(text || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

function entryInfo(entry) {
    return {
        valid: true,
        name: entry?.name || "",
        isFile: Boolean(entry?.isFile),
        nativePath: entry?.nativePath || "",
    };
}

async function readEntryContent(entry, formatType) {
    const binary = formatType === "binary";
    const data = await entry.read({ format: binary ? formats.binary : formats.utf8 });
    return binary ? `base64:${bytesToBase64(new Uint8Array(data))}` : data;
}

async function readFileToken(fileToken, formatType) {
    const entry = fs.getEntryForSessionToken(fileToken);
    if (!entry?.isFile) throw new Error("Invalid file token");
    return readEntryContent(entry, formatType);
}

async function writeFileInFolder(folderToken, fileName, content, overwrite) {
    const folder = await resolveFolder(folderToken);
    const file = await folder.createFile(fileName, { overwrite: overwrite !== false });
    const asText = String(content ?? "");
    if (typeof content === "string" && asText.startsWith("base64:")) {
        await file.write(base64ToBytes(asText.slice(7)), { format: formats.binary });
    } else {
        await file.write(content, { format: formats.utf8 });
    }
    return { ok: true };
}

async function openBinaryFile(types) {
    const file = await fs.getFileForOpening({ types: types || ["jpg", "jpeg", "png", "webp", "gif"] });
    if (!file) return null;
    const bytes = new Uint8Array(await file.read({ format: formats.binary }));
    return { name: file.name, base64: bytesToBase64(bytes) };
}

async function getFolderToken() {
    const folder = await fs.getFolder();
    if (!folder) return null;
    return { token: await fs.createPersistentToken(folder), name: folder.name, nativePath: folder.nativePath || "" };
}

async function getDataFolderToken() {
    const folder = await fs.getDataFolder();
    return { token: await fs.createPersistentToken(folder), name: folder.name || "PluginData", nativePath: folder.nativePath || "" };
}

async function getSessionFolderToken(getFolder) {
    return { token: await fs.createSessionToken(await getFolder()) };
}

async function readPersistentEntry(token) {
    const entry = await fs.getEntryForPersistentToken(token);
    return entry ? entryInfo(entry) : { valid: false };
}

async function folderEntryToken(folderToken, fileName) {
    const entry = await (await resolveFolder(folderToken)).getEntry(fileName);
    return { token: await fs.createSessionToken(entry), name: entry.name, isFile: entry.isFile };
}

async function saveTextFile(nameInput, content) {
    const name = String(nameInput || "export.json").trim() || "export.json";
    const file = await fs.getFileForSaving(name, { types: ["json"] });
    if (!file) return null;
    await file.write(String(content ?? ""), { format: formats.utf8 });
    return { ok: true, name: file.name || name, nativePath: file.nativePath || "" };
}

async function openTextFile(types) {
    const requestedTypes = Array.isArray(types) && types.length ? types : ["json"];
    const file = await fs.getFileForOpening({ types: requestedTypes });
    if (!file) return null;
    return { ok: true, name: file.name || "", text: String(await file.read({ format: formats.utf8 }) || "") };
}

async function readFileFromFolder(folderToken, fileName, formatType) {
    const entry = await (await resolveFolder(folderToken)).getEntry(fileName);
    if (!entry.isFile) throw new Error("Not a file");
    return readEntryContent(entry, formatType);
}

async function getPluginEntry(relativePath) {
    const pluginFolder = await fs.getPluginFolder();
    const path = String(relativePath || "").replace(/\\/g, "/").split("/").filter(Boolean);
    if (!path.length) throw new Error("Plugin file path is empty");
    let entry = pluginFolder;
    for (const part of path) entry = await entry.getEntry(part);
    return entry;
}

async function deleteEntryFromFolder(folderToken, fileName) {
    const entry = await (await resolveFolder(folderToken)).getEntry(fileName);
    await entry.delete();
    return { ok: true };
}

async function deleteSessionEntry(token) {
    const entry = fs.getEntryForSessionToken(token);
    if (entry) await entry.delete();
    return { ok: true };
}

const STORAGE_HANDLERS = Object.freeze({
    "storage.getFolder": () => getFolderToken(),
    "storage.getDataFolder": () => getDataFolderToken(),
    "storage.getTemporaryFolder": () => getSessionFolderToken(() => fs.getTemporaryFolder()),
    "runtime.writeLog": (args) => writeRuntimeLogsInHost(args[0]),
    "storage.getPluginFolder": () => getSessionFolderToken(() => fs.getPluginFolder()),
    "storage.getFileForOpening": (args) => openBinaryFile(args[0]),
    "storage.getEntryForPersistentToken": (args) => readPersistentEntry(args[0]),
    "storage.createPersistentToken": async (args) => fs.createPersistentToken(await fs.getEntryForPersistentToken(args[0])),
    "storage.folderGetEntries": async (args) => mapFolderEntriesWithMtime(await (await resolveFolder(args[0])).getEntries()),
    "storage.folderGetEntriesBySessionToken": async (args) => mapFolderEntriesWithMtime(await fs.getEntryForSessionToken(args[0]).getEntries()),
    "storage.folderGetEntry": (args) => folderEntryToken(args[0], args[1]),
    "storage.folderCreateFile": (args) => writeFileInFolder(args[0], args[1], args[2], args[3]),
    "storage.getResultImageCacheInfo": () => getResultImageCacheInfoInHost(),
    "storage.openResultImageCacheFolder": () => openResultImageCacheFolderInHost(),
    "storage.openForgePresetFolder": (args) => openForgePresetFolderInHost(args[0]),
    "storage.openSoundFolder": (args) => openSoundFolderInHost(args[0]),
    "storage.clearResultImageCache": () => clearResultImageCacheInHost(),
    "storage.saveTextFile": (args) => saveTextFile(args[0], args[1]),
    "storage.openTextFile": (args) => openTextFile(args[0]),
    "storage.folderCreateFolder": async (args) => {
        await (await resolveFolder(args[0])).createFolder(args[1]);
        return { ok: true };
    },
    "storage.fileRead": (args) => readFileToken(args[0], args[1]),
    "storage.fileReadInFolder": (args) => readFileFromFolder(args[0], args[1], args[2]),
    "storage.fileDeleteInFolder": (args) => deleteEntryFromFolder(args[0], args[1]),
    "storage.fileDelete": (args) => deleteSessionEntry(args[0]),
    "storage.createSessionTokenForFile": async (args) => fs.createSessionToken(await (await resolveFolder(args[0])).getEntry(args[1])),
    "storage.readPluginFile": async (args) => readEntryContent(await getPluginEntry(args[0]), "binary"),
});

export async function handleXlrhStorageBridgeMethod(method, args = []) {
    const handler = STORAGE_HANDLERS[method];
    if (!handler) throw new Error(`Unhandled storage bridge method: ${method}`);
    return handler(Array.isArray(args) ? args : []);
}
