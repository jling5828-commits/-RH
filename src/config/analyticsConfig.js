import manifest from "../../plugin/manifest.json";

const FALLBACK_PLUGIN_VERSION = "1.0.0";

function manifestVersion() {
    const version = typeof manifest?.version === "string" ? manifest.version.trim() : "";
    return version || FALLBACK_PLUGIN_VERSION;
}

export const ANALYTICS_CONFIG = Object.freeze({
    enabled: false,
    endpoint: "",
    apiToken: "",
    pluginVersion: manifestVersion(),
    maxRecordsPerAnonymousId: 50,
    channel: "小梁RH",
});

export function getAnalyticsPluginVersion() {
    return ANALYTICS_CONFIG.pluginVersion;
}
