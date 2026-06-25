import { RH_DEFAULT_BASE_URL } from "./constants.js";
import { rhUploadBinary } from "./upload.js";
import { webappIdToCanonicalString } from "./appDemo.js";
import {
    rhCancelTask,
    rhGetWorkflowNodeMap,
    rhQueryTaskOutputsLegacy,
    rhQueryTaskResultV2,
    rhQueryTaskStatusString,
    rhSubmitAiAppRun,
} from "./taskApi.js";
import { formatRhError } from "./rhErrorCodes.js";
import { runXlrhAiAppJob, validateXlrhUploadSpecs } from "./xlrhRunEngine.js";
import { cancelRunningHubAiAppRequest, isInWebView, runRunningHubAiAppInHost } from "../bridge/uxpBridge.js";
import { logRuntimeEvent } from "../utils/runtimeLogger.js";

function summarizeUploadsForDiagnostics(uploads) {
    return (Array.isArray(uploads) ? uploads : []).slice(0, 12).map((item) => ({
        nodeId: String(item?.nodeId || ""),
        fieldName: String(item?.fieldName || ""),
        fileName: String(item?.fileName || ""),
        mimeType: String(item?.mimeType || ""),
        hasUploadSession: !!String(item?.uploadSessionId || "").trim(),
        hasBase64: !!String(item?.fileBase64 || "").trim(),
    }));
}

function recordRunnerFailure(stage, opts, result, error) {
    try {
        const uploads = Array.isArray(opts?.uploads) ? opts.uploads : [];
        logRuntimeEvent("error", "runninghub.api_error", {
            stage,
            message: result?.message || error?.message || String(error || ""),
            code: result?.code ?? error?.code,
            status: result?.status ?? error?.status,
            taskId: result?.taskId || "",
            cancelled: !!result?.cancelled,
            timedOut: !!result?.timedOut,
            webappId: opts?.webappId,
            baseUrl: opts?.baseUrl,
            uploadCount: uploads.length,
            uploads: summarizeUploadsForDiagnostics(uploads),
            detail: result?.detail || null,
            error: error instanceof Error ? error : null,
        });
    } catch {
        /* logging is best effort */
    }
}

async function withFailureLog(promise, opts, stage) {
    try {
        const result = await promise;
        if (result && result.success === false && !result.cancelled) recordRunnerFailure(result.stage || stage, opts, result, null);
        return result;
    } catch (error) {
        recordRunnerFailure(stage, opts, null, error);
        throw error;
    }
}

function hostPayloadFromOptions(opts, uploads) {
    return {
        apiKey: opts.apiKey,
        webappId: opts.webappId,
        nodeInfoList: opts.nodeInfoList,
        uploads,
        instanceType: opts.instanceType,
        webhookUrl: opts.webhookUrl,
        baseUrl: opts.baseUrl,
        pollInitialMs: opts.pollInitialMs,
        pollMaxMs: opts.pollMaxMs,
        requestTimeoutMs: opts.requestTimeoutMs,
    };
}

async function runInHostBridge(opts, uploads) {
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    const { requestId, promise } = runRunningHubAiAppInHost(
        hostPayloadFromOptions(opts, uploads),
        onProgress ? (event) => onProgress(event.phase, event.detail, event.extra) : undefined
    );
    if (opts.signal) {
        const cancelHostRequest = () => {
            cancelRunningHubAiAppRequest(requestId).catch(() => {});
        };
        if (opts.signal.aborted) cancelHostRequest();
        else opts.signal.addEventListener("abort", cancelHostRequest, { once: true });
    }
    return promise;
}

const webViewServices = Object.freeze({
    defaultBaseUrl: RH_DEFAULT_BASE_URL,
    canonicalWebappId: webappIdToCanonicalString,
    uploadBinary: (ctx, upload) => rhUploadBinary(
        ctx.baseUrl,
        ctx.apiKey,
        upload.uploadSessionId ? "" : String(upload.fileBase64 || ""),
        upload.fileName,
        upload.mimeType || "image/png",
        {
            webappId: ctx.webappId,
            timeoutMs: ctx.requestTimeoutMs,
            ...(upload.uploadSessionId ? { uploadSessionId: upload.uploadSessionId } : {}),
        }
    ),
    submitRun: (ctx, payload) => rhSubmitAiAppRun(ctx.baseUrl, ctx.apiKey, payload, { timeoutMs: ctx.requestTimeoutMs }),
    cancelTask: (ctx, taskId) => rhCancelTask(ctx.baseUrl, ctx.apiKey, taskId, { timeoutMs: ctx.requestTimeoutMs }),
    queryStatus: (ctx, taskId) => rhQueryTaskStatusString(ctx.baseUrl, ctx.apiKey, taskId, { timeoutMs: ctx.requestTimeoutMs }),
    queryResultV2: (ctx, taskId) => rhQueryTaskResultV2(ctx.baseUrl, ctx.apiKey, taskId, { timeoutMs: ctx.requestTimeoutMs }),
    queryLegacyOutputs: (ctx, taskId) => rhQueryTaskOutputsLegacy(ctx.baseUrl, ctx.apiKey, taskId, { timeoutMs: ctx.requestTimeoutMs }),
    queryWorkflowNodeMap: (ctx) => rhGetWorkflowNodeMap(ctx.baseUrl, ctx.apiKey, ctx.webappId, { timeoutMs: ctx.requestTimeoutMs }),
});

export async function runAiAppAndWait(opts) {
    const uploadCheck = validateXlrhUploadSpecs(Array.isArray(opts?.uploads) ? opts.uploads : []);
    if (!uploadCheck.ok) {
        const result = { success: false, stage: "upload_validate", message: `上传参数无效: ${uploadCheck.message}` };
        recordRunnerFailure("upload_validate", opts, result, null);
        return result;
    }

    if (isInWebView()) {
        return withFailureLog(runInHostBridge(opts, uploadCheck.uploads), opts, "host_flow");
    }

    return withFailureLog(runXlrhAiAppJob({ ...opts, uploads: uploadCheck.uploads }, webViewServices), opts, "webview_flow");
}

export { formatRhError as formatRunningHubErrorForRunner };
