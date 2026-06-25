/**
 * XiaoLiangRH RunningHub execution engine.
 *
 * This module owns the task orchestration shape used by both WebView and UXP host.
 * The platform calls stay injectable so each side can provide its own transport.
 */

import {
    RH_DEFAULT_BASE_URL,
    RH_DEFAULT_POLL_INITIAL_MS,
    RH_DEFAULT_POLL_MAX_MS,
} from "./constants.js";
import { normalizeTaskEnvelope } from "./envelope.js";
import { formatRhError, isRhPermissionError } from "./rhErrorCodes.js";

const OFFICIAL_RH_ORIGINS = Object.freeze([
    "https://www.runninghub.cn",
    "https://runninghub.cn",
]);

const KNOWN_V2_PENDING = new Set(["CREATE", "CREATED", "QUEUED", "RUNNING", "PENDING", "WAITING", "PROCESSING", "GENERATING"]);
const GENERIC_FAILED_CONFIRM_ROUNDS = 3;
const RESULT_URL_WEIGHTS = Object.freeze({
    originurl: 180,
    origin_url: 180,
    originalurl: 175,
    original_url: 175,
    downloadurl: 155,
    download_url: 155,
    fileurl: 130,
    file_url: 130,
    resulturl: 100,
    result_url: 100,
    publicurl: 90,
    public_url: 90,
    imageurl: 80,
    image_url: 80,
    url: 35,
});
const RESULT_URL_FIELD_SET = new Set(Object.keys(RESULT_URL_WEIGHTS));

function textOf(value) {
    return value == null ? "" : String(value).trim();
}

function plainObject(value) {
    return value && typeof value === "object" ? value : null;
}

function keepOfficialBaseUrl(input) {
    const value = textOf(input || RH_DEFAULT_BASE_URL).replace(/\/+$/, "");
    if (OFFICIAL_RH_ORIGINS.some((origin) => value === origin || value.startsWith(origin + "/"))) {
        return { ok: true, value };
    }
    return { ok: false, message: "baseUrl 仅允许官方 https 域名" };
}

function abortError() {
    return Object.assign(new Error("aborted"), { name: "AbortError" });
}

function isAbortLike(error) {
    return error && typeof error === "object" && error.name === "AbortError";
}

function waitFor(ms, signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
        const timer = setTimeout(done, Math.max(0, Number(ms) || 0));
        const abort = () => finish(false);
        function done() {
            finish(true);
        }
        function finish(ok) {
            clearTimeout(timer);
            if (signal) signal.removeEventListener("abort", abort);
            ok ? resolve() : reject(abortError());
        }
        if (signal) signal.addEventListener("abort", abort, { once: true });
    });
}

function nextDelay(attempt, initialMs, maxMs) {
    const n = Math.max(0, Number(attempt) || 0);
    const floor = Math.max(200, Number(initialMs) || RH_DEFAULT_POLL_INITIAL_MS);
    const ceiling = Math.max(floor, Number(maxMs) || RH_DEFAULT_POLL_MAX_MS);
    const growth = Math.min(ceiling, floor * Math.pow(1.7, n));
    return Math.round(growth * (0.9 + Math.random() * 0.2));
}

async function retryTransient(work, { attempts = 3, delayMs = 350 } = {}) {
    let last;
    for (let index = 0; index < attempts; index++) {
        try {
            return await work(index);
        } catch (error) {
            last = error;
            const status = Number(error?.status);
            const canRetry = status === 429 || status >= 500;
            if (!canRetry || index >= attempts - 1) throw error;
            await waitFor(delayMs * (index + 1));
        }
    }
    throw last;
}

function progressEmitter(onProgress) {
    const emitRaw = typeof onProgress === "function" ? onProgress : () => {};
    let lastPhase = "";
    let lastDetail = "";
    let lastAt = 0;
    return (phase, detail = "", windowMs = 0, extra = null) => {
        const now = Date.now();
        const text = textOf(detail);
        if (windowMs > 0 && phase === lastPhase && text === lastDetail && now - lastAt < windowMs) return;
        lastPhase = phase;
        lastDetail = text;
        lastAt = now;
        emitRaw(phase, text, extra);
    };
}

