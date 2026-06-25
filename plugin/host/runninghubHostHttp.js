import { PLUGIN_HTTP_USER_AGENT_RH } from "../../src/pluginMeta.js";

const RH_HOST_TIMEOUT_MS = 120000;
const MIN_TIMEOUT_MS = 1000;
const HEADER_CONTENT_TYPE = "application/json";
const DEFAULT_FAILURE_TEXT = "RunningHub HTTP 请求失败";
const BAD_JSON_TEXT = "RunningHub 响应不是合法 JSON";

function normalizeUrlPart(value) {
    return String(value || "").trim();
}

function jsonBody(payload) {
    return JSON.stringify(payload ?? {});
}

function makeRhHeaders(apiKey, extraHeaders = {}) {
    return {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": HEADER_CONTENT_TYPE,
        "User-Agent": PLUGIN_HTTP_USER_AGENT_RH,
        ...extraHeaders,
    };
}

function parseJsonOrNull(text) {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function decorateHttpError(message, status, rawBody) {
    const error = new Error(message || DEFAULT_FAILURE_TEXT);
    if (status != null) error.status = status;
    if (rawBody) error.rawBody = String(rawBody).slice(0, 500);
    return error;
}

function resolvedTimeout(timeoutMs) {
    const value = Number(timeoutMs);
    return Math.max(MIN_TIMEOUT_MS, Number.isFinite(value) && value > 0 ? value : RH_HOST_TIMEOUT_MS);
}

function createAbortScope(parentSignal, timeoutMs) {
    if (typeof AbortController === "undefined") {
        return { signal: parentSignal, dispose() {} };
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, resolvedTimeout(timeoutMs));

    if (parentSignal?.aborted) abort();
    else if (parentSignal) parentSignal.addEventListener("abort", abort, { once: true });

    return {
        signal: controller.signal,
        dispose() {
            clearTimeout(timer);
            if (parentSignal) parentSignal.removeEventListener("abort", abort);
        },
    };
}

function makeFetchInit(method, body, apiKey, headers = makeRhHeaders(apiKey)) {
    const init = { method, headers };
    if (method !== "GET") init.body = jsonBody(body);
    return init;
}

async function fetchWithHostTimeout(url, init, opts = {}) {
    const scope = createAbortScope(opts.signal, opts.timeoutMs);
    try {
        return await fetch(url, { ...init, signal: scope.signal });
    } finally {
        scope.dispose();
    }
}

async function responseAsLooseJson(response) {
    const rawText = await response.text().catch(() => "");
    return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText || "",
        json: parseJsonOrNull(rawText),
        rawText,
    };
}

async function requestLooseJson(method, url, body, apiKey, opts = {}) {
    const response = await fetchWithHostTimeout(url, makeFetchInit(method, body, apiKey), opts);
    return responseAsLooseJson(response);
}

async function requestStrictJson(url, body, apiKey, opts = {}, headers = makeRhHeaders(apiKey)) {
    const response = await fetchWithHostTimeout(url, makeFetchInit("POST", body, apiKey, headers), opts);
    const rawText = await response.text().catch(() => "");

    if (!response.ok) {
        throw decorateHttpError(`HTTP ${response.status} ${response.statusText || ""}`.trim(), response.status, rawText);
    }

    const json = parseJsonOrNull(rawText);
    if (json == null) throw decorateHttpError(BAD_JSON_TEXT, response.status, rawText);
    return json;
}

export function rhJoinUrlHost(baseUrl, path) {
    const base = normalizeUrlPart(baseUrl).replace(/\/+$/, "");
    const suffix = String(path || "");
    return `${base}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}

export function rhPostJsonResultHost(url, body, apiKey, opts = {}) {
    return requestLooseJson("POST", url, body, apiKey, opts);
}

export function rhGetJsonResultHost(url, apiKey, opts = {}) {
    return requestLooseJson("GET", url, undefined, apiKey, opts);
}

export function rhPostJsonHost(url, body, apiKey, opts = {}) {
    return requestStrictJson(url, body, apiKey, opts);
}

export function rhPostJsonBearerOnlyHost(url, body, apiKey, opts = {}) {
    return requestStrictJson(url, body, apiKey, opts, makeRhHeaders(apiKey));
}
