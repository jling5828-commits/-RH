export function pluginRuntimeHint() {
    try {
        return typeof window !== "undefined" ? window.location?.href || "" : "";
    } catch (_) {
        return "";
    }
}

function cleanChildFolderName(folderName) {
    return String(folderName || "").replace(/[\\/]+/g, "").trim();
}

function fileUrlToNativePath(value) {
    const raw = String(value || "").trim();
    if (!/^file:\/\//i.test(raw)) return raw;
    let path = raw.replace(/^file:\/\/\/?/i, "").split(/[?#]/)[0];
    try { path = decodeURIComponent(path); } catch (_) {}
    if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
    return path.replace(/\//g, "\\");
}

function isNativePath(value) {
    return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value);
}

function joinNativePath(rootPath, childName) {
    const root = String(rootPath || "").replace(/[\\/]+$/, "");
    const name = cleanChildFolderName(childName);
    return root && name ? `${root}\\${name}` : "";
}

async function getPluginChildFolder(folderName) {
    const name = cleanChildFolderName(folderName);
    if (!name) return null;
    const fs = require("uxp")?.storage?.localFileSystem;
    if (!fs || typeof fs.getPluginFolder !== "function") return null;
    const pluginFolder = await fs.getPluginFolder();
    try {
        const existing = await pluginFolder.getEntry(name);
        if (existing?.isFile === false) return { pluginFolder, folder: existing };
        throw new Error(`${name} is not a folder`);
    } catch (_) {}
    try {
        return { pluginFolder, folder: await pluginFolder.createFolder(name) };
    } catch (error) {
        const existing = await pluginFolder.getEntry(name);
        if (existing?.isFile === false) return { pluginFolder, folder: existing };
        throw error;
    }
}

export function pluginChildNativePath(folderName, hint = pluginRuntimeHint()) {
    const pagePath = fileUrlToNativePath(hint);
    if (!isNativePath(pagePath)) return "";
    const root = pagePath.replace(/[\\/]+[^\\/]*$/, "").replace(/[\\/]+$/, "");
    return joinNativePath(root, folderName);
}

export async function pluginChildNativePathAsync(folderName, hint = pluginRuntimeHint()) {
    const direct = pluginChildNativePath(folderName, hint);
    if (isNativePath(direct)) return direct;
    try {
        const result = await getPluginChildFolder(folderName);
        const nativePath = result?.folder?.nativePath || joinNativePath(result?.pluginFolder?.nativePath, folderName);
        if (isNativePath(nativePath)) return nativePath;
    } catch (_) {}
    return "";
}