function normalizeRunInputs(opts, toWebappId) {
    const apiKey = textOf(opts?.apiKey);
    if (!apiKey) return { ok: false, message: "未配置 API Key" };
    const webappId = toWebappId(opts?.webappId);
    if (!webappId || !/^\d+$/.test(webappId)) return { ok: false, message: "webappId 无效" };
    const nodeInfoList = Array.isArray(opts?.nodeInfoList) ? opts.nodeInfoList : [];
    if (nodeInfoList.length === 0) return { ok: false, message: "nodeInfoList 不能为空" };
    for (let index = 0; index < nodeInfoList.length; index++) {
        const row = plainObject(nodeInfoList[index]);
        if (!row) return { ok: false, message: `nodeInfoList[${index}] 无效` };
        if (!textOf(row.nodeId)) return { ok: false, message: `nodeInfoList[${index}] 缺少 nodeId` };
        if (!textOf(row.fieldName)) return { ok: false, message: `nodeInfoList[${index}] 缺少 fieldName` };
    }
    return { ok: true, apiKey, webappId, nodeInfoList };
}

export function validateXlrhUploadSpecs(rawUploads) {
    if (!Array.isArray(rawUploads) || rawUploads.length === 0) return { ok: true, uploads: [] };
    const uploads = [];
    const targetKeys = new Set();
    const payloadKeys = new Set();
    for (let index = 0; index < rawUploads.length; index++) {
        const src = plainObject(rawUploads[index]);
        if (!src) return { ok: false, message: `uploads[${index}] 无效` };
        const nodeId = textOf(src.nodeId);
        const fieldName = textOf(src.fieldName);
        const fileName = textOf(src.fileName);
        const fileBase64 = textOf(src.fileBase64);
        const uploadSessionId = textOf(src.uploadSessionId);
        const mimeType = textOf(src.mimeType) || "image/png";
        if (!nodeId || !fieldName) return { ok: false, message: `uploads[${index}] 缺少 nodeId/fieldName` };
        if (!fileName) return { ok: false, message: `uploads[${index}] 缺少 fileName` };
        if (!fileBase64 && !uploadSessionId) return { ok: false, message: `uploads[${index}] 缺少 fileBase64/uploadSessionId` };
        const targetKey = `${nodeId}\n${fieldName}`;
        if (targetKeys.has(targetKey)) return { ok: false, message: `uploads[${index}] 重复映射目标 ${nodeId}::${fieldName}` };
        targetKeys.add(targetKey);
        const payloadKey = uploadSessionId ? `session:${uploadSessionId}` : `base64:${fileBase64.length}:${fileBase64.slice(0, 32)}`;
        if (payloadKeys.has(payloadKey)) return { ok: false, message: `uploads[${index}] 检测到同图多槽复用` };
        payloadKeys.add(payloadKey);
        uploads.push({
            nodeId,
            fieldName,
            fileName,
            mimeType,
            ...(uploadSessionId ? { uploadSessionId } : { fileBase64 }),
        });
    }
    return { ok: true, uploads };
}

function cloneNodeInfoList(rows) {
    return rows.map((row) => ({ ...row }));
}

function setNodeUploadValue(rows, upload, uploadedFileName) {
    const nodeId = textOf(upload.nodeId);
    const fieldName = textOf(upload.fieldName);
    const target = rows.find((row) => textOf(row.nodeId) === nodeId && textOf(row.fieldName) === fieldName);
    if (!target) return false;
    target.fieldValue = uploadedFileName;
    return true;
}

function uploadProgressText(index, total, info) {
    if (!info || !Number(info.byteLength)) return `上传 ${index}/${total}`;
    const bytes = Number(info.byteLength) || 0;
    const size = bytes >= 1024 * 1024
        ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
        : bytes >= 1024
            ? `${(bytes / 1024).toFixed(1)}KB`
            : `${bytes}B`;
    const mime = textOf(info.mimeType).toLowerCase();
    const type = mime.includes("jpeg") || mime.includes("jpg") ? "JPG" : mime.includes("png") ? "PNG" : "FILE";
    return `上传 ${index}/${total} · ${type} · ${size}`;
}

