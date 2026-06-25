import { RH_DEFAULT_BASE_URL, RH_PARSE_FALLBACKS, RH_PATH } from "./constants.js";
import { rhGetJsonResult, rhJoinUrl, rhPostJsonResult } from "./http.js";
import { normalizeTaskEnvelope } from "./envelope.js";

const APP_SCHEMA_CACHE = new Map();
const APP_SCHEMA_PENDING = new Map();
const APP_ID_QUERY_KEYS = Object.freeze(["webappId", "webappid", "webAppId", "appId", "appid", "workflowId", "workflowid", "id", "code"]);
const APP_ID_PATH_HINTS = new Set(["app", "apps", "workflow", "workflows", "community", "detail", "webapp"]);
const INPUT_ARRAY_KEYS = Object.freeze(["inputs", "nodeInfoList"]);
const NAME_KEYS = Object.freeze(["webappName", "appName", "workflowName", "displayName", "title", "name"]);
const NAME_KEY_WEIGHT = Object.freeze({
    webappname: 80,
    appname: 74,
    workflowname: 70,
    displayname: 62,
    title: 52,
    name: 44,
});
const COVER_KEY_PATTERNS = Object.freeze(["cover", "thumbnail", "thumb", "image", "avatar", "banner", "poster"]);
const ICON_KEY_PATTERNS = Object.freeze(["icon", "logo"]);

function textOf(value) {
    return value == null ? "" : String(value).trim();
}

function objectOf(value) {
    return value && typeof value === "object" ? value : null;
}

