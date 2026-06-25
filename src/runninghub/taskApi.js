import { RH_PATH } from "./constants.js";
import { webappIdToCanonicalString } from "./appDemo.js";
import { rhGetJsonResult, rhJoinUrl, rhPostJsonBearerOnly, rhPostJsonResult, rhPostTaskEnvelope } from "./http.js";
import { normalizeTaskEnvelope } from "./envelope.js";
import { formatRhError } from "./rhErrorCodes.js";

const APP_ID_BODY_KEYS = Object.freeze(["webappId", "webAppId", "appId"]);
const SUBMIT_BODY_ERROR_PHRASES = Object.freeze([
    "webappid cannot be null",
    "webapp id",
    "param apikey",
    "param api key",
    "apikey is required",
]);
const ACCOUNT_MONEY_KEYS = Object.freeze(["remainMoney", "balance", "money"]);
const ACCOUNT_COIN_KEYS = Object.freeze(["remainCoins", "rhCoins", "coins"]);

function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value) {
    return value == null ? "" : String(value).trim();
}

function taskId(value) {
    if (value == null) return "";
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "number") return Number.isFinite(value) ? String(Math.trunc(value)) : "";
    return String(value);
}

function envPayload(env) {
    return record(env?.data);
}

function field(recordLike, key) {
    const source = record(recordLike);
    return source?.[key] == null ? "" : String(source[key]);
}

function responseMessage(json) {
    const source = record(json);
    if (!source) return "请求失败";
    return text(source.msg) || text(source.message) || "请求失败";
}

function submitErrorLooksLikeBodyShape(message) {
    const lower = text(message).toLowerCase();
    return SUBMIT_BODY_ERROR_PHRASES.some((phrase) => lower.includes(phrase));
}

function statusError(status, statusText = "") {
    const error = new Error(`HTTP ${status} ${statusText}`.trim());
    error.status = status;
    return error;
}

function canonicalWebappId(value) {
    return webappIdToCanonicalString(value);
}

function submitExtraFields(payload = {}) {
    return Object.fromEntries(
        [["instanceType", payload.instanceType], ["webhookUrl", payload.webhookUrl]].filter(([, value]) => Boolean(value))
    );
}

function submitResult(env, raw) {
    const data = envPayload(env);
    return {
        env,
        raw,
        taskId: taskId(data?.taskId),
        taskStatus: field(data, "taskStatus"),
        promptTips: field(data, "promptTips"),
        netWssUrl: typeof data?.netWssUrl === "string" ? data.netWssUrl : "",
        clientId: field(data, "clientId"),
    };
}

function submitCandidates(webappId, apiKey, nodeInfoList, extra) {
    return APP_ID_BODY_KEYS.map((key) => ({ key, body: { apiKey, [key]: webappId, nodeInfoList, ...extra } }));
}

function submitFailure(lastResponse, notes) {
    const env = normalizeTaskEnvelope(lastResponse?.json);
    return {
        ...env,
        code: env.code !== 0 ? env.code : -1,
        message: notes.length ? notes.join(" | ") : env.message || responseMessage(lastResponse?.json) || "提交失败",
    };
}

function numericDemoWebappId(opts = {}) {
    const id = canonicalWebappId(opts.webappId);
    return id && /^\d+$/.test(id) ? id : "1";
}

function firstNonEmpty(source, keys) {
    const row = record(source);
    if (!row) return "";
    for (const key of keys) {
        const value = text(row[key]);
        if (value) return value;
    }
    return "";
}