async function uploadAllImages(ctx, nodeInfoList) {
    const uploads = ctx.uploads;
    for (let offset = 0; offset < uploads.length; offset++) {
        const upload = uploads[offset];
        const count = offset + 1;
        if (ctx.isAborted()) return { type: "cancel" };
        ctx.emit("upload", `上传 ${count}/${uploads.length}`, 300, null);
        let uploaded;
        try {
            uploaded = await ctx.services.uploadBinary(ctx, upload, {
                onUploadReady: (info) => ctx.emit("upload", uploadProgressText(count, uploads.length, info), 0, null),
            });
        } catch (error) {
            const message = formatRhError({
                status: error?.status,
                code: error?.code,
                message: error?.message || String(error),
            });
            return {
                type: "fail",
                value: {
                    success: false,
                    message: `上传失败（第 ${count} 个文件）: ${message}`,
                    detail: {
                        error,
                        diagnostic: {
                            hasUploadSession: !!textOf(upload.uploadSessionId),
                            hasBase64: !!textOf(upload.fileBase64),
                            fileName: textOf(upload.fileName),
                            mimeType: textOf(upload.mimeType) || "image/png",
                            nodeId: textOf(upload.nodeId),
                            fieldName: textOf(upload.fieldName),
                        },
                    },
                },
            };
        }
        if (!setNodeUploadValue(nodeInfoList, upload, uploaded?.fileName)) {
            return {
                type: "fail",
                value: {
                    success: false,
                    message: `上传成功但未找到对应节点 nodeId=${upload.nodeId} fieldName=${upload.fieldName}`,
                },
            };
        }
    }
    return { type: "ok" };
}

function parsePromptTips(promptTips) {
    const text = textOf(promptTips);
    if (!text) return [];
    try {
        const parsed = JSON.parse(text);
        const nodeErrors = Array.isArray(parsed?.node_errors) ? parsed.node_errors : [];
        return nodeErrors.map((item) => {
            const row = plainObject(item);
            if (!row) return String(item);
            const nodeId = row.nodeId ?? row.node_id ?? "?";
            const message = row.message ?? row.msg ?? row.error ?? row.detail ?? JSON.stringify(item);
            return `节点 ${nodeId} 错误：${message}`;
        });
    } catch {
        return [];
    }
}

class XlrhSocketProgress {
    constructor(nodeMap) {
        this.nodeMap = nodeMap || {};
        this.done = new Set();
        this.activeNode = "";
        this.value = 0;
        this.max = 0;
        this.finished = false;
    }

    nameFor(nodeId) {
        const id = textOf(nodeId);
        return id ? this.nodeMap[id] || `节点${id}` : "";
    }

    markDone(nodeId) {
        const id = textOf(nodeId);
        if (!id || this.done.has(id)) return false;
        this.done.add(id);
        return true;
    }

    startNode(nodeId) {
        if (this.activeNode) this.markDone(this.activeNode);
        this.activeNode = textOf(nodeId);
        this.value = 0;
        this.max = 0;
    }

    setProgress(nodeId, value, max) {
        const id = textOf(nodeId);
        if (id) this.activeNode = id;
        this.value = Number(value) || 0;
        this.max = Number(max) || 0;
    }

    cached(nodeIds) {
        const names = [];
        for (const id of Array.isArray(nodeIds) ? nodeIds : []) {
            if (this.markDone(id)) names.push(this.nameFor(id));
        }
        return names;
    }

    complete() {
        if (this.activeNode) this.markDone(this.activeNode);
        this.activeNode = "";
        this.value = 0;
        this.max = 0;
        this.finished = true;
    }

    currentPercent() {
        return this.max > 0 ? (this.value / this.max) * 100 : 0;
    }

    label(cachedNames) {
        if (this.finished) return "执行完成，正在获取结果...";
        const suffix = cachedNames?.length ? ` · ${cachedNames.join("、")}（缓存完成）` : "";
        const name = this.nameFor(this.activeNode);
        if (!name) return `排队中...${suffix}`;
        if (this.max > 0) return `当前节点: ${name} (${this.currentPercent().toFixed(1)}%)${suffix}`;
        return `当前节点: ${name}${suffix}`;
    }
}

