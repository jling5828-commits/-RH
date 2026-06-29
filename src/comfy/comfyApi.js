import { hostFetch, hostFetchFormData } from "../bridge/hostNetwork.js";
import { fetchProxyFormDataFromUploadSession } from "../bridge/uxpBridge.js";

function cleanText(value) {
    return value == null ? "" : String(value).trim();
}

export function normalizeComfyBaseUrl(value) {
    let url = cleanText(value);
    if (!url) return "";
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
    return url.replace(/\/+$/, "");
}

function joinComfyUrl(baseUrl, path) {
    const base = normalizeComfyBaseUrl(baseUrl);
    const p = String(path || "");
    return `${base}${p.startsWith("/") ? p : `/${p}`}`;
}

function comfyConnectionCandidates(value) {
    const url = normalizeComfyBaseUrl(value);
    return url ? [url] : [];
}

function isXgOsDesktopUrl(value) {
    const text = cleanText(value);
    if (!text) return false;
    try {
        const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
        return /^[a-z0-9]+\.os\.x-gpu\.com$/i.test(url.hostname);
    } catch (_) {
        return /\.os\.x-gpu\.com/i.test(text);
    }
}

function buildXgOsComfyError() {
    return new Error(
        "检测到仙宫云 OS 桌面地址。OS 地址不能直接连接 Comfy UI，也不能可靠推断外部端口前缀。请在 OS 里打开 ComfyUI 窗口右上角“新窗口/外部打开”图标，复制新窗口里的 container.x-gpu.com 地址到插件。"
    );
}

function encodeUserDataPath(path) {
    return String(path || "").split("/").map(encodeURIComponent).join("%2F");
}

function parseJsonBody(response, fallback = {}) {
    const raw = String(response?.body || "");
    if (!raw) return fallback;
    try {
        return JSON.parse(raw);
    } catch (_) {
        return fallback;
    }
}

function shortComfyText(value, max = 800) {
    if (value == null) return "";
    let text = "";
    try {
        text = typeof value === "string" ? value : JSON.stringify(value);
    } catch (_) {
        text = String(value);
    }
    return text.length > max ? `${text.slice(0, max)}...` : text;
}

function formatComfyNodeErrors(nodeErrors) {
    if (!nodeErrors || typeof nodeErrors !== "object") return "";
    const parts = [];
    for (const [nodeId, info] of Object.entries(nodeErrors)) {
        const label = info?.class_type ? `${nodeId} ${info.class_type}` : nodeId;
        const errors = Array.isArray(info?.errors) ? info.errors : [];
        const message = errors.map((item) => item?.message || item?.type || shortComfyText(item, 160)).filter(Boolean).join("; ");
        parts.push(message ? `${label}: ${message}` : `${label}: ${shortComfyText(info, 240)}`);
        if (parts.length >= 3) break;
    }
    return parts.join(" | ");
}

function hasComfyNodeErrors(nodeErrors) {
    return !!nodeErrors && typeof nodeErrors === "object" && Object.keys(nodeErrors).length > 0;
}

function buildComfyErrorMessage(response, detail) {
    const status = response?.status || 0;
    const statusLine = status ? `HTTP ${status} ${response?.statusText || ""}`.trim() : (response?.statusText || "Network request failed");
    const rawError = detail?.error;
    const detailMessage = detail?.error?.message || (typeof rawError === "string" ? rawError : shortComfyText(rawError, 300)) || detail?.message || detail?.detail || "";
    const nodeMessage = formatComfyNodeErrors(detail?.node_errors || detail?.error?.response?.node_errors);
    const bodyMessage = !detailMessage && !nodeMessage ? shortComfyText(response?.body, 800) : "";
    return [statusLine, detailMessage, nodeMessage, bodyMessage].filter(Boolean).join(": ");
}

