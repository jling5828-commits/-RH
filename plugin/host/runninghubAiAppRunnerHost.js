import { RH_DEFAULT_BASE_URL, RH_PATH } from "../../src/runninghub/constants.js";
import { normalizeTaskEnvelope } from "../../src/runninghub/envelope.js";
import { formatRhError } from "../../src/runninghub/rhErrorCodes.js";
import { extractDownloadUrlFromData } from "../../src/runninghub/rhUploadResponseParse.js";
import { runXlrhAiAppJob } from "../../src/runninghub/xlrhRunEngine.js";
import { PLUGIN_HTTP_USER_AGENT_RH } from "../../src/pluginMeta.js";
import { webappIdToCanonicalStringHost } from "./runninghubIdsHost.js";
import { makeRhHostNetworkError, rhJoinUrlHost } from "./runninghubHostHttp.js";
import { peekUploadSession } from "./xiaoliangRhUploadSessionStore.js";
import {
    rhCancelTaskHost,
    rhGetWorkflowNodeMapHost,
    rhQueryTaskOutputsLegacyHost,
    rhQueryTaskResultV2Host,
    rhQueryTaskStatusStringHost,
    rhSubmitAiAppRunHost,
} from "./runninghubTaskApiHost.js";

const DEFAULT_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const UPLOAD_FILE_NAME_FIELDS = Object.freeze(["fileName", "file_name", "path", "filePath", "file_path"]);

function textOf(value) {
    return value == null ? "" : String(value).trim();
}

function decodeBase64ToBytes(raw) {
    const bin = atob(String(raw || ""));
    const bytes = new Uint8Array(bin.length);
    for (let index = 0; index < bin.length; index++) bytes[index] = bin.charCodeAt(index);
    return bytes;
}

function readUploadedFileName(data) {
    if (typeof data === "string") return data.trim();
    if (!data || typeof data !== "object") return "";
    for (const field of UPLOAD_FILE_NAME_FIELDS) {
        const value = data[field];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
}

function timeoutSignal(parentSignal, timeoutMs) {
    if (typeof AbortController === "undefined") {
        return { signal: parentSignal, timedOut: () => false, dispose: () => {} };
    }
    const controller = new AbortController();
    const ms = Math.max(1000, Number(timeoutMs) || DEFAULT_UPLOAD_TIMEOUT_MS);
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, ms);
    const forwardAbort = () => controller.abort();
    if (parentSignal?.aborted) controller.abort();
    else if (parentSignal) parentSignal.addEventListener("abort", forwardAbort, { once: true });
    return {
        signal: controller.signal,
        timedOut: () => timedOut,
        dispose: () => {
            clearTimeout(timer);
            if (parentSignal) parentSignal.removeEventListener("abort", forwardAbort);
        },
    };
}

function uploadBytesFromSpec(upload) {
    const sessionId = textOf(upload?.uploadSessionId);
    if (sessionId) {
        const session = peekUploadSession(sessionId);
        if (!session || !(session.bytes instanceof Uint8Array) || session.bytes.length === 0) {
            throw new Error("RH uploadSession 无效或已过期");
        }
        return { bytes: session.bytes, mimeType: session.mimeType || textOf(upload?.mimeType) || "image/png" };
    }
    const fileBase64 = String(upload?.fileBase64 || "");
    if (!fileBase64) throw new Error("上传参数缺失：fileBase64/uploadSessionId");
    return { bytes: decodeBase64ToBytes(fileBase64), mimeType: textOf(upload?.mimeType) || "image/png" };
}

function uploadErrorFromResponse(resp, fallbackMessage) {
    const err = new Error(formatRhError({ status: resp?.status, code: resp?.code, message: resp?.message }) || fallbackMessage);
    if (resp?.status != null) err.status = resp.status;
    if (resp?.code != null) err.code = resp.code;
    return err;
}

function normalizeUploadEnvelope(json, status) {
    const env = normalizeTaskEnvelope(json);
    if (env.code !== 0) throw uploadErrorFromResponse({ status, code: env.code, message: env.message }, "上传失败");
    const data = env.data && typeof env.data === "object" ? env.data : {};
    const fileName = readUploadedFileName(env.data);
    if (!fileName) throw new Error("上传成功但未返回 fileName");
    return {
        fileName,
        downloadUrl: extractDownloadUrlFromData(data) || undefined,
        type: typeof data.type === "string" ? data.type : undefined,
        size: data.size != null ? String(data.size) : undefined,
    };
}