function attachProgressSocket(url, nodeMap, ctx, activeRef) {
    const target = textOf(url);
    if (!target || typeof WebSocket === "undefined") return () => {};
    const progress = new XlrhSocketProgress(nodeMap);
    let socket;

    const send = (cachedNames) => {
        activeRef.current = true;
        const nodePercent = progress.currentPercent();
        const hasNodeProgress = progress.max > 0;
        ctx.emit("poll_status", progress.label(cachedNames), 0, {
            displayMode: "node",
            progress: hasNodeProgress ? nodePercent : null,
            nodePercent: hasNodeProgress ? nodePercent : null,
            currentNodeName: progress.nameFor(progress.activeNode),
            cachedNodeNames: cachedNames,
            isComplete: progress.finished,
        });
    };

    try {
        socket = new WebSocket(target);
    } catch {
        return () => {};
    }

    socket.onmessage = (event) => {
        try {
            const packet = JSON.parse(event.data);
            const type = textOf(packet?.type).toLowerCase();
            const data = plainObject(packet?.data) || {};
            if (type === "progress") {
                progress.setProgress(data.node, data.value, data.max);
                send();
            } else if (type === "executing") {
                progress.startNode(data.node);
                if (progress.activeNode) send();
            } else if (type === "execution_cached") {
                send(progress.cached(data.nodes));
            } else if (type === "execution_success") {
                progress.complete();
                send();
            }
        } catch {
            /* progress socket is best effort */
        }
    };
    socket.onerror = () => {};
    socket.onclose = () => {};

    const close = () => {
        try {
            if (socket && socket.readyState === WebSocket.OPEN) socket.close();
        } catch {
            /* ignore */
        }
    };
    if (ctx.signal) ctx.signal.addEventListener("abort", close, { once: true });
    return close;
}

