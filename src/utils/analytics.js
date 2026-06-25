import { ANALYTICS_CONFIG } from "../config/analyticsConfig.js";

const LOCAL_EVENT_LIMIT = 20;
const ALLOWED_EVENTS = new Set(["plugin_load", "generate_success", "generate_fail", "plugin_refresh"]);
const recentAnalyticsEvents = [];

function clip(value, max = 200) {
    return String(value ?? "").slice(0, max);
}

function rememberLocalEvent(event, note, channel) {
    const record = {
        event,
        note: clip(note),
        channel: clip(channel || ANALYTICS_CONFIG.channel || "小梁RH", 80),
        pluginVersion: ANALYTICS_CONFIG.pluginVersion || "1.0.0",
        timestamp: Date.now(),
    };
    recentAnalyticsEvents.unshift(record);
    recentAnalyticsEvents.splice(LOCAL_EVENT_LIMIT);
    return record;
}

function shouldRecord(event) {
    return !!ANALYTICS_CONFIG.enabled && ALLOWED_EVENTS.has(event);
}

export async function sendAnalyticsPing(event, note = "", channelOverride = "") {
    if (!shouldRecord(event)) return null;
    return rememberLocalEvent(event, note, channelOverride);
}

export function pingPluginLoad() {
    sendAnalyticsPing("plugin_load").catch(() => {});
}

export function pingGenerateStart() {}

export function pingGenerateSuccess(note = "", channel = "") {
    sendAnalyticsPing("generate_success", note, channel).catch(() => {});
}

export function pingGenerateFail(note = "", channel = "") {
    sendAnalyticsPing("generate_fail", note, channel).catch(() => {});
}

export function reportGenerateOutcome({ status, channel, cancelled = false, resultDetail = null, successNote, failNote }) {
    if (cancelled || status === "cancelled") return;
    if (status === "success") {
        const saved = resultDetail?.saved ?? 0;
        const note = successNote != null && String(successNote).trim() ? successNote : `saved=${saved}`;
        pingGenerateSuccess(note, channel);
        return;
    }
    if (status === "error" || status === "warning") {
        const detail = resultDetail?.errors?.[0] || resultDetail?.message || "unknown";
        pingGenerateFail(failNote != null && String(failNote).trim() ? failNote : detail, channel);
    }
}

export function pingPluginRefresh() {
    sendAnalyticsPing("plugin_refresh").catch(() => {});
}

export function getLocalAnalyticsEvents() {
    return recentAnalyticsEvents.slice();
}