function comfyImageMimeFromContentTypeOrUrl(contentType, url) {
    const text = `${contentType || ""} ${url || ""}`.toLowerCase();
    if (text.includes("jpeg") || text.includes("jpg")) return "image/jpeg";
    if (text.includes("webp")) return "image/webp";
    if (text.includes("gif")) return "image/gif";
    return "image/png";
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isComfyUnavailableMessage(message) {
    return /Network request failed|HTTP 0|HTTP 502|HTTP 503|HTTP 504|Service Unavailable|Bad Gateway|Gateway Timeout|实例可能正在启动|正在启动|请稍后/i.test(String(message || ""));
}

function comfyUnavailableError(error) {
    const status = Number(error?.status || 0);
    if (status === 502 || status === 503 || status === 504 || isComfyUnavailableMessage(error?.message || error)) {
        return new Error("Comfy 实例未就绪或已断开，请等云端启动完成后重试");
    }
    return null;
}

function isRetryableComfyUploadMessage(message) {
    return isComfyUnavailableMessage(message);
}

function buildComfyQueueBody(prompt, clientId) {
    return { client_id: clientId, prompt };
}

async function comfyFetchJson(baseUrl, path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.body != null && !headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
    }
    const response = await hostFetch(joinComfyUrl(baseUrl, path), {
        method: opts.method || "GET",
        headers,
        body: opts.body == null ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
        timeoutMs: opts.timeoutMs || 15000,
        returnBinary: opts.returnBinary,
    });
    if (!response?.ok) {
        const detail = parseJsonBody(response, null);
        const error = new Error(buildComfyErrorMessage(response, detail));
        error.status = response?.status || 0;
        error.detail = detail;
        throw error;
    }
    return parseJsonBody(response, {});
}

export async function testComfyConnection(baseUrl) {
    if (isXgOsDesktopUrl(baseUrl)) throw buildXgOsComfyError();
    const urls = comfyConnectionCandidates(baseUrl);
    if (!urls.length) throw new Error("请输入 Comfy UI 地址");
    let lastError = null;
    for (const url of urls) {
        try {
            const stats = await comfyFetchJson(url, "/system_stats", { timeoutMs: 8000 });
            return { ok: true, baseUrl: url, stats };
        } catch (first) {
            try {
                const queue = await comfyFetchJson(url, "/queue", { timeoutMs: 8000 });
                return { ok: true, baseUrl: url, stats: queue || {} };
            } catch (second) {
                lastError = second || first;
            }
        }
    }
    throw lastError || new Error("Comfy UI 连接失败");
}

export async function ensureComfyReady(baseUrl) {
    try {
        return await testComfyConnection(baseUrl);
    } catch (error) {
        throw comfyUnavailableError(error) || error;
    }
}

export async function fetchComfyWorkflowList(baseUrl) {
    const paths = [
        "/api/userdata?dir=workflows&recurse=true&full_info=true",
        "/userdata?dir=workflows&recurse=true&full_info=true",
        "/api/v2/userdata?path=workflows",
        "/v2/userdata?path=workflows",
    ];
    let lastMessage = "标准 Comfy 未返回工作流列表";
    for (const path of paths) {
        try {
            const data = await comfyFetchJson(baseUrl, path, { timeoutMs: 10000 });
            const list = normalizeWorkflowListResponse(data, path.includes("dir=workflows") ? "workflows/" : "");
            if (list.length > 0) return { ok: true, workflows: list };
        } catch (error) {
            lastMessage = error?.message || String(error);
        }
    }
    return { ok: false, workflows: [], message: lastMessage };
}

function normalizeWorkflowListResponse(data, prefix = "") {
    const source = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    return source
        .map((item) => {
            const path = typeof item === "string" ? item : item?.path || item?.name || "";
            if (!/\.json$/i.test(path)) return null;
            const name = String(path).split("/").pop().replace(/\.json$/i, "") || path;
            const fullPath = String(path).startsWith(prefix) ? String(path) : `${prefix}${path}`;
            return { id: `server:${fullPath}`, name, path: fullPath, source: "server" };
        })
        .filter(Boolean);
}