function normalizedKey(key) {
    return String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function looksLikeJsonText(text) {
    const t = textOf(text);
    return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

function parseJsonText(value) {
    if (typeof value !== "string" || !looksLikeJsonText(value)) return undefined;
    try {
        return JSON.parse(value.trim());
    } catch {
        return undefined;
    }
}

function asUrlCandidate(raw) {
    const value = textOf(raw);
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (/^(?:www\.)?runninghub\.(?:cn|ai)\//i.test(value)) return `https://${value}`;
    return "";
}

function urlFromMaybeEncoded(raw) {
    const value = textOf(raw);
    if (!value) return "";
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function readIdFromUrlLike(value) {
    const decoded = urlFromMaybeEncoded(value);
    const urlText = /^https?:\/\//i.test(decoded)
        ? decoded
        : /runninghub\.(?:cn|ai)/i.test(decoded)
            ? `https://${decoded.replace(/^\/+/, "")}`
            : "";
    if (!urlText) return "";

    try {
        const url = new URL(urlText);
        const searchAreas = [url.searchParams];
        if (url.hash && url.hash.includes("?")) {
            const hashQuery = url.hash.slice(url.hash.indexOf("?") + 1);
            searchAreas.push(new URLSearchParams(hashQuery));
        }
        for (const params of searchAreas) {
            for (const key of APP_ID_QUERY_KEYS) {
                const hit = params.get(key);
                if (textOf(hit)) return textOf(hit);
            }
        }
        const segments = url.pathname.split("/").map((item) => item.trim()).filter(Boolean);
        for (let i = 0; i < segments.length - 1; i++) {
            if (APP_ID_PATH_HINTS.has(segments[i].toLowerCase())) return segments[i + 1];
        }
        return segments.length ? segments[segments.length - 1] : "";
    } catch {
        return "";
    }
}

export function normalizeRhAppId(rawValue) {
    const value = textOf(rawValue);
    if (!value) return "";
    const directUrlId = readIdFromUrlLike(value);
    if (directUrlId) return directUrlId;
    if (!/[/?#]/.test(value)) return value;
    const decoded = urlFromMaybeEncoded(value);
    const numeric = decoded.match(/\d{5,}/);
    return numeric ? numeric[0] : value;
}

export function webappIdToCanonicalString(raw) {
    if (raw == null) return "";
    if (typeof raw === "bigint") return raw.toString();
    const id = normalizeRhAppId(raw);
    if (!id) return "";
    if (/^\d+$/.test(id)) return id;
    const numeric = Number(id);
    return Number.isFinite(numeric) && numeric > 0 ? String(Math.trunc(numeric)) : id;
}

function cacheKey(apiKey, appId) {
    return `${textOf(apiKey)}\n${textOf(appId)}`;
}

function apiRoot(baseUrl) {
    return textOf(baseUrl).replace(/\/+$/, "") || RH_DEFAULT_BASE_URL;
}

function withQuery(baseUrl, endpoint, params) {
    const url = new URL(rhJoinUrl(baseUrl, endpoint));
    for (const [key, value] of Object.entries(params || {})) {
        const text = textOf(value);
        if (text) url.searchParams.set(key, text);
    }
    return url.toString();
}

function stringFromRecord(record, keys) {
    const obj = objectOf(record);
    if (!obj) return "";
    for (const key of keys) {
        const value = textOf(obj[key]);
        if (value) return value;
    }
    return "";
}

function isPlaceholderName(name) {
    const value = textOf(name);
    if (!value) return true;
    const key = value.toLowerCase();
    return ["unknown", "unknown app", "unnamed", "unnamed app", "app", "未命名", "未命名应用"].includes(key);
}

function pushNameCandidate(candidates, seen, value, key, depth) {
    const text = textOf(value);
    if (isPlaceholderName(text)) return;
    const marker = text.toLowerCase();
    if (seen.has(marker)) return;
    seen.add(marker);
    const nk = normalizedKey(key);
    candidates.push({
        value: text,
        score: (NAME_KEY_WEIGHT[nk] || 20) + Math.min(16, text.length) - Math.max(0, depth),
        depth,
    });
}

function collectNameCandidates(value, key, depth, candidates, seen) {
    if (depth > 8 || value == null) return;
    const parsed = parseJsonText(value);
    if (parsed !== undefined) {
        collectNameCandidates(parsed, "", depth + 1, candidates, seen);
        return;
    }
    if (typeof value !== "object") {
        if (NAME_KEY_WEIGHT[normalizedKey(key)] != null) pushNameCandidate(candidates, seen, value, key, depth);
        return;
    }
    if (Array.isArray(value)) {
        value.slice(0, 40).forEach((item) => collectNameCandidates(item, key, depth + 1, candidates, seen));
        return;
    }
    for (const nameKey of NAME_KEYS) {
        if (Object.prototype.hasOwnProperty.call(value, nameKey)) pushNameCandidate(candidates, seen, value[nameKey], nameKey, depth);
    }
    for (const [childKey, child] of Object.entries(value)) collectNameCandidates(child, childKey, depth + 1, candidates, seen);
}

function bestAppName(json, fallback = "未命名应用") {
    const candidates = [];
    collectNameCandidates(json, "", 0, candidates, new Set());
    candidates.sort((a, b) => b.score - a.score || a.depth - b.depth);
    return candidates[0]?.value || fallback;
}

function mediaScore(fieldPath, url, target) {
    const path = String(fieldPath || "").toLowerCase();
    const value = String(url || "").toLowerCase();
    const fields = target === "icon" ? ICON_KEY_PATTERNS : COVER_KEY_PATTERNS;
    let score = 0;
    for (const pattern of fields) if (path.includes(pattern)) score += 40;
    if (target === "cover" && ICON_KEY_PATTERNS.some((pattern) => path.includes(pattern))) score -= 45;
    if (target === "icon" && COVER_KEY_PATTERNS.some((pattern) => path.includes(pattern))) score -= 20;
    if (/thumbnail|thumb/.test(path + value)) score += target === "cover" ? 12 : -5;
    if (/\.png(?:$|[?#])/.test(value)) score += 5;
    return score;
}

function collectMediaUrls(value, path, depth, bucket) {
    if (depth > 9 || value == null) return;
    const parsed = parseJsonText(value);
    if (parsed !== undefined) {
        collectMediaUrls(parsed, path, depth + 1, bucket);
        return;
    }
    const url = asUrlCandidate(value);
    if (url) {
        bucket.push({ path, url });
        return;
    }
    if (typeof value !== "object") return;
    if (Array.isArray(value)) {
        value.slice(0, 60).forEach((item, index) => collectMediaUrls(item, `${path}[${index}]`, depth + 1, bucket));
        return;
    }
    for (const [key, child] of Object.entries(value)) collectMediaUrls(child, path ? `${path}.${key}` : key, depth + 1, bucket);
}

function pickMedia(json, target) {
    const bucket = [];
    collectMediaUrls(json, "", 0, bucket);
    bucket.sort((a, b) => mediaScore(b.path, b.url, target) - mediaScore(a.path, a.url, target));
    const best = bucket.find((item) => mediaScore(item.path, item.url, target) > 0);
    return best?.url || undefined;
}

function candidateLabel(record) {
    return {
        name: stringFromRecord(record, NAME_KEYS),
        description: stringFromRecord(record, ["description", "desc", "intro", "summary"]),
    };
}

function pushSchemaCandidate(record, key, depth, out) {
    const inputs = Array.isArray(record?.[key]) ? record[key] : null;
    if (!inputs || inputs.length === 0) return;
    const label = candidateLabel(record);
    out.push({
        ...label,
        inputs,
        depth,
        score: inputs.length * 10 + (label.name ? 6 : 0) + (label.description ? 2 : 0) - depth,
    });
}

function collectSchemaCandidates(value, depth, out) {
    if (depth > 10 || value == null) return;
    const parsed = parseJsonText(value);
    if (parsed !== undefined) {
        collectSchemaCandidates(parsed, depth + 1, out);
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item) => collectSchemaCandidates(item, depth + 1, out));
        return;
    }
    if (typeof value !== "object") return;
    for (const key of INPUT_ARRAY_KEYS) pushSchemaCandidate(value, key, depth, out);
    for (const child of Object.values(value)) collectSchemaCandidates(child, depth + 1, out);
}

export function extractAppPayloadFromJson(json) {
    const candidates = [];
    const env = normalizeTaskEnvelope(json);
    if (env.code === 0 && env.data != null) collectSchemaCandidates(env.data, 0, candidates);
    collectSchemaCandidates(json, 0, candidates);
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score || b.inputs.length - a.inputs.length || a.depth - b.depth);
    const payload = candidates[0];
    return {
        name: payload.name || bestAppName(json, "未命名应用"),
        description: payload.description || "",
        inputs: payload.inputs,
        coverUrl: pickMedia(json, "cover"),
        iconUrl: pickMedia(json, "icon"),
    };
}

function usablePayload(json) {
    const payload = extractAppPayloadFromJson(json);
    return payload && Array.isArray(payload.inputs) && payload.inputs.length > 0 ? payload : null;
}

function normalizePayload(json) {
    const payload = usablePayload(json);
    if (!payload) return null;
    return {
        ...payload,
        name: bestAppName(json, payload.name || "未命名应用"),
        coverUrl: payload.coverUrl || pickMedia(json, "cover"),
        iconUrl: payload.iconUrl || pickMedia(json, "icon"),
    };
}

async function readEndpointVariants(baseUrl, apiKey, appId, endpoint, opts = {}) {
    const getVariants = [
        { apiKey, webappId: appId },
        { apiKey, webAppId: appId },
        { apiKey, appId },
        { apikey: apiKey, webappId: appId },
    ];
    for (const params of getVariants) {
        const res = await rhGetJsonResult(withQuery(baseUrl, endpoint, params), apiKey, opts);
        const payload = normalizePayload(res.json);
        if (payload) return payload;
    }

    const postUrl = rhJoinUrl(baseUrl, endpoint);
    for (const body of getVariants.slice(0, 3)) {
        const res = await rhPostJsonResult(postUrl, body, apiKey, opts);
        const payload = normalizePayload(res.json);
        if (payload) return payload;
    }
    return null;
}

async function readFallbackEndpoint(baseUrl, endpoint, appId, apiKey, opts = {}) {
    const urls = [
        `${rhJoinUrl(baseUrl, endpoint)}/${encodeURIComponent(appId)}`,
        withQuery(baseUrl, endpoint, { webappId: appId }),
        withQuery(baseUrl, endpoint, { webAppId: appId }),
        withQuery(baseUrl, endpoint, { appId }),
        withQuery(baseUrl, endpoint, { id: appId }),
    ];
    const seen = new Set();
    for (const url of urls) {
        if (!url || seen.has(url)) continue;
        seen.add(url);
        const res = await rhGetJsonResult(url, apiKey, opts);
        const payload = normalizePayload(res.json);
        if (payload) return payload;
    }
    return null;
}

function withTimeout(promise, timeoutMs) {
    const ms = Math.max(1000, Number(timeoutMs) || 8000);
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("请求超时")), ms)),
    ]);
}

function publicAppPayload(appId, payload) {
    return {
        appId,
        name: payload.name || "未命名应用",
        description: payload.description || "",
        inputs: payload.inputs,
        coverUrl: payload.coverUrl,
        iconUrl: payload.iconUrl,
    };
}

async function fetchAppSchemaFresh(baseUrl, apiKey, appId, timeoutMs) {
    const primary = await readEndpointVariants(baseUrl, apiKey, appId, RH_PATH.PARSE_APP, { timeoutMs: Math.min(timeoutMs, 5000) });
    if (primary) return primary;
    for (const endpoint of RH_PARSE_FALLBACKS) {
        const payload = await readFallbackEndpoint(baseUrl, endpoint, appId, apiKey, { timeoutMs: Math.min(timeoutMs, 3000) });
        if (payload) return payload;
    }
    throw new Error("无法从 apiCallDemo 解析到可用 inputs，请检查应用 ID 与 API Key");
}

export async function fetchAiAppInputs(baseUrl, apiKey, webappId, opts = {}) {
    const root = apiRoot(baseUrl);
    const key = textOf(apiKey);
    const appId = normalizeRhAppId(webappId);
    if (!key) throw new Error("未配置 API Key");
    if (!appId) throw new Error("webappId 无效");

    const id = cacheKey(key, appId);
    if (!opts.skipCache) {
        const cached = APP_SCHEMA_CACHE.get(id);
        if (cached) return publicAppPayload(appId, cached);
        const pending = APP_SCHEMA_PENDING.get(id);
        if (pending) return pending.then((payload) => publicAppPayload(appId, payload));
    }

    const timeoutMs = Number(opts.timeoutMs) || 8000;
    const pending = withTimeout(fetchAppSchemaFresh(root, key, appId, timeoutMs), timeoutMs);
    APP_SCHEMA_PENDING.set(id, pending);
    try {
        const payload = await pending;
        APP_SCHEMA_CACHE.set(id, payload);
        return publicAppPayload(appId, payload);
    } finally {
        APP_SCHEMA_PENDING.delete(id);
    }
}

export function clearRhAppCache(apiKey, webappId) {
    const key = textOf(apiKey);
    const appId = normalizeRhAppId(webappId);
    if (key && appId) APP_SCHEMA_CACHE.delete(cacheKey(key, appId));
}

export function clearAllRhAppCache() {
    APP_SCHEMA_CACHE.clear();
    APP_SCHEMA_PENDING.clear();
}
