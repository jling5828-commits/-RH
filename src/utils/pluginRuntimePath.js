export function pluginRuntimeHint() {
    try {
        return typeof window !== "undefined" ? window.location?.href || "" : "";
    } catch (_) {
        return "";
    }
}

function fileUrlToNativePath(value) {
    const raw = String(value || "").trim();
    if (!/^file:\/\//i.test(raw)) return raw;
    let path = raw.replace(/^file:\/\/\/?/i, "").split(/[?#]/)[0];
    try { path = decodeURIComponent(path); } catch (_) {}
    if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
    return path.replace(/\//g, "\\");
}

export function pluginChildNativePath(folderName, hint = pluginRuntimeHint()) {
    const pagePath = fileUrlToNativePath(hint);
    if (!/^[A-Za-z]:[\\/]/.test(pagePath) && !/^\\\\/.test(pagePath)) return "";
    const root = pagePath.replace(/[\\/]+[^\\/]*$/, "").replace(/[\\/]+$/, "");
    const name = String(folderName || "").replace(/[\\/]+/g, "");
    return root && name ? `${root}\\${name}` : "";
}
