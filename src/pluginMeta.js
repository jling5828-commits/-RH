import manifest from "../plugin/manifest.json";

const BRAND = Object.freeze({
    fallbackName: "小梁RH",
    panelTitle: "小梁RH",
    userAgent: "XiaoLiangRH",
    rhUserAgent: "XiaoLiangRH-RH",
    httpFallbackVersion: "1.3.4",
});

function manifestText(field, fallback = "") {
    const value = manifest && Object.prototype.hasOwnProperty.call(manifest, field) ? manifest[field] : fallback;
    const text = String(value || "").trim();
    return text || fallback;
}

function httpVersion(version) {
    const text = String(version || "").trim();
    return text && text !== "1.0.0" ? text : BRAND.httpFallbackVersion;
}

export const PLUGIN_CHINESE_NAME = BRAND.fallbackName;
export const PLUGIN_PANEL_TITLE = BRAND.panelTitle;
export const PLUGIN_DISPLAY_NAME = manifestText("name", BRAND.fallbackName);
export const PLUGIN_VERSION = manifestText("version", "");

const PLUGIN_HTTP_VERSION = httpVersion(PLUGIN_VERSION);
export const PLUGIN_HTTP_USER_AGENT = `${BRAND.userAgent}/${PLUGIN_HTTP_VERSION}`;
export const PLUGIN_HTTP_USER_AGENT_RH = `${BRAND.rhUserAgent}/${PLUGIN_HTTP_VERSION}`;