async function uploadBinaryFromHost(ctx, upload, hooks = {}) {
    const { bytes, mimeType } = uploadBytesFromSpec(upload);
    if (typeof hooks.onUploadReady === "function") {
        try {
            hooks.onUploadReady({ byteLength: bytes.length, fileName: upload.fileName, mimeType });
        } catch {
            /* progress hooks are best effort */
        }
    }

    const formData = new FormData();
    formData.append("file", new Blob([bytes], { type: mimeType }), upload.fileName || "image.png");
    const abort = timeoutSignal(ctx.signal, ctx.requestTimeoutMs || DEFAULT_UPLOAD_TIMEOUT_MS);
    const uploadUrl = rhJoinUrlHost(ctx.baseUrl, RH_PATH.UPLOAD_BINARY);
    let response;
    try {
        response = await fetch(uploadUrl, {
            method: "POST",
            body: formData,
            headers: {
                Authorization: `Bearer ${ctx.apiKey}`,
                "User-Agent": PLUGIN_HTTP_USER_AGENT_RH,
            },
            signal: abort.signal,
        });
    } catch (error) {
        if (abort.timedOut()) {
            const timeout = new Error(`上传超时（${Math.round((Number(ctx.requestTimeoutMs) || DEFAULT_UPLOAD_TIMEOUT_MS) / 1000)}秒）`);
            timeout.code = "RH_UPLOAD_TIMEOUT";
            throw timeout;
        }
        throw makeRhHostNetworkError(uploadUrl, error, { stage: "上传" });
    } finally {
        abort.dispose();
    }

    const bodyText = await response.text().catch(() => "");
    if (!response.ok) throw uploadErrorFromResponse({ status: response.status, message: response.statusText || "" }, "上传失败");
    let json;
    try {
        json = JSON.parse(bodyText || "{}");
    } catch {
        throw new Error("上传响应不是合法 JSON");
    }
    return normalizeUploadEnvelope(json, response.status);
}

function httpOptions(ctx) {
    return { timeoutMs: ctx.requestTimeoutMs, signal: ctx.signal };
}

function sendProgress(sendToWebview, requestId) {
    return (phase, detail, extra) => {
        sendToWebview({
            type: "uxp.progress",
            domain: "runninghub",
            requestId,
            phase,
            detail: detail ?? "",
            extra: extra ?? null,
        });
    };
}

const hostRunnerServices = Object.freeze({
    defaultBaseUrl: RH_DEFAULT_BASE_URL,
    canonicalWebappId: webappIdToCanonicalStringHost,
    uploadBinary: uploadBinaryFromHost,
    submitRun: (ctx, payload) => rhSubmitAiAppRunHost(ctx.baseUrl, ctx.apiKey, payload, httpOptions(ctx)),
    cancelTask: (ctx, taskId) => rhCancelTaskHost(ctx.baseUrl, ctx.apiKey, taskId, httpOptions(ctx)),
    queryStatus: (ctx, taskId) => rhQueryTaskStatusStringHost(ctx.baseUrl, ctx.apiKey, taskId, httpOptions(ctx)),
    queryResultV2: (ctx, taskId) => rhQueryTaskResultV2Host(ctx.baseUrl, ctx.apiKey, taskId, httpOptions(ctx)),
    queryLegacyOutputs: (ctx, taskId) => rhQueryTaskOutputsLegacyHost(ctx.baseUrl, ctx.apiKey, taskId, httpOptions(ctx)),
    queryWorkflowNodeMap: (ctx) => rhGetWorkflowNodeMapHost(ctx.baseUrl, ctx.apiKey, ctx.webappId, httpOptions(ctx)),
});

export async function runAiAppAndWaitInHost(payload, requestId, sendToWebview, signal) {
    return runXlrhAiAppJob(
        {
            ...(payload || {}),
            signal,
            onProgress: sendProgress(sendToWebview, requestId),
        },
        hostRunnerServices
    );
}
