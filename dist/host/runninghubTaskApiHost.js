import { RH_PATH } from "../../src/runninghub/constants.js";
import { normalizeTaskEnvelope as makeEnvelope } from "../../src/runninghub/envelope.js";
import { formatRhError } from "../../src/runninghub/rhErrorCodes.js";
import { webappIdToCanonicalStringHost as canonicalWebappId } from "./runninghubIdsHost.js";
import {
    rhJoinUrlHost,
    rhPostJsonBearerOnlyHost,
    rhPostJsonHost,
    rhPostJsonResultHost,
} from "./runninghubHostHttp.js";

const APP_ID_FIELDS = Object.freeze(["webappId", "webAppId", "appId"]);
const AUTH_REJECT_STATUS = new Set([401, 403]);
const PARAMETER_SHAPE_MARKERS = Object.freeze([
    "webappid cannot be null",
    "webapp id",
    "param apikey",
    "param api key",
    "apikey is required",
]);

function plainObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function tidyText(value) {
    return value == null ? "" : String(value).trim();
}

function taskIdText(value) {
    if (value == null) return "";
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "number") return Number.isFinite(value) ? String(Math.trunc(value)) : "";
    return String(value);
}

function envPayload(env) {
    return plainObject(env?.data);
}

function fieldText(source, key) {
    const obj = plainObject(source);
    return obj?.[key] == null ? "" : String(obj[key]);
}

function platformMessage(json) {
    const obj = plainObject(json);
    if (!obj) return "请求失败";
    return tidyText(obj.msg) || tidyText(obj.message) || "请求失败";
}

function canTryAlternateSubmitBody(message) {
    const lower = tidyText(message).toLowerCase();
    return PARAMETER_SHAPE_MARKERS.some((marker) => lower.includes(marker));
}

function makeAuthError(status, statusText = "") {
    const error = new Error(`HTTP ${status} ${statusText}`.trim());
    error.status = status;
    return error;
}

function submitExtras(payload = {}) {
    const extra = {};
    if (payload.instanceType) extra.instanceType = payload.instanceType;
    if (payload.webhookUrl) extra.webhookUrl = payload.webhookUrl;
    return extra;
}

function submitCandidateBodies(appId, apiKey, nodeInfoList, extra) {
    return APP_ID_FIELDS.map((fieldName) => ({
        fieldName,
        body: { apiKey, [fieldName]: appId, nodeInfoList, ...extra },
    }));
}

function submitEnvelopeResult(env, raw) {
    const data = envPayload(env);
    return {
        env,
        raw,
        taskId: taskIdText(data?.taskId),
        taskStatus: fieldText(data, "taskStatus"),
        promptTips: fieldText(data, "promptTips"),
        netWssUrl: typeof data?.netWssUrl === "string" ? data.netWssUrl : "",
        clientId: fieldText(data, "clientId"),
    };
}

function mergedSubmitFailure(lastResponse, notes) {
    const env = makeEnvelope(lastResponse?.json);
    return {
        ...env,
        code: env.code !== 0 ? env.code : -1,
        message: notes.length ? notes.join(" | ") : env.message || platformMessage(lastResponse?.json) || "提交失败",
    };
}

async function strictPostEnvelope(baseUrl, path, body, apiKey, opts = {}) {
    const json = await rhPostJsonHost(rhJoinUrlHost(baseUrl, path), body, apiKey, opts);
    return { env: makeEnvelope(json), json };
}