export async function fetchComfyWorkflowJson(baseUrl, path) {
    const encoded = encodeUserDataPath(path);
    const attempts = [`/api/userdata/${encoded}`, `/userdata/${encoded}`];
    let lastError = null;
    for (const endpoint of attempts) {
        try {
            return await comfyFetchJson(baseUrl, endpoint, { timeoutMs: 15000 });
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("读取工作流失败");
}

export async function fetchComfyObjectInfo(baseUrl) {
    let lastError = null;
    for (const endpoint of ["/api/object_info", "/object_info"]) {
        try {
            return await comfyFetchJson(baseUrl, endpoint, { timeoutMs: 15000 });
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("读取 Comfy 云端节点失败");
}

export async function uploadComfyImage(baseUrl, uploadRecord, opts = {}) {
    const fileName = cleanText(uploadRecord?.fileName) || `xlrh-${Date.now()}.png`;
    const mimeType = cleanText(uploadRecord?.mimeType) || "image/png";
    const sessionId = cleanText(uploadRecord?.uploadSessionId);
    const subfolder = cleanText(uploadRecord?.subfolder || opts.subfolder);
    const fields = { type: "input", overwrite: "true", ...(subfolder ? { subfolder } : {}) };
    const maxAttempts = Math.max(1, Number(opts.attempts || 3));
    const retryDelayMs = Math.max(0, Number(opts.retryDelayMs || 3000));
    let lastMessage = "";
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const messages = [];
        for (const path of ["/api/upload/image", "/upload/image"]) {
            const url = joinComfyUrl(baseUrl, path);
            try {
                const response = sessionId
                    ? await fetchProxyFormDataFromUploadSession(url, fields, sessionId, fileName, mimeType, {}, "image")
                    : await hostFetchFormData(url, fields, cleanText(uploadRecord?.base64), fileName, mimeType, {}, "image");
                if (response?.ok) {
                    const data = parseJsonBody(response, null);
                    if (!data?.name) throw new Error("Comfy 上传成功但未返回文件名");
                    return subfolder && !data.subfolder ? { ...data, subfolder } : data;
                }
                messages.push(`${path}: ${buildComfyErrorMessage(response, parseJsonBody(response, null))}`);
            } catch (error) {
                messages.push(`${path}: ${error?.message || String(error)}`);
            }
        }
        lastMessage = messages.join(" | ") || "Comfy 上传失败";
        if (attempt >= maxAttempts || !isRetryableComfyUploadMessage(lastMessage)) break;
        if (typeof opts.onRetry === "function") opts.onRetry({ attempt, nextAttempt: attempt + 1, maxAttempts, message: lastMessage });
        await wait(retryDelayMs * attempt);
    }
    const unavailable = comfyUnavailableError(new Error(lastMessage));
    if (unavailable) throw unavailable;
    throw new Error(lastMessage || "Comfy 上传失败");
}

export async function queueComfyPrompt(baseUrl, prompt, clientId, workflow = null) {
    const id = clientId || `xlrh-${Date.now()}`;
    const body = buildComfyQueueBody(prompt, id, workflow);
    let data;
    try {
        data = await comfyFetchJson(baseUrl, "/prompt", { method: "POST", body, timeoutMs: 20000 });
    } catch (error) {
        if (error?.status < 400 || error.status >= 500) throw error;
        data = await comfyFetchJson(baseUrl, "/prompt", { method: "POST", body: { prompt, client_id: id }, timeoutMs: 20000 });
    }
    if (hasComfyNodeErrors(data?.node_errors)) {
        throw new Error(formatComfyNodeErrors(data.node_errors) || "Comfy 节点校验失败");
    }
    if (data?.error) {
        throw new Error(data?.error?.message || shortComfyText(data.error, 300) || "Comfy 执行失败");
    }
    if (!data?.prompt_id) {
        const nodeErrors = hasComfyNodeErrors(data?.node_errors) ? Object.keys(data.node_errors).join("、") : "";
        throw new Error(data?.error?.message || nodeErrors || "Comfy 未返回 prompt_id");
    }
    return data;
}

export async function getComfyHistory(baseUrl, promptId) {
    return comfyFetchJson(baseUrl, `/history/${encodeURIComponent(promptId)}`, { timeoutMs: 15000 });
}

async function getComfyQueue(baseUrl) {
    return comfyFetchJson(baseUrl, "/queue", { timeoutMs: 15000 });
}

export async function interruptComfy(baseUrl, promptId) {
    const bodies = promptId ? [{ prompt_id: promptId }, {}] : [{}];
    let lastError = null;
    for (const path of ["/interrupt", "/api/interrupt"]) {
        for (const body of bodies) {
            try {
                return await comfyFetchJson(baseUrl, path, { method: "POST", body, timeoutMs: 8000 });
            } catch (error) {
                lastError = error;
            }
        }
    }
    throw lastError || new Error("Comfy 取消失败");
}

async function deleteComfyQueueItem(baseUrl, promptId) {
    if (!promptId) return null;
    let lastError = null;
    for (const path of ["/queue", "/api/queue"]) {
        try {
            return await comfyFetchJson(baseUrl, path, { method: "POST", body: { delete: [promptId] }, timeoutMs: 8000 });
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error("Comfy 队列清理失败");
}

export async function cancelComfyPrompt(baseUrl, promptId) {
    const results = [];
    try {
        results.push(await interruptComfy(baseUrl, promptId));
    } catch (_) {
        /* best effort */
    }
    try {
        results.push(await deleteComfyQueueItem(baseUrl, promptId));
    } catch (_) {
        /* best effort */
    }
    return results;
}

export function buildComfyViewUrl(baseUrl, image, promptId = "") {
    const params = new URLSearchParams();
    params.set("filename", image.filename || image.name || "");
    params.set("type", image.type || "output");
    if (image.subfolder) params.set("subfolder", image.subfolder);
    if (promptId) params.set("_xlrh_prompt", promptId);
    params.set("_xlrh_ts", `${Date.now()}_${Math.random().toString(36).slice(2)}`);
    return joinComfyUrl(baseUrl, `/view?${params.toString()}`);
}

async function snapshotComfyImageUrl(imageUrl, opts = {}) {
    const url = String(imageUrl || "");
    if (!url || url.startsWith("data:")) return url;
    if (opts.signal?.aborted) throw new Error("已取消");
    let lastStatus = 0;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
        const fetchUrl = `${url}${url.includes("?") ? "&" : "?"}_xlrh_dl=${Date.now()}_${attempt}_${Math.random().toString(36).slice(2)}`;
        const response = await hostFetch(fetchUrl, {
            method: "GET",
            headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
            returnBinary: true,
            timeoutMs: opts.imageTimeoutMs || 660000,
        });
        if (opts.signal?.aborted) throw new Error("已取消");
        lastStatus = response?.status || 0;
        if (response?.ok && response.bodyBase64) {
            const mime = comfyImageMimeFromContentTypeOrUrl(response.contentType, url);
            return `data:${mime};base64,${response.bodyBase64}`;
        }
        await wait(250 * attempt);
    }
    throw new Error(`Comfy 回图下载失败：HTTP ${lastStatus}`);
}

async function snapshotComfyResultImages(result, opts = {}) {
    const sourceUrls = Array.isArray(result?.urls) ? result.urls : [];
    const urls = await Promise.all(sourceUrls.map((url) => snapshotComfyImageUrl(url, opts)));
    return { ...result, urls, remoteUrls: result?.urls || [], images: result?.images || [] };
}

function buildComfySocketUrl(baseUrl, clientId) {
    const url = new URL(joinComfyUrl(baseUrl, "/ws"));
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("clientId", clientId);
    return url.toString();
}

function extractComfyImagesFromOutput(output, baseUrl, promptId = "") {
    const urls = [];
    for (const key of ["images", "gifs"]) {
        for (const image of Array.isArray(output?.[key]) ? output[key] : []) {
            if (image?.filename || image?.name) urls.push(buildComfyViewUrl(baseUrl, image, promptId));
        }
    }
    return urls;
}

function isComfyOutputLikeClassType(classType) {
    return /(preview.*image|save.*image|image.*save|output.*image|image.*output)/i.test(String(classType || ""));
}

function extractComfyImagesFromExecutedOutput(output, baseUrl, promptId, prompt, nodeId) {
    const urls = [];
    const images = [];
    for (const key of ["images", "gifs"]) {
        for (const image of Array.isArray(output?.[key]) ? output[key] : []) {
            if (!(image?.filename || image?.name)) continue;
            const url = buildComfyViewUrl(baseUrl, image, promptId);
            urls.push(url);
            images.push({
                ...image,
                nodeId,
                classType: prompt?.[nodeId]?.class_type || "",
                outputType: key,
                url,
            });
        }
    }
    return { urls, images };
}

function comfyResultImageName(image) {
    return String(image?.filename || image?.name || image?.url || "").trim();
}

function matchesComfyPrompt(data, promptId) {
    const id = data?.prompt_id || data?.promptId;
    if (!promptId) return true;
    if (!id) return true;
    return String(id || "") === String(promptId);
}

function isComfyExecutionComplete(type, data) {
    if (type === "execution_success") return true;
    if (type !== "executing") return false;
    const node = data?.node ?? data?.node_id ?? data?.nodeId ?? data?.current_node;
    if (node == null) return true;
    const text = String(node).trim();
    return !text || /^(none|null)$/i.test(text);
}

function formatComfyExecutionError(data) {
    const rawError = typeof data?.error === "string" ? data.error : "";
    const message = data?.exception_message || data?.message || rawError || shortComfyText(data, 300);
    return data?.node_id ? `节点 ${data.node_id}: ${message || "Comfy 任务失败"}` : (message || "Comfy 任务失败");
}

function findComfyStatusError(status) {
    if (!status || typeof status !== "object") return "";
    const messages = Array.isArray(status.messages) ? status.messages : [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const entry = messages[index];
        const type = String(Array.isArray(entry) ? entry[0] : (entry?.type || entry?.name || "")).toLowerCase();
        const data = Array.isArray(entry) ? entry[1] : (entry?.data || entry?.detail || entry);
        if (/execution_interrupted|interrupt|cancel/.test(type)) return "已取消";
        if (/execution_error|exception|error|failed|failure/.test(type)) return formatComfyExecutionError(data);
        const nested = data?.exception_message || data?.error?.message || (typeof data?.error === "string" ? data.error : "") || data?.message;
        if (nested && /exception|error|failed|failure/i.test(`${type} ${nested}`)) return formatComfyExecutionError(data);
    }
    const statusText = String(status.status_str || status.status || "").toLowerCase();
    if (/interrupt|cancel/.test(statusText)) return "已取消";
    if (/error|failed|failure|exception/.test(statusText)) {
        return status.exception_message || status.message || shortComfyText(status.error, 300) || "Comfy 任务失败";
    }
    return "";
}

function findComfyHistoryError(item) {
    if (!item || typeof item !== "object") return "";
    const statusError = findComfyStatusError(item.status);
    if (statusError) return statusError;
    const nodeErrors = formatComfyNodeErrors(item.node_errors || item.status?.node_errors);
    if (nodeErrors) return nodeErrors;
    const directError = item.error || item.status?.error;
    if (directError) return typeof directError === "string" ? directError : (directError.message || shortComfyText(directError, 300));
    return "";
}

function isComfyHistoryComplete(item) {
    if (!item || typeof item !== "object") return false;
    return item?.status?.completed === true || /success|completed/i.test(String(item?.status?.status_str || item?.status?.status || ""));
}

function hasComfyPromptId(value, promptId, seen = new Set()) {
    const wanted = String(promptId || "");
    if (!wanted || value == null) return false;
    if (typeof value !== "object") return String(value) === wanted;
    if (seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) return value.some((item) => hasComfyPromptId(item, wanted, seen));
    return Object.values(value).some((item) => hasComfyPromptId(item, wanted, seen));
}

function isComfyPromptQueued(queue, promptId) {
    if (!queue || typeof queue !== "object") return false;
    return [queue.queue_running, queue.queue_pending, queue.running, queue.pending, queue].some((part) => hasComfyPromptId(part, promptId));
}

function markComfyProgress(opts, data) {
    if (opts.progressState) opts.progressState.lastProgressAt = Date.now();
    if (typeof opts.onProgress === "function") opts.onProgress(data || {});
}

export function startComfyEventImageWait(baseUrl, promptId, opts = {}) {
    if (!opts.clientId || typeof WebSocket === "undefined") return { promise: new Promise(() => {}), close() {} };
    let socket = null;
    let settled = false;
    let abortHandler = null;
    const collected = [];
    const seenImages = new Set();
    const expectedOutputSuffix = cleanText(opts.outputSuffix);
    const pushCollectedImage = (image, remoteUrl) => {
        const identity = [
            image?.filename || image?.name || "",
            image?.subfolder || "",
            image?.type || "",
            image?.nodeId || "",
            image?.outputType || "",
        ].join("|");
        if (seenImages.has(identity)) return;
        seenImages.add(identity);
        collected.push({
            image,
            remoteUrl,
            snapshot: snapshotComfyImageUrl(remoteUrl, opts).catch(() => remoteUrl),
        });
    };
    const buildResult = async () => {
        const resolvedUrls = await Promise.all(collected.map((item) => item.snapshot));
        return {
            source: "event",
            promptId,
            urls: resolvedUrls,
            remoteUrls: collected.map((item) => item.remoteUrl),
            images: collected.map((item, index) => ({ ...item.image, url: resolvedUrls[index] })),
        };
    };
    const close = () => {
        if (abortHandler) opts.signal?.removeEventListener?.("abort", abortHandler);
        try {
            if (socket && socket.readyState !== WebSocket.CLOSED) socket.close();
        } catch (_) {
            /* best effort */
        }
    };
    const promise = new Promise((resolve, reject) => {
        const finish = (handler, value) => {
            if (settled) return;
            settled = true;
            close();
            Promise.resolve(typeof value === "function" ? value() : value).then(handler, handler);
        };
        try {
            socket = new WebSocket(buildComfySocketUrl(baseUrl, opts.clientId));
        } catch (_) {
            return;
        }
        abortHandler = () => finish(reject, new Error("已取消"));
        if (opts.signal?.aborted) return abortHandler();
        opts.signal?.addEventListener?.("abort", abortHandler, { once: true });
        socket.onopen = () => {
            if (opts.progressState) opts.progressState.webSocketOpenAt = Date.now();
        };
        socket.onmessage = (event) => {
            try {
                const packet = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
                const type = String(packet?.type || "").toLowerCase();
                const data = packet?.data || packet?.detail || {};
                const packetPromptId = data?.prompt_id || data?.promptId;
                const hasPacketPromptId = packetPromptId != null && String(packetPromptId).trim() !== "";
                if (hasPacketPromptId && !matchesComfyPrompt(data, promptId)) return;
                if (["execution_start", "executing", "progress", "execution_cached"].includes(type)) {
                    if (opts.progressState && !opts.progressState.executionStartedAt) opts.progressState.executionStartedAt = Date.now();
                    markComfyProgress(opts, data);
                }
                if (type === "executed") {
                    const output = data?.output || data?.output_data || data?.result || data?.detail?.output || null;
                    const nodeId = String(data?.node ?? data?.node_id ?? data?.nodeId ?? data?.current_node ?? "");
                    if (output) {
                        const extracted = extractComfyImagesFromExecutedOutput(output, baseUrl, promptId, opts.prompt, nodeId);
                        for (let index = 0; index < extracted.images.length; index += 1) {
                            if (!hasPacketPromptId && expectedOutputSuffix && !comfyResultImageName(extracted.images[index]).includes(expectedOutputSuffix)) continue;
                            pushCollectedImage(extracted.images[index], extracted.urls[index]);
                        }
                    }
                    markComfyProgress(opts, data);
                } else if (type === "execution_success" || isComfyExecutionComplete(type, data)) {
                    if (!hasPacketPromptId && expectedOutputSuffix && collected.length === 0) return;
                    finish(resolve, buildResult);
                } else if (type === "execution_error") {
                    const error = new Error(formatComfyExecutionError(data));
                    error.kind = "comfy-execution";
                    finish(reject, error);
                } else if (type === "execution_interrupted") {
                    const error = new Error("宸插彇娑?");
                    error.kind = "comfy-execution";
                    finish(reject, error);
                }
            } catch (_) {
                /* socket messages are best effort */
            }
        };
        socket.onerror = () => {
            if (settled) return;
            const error = new Error("Comfy WebSocket 连接错误");
            error.kind = "socket";
            finish(reject, error);
        };
        socket.onclose = () => {
            if (settled) return;
            const error = new Error("Comfy WebSocket 已关闭");
            error.kind = "socket";
            finish(reject, error);
        };
    });
    return { promise, close };
}

function normalizeComfyOutputNodeIds(value) {
    if (!Array.isArray(value)) return null;
    const ids = value.map((item) => String(item || "").trim()).filter(Boolean);
    return ids.length > 0 ? new Set(ids) : null;
}

export function extractComfyImagesFromHistory(history, promptId, baseUrl, prompt = null, outputNodeIds = null) {
    const item = promptId ? history?.[promptId] : Object.values(history || {})[0];
    const outputs = item?.outputs && typeof item.outputs === "object" ? item.outputs : {};
    const rows = [];
    const allowedNodeIds = normalizeComfyOutputNodeIds(outputNodeIds);
    for (const [nodeId, nodeOutput] of Object.entries(outputs)) {
        if (allowedNodeIds && !allowedNodeIds.has(String(nodeId))) continue;
        const images = [];
        const urls = [];
        for (const key of ["images", "gifs"]) {
            for (const image of Array.isArray(nodeOutput?.[key]) ? nodeOutput[key] : []) {
                if (!(image?.filename || image?.name)) continue;
                const url = buildComfyViewUrl(baseUrl, image, promptId);
                urls.push(url);
                images.push({ ...image, nodeId, classType: prompt?.[nodeId]?.class_type || "", outputType: key, url });
            }
        }
        if (urls.length > 0) rows.push({ nodeId, classType: prompt?.[nodeId]?.class_type || "", urls, images });
    }
    const saveRows = allowedNodeIds ? rows : rows.filter((row) => /^SaveImage$/i.test(row.classType));
    const selectedRows = allowedNodeIds || saveRows.length > 0 ? saveRows : rows;
    return {
        urls: selectedRows.flatMap((row) => row.urls),
        images: selectedRows.flatMap((row) => row.images),
    };
}

async function waitForComfyHistoryImages(baseUrl, promptId, opts = {}) {
    let missingFromQueueCount = 0;
    while (true) {
        if (opts.signal?.aborted) throw new Error("已取消");
        let history;
        try {
            history = await getComfyHistory(baseUrl, promptId);
        } catch (error) {
            if (opts.signal?.aborted) throw new Error("已取消");
            if (comfyUnavailableError(error) || isComfyUnavailableMessage(error?.message || error)) {
                await wait(opts.pollMs || 1500);
                continue;
            }
            throw error;
        }
        const item = promptId ? history?.[promptId] : Object.values(history || {})[0];
        const historyError = findComfyHistoryError(item);
        if (historyError) throw new Error(historyError);
        if (isComfyHistoryComplete(item)) {
            const images = extractComfyImagesFromHistory(history, promptId, baseUrl, opts.prompt, opts.outputNodeIds);
            if (images.urls.length > 0) return { ...images, history };
            throw new Error("工作流完成但没有图片输出，请确认 SaveImage/PreviewImage 节点已启用");
        }
        if (!item) {
            try {
                const queue = await getComfyQueue(baseUrl);
                if (isComfyPromptQueued(queue, promptId)) {
                    missingFromQueueCount = 0;
                } else {
                    missingFromQueueCount += 1;
                    if (missingFromQueueCount >= 2) throw new Error("Comfy 任务已离开队列，但没有返回结果或错误");
                }
            } catch (error) {
                if (opts.signal?.aborted) throw new Error("已取消");
                if (!(comfyUnavailableError(error) || isComfyUnavailableMessage(error?.message || error))) throw error;
            }
        } else {
            missingFromQueueCount = 0;
        }
        await new Promise((resolve) => setTimeout(resolve, opts.pollMs || 1500));
    }
}

export async function waitForComfyImages(baseUrl, promptId, opts = {}) {
    const waitOpts = { ...opts, progressState: { lastProgressAt: Date.now(), webSocketOpenAt: 0, executionStartedAt: 0 } };
    const result = await waitForComfyHistoryImages(baseUrl, promptId, waitOpts);
    return await snapshotComfyResultImages(result, waitOpts);
}