function parsePossiblyJson(value) {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function nodeClassMap(prompt) {
    const source = record(prompt);
    if (!source) return {};

    const out = {};
    for (const [nodeId, nodeInfo] of Object.entries(source)) {
        const classType = text(record(nodeInfo)?.class_type);
        if (classType) out[String(nodeId)] = classType;
    }
    return out;
}

async function postEnvelopePath(baseUrl, path, body, apiKey, opts = {}) {
    return rhPostTaskEnvelope(rhJoinUrl(baseUrl, path), body, apiKey, opts);
}

export async function rhSubmitAiAppRun(baseUrl, apiKey, payload, opts = {}) {
    const webappId = canonicalWebappId(payload?.webappId);
    if (!webappId) {
        const env = { ...normalizeTaskEnvelope(null), code: -1, message: "webappId 无效", data: null };
        return submitResult(env, null);
    }

    const endpoint = rhJoinUrl(baseUrl, RH_PATH.AI_APP_RUN);
    const nodeInfoList = Array.isArray(payload?.nodeInfoList) ? payload.nodeInfoList : [];
    const notes = [];
    let lastResponse = { ok: false, status: 0, json: null };

    for (const candidate of submitCandidates(webappId, apiKey, nodeInfoList, submitExtraFields(payload))) {
        const response = await rhPostJsonResult(endpoint, candidate.body, apiKey, opts);
        lastResponse = response;

        if (response.status === 401 || response.status === 403) throw statusError(response.status, response.statusText || "");

        const env = normalizeTaskEnvelope(response.json);
        if (response.ok && env.code === 0 && taskId(envPayload(env)?.taskId)) return submitResult(env, response.json);

        const message = responseMessage(response.json);
        if (candidate.key === "webappId" && !submitErrorLooksLikeBodyShape(message)) return submitResult(env, response.json);
        notes.push(`${candidate.key}: ${message}`);
    }

    return submitResult(submitFailure(lastResponse, notes), lastResponse.json);
}

export async function rhCancelTask(baseUrl, apiKey, taskIdValue, opts = {}) {
    const { env, json } = await postEnvelopePath(baseUrl, RH_PATH.CANCEL_TASK, { apiKey, taskId: taskIdValue }, apiKey, opts);
    return { env, raw: json };
}

export async function rhTestApiKey(baseUrl, apiKey, opts = {}) {
    const webappId = numericDemoWebappId(opts);
    const url = new URL(rhJoinUrl(baseUrl, RH_PATH.PARSE_APP));
    url.searchParams.set("apiKey", apiKey);
    url.searchParams.set("webappId", webappId);

    const response = await rhGetJsonResult(url.toString(), apiKey, opts);
    if (response.status === 401 || response.status === 403) {
        return { ok: false, message: formatRhError({ status: response.status }) };
    }

    const env = normalizeTaskEnvelope(response.json);
    if (env.code === 0) return { ok: true, message: "API Key 可用" };

    const rawMessage = env.message || responseMessage(response.json) || `HTTP ${response.status}`;
    const message = formatRhError({ code: env.code, message: rawMessage, status: response.status });
    const demoAppMissing = /WEBAPP_NOT_EXISTS|webapp.*not.*exist|webapp.*不存在/i.test(String(rawMessage));
    return {
        ok: response.ok,
        message: demoAppMissing
            ? `${message}（测试使用的应用 ID：${webappId}；如果这是平台演示应用下线，请填写正确的 AI 应用 ID 后重试）`
            : message,
    };
}

export async function rhFetchAccountStatus(baseUrl, apiKey, opts = {}) {
    const response = await rhPostJsonResult(rhJoinUrl(baseUrl, RH_PATH.ACCOUNT_STATUS), { apikey: apiKey }, apiKey, opts);
    const env = normalizeTaskEnvelope(response.json);
    if (!response.ok || env.code !== 0) {
        const error = new Error(formatRhError({ code: env.code, message: env.message || responseMessage(response.json), status: response.status }));
        error.status = response.status;
        throw error;
    }

    const data = envPayload(env) || {};
    const account = record(data.accountStatus) || data;
    return {
        env,
        raw: response.json,
        remainMoney: firstNonEmpty(account, ACCOUNT_MONEY_KEYS),
        remainCoins: firstNonEmpty(account, ACCOUNT_COIN_KEYS),
    };
}

export async function rhQueryTaskStatusString(baseUrl, apiKey, taskIdValue, opts = {}) {
    const { env } = await postEnvelopePath(baseUrl, RH_PATH.TASK_STATUS, { apiKey, taskId: taskIdValue }, apiKey, opts);
    return { env, statusStr: text(env.data) };
}

export async function rhQueryTaskResultV2(baseUrl, apiKey, taskIdValue, opts = {}) {
    const raw = await rhPostJsonBearerOnly(rhJoinUrl(baseUrl, RH_PATH.QUERY_V2), { taskId: taskIdValue }, apiKey, opts);
    const source = record(raw);
    if (!source) return { kind: "invalid", flat: null };
    const data = record(source.data);
    const resultSource = data || source;

    return {
        kind: "ok",
        status: field(resultSource, "status"),
        errorCode: field(resultSource, "errorCode"),
        errorMessage: field(resultSource, "errorMessage"),
        promptTips: field(resultSource, "promptTips"),
        results: Array.isArray(resultSource.results) ? resultSource.results : resultSource.results == null ? null : [],
        raw,
    };
}

export async function rhGetWorkflowNodeMap(baseUrl, apiKey, webappId, opts = {}) {
    const workflowId = canonicalWebappId(webappId) || text(webappId);
    if (!workflowId) return {};

    try {
        const response = await rhPostJsonResult(
            rhJoinUrl(baseUrl, RH_PATH.GET_JSON_API_FORMAT),
            { apiKey, workflowId },
            apiKey,
            opts
        );
        const env = normalizeTaskEnvelope(response.json);
        const data = envPayload(env);
        return env.code === 0 && data?.prompt ? nodeClassMap(parsePossiblyJson(data.prompt)) : {};
    } catch {
        return {};
    }
}

export async function rhQueryTaskOutputsLegacy(baseUrl, apiKey, taskIdValue, opts = {}) {
    const { env, json } = await postEnvelopePath(baseUrl, RH_PATH.TASK_OUTPUTS_LEGACY, { apiKey, taskId: taskIdValue }, apiKey, opts);
    return { env, json };
}
