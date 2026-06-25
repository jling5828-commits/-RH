import { invoke, isInWebView } from "../bridge/uxpBridge.js";
import { hostFetch } from "../bridge/hostNetwork.js";
import { PLUGIN_HTTP_USER_AGENT_RH } from "../pluginMeta.js";
import { normalizeTaskEnvelope } from "./envelope.js";

const RH_HTTP_COMMAND = "runninghub.http";
const JSON_TYPE = "application/json";

function bodyText(payload) {
    return JSON.stringify(payload == null ? {} : payload);
}

function safeJsonParse(text) {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function baseHeaders(apiKey, extraHeaders = {}) {
    return {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": JSON_TYPE,
        "User-Agent": PLUGIN_HTTP_USER_AGENT_RH,
        ...extraHeaders,
    };
}

function requestError(message, status, rawBody) {
    const error = new Error(message || "RunningHub 请求失败");
    if (status != null) error.status = status;
    if (rawBody) error.rawBody = String(rawBody).slice(0, 500);
    return error;
}

function httpStatusError(resp, rawBody) {
    const status = resp?.status || 0;
    const statusText = resp?.statusText || "";
    const label = `HTTP ${status} ${statusText}`.trim();
    return requestError(label || "RunningHub HTTP 请求失败", status, rawBody);
}

function invalidJsonError(status, rawBody) {
    return requestError("RunningHub 响应不是合法 JSON", status, rawBody);
}

function resultEnvelope(resp) {
    const rawText = resp?.body || "";
    return {
        ok: !!resp?.ok,
        status: resp?.status,
        statusText: resp?.statusText || "",
        json: safeJsonParse(rawText),
        rawText,
    };
}

function hostCommand(op, payload) {
    return invoke(RH_HTTP_COMMAND, { op, ...payload });
}

async function directFetch(method, url, apiKey, body, opts = {}, headers = baseHeaders(apiKey)) {
    const init = { method, headers, timeoutMs: opts.timeoutMs };
    if (method !== "GET") init.body = bodyText(body);
    return hostFetch(url, init);
}

async function requestLoose(method, op, url, body, apiKey, opts = {}) {
    if (isInWebView()) {
        const payload = { url, apiKey, timeoutMs: opts.timeoutMs };
        if (method !== "GET") payload.body = body;
        return hostCommand(op, payload);
    }
    const response = await directFetch(method, url, apiKey, body, opts);
    return resultEnvelope(response);
}

async function requestStrict(op, url, body, apiKey, opts = {}, headers = baseHeaders(apiKey)) {
    if (isInWebView()) {
        return hostCommand(op, { url, body, apiKey, timeoutMs: opts.timeoutMs });
    }
    const response = await directFetch("POST", url, apiKey, body, opts, headers);
    const rawText = response?.body || "";
    if (!response?.ok) throw httpStatusError(response, rawText);
    const json = safeJsonParse(rawText);
    if (json == null) throw invalidJsonError(response?.status, rawText);
    return json;
}

export function rhAuthHeaders(apiKey) {
    return baseHeaders(apiKey);
}

export function rhJoinUrl(baseUrl, path) {
    const root = String(baseUrl || "").replace(/\/+$/, "");
    const tail = String(path || "");
    return `${root}${tail.startsWith("/") ? tail : `/${tail}`}`;
}

export function rhPostJsonResult(url, body, apiKey, opts = {}) {
    return requestLoose("POST", "postJsonResult", url, body, apiKey, opts);
}

export function rhGetJsonResult(url, apiKey, opts = {}) {
    return requestLoose("GET", "getJsonResult", url, undefined, apiKey, opts);
}

export function rhPostJson(url, body, apiKey, opts = {}) {
    return requestStrict("postJson", url, body, apiKey, opts);
}

export async function rhPostTaskEnvelope(url, body, apiKey, opts = {}) {
    const json = await rhPostJson(url, body, apiKey, opts);
    return { env: normalizeTaskEnvelope(json), json };
}

export function rhPostJsonBearerOnly(url, body, apiKey, opts = {}) {
    return requestStrict("postJsonBearerOnly", url, body, apiKey, opts, baseHeaders(apiKey));
}
