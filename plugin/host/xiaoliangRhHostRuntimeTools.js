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

function childProcess() {
    return nativeRequire("child_process");
}

function fileUrlToNativePath(value) {
    const raw = String(value || "").trim();
    if (!/^file:\/\//i.test(raw)) return raw;
    let path = raw.replace(/^file:\/\/\/?/i, "").split(/[?#]/)[0];
    try { path = decodeURIComponent(path); } catch (_) {}
    if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
    return path.replace(/\//g, "\\");
}

function startExplorer(nativePath, prefixArgs = []) {
    const cp = childProcess();
    if (!cp || (typeof cp.spawn !== "function" && typeof cp.execFile !== "function")) {
        return Promise.reject(new Error("child_process unavailable"));
    }
    const args = [...prefixArgs, String(nativePath || "")];
    if (typeof cp.spawn === "function") {
        return new Promise((resolve, reject) => {
            try {
                const child = cp.spawn("explorer.exe", args, { detached: true, stdio: "ignore", windowsHide: true });
                child.once?.("error", reject);
                child.unref?.();
                setTimeout(() => resolve(true), 30);
            } catch (error) {
                reject(error);
            }
        });
    }
    return new Promise((resolve, reject) => {
        try {
            cp.execFile("explorer.exe", args, { windowsHide: true }, (error) => (error ? reject(error) : resolve(true)));
        } catch (error) {
            reject(error);
        }
    });
}

async function openViaCmdFile(nativePath) {
    const dataFolder = await localFs.getDataFolder();
    const file = await dataFolder.createFile("open-folder.cmd", { overwrite: true });
    const safePath = String(nativePath || "").replace(/"/g, '""');
    await file.write(`@echo off\r\nstart "" explorer.exe "${safePath}"\r\nexit /b 0\r\n`, { format: uxpFormats.utf8 });
    await uxpShell.openPath(file.nativePath);
}

export async function openNativeFolderInHost(nativePath) {
    const targetPath = String(nativePath || "").trim();
    if (!targetPath) throw new Error("folder path unavailable");
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
    let opened = await tryOpen("explorer", () => startExplorer(targetPath));
    if (opened) return opened;
    opened = await tryOpen("explorer-select", () => startExplorer(targetPath, ["/select,"]));
    if (opened) return opened;
    opened = await tryOpen("cmd-launcher", () => openViaCmdFile(targetPath));
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
    if (!nativePath) return "";
    const fsNode = nodeFs();
    if (!fsNode) return nativePath;
    try {
        if (!fsNode.existsSync(nativePath)) fsNode.mkdirSync(nativePath, { recursive: true });
        return nativePath;
    } catch (_) {
        return "";
    }
}

function fileExists(nativePath) {
    const fsNode = nodeFs();
    try {
        return !!nativePath && fsNode?.existsSync(nativePath) && fsNode.statSync(nativePath).isFile();
    } catch (_) {
        return false;
    }
}

function folderExists(nativePath) {
    const fsNode = nodeFs();
    try {
        return !!nativePath && fsNode?.existsSync(nativePath) && fsNode.statSync(nativePath).isDirectory();
    } catch (_) {
        return false;
    }
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
    const root = String(rootPath || "").replace(/[\\/]+$/, "");
    return root ? `${root}\\${childName}` : "";
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
        if (fileExists(joinNativePath(cursor, "manifest.json"))) return ensureNativeFolder(cursor);
        const next = parentNativePath(cursor);
        if (!next || next === cursor) break;
        cursor = next;
    }
    return "";
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
    const pluginFolder = await localFs.getPluginFolder();
    const runtimeRoot = runtimePluginNativeRoot(runtimeHint);
    if (runtimeRoot) return { pluginFolder, nativePath: runtimeRoot };
    const direct = pluginRootFromCandidate(pluginFolder.nativePath || "") || ensureNativeFolder(pluginFolder.nativePath || "");
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
    const dataFolder = await localFs.getDataFolder();
    const cacheFolder = await getOrCreateChildFolder(dataFolder, CACHE_FOLDER_NAME);
    const dataNativePath = dataFolder.nativePath || "";
    return {
        ok: true,
        name: cacheFolder.name || CACHE_FOLDER_NAME,
        nativePath: chooseCacheNativePath(dataNativePath, cacheFolder.nativePath || ""),
        dataNativePath,
    };
}

export async function openResultImageCacheFolderInHost() {
    const info = await getResultImageCacheInfoInHost();
    if (!info.nativePath) throw new Error("image_cache path unavailable");
    return { ...info, ...(await openNativeFolderInHost(info.nativePath)) };
}

export async function openForgePresetFolderInHost(runtimeHint = "") {
    const info = await pluginChildNativeFolder(FORGE_PRESET_FOLDER_NAME, runtimeHint);
    return {
        ok: true,
        name: info.name,
        nativePath: info.nativePath,
        pluginNativePath: info.pluginNativePath,
        ...(await openNativeFolderInHost(info.nativePath)),
    };
}

export async function openSoundFolderInHost(runtimeHint = "") {
    const info = await pluginChildNativeFolder(VOICE_FOLDER_NAME, runtimeHint);
    return {
        ok: true,
        name: info.name,
        nativePath: info.nativePath,
        pluginNativePath: info.pluginNativePath,
        ...(await openNativeFolderInHost(info.nativePath)),
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