function urlScore(path, url, order) {
    const key = textOf(path).split(".").pop()?.toLowerCase() || "";
    const all = `${path} ${url}`.toLowerCase();
    let score = 1000 - order;
    score += RESULT_URL_WEIGHTS[key] || 0;
    if (/preview|thumbnail|thumb|cover|icon/.test(all)) score -= 520;
    if (/\.png(?:$|[?#])|format=png/.test(all)) score += 55;
    if (/\.(?:jpe?g|webp)(?:$|[?#])|format=(?:jpg|jpeg|webp)/.test(all)) score -= 65;
    return score;
}

function walkResultUrls(value, trail, bag) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
        value.forEach((item, index) => walkResultUrls(item, `${trail}[${index}]`, bag));
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        const path = trail ? `${trail}.${key}` : key;
        if (typeof child === "string" && RESULT_URL_FIELD_SET.has(key.toLowerCase())) {
            const url = child.trim();
            if (/^https?:\/\//i.test(url)) bag.push({ path, url });
        } else if (child && typeof child === "object") {
            walkResultUrls(child, path, bag);
        }
    }
}

function chooseResultUrls(rows) {
    const seen = new Set();
    const out = [];
    for (const row of Array.isArray(rows) ? rows : []) {
        const candidates = [];
        walkResultUrls(row, "", candidates);
        candidates
            .map((item, order) => ({ ...item, score: urlScore(item.path, item.url, order) }))
            .sort((a, b) => b.score - a.score)
            .some((item) => {
                if (seen.has(item.url)) return false;
                seen.add(item.url);
                out.push(item.url);
                return true;
            });
    }
    return out;
}

function urlsFromV2(raw) {
    const results = Array.isArray(raw?.results) ? raw.results : Array.isArray(raw?.data?.results) ? raw.data.results : [];
    return chooseResultUrls(results);
}

function urlsFromLegacy(raw) {
    const env = normalizeTaskEnvelope(raw);
    const data = Array.isArray(env.data) ? env.data : [];
    return { urls: chooseResultUrls(data), items: data };
}

async function fetchLegacyUntilReady(ctx, taskId) {
    for (let round = 0; ; round++) {
        if (ctx.isAborted()) return { type: "cancel" };
        ctx.emit("fetch_result_fallback", `获取结果（legacy）${round + 1}`, 1200, null);
        try {
            const legacy = await ctx.services.queryLegacyOutputs(ctx, taskId);
            const parsed = urlsFromLegacy(legacy?.json);
            if (parsed.urls.length > 0) return { type: "ok", fileUrls: parsed.urls, raw: legacy?.json };
        } catch (error) {
            if (isAbortLike(error)) return { type: "cancel" };
            if (isRhPermissionError({ status: error?.status, message: error?.message || String(error), rawBody: error?.rawBody })) {
                return {
                    type: "failed",
                    message: formatRhError({ status: error?.status, message: error?.message || String(error), rawBody: error?.rawBody }),
                    raw: error,
                };
            }
            if (round === 0 || round % 5 === 0) {
                ctx.emit("fetch_result_fallback", `获取结果（legacy）失败（将继续重试）: ${formatRhError({ status: error?.status, message: error?.message || String(error) })}`, 2500, null);
            }
        }
        await waitFor(nextDelay(round, ctx.pollInitial, ctx.pollMax), ctx.signal).catch(() => null);
    }
}

async function fetchV2UntilReady(ctx, taskId) {
    let genericFailed = 0;
    for (let round = 0; ; round++) {
        if (ctx.isAborted()) return { type: "cancel" };
        ctx.emit("fetch_result", `获取结果 ${round + 1}`, 1200, null);
        let result;
        try {
            result = await retryTransient(() => ctx.services.queryResultV2(ctx, taskId), { attempts: 3, delayMs: 400 });
        } catch (error) {
            if (isAbortLike(error)) return { type: "cancel" };
            if (isRhPermissionError({ status: error?.status, message: error?.message || String(error), rawBody: error?.rawBody })) {
                return {
                    type: "failed",
                    message: formatRhError({ status: error?.status, message: error?.message || String(error), rawBody: error?.rawBody }),
                    raw: error,
                };
            }
            if (round === 0 || round % 5 === 0) {
                ctx.emit("fetch_result", `获取结果失败（将继续重试）: ${formatRhError({ status: error?.status, message: error?.message || String(error) })}`, 2500, null);
            }
            await waitFor(nextDelay(round, ctx.pollInitial, ctx.pollMax), ctx.signal).catch(() => null);
            continue;
        }

        if (result?.kind !== "ok" || !result.raw) return { type: "invalid_v2" };
        const status = textOf(result.status).toUpperCase();
        if (status === "FAILED") {
            if (!textOf(result.errorCode) && !textOf(result.errorMessage) && ++genericFailed < GENERIC_FAILED_CONFIRM_ROUNDS) {
                ctx.emit("fetch_result", "任务短暂返回失败，正在复查", 2500, null);
                await waitFor(nextDelay(round, ctx.pollInitial, ctx.pollMax), ctx.signal).catch(() => null);
                continue;
            }
            return {
                type: "failed",
                message: result.errorMessage || result.errorCode || "任务失败",
                errorCode: result.errorCode,
                errorMessage: result.errorMessage,
                promptTips: result.promptTips,
                raw: result.raw,
            };
        }
        genericFailed = 0;
        if (status === "SUCCESS") {
            const urls = urlsFromV2(result.raw);
            if (urls.length > 0) return { type: "ok", fileUrls: urls, raw: result.raw };
        } else if (status && !KNOWN_V2_PENDING.has(status)) {
            ctx.emit("fetch_result", `任务状态 ${result.status}，继续等待`, 2500, null);
        }
        await waitFor(nextDelay(round, ctx.pollInitial, ctx.pollMax), ctx.signal).catch(() => null);
    }
}

async function cancelIfPossible(ctx, taskId) {
    if (!taskId) return;
    try {
        await ctx.services.cancelTask(ctx, taskId);
    } catch {
        /* best effort */
    }
}

function failedByFetchResult(result, taskId, nodeErrors) {
    const errors = [...(Array.isArray(nodeErrors) ? nodeErrors : []), ...parsePromptTips(result?.promptTips)];
    const formatted = formatRhError({
        errorCode: result?.errorCode,
        errorMessage: result?.errorMessage,
        message: result?.message,
    });
    return { success: false, taskId, message: formatted, detail: result?.raw, nodeErrors: errors };
}

function successResult(taskId, fileUrls, warnings, nodeErrors, submitPack, meta) {
    return {
        success: true,
        taskId,
        fileUrls,
        warnings,
        nodeErrors,
        clientId: submitPack?.clientId || undefined,
        netWssUrl: submitPack?.netWssUrl || undefined,
        meta,
    };
}

async function resolveTaskResult(ctx, taskId, warnings, nodeErrors, submitPack) {
    ctx.emit("fetch_result", "等待 RunningHub 结果", 800, null);
    let v2Result;
    try {
        v2Result = await fetchV2UntilReady(ctx, taskId);
    } catch (error) {
        v2Result = { type: "error", error };
    }
    if (v2Result?.type === "cancel") {
        await cancelIfPossible(ctx, taskId);
        return { success: false, cancelled: true, taskId, message: "已取消", nodeErrors };
    }
    if (v2Result?.type === "ok") {
        return successResult(taskId, v2Result.fileUrls, warnings, nodeErrors, submitPack, { v2: v2Result.raw, submit: submitPack.raw });
    }
    if (v2Result?.type === "failed") return failedByFetchResult(v2Result, taskId, nodeErrors);

    const legacy = await fetchLegacyUntilReady(ctx, taskId);
    if (legacy.type === "cancel") {
        await cancelIfPossible(ctx, taskId);
        return { success: false, cancelled: true, taskId, message: "已取消", nodeErrors };
    }
    if (legacy.type === "ok") {
        warnings.push("已使用 deprecated /task/openapi/outputs 获取结果，建议确认 openapi/v2/query 可用性");
        return successResult(taskId, legacy.fileUrls, warnings, nodeErrors, submitPack, { legacy: legacy.raw, submit: submitPack.raw });
    }
    if (legacy.type === "failed") return failedByFetchResult(legacy, taskId, nodeErrors);
    return { success: false, taskId, message: "未能解析输出文件 URL", detail: legacy, nodeErrors };
}

export async function runXlrhAiAppJob(opts, services) {
    const base = keepOfficialBaseUrl(opts?.baseUrl || services?.defaultBaseUrl || RH_DEFAULT_BASE_URL);
    if (!base.ok) return { success: false, message: base.message || "baseUrl 无效" };

    const canonicalId = typeof services?.canonicalWebappId === "function" ? services.canonicalWebappId : (value) => textOf(value);
    const checked = normalizeRunInputs(opts, canonicalId);
    if (!checked.ok) return { success: false, message: checked.message || "参数无效" };

    const uploadCheck = validateXlrhUploadSpecs(Array.isArray(opts?.uploads) ? opts.uploads : []);
    if (!uploadCheck.ok) return { success: false, message: `上传参数无效: ${uploadCheck.message}` };

    const ctx = {
        services,
        baseUrl: base.value,
        apiKey: checked.apiKey,
        webappId: checked.webappId,
        signal: opts?.signal,
        requestTimeoutMs: opts?.requestTimeoutMs,
        pollInitial: opts?.pollInitialMs ?? RH_DEFAULT_POLL_INITIAL_MS,
        pollMax: opts?.pollMaxMs ?? RH_DEFAULT_POLL_MAX_MS,
        uploads: uploadCheck.uploads,
        emit: progressEmitter(opts?.onProgress),
        isAborted: () => opts?.signal?.aborted === true,
    };

    const warnings = [];
    const nodeInfoList = cloneNodeInfoList(checked.nodeInfoList);
    const uploaded = await uploadAllImages(ctx, nodeInfoList);
    if (uploaded.type === "cancel") return { success: false, cancelled: true, message: "已取消" };
    if (uploaded.type === "fail") return uploaded.value;
    if (ctx.isAborted()) return { success: false, cancelled: true, message: "已取消" };

    ctx.emit("submit", "提交任务", 500, null);
    let submitPack;
    try {
        submitPack = await services.submitRun(ctx, {
            webappId: checked.webappId,
            nodeInfoList,
            instanceType: opts?.instanceType,
            webhookUrl: opts?.webhookUrl,
        });
    } catch (error) {
        return {
            success: false,
            message: `提交失败: ${formatRhError({ status: error?.status, message: error?.message || String(error) })}`,
            permissionDenied: isRhPermissionError({ status: error?.status, message: error?.message || String(error), rawBody: error?.rawBody }),
            taskId: undefined,
            detail: error,
        };
    }

    if (submitPack?.env?.code !== 0) {
        return {
            success: false,
            message: formatRhError({ code: submitPack?.env?.code, message: submitPack?.env?.message }),
            code: submitPack?.env?.code,
            permissionDenied: isRhPermissionError({ code: submitPack?.env?.code, message: submitPack?.env?.message, detail: submitPack?.raw }),
            detail: submitPack?.raw,
        };
    }

    const taskId = textOf(submitPack?.taskId);
    if (!taskId) return { success: false, message: "提交成功但未返回 taskId", code: submitPack?.env?.code };

    const nodeErrors = parsePromptTips(submitPack?.promptTips);
    if (nodeErrors.length > 0) warnings.push(...nodeErrors);
    else if (textOf(submitPack?.promptTips)) warnings.push(`promptTips: ${textOf(submitPack.promptTips)}`);

    const socketActiveRef = { current: false };
    let closeSocket = () => {};
    const netWssUrl = textOf(submitPack?.netWssUrl);
    if (netWssUrl) {
        let nodeMap = {};
        try {
            nodeMap = await services.queryWorkflowNodeMap(ctx);
        } catch {
            nodeMap = {};
        }
        closeSocket = attachProgressSocket(netWssUrl, nodeMap, ctx, socketActiveRef);
    }

    try {
        return await resolveTaskResult(ctx, taskId, warnings, nodeErrors, submitPack);
    } finally {
        closeSocket();
    }
}
