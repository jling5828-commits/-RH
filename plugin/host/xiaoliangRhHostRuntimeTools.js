const uxpStorage = require("uxp").storage;
const uxpShell = require("uxp").shell;
const os = require("os");

const localFs = uxpStorage.localFileSystem;
const uxpFormats = uxpStorage.formats;

const CACHE_FOLDER_NAME = "image_cache";
const FORGE_PRESET_FOLDER_NAME = "forge_presets";
const VOICE_FOLDER_NAME = "voices";
const LOG_FOLDER_NAME = "logs";
const LOG_FILE_NAME = "xiaoliang-rh.log";
const LOG_ARCHIVE_PREFIX = "xiaoliang-rh-";
const LOG_MAX_BYTES = 1024 * 1024;
const LOG_MAX_FILES = 5;
const MANIFEST_ID = "XiaoLiangRH";

function nativeRequire(name) {
    try {
        const req = typeof __non_webpack_require__ === "function"
            ? __non_webpack_require__
            : Function("return require")();
        return req ? req(name) : null;
    } catch (_) {
        return null;
    }
}

function nodeFs() {
    return nativeRequire("fs");
}

function fileUrlToNativePath(value) {
    const raw = String(value || "").trim();
    if (!/^file:\/\//i.test(raw)) return raw;
    let path = raw.replace(/^file:\/\/\/?/i, "").split(/[?#]/)[0];
    try { path = decodeURIComponent(path); } catch (_) {}
    if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
    return path.replace(/\//g, "\\");
}

function normalizeNativePath(value) {
    let path = fileUrlToNativePath(value).trim().replace(/\//g, "\\");
    if (!path) return "";
    if (/^[A-Za-z]:/.test(path)) {
        const drive = path.slice(0, 2);
        const rest = path.slice(2).replace(/\\+/g, "\\");
        return `${drive}${rest.startsWith("\\") ? rest : `\\${rest}`}`;
    }
    if (/^\\\\/.test(path)) return `\\\\${path.slice(2).replace(/\\+/g, "\\")}`;
    return path.replace(/\\+/g, "\\");
}

function assertUxpOpenOk(result) {
    if (!result) return;
    throw new Error(String(result));
}

async function openViaUxpPath(nativePath) {
    assertUxpOpenOk(await uxpShell.openPath(normalizeNativePath(nativePath), "小梁RH正在打开插件文件夹"));
}

export async function openNativeFolderInHost(nativePath) {
    const rawPath = normalizeNativePath(nativePath);
    if (!rawPath) throw new Error("folder path unavailable");
    const targetPath = ensureNativeFolder(fileExists(rawPath) ? parentNativePath(rawPath) : rawPath) || rawPath;
    if (!folderExists(targetPath)) console.warn("[XiaoLiangRH][open-cache] folder existence not confirmed", targetPath);
    const attempts = [];
    const tryOpen = async (name, action) => {
        try {
            await action();
            console.log(`[XiaoLiangRH][open-cache] host open via ${name}`, targetPath);
            return { opener: name, attempts };
        } catch (error) {
            attempts.push(`${name}: ${error?.message || String(error)}`);
            return null;
        }
    };

    console.log("[XiaoLiangRH][open-cache] host open start", targetPath);
    const opened = await tryOpen("uxp-openPath", () => openViaUxpPath(targetPath));
    if (opened) return opened;
    throw new Error(`open folder failed: ${attempts.join(" / ")}`);
}

function knownCacheNativePaths() {
    const home = os.homedir?.() || "";
    if (!home) return [];
    const storageRoot = `${home}\\AppData\\Roaming\\Adobe\\UXP\\PluginsStorage\\PHSP`;
    const fsNode = nodeFs();
    const versions = [];
    try {
        if (fsNode?.existsSync(storageRoot)) {
            for (const item of fsNode.readdirSync(storageRoot, { withFileTypes: true }) || []) {
                if (item?.isDirectory?.()) versions.push(item.name);
            }
        }
    } catch (_) {
        // Keep the default candidate below.
    }
    if (!versions.includes("27")) versions.push("27");
    const paths = [];
    for (const version of versions) {
        for (const scope of ["Developer", "External"]) {
            paths.push(`${storageRoot}\\${version}\\${scope}\\${MANIFEST_ID}\\PluginData\\${CACHE_FOLDER_NAME}`);
        }
    }
    return paths;
}

function ensureNativeFolder(nativePath) {
    const targetPath = normalizeNativePath(nativePath);
    if (!targetPath) return "";
    const fsNode = nodeFs();
    if (!fsNode) return targetPath;
    try {
        if (typeof fsNode.existsSync === "function" && typeof fsNode.mkdirSync === "function") {
            if (!fsNode.existsSync(targetPath)) fsNode.mkdirSync(targetPath, { recursive: true });
            return targetPath;
        }
        if (typeof fsNode.lstatSync === "function") {
            const stat = fsNode.lstatSync(targetPath);
            if (!stat || typeof stat.isDirectory !== "function" || stat.isDirectory()) return targetPath;
        }
    } catch (_) {
        // UXP's fs API is not identical to Node's fs; keep the path and let shell.openPath report the real failure.
    }
    return targetPath;
}

function fileExists(nativePath) {
    const targetPath = normalizeNativePath(nativePath);
    const fsNode = nodeFs();
    try {
        if (!targetPath || !fsNode) return false;
        if (typeof fsNode.existsSync === "function" && typeof fsNode.statSync === "function") {
            return fsNode.existsSync(targetPath) && fsNode.statSync(targetPath).isFile();
        }
        if (typeof fsNode.lstatSync === "function") {
            const stat = fsNode.lstatSync(targetPath);
            return !!stat && typeof stat.isFile === "function" && stat.isFile();
        }
    } catch (_) {
        // Keep folder paths flowing to openPath.
    }
    return false;
}

function folderExists(nativePath) {
    const targetPath = normalizeNativePath(nativePath);
    const fsNode = nodeFs();
    if (!fsNode) return !!targetPath;
    try {
        if (!targetPath) return false;
        if (typeof fsNode.existsSync === "function" && typeof fsNode.statSync === "function") {
            return fsNode.existsSync(targetPath) && fsNode.statSync(targetPath).isDirectory();
        }
        if (typeof fsNode.lstatSync === "function") {
            const stat = fsNode.lstatSync(targetPath);
            return !!stat && (typeof stat.isDirectory !== "function" || stat.isDirectory());
        }
    } catch (_) {
        // Do not block shell.openPath just because this UXP fs flavor cannot stat native paths.
    }
    return true;
}

function chooseCacheNativePath(dataNativePath, cacheNativePath) {
    const direct = cacheNativePath || (dataNativePath ? `${dataNativePath.replace(/[\\/]+$/, "")}\\${CACHE_FOLDER_NAME}` : "");
    const fsNode = nodeFs();
    const candidates = [direct, ...knownCacheNativePaths()].filter(Boolean);
    for (const path of candidates) {
        try {
            if (!fsNode || fsNode.existsSync(path)) {
                const ensured = ensureNativeFolder(path);
                if (ensured) return ensured;
            }
        } catch (_) {
            // Try the next candidate.
        }
    }
    for (const path of candidates) {
        const ensured = ensureNativeFolder(path);
        if (ensured) return ensured;
    }
    return direct;
}

function joinNativePath(rootPath, childName) {
    const root = normalizeNativePath(rootPath).replace(/[\\/]+$/, "");
    return root ? normalizeNativePath(`${root}\\${childName}`) : "";
}

function parentNativePath(nativePath) {
    return String(nativePath || "").replace(/[\\/]+[^\\/]*$/, "");
}

function pluginRootFromCandidate(nativePath) {
    const fsNode = nodeFs();
    let cursor = String(nativePath || "").trim();
    if (!cursor) return "";
    try {
        if (fsNode?.existsSync(cursor) && fsNode.statSync(cursor).isFile()) cursor = parentNativePath(cursor);
    } catch (_) {
        cursor = parentNativePath(cursor);
    }
    if (!fsNode) return parentNativePath(cursor) || cursor;
    for (let depth = 0; depth < 6 && cursor; depth += 1) {
        if (manifestMatchesPlugin(joinNativePath(cursor, "manifest.json"))) return ensureNativeFolder(cursor);
        const next = parentNativePath(cursor);
        if (!next || next === cursor) break;
        cursor = next;
    }
    return "";
}

function manifestMatchesPlugin(manifestPath) {
    const fsNode = nodeFs();
    if (!fileExists(manifestPath)) return false;
    if (!fsNode) return true;
    try {
        const manifest = JSON.parse(fsNode.readFileSync(manifestPath, "utf8"));
        return !manifest?.id || manifest.id === MANIFEST_ID;
    } catch (_) {
        return false;
    }
}

function runtimePluginNativeRoot(runtimeHint = "") {
    const processNode = nativeRequire("process");
    const candidates = [];
    if (runtimeHint) candidates.push(fileUrlToNativePath(runtimeHint));
    try { if (globalThis?.location?.href) candidates.push(fileUrlToNativePath(globalThis.location.href)); } catch (_) {}
    try { if (globalThis?.document?.location?.href) candidates.push(fileUrlToNativePath(globalThis.document.location.href)); } catch (_) {}
    try { if (typeof __filename === "string") candidates.push(__filename); } catch (_) {}
    try { if (typeof __dirname === "string") candidates.push(__dirname); } catch (_) {}
    try { if (processNode?.cwd) candidates.push(processNode.cwd()); } catch (_) {}
    try {
        const mainFile = processNode?.mainModule?.filename || nativeRequire?.main?.filename || "";
        if (mainFile) candidates.push(mainFile);
    } catch (_) {}
    for (const candidate of candidates) {
        const found = pluginRootFromCandidate(candidate);
        if (found) return found;
        const foundParent = pluginRootFromCandidate(parentNativePath(candidate));
        if (foundParent) return foundParent;
    }
    return "";
}

async function pluginNativeRoot(runtimeHint = "") {
    const runtimeRoot = runtimePluginNativeRoot(runtimeHint);
    let pluginFolder = null;
    try {
        pluginFolder = await localFs.getPluginFolder();
    } catch (_) {}
    if (runtimeRoot) return { pluginFolder, nativePath: runtimeRoot };
    if (!pluginFolder) return { pluginFolder: null, nativePath: "" };
    const direct = pluginRootFromCandidate(pluginFolder.nativePath || "");
    if (direct) return { pluginFolder, nativePath: direct };
    try {
        const manifest = await pluginFolder.getEntry("manifest.json");
        const parent = ensureNativeFolder(parentNativePath(manifest?.nativePath || ""));
        if (parent) return { pluginFolder, nativePath: parent };
    } catch (_) {}
    return { pluginFolder, nativePath: "" };
}

async function pluginChildNativeFolder(folderName, runtimeHint = "") {
    const { pluginFolder, nativePath: pluginNativePath } = await pluginNativeRoot(runtimeHint);
    if (!pluginNativePath) throw new Error("plugin path unavailable");
    const nativePath = ensureNativeFolder(joinNativePath(pluginNativePath, folderName));
    if (!nativePath) throw new Error(`${folderName} path unavailable`);
    return { pluginFolder, pluginNativePath, nativePath, name: folderName };
}

async function getOrCreateChildFolder(parentFolder, folderName) {
    try {
        const found = await parentFolder.getEntry(folderName);
        if (found && found.isFile === false) return found;
    } catch (_) {
        // Create below.
    }
    try {
        return await parentFolder.createFolder(folderName);
    } catch (error) {
        const retried = await parentFolder.getEntry(folderName);
        if (retried && retried.isFile === false) return retried;
        throw error;
    }
}

function entryNativePath(entry) {
    return normalizeNativePath(entry?.nativePath || "");
}

async function openFolderEntryViaUxp(folder, label) {
    if (!folder || folder.isFile) throw new Error(`${label || "folder"} entry unavailable`);
    const nativePath = entryNativePath(folder);
    if (!nativePath) throw new Error(`${label || "folder"} nativePath unavailable`);
    assertUxpOpenOk(await uxpShell.openPath(nativePath, "小梁RH正在打开插件文件夹"));
    return { ok: true, opener: "uxp-openPath-entry", nativePath };
}

async function pluginChildFolderEntry(folderName) {
    const pluginFolder = await localFs.getPluginFolder();
    const folder = await getOrCreateChildFolder(pluginFolder, folderName);
    return { pluginFolder, folder };
}

async function deleteFolderContents(folder) {
    const entries = await folder.getEntries();
    let files = 0;
    let folders = 0;
    let bytes = 0;
    for (const entry of entries || []) {
        if (entry.isFile === false) {
            const nested = await deleteFolderContents(entry);
            files += nested.files;
            folders += nested.folders + 1;
            bytes += nested.bytes;
            try { await entry.delete(); } catch (_) {}
            continue;
        }
        const data = await entry.read({ format: uxpFormats.binary });
        const length = new Uint8Array(data).length;
        await entry.delete();
        files += 1;
        bytes += length;
    }
    return { files, folders, bytes };
}

export async function clearResultImageCacheInHost() {
    const dataFolder = await localFs.getDataFolder();
    const cacheFolder = await getOrCreateChildFolder(dataFolder, CACHE_FOLDER_NAME);
    return { ok: true, ...(await deleteFolderContents(cacheFolder)) };
}

export async function getResultImageCacheInfoInHost() {
    let dataNativePath = "";
    let cacheNativePath = "";
    let cacheName = CACHE_FOLDER_NAME;
    try {
        const dataFolder = await localFs.getDataFolder();
        const cacheFolder = await getOrCreateChildFolder(dataFolder, CACHE_FOLDER_NAME);
        dataNativePath = dataFolder.nativePath || "";
        cacheNativePath = cacheFolder.nativePath || "";
        cacheName = cacheFolder.name || CACHE_FOLDER_NAME;
    } catch (_) {}
    return {
        ok: true,
        name: cacheName,
        nativePath: chooseCacheNativePath(dataNativePath, cacheNativePath),
        dataNativePath,
    };
}

export async function openResultImageCacheFolderInHost() {
    const dataFolder = await localFs.getDataFolder();
    const cacheFolder = await getOrCreateChildFolder(dataFolder, CACHE_FOLDER_NAME);
    const opened = await openFolderEntryViaUxp(cacheFolder, CACHE_FOLDER_NAME);
    return {
        ok: true,
        name: cacheFolder.name || CACHE_FOLDER_NAME,
        dataNativePath: entryNativePath(dataFolder),
        ...opened,
    };
}

export async function openForgePresetFolderInHost(runtimeHint = "") {
    const dataFolder = await localFs.getDataFolder();
    const folder = await getOrCreateChildFolder(dataFolder, FORGE_PRESET_FOLDER_NAME);
    const opened = await openFolderEntryViaUxp(folder, FORGE_PRESET_FOLDER_NAME);
    return {
        ok: true,
        name: folder.name || FORGE_PRESET_FOLDER_NAME,
        dataNativePath: entryNativePath(dataFolder),
        ...opened,
    };
}

export async function openSoundFolderInHost(runtimeHint = "") {
    const { pluginFolder, folder } = await pluginChildFolderEntry(VOICE_FOLDER_NAME);
    const opened = await openFolderEntryViaUxp(folder, VOICE_FOLDER_NAME);
    return {
        ok: true,
        name: folder.name || VOICE_FOLDER_NAME,
        pluginNativePath: entryNativePath(pluginFolder),
        ...opened,
    };
}

function safeLogLine(value) {
    try {
        return JSON.stringify(value);
    } catch (_) {
        return JSON.stringify({ ts: new Date().toISOString(), level: "warn", event: "runtime.log.serialize_failed" });
    }
}

async function entryIfExists(parentFolder, name) {
    try {
        return await parentFolder.getEntry(name);
    } catch (_) {
        return null;
    }
}

async function runtimeLogFolder() {
    return getOrCreateChildFolder(await localFs.getDataFolder(), LOG_FOLDER_NAME);
}

async function readTextFile(file) {
    if (!file || file.isFile === false) return "";
    try {
        const text = await file.read({ format: uxpFormats.utf8 });
        return typeof text === "string" ? text : "";
    } catch (_) {
        return "";
    }
}

async function fileByteLength(file) {
    if (!file || file.isFile === false) return 0;
    try {
        return new Uint8Array(await file.read({ format: uxpFormats.binary })).length;
    } catch (_) {
        return (await readTextFile(file)).length * 2;
    }
}

async function pruneRuntimeLogs(folder) {
    const rows = [];
    for (const entry of (await folder.getEntries()) || []) {
        if (entry.isFile === false) continue;
        const name = String(entry.name || "");
        const archive = name.startsWith(LOG_ARCHIVE_PREFIX) && name.endsWith(".log");
        if (name !== LOG_FILE_NAME && !archive) continue;
        let modified = 0;
        try {
            modified = Number(entry.dateModified?.getTime?.() || entry.dateModified || 0);
        } catch (_) {
            modified = 0;
        }
        const stamp = Number(name.match(/xiaoliang-rh-(\d+)\.log$/)?.[1] || modified || Date.now());
        rows.push({ entry, name, stamp, active: name === LOG_FILE_NAME });
    }
    rows.sort((a, b) => (a.active !== b.active ? (a.active ? 1 : -1) : b.stamp - a.stamp));
    const keep = new Set(rows.slice(0, LOG_MAX_FILES).map((row) => row.name));
    for (const row of rows) {
        if (keep.has(row.name)) continue;
        try { await row.entry.delete(); } catch (_) {}
    }
}

async function rotateRuntimeLog(folder, incomingText) {
    const active = await entryIfExists(folder, LOG_FILE_NAME);
    if (!active || active.isFile === false) return;
    if ((await fileByteLength(active)) + String(incomingText || "").length * 4 <= LOG_MAX_BYTES) return;
    const oldText = await readTextFile(active);
    if (oldText.trim()) {
        const archive = await folder.createFile(`${LOG_ARCHIVE_PREFIX}${Date.now()}.log`, { overwrite: true });
        await archive.write(oldText, { format: uxpFormats.utf8 });
    }
    try { await active.delete(); } catch (_) {}
}

export async function writeRuntimeLogsInHost(entries) {
    const list = Array.isArray(entries) ? entries.slice(0, 120) : [];
    if (!list.length) return { ok: true, written: 0 };
    const content = `${list.map(safeLogLine).join("\n")}\n`;
    const folder = await runtimeLogFolder();
    await rotateRuntimeLog(folder, content);
    let active = await entryIfExists(folder, LOG_FILE_NAME);
    const current = active && active.isFile !== false ? await readTextFile(active) : "";
    if (!active || active.isFile === false) active = await folder.createFile(LOG_FILE_NAME, { overwrite: true });
    await active.write(current + content, { format: uxpFormats.utf8 });
    await pruneRuntimeLogs(folder);
    return { ok: true, written: list.length };
}
