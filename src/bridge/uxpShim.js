import { shell, storage } from "./uxpBridge.js";

const localFs = storage.localFileSystem;
const BRIDGE_B64_PREFIX = "base64:";
const BINARY_CHUNK = 8192;

function requestedFormat(options = {}) {
    return options.format === "utf8" ? "utf8" : "binary";
}

function removeBridgePrefix(payload) {
    const text = String(payload || "");
    return text.startsWith(BRIDGE_B64_PREFIX) ? text.slice(BRIDGE_B64_PREFIX.length) : text;
}

function arrayBufferFromBase64(payload) {
    const binary = atob(removeBridgePrefix(payload));
    const out = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        out[index] = binary.charCodeAt(index);
    }
    return out.buffer;
}

function base64FromArrayBuffer(content) {
    const bytes = new Uint8Array(content);
    const pieces = [];
    for (let offset = 0; offset < bytes.length; offset += BINARY_CHUNK) {
        pieces.push(String.fromCharCode.apply(null, bytes.subarray(offset, offset + BINARY_CHUNK)));
    }
    return `${BRIDGE_B64_PREFIX}${btoa(pieces.join(""))}`;
}

function decodePayload(format, payload) {
    return format === "binary" ? arrayBufferFromBase64(payload) : payload;
}

function safeMtime(value) {
    return Number.isFinite(value) ? value : 0;
}

function readerFrom(loadPayload) {
    return async (options = {}) => {
        const format = requestedFormat(options);
        return decodePayload(format, await loadPayload(format));
    };
}

function makeFolderBackedFile(folderToken, name, modifiedAt = 0) {
    return {
        name,
        isFile: true,
        folderToken,
        dateModifiedMs: safeMtime(modifiedAt),
        read: readerFrom((format) => localFs.fileReadInFolder(folderToken, name, format)),
        async write(content, options = {}) {
            const format = requestedFormat(options);
            const payload = format === "binary" ? base64FromArrayBuffer(content) : content;
            await localFs.folderCreateFile(folderToken, name, payload, options.overwrite !== false);
        },
        async delete() {
            await localFs.fileDeleteInFolder(folderToken, name);
        },
        createSessionToken: () => localFs.createSessionTokenForFile(folderToken, name),
    };
}

function makeTokenBackedFile(fileToken, name) {
    return {
        name,
        isFile: true,
        fileToken,
        read: readerFrom((format) => localFs.fileRead(fileToken, format)),
        async delete() {
            await localFs.fileDelete(fileToken);
        },
        createSessionToken: async () => fileToken,
    };
}

async function getChildDescriptor(folderToken, name) {
    return localFs.folderGetEntry(folderToken, name);
}

function makeLazyFolder(parentToken, name) {
    let pending = null;
    const load = async () => {
        if (!pending) {
            pending = getChildDescriptor(parentToken, name).then((entry) => makeUxFolder(entry.token, entry.name, true, entry.nativePath));
        }
        return pending;
    };

    return {
        token: null,
        name,
        isFile: false,
        async getEntries() {
            return (await load()).getEntries();
        },
        async getEntry(entryName) {
            return (await load()).getEntry(entryName);
        },
    };
}

function wrapListedEntry(folderToken, entry) {
    if (entry?.isFile) return makeFolderBackedFile(folderToken, entry.name, entry.dateModifiedMs);
    return makeLazyFolder(folderToken, entry?.name);
}

async function listFolderEntries(token, bySessionToken) {
    const entries = bySessionToken
        ? await localFs.folderGetEntriesBySessionToken(token)
        : await localFs.folderGetEntries(token);
    return Array.isArray(entries) ? entries : [];
}

function makeUxFolder(token, name, bySessionToken = false, nativePath) {
    const folder = {
        token,
        name,
        isFile: false,
        async getEntries() {
            const entries = await listFolderEntries(token, bySessionToken);
            return entries.map((entry) => wrapListedEntry(token, entry));
        },
        async getEntry(entryName) {
            const entry = await getChildDescriptor(token, entryName);
            return entry.isFile
                ? makeTokenBackedFile(entry.token, entry.name)
                : makeUxFolder(entry.token, entry.name, true, entry.nativePath);
        },
        createFile: async (fileName) => makeFolderBackedFile(token, fileName),
        async createFolder(folderName) {
            await localFs.folderCreateFolder(token, folderName);
            const entry = await getChildDescriptor(token, folderName);
            if (entry.isFile) throw new Error("Expected folder");
            return makeUxFolder(entry.token, entry.name, true, entry.nativePath);
        },
    };

    if (nativePath) folder.nativePath = nativePath;
    return folder;
}

function folderFromBridgeResult(result, fallbackName, bySessionToken = false) {
    if (!result?.token) return null;
    return makeUxFolder(result.token, result.name || fallbackName, bySessionToken, result.nativePath);
}

function installSessionTokenBridge() {
    localFs.createSessionToken = async (entry) => {
        if (entry?.createSessionToken) return entry.createSessionToken();
        if (entry?.folderToken && entry?.name) return localFs.createSessionTokenForFile(entry.folderToken, entry.name);
        if (entry?.fileToken) return entry.fileToken;
        throw new Error("Invalid entry for createSessionToken");
    };
}

function installPersistentTokenBridge() {
    const original = localFs.createPersistentToken?.bind(localFs);
    localFs.createPersistentToken = async (entry) => {
        if (entry?.token) return entry.token;
        return original ? original(entry?.token ?? entry) : entry?.token;
    };
}

function patchFolderPicker(methodName, fallbackName, bySessionToken = false) {
    const original = localFs[methodName]?.bind(localFs);
    if (typeof original !== "function") return;
    localFs[methodName] = async (...args) => folderFromBridgeResult(await original(...args), fallbackName, bySessionToken);
}

function installFolderBridge() {
    patchFolderPicker("getFolder", "folder");
    patchFolderPicker("getDataFolder", "data");
    patchFolderPicker("getPluginFolder", "plugin", true);
    patchFolderPicker("getTemporaryFolder", "temp", true);

    const originalEntryForToken = localFs.getEntryForPersistentToken?.bind(localFs);
    if (typeof originalEntryForToken === "function") {
        localFs.getEntryForPersistentToken = async (token) => {
            const result = await originalEntryForToken(token);
            return result?.valid ? makeUxFolder(token, result.name, false, result.nativePath) : null;
        };
    }
}

function installOpenFileBridge() {
    const original = localFs.getFileForOpening?.bind(localFs);
    if (typeof original !== "function") return;

    localFs.getFileForOpening = async (options) => {
        const result = await original(options);
        if (!result) return null;
        const content = arrayBufferFromBase64(result.base64);
        return { name: result.name, read: async () => content };
    };
}

installSessionTokenBridge();
installPersistentTokenBridge();
installFolderBridge();
installOpenFileBridge();

export { shell, storage };
export const versions = { plugin: "1.0.8" };