function parseWorkflowPrompt(value) {
    if (typeof value !== "string") return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function workflowClassMap(prompt) {
    const graph = plainObject(prompt);
    if (!graph) return {};

    const map = {};
    for (const [nodeId, nodeInfo] of Object.entries(graph)) {
        const classType = tidyText(plainObject(nodeInfo)?.class_type);
        if (classType) map[String(nodeId)] = classType;
    }
    return map;
}

export async function rhSubmitAiAppRunHost(baseUrl, apiKey, payload, opts = {}) {
    const appId = canonicalWebappId(payload?.webappId);
    if (!appId) {
        const env = { ...makeEnvelope(null), code: -1, message: "webappId 无效", data: null };
        return submitEnvelopeResult(env, null);
    }

    const endpoint = rhJoinUrlHost(baseUrl, RH_PATH.AI_APP_RUN);
    const nodeInfoList = Array.isArray(payload?.nodeInfoList) ? payload.nodeInfoList : [];
    const notes = [];
    let lastResponse = { ok: false, status: 0, statusText: "", json: null };

    for (const candidate of submitCandidateBodies(appId, apiKey, nodeInfoList, submitExtras(payload))) {
        const response = await rhPostJsonResultHost(endpoint, candidate.body, apiKey, opts);
        lastResponse = response;

        if (AUTH_REJECT_STATUS.has(response.status)) {
            throw makeAuthError(response.status, response.statusText || "");
        }

        const env = makeEnvelope(response.json);
        const taskId = taskIdText(envPayload(env)?.taskId);
        if (response.ok && env.code === 0 && taskId) return submitEnvelopeResult(env, response.json);

        const message = platformMessage(response.json);
        if (candidate.fieldName === "webappId" && !canTryAlternateSubmitBody(message)) {
            return submitEnvelopeResult(env, response.json);
        }
        notes.push(`${candidate.fieldName}: ${message}`);
    }

    return submitEnvelopeResult(mergedSubmitFailure(lastResponse, notes), lastResponse.json);
}

export async function rhCancelTaskHost(baseUrl, apiKey, taskIdValue, opts = {}) {
    const { env, json } = await strictPostEnvelope(baseUrl, RH_PATH.CANCEL_TASK, { apiKey, taskId: taskIdValue }, apiKey, opts);
    return { env, raw: json };
}

export async function rhQueryTaskStatusStringHost(baseUrl, apiKey, taskIdValue, opts = {}) {
    const { env } = await strictPostEnvelope(baseUrl, RH_PATH.TASK_STATUS, { apiKey, taskId: taskIdValue }, apiKey, opts);
    return { env, statusStr: tidyText(env.data) };
}

export async function rhQueryTaskResultV2Host(baseUrl, apiKey, taskIdValue, opts = {}) {
    const raw = await rhPostJsonBearerOnlyHost(rhJoinUrlHost(baseUrl, RH_PATH.QUERY_V2), { taskId: taskIdValue }, apiKey, opts);
    const obj = plainObject(raw);
    if (!obj) return { kind: "invalid", flat: null };
    const data = plainObject(obj.data);
    const resultObj = data || obj;

    return {
        kind: "ok",
        status: fieldText(resultObj, "status"),
        errorCode: fieldText(resultObj, "errorCode"),
        errorMessage: fieldText(resultObj, "errorMessage"),
        promptTips: fieldText(resultObj, "promptTips"),
        results: Array.isArray(resultObj.results) ? resultObj.results : resultObj.results == null ? null : [],
        raw,
    };
}

export async function rhGetWorkflowNodeMapHost(baseUrl, apiKey, webappId, opts = {}) {
    const workflowId = canonicalWebappId(webappId) || tidyText(webappId);
    if (!workflowId) return {};

    try {
        const response = await rhPostJsonResultHost(
            rhJoinUrlHost(baseUrl, RH_PATH.GET_JSON_API_FORMAT),
            { apiKey, workflowId },
            apiKey,
            opts
        );
        const env = makeEnvelope(response.json);
        const data = envPayload(env);
        if (env.code !== 0 || !data?.prompt) return {};
        return workflowClassMap(parseWorkflowPrompt(data.prompt));
    } catch {
        return {};
    }
}

export async function rhQueryTaskOutputsLegacyHost(baseUrl, apiKey, taskIdValue, opts = {}) {
    const { env, json } = await strictPostEnvelope(baseUrl, RH_PATH.TASK_OUTPUTS_LEGACY, { apiKey, taskId: taskIdValue }, apiKey, opts);
    return { env, json };
}

export function rhHostApiErrorMessage(source = {}) {
    return formatRhError(source);
}
