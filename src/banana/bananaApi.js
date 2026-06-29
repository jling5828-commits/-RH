import { hostFetch, hostFetchFormData } from "../bridge/hostNetwork.js";
import { PLUGIN_HTTP_USER_AGENT } from "../pluginMeta.js";

export const BANANA_AJI_ENDPOINTS = Object.freeze([
    "https://ai.ajiai.top",
    "https://cn.ajiai.top",
]);
export const BANANA_AJI_MODELS = Object.freeze([
    "AJbanana3",
    "AJbanana2",
    "gemini-2.5-flash-image",
]);
const BANANA_AJI_SIZE_SUFFIX_RE = /-(?:1k|2k|4k)$/i;

export const BANANA_GRS_ENDPOINT = "https://grsai.com/";
const BANANA_GRS_API_ENDPOINTS = Object.freeze([
    "https://grsaiapi.com",
    "https://grsai.dakka.com.cn",
]);
export const BANANA_GRS_MODELS = Object.freeze([
    "nano-banana",
    "nano-banana-fast",
    "nano-banana-pro",
    "nano-banana-pro-cl",
    "nano-banana-pro-vt",
    "nano-banana-pro-vip",
    "nano-banana-pro-4k-vip",
    "nano-banana-2",
    "nano-banana-2-cl",
    "nano-banana-2-4k-cl",
]);

export function normalizeBananaBaseUrl(value) {
    const text = String(value || "").trim().replace(/\/+$/, "");
    if (!text) return "";
    return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

function parseJson(text, fallback = {}) {
    try { return JSON.parse(String(text || "")); }
    catch (_) { return fallback; }
}

function apiError(response) {
    const json = parseJson(response?.body, null);
    const message = json?.error?.message || json?.message || json?.msg || String(response?.body || "").trim();
    const status = response?.status || 0;
    const error = new Error(message ? `HTTP ${status}: ${message}` : `HTTP ${status}`);
    error.status = status;
    return error;
}

function networkError(provider, error) {
    const message = String(error?.message || error || "");
    if (/fetch failed|failed to fetch|network|econn|enotfound|timeout|timed out|请求超时/i.test(message)) {
        return new Error(`${provider} 连接失败或超时，请检查网络、VPN 或供应商地址`);
    }
    return error instanceof Error ? error : new Error(message || "请求失败");
}

function requireConfig(config) {
    const baseUrl = normalizeBananaBaseUrl(config?.baseUrl);
    const apiKey = String(config?.apiKey || "").trim();
    if (!baseUrl) throw new Error("请先选择供应商地址");
    if (!apiKey) throw new Error("请先在账户管理中填写 API Key");
    return { baseUrl, apiKey };
}

function base64DataUrl(mimeType, base64) {
    return `data:${mimeType || "image/png"};base64,${base64}`;
}

function grsHeaders(apiKey, extra = {}) {
    return { ...extra, Authorization: `Bearer ${apiKey}`, "User-Agent": PLUGIN_HTTP_USER_AGENT };
}

function grsBusinessError(message) {
    const error = new Error(message || "GRS 请求失败");
    error.grsBusiness = true;
    return error;
}

function grsBaseUrlCandidates(baseUrl) {
    const normalized = normalizeBananaBaseUrl(baseUrl);
    const candidates = normalized === normalizeBananaBaseUrl(BANANA_GRS_ENDPOINT) ? [...BANANA_GRS_API_ENDPOINTS] : [normalized, ...BANANA_GRS_API_ENDPOINTS];
    return [...new Set(candidates.map(normalizeBananaBaseUrl).filter(Boolean))];
}

function isGrsRetryableError(error) {
    if (error?.grsBusiness) return false;
    const status = Number(error?.status || 0);
    if ([0, 404, 502, 503, 504].includes(status)) return true;
    const message = String(error?.message || error || "");
    return /fetch failed|failed to fetch|network|econn|enotfound|timeout|timed out|404|This page could not be found/i.test(message);
}

async function withGrsCandidate(baseUrl, apiKey, action) {
    let lastError = null;
    for (const candidate of grsBaseUrlCandidates(baseUrl)) {
        try { return await action(candidate); }
        catch (error) {
            lastError = error;
            if (!isGrsRetryableError(error)) throw error;
        }
    }
    throw networkError("GRS", lastError);
}

function assertGrsOkJson(json) {
    if (json?.code != null && Number(json.code) !== 0) throw grsBusinessError(json.msg || json.message || `code ${json.code}`);
    return json;
}

function imageUrlsFromGemini(json) {
    const urls = [];
    for (const candidate of json?.candidates || []) {
        for (const part of candidate?.content?.parts || []) {
            const image = part?.inlineData || part?.inline_data;
            if (image?.data) urls.push(base64DataUrl(image.mimeType, image.data));
        }
    }
    return urls;
}

function grsPayloadFromRaw(raw) {
    const lines = String(raw || "").trim().split("\n");
    let payload = null;
    for (const line of lines) {
        const value = line.replace(/^data:\s*/, "").trim();
        if (!value || value === "[DONE]") continue;
        const json = parseJson(value, null);
        if (json) payload = json;
    }
    payload = payload || parseJson(raw, null);
    return payload;
}

function checkGrsPayload(payload) {
    if (!payload) return;
    if (payload.code != null && Number(payload.code) !== 0) throw new Error(payload.msg || payload.message || `code ${payload.code}`);
    const root = payload.data && typeof payload.data === "object" ? payload.data : payload;
    if (root?.code != null && Number(root.code) !== 0) throw new Error(root.msg || root.message || `code ${root.code}`);
    if (root?.status === "failed") throw new Error(root.error || root.failure_reason || root.message || "GRS 任务失败");
}

function imageUrlsFromGrsPayload(payload) {
    checkGrsPayload(payload);
    if (!payload) return [];
    const root = payload.data && typeof payload.data === "object" ? payload.data : payload;
    const data = root?.data && typeof root.data === "object" ? root.data : root;
    const list = data?.results || data?.result || root?.results || root?.result || [];
    const urls = Array.isArray(list)
        ? list.map((item) => item?.url || item?.image || (typeof item === "string" ? item : "")).filter(Boolean)
        : [];
    if (urls.length) return urls;
    const single = data?.url || data?.image || root?.url || root?.image;
    return single ? [single] : [];
}

function imageUrlsFromGrs(raw) {
    return imageUrlsFromGrsPayload(grsPayloadFromRaw(raw));
}

function grsTaskIdFromRaw(raw) {
    const payload = grsPayloadFromRaw(raw);
    checkGrsPayload(payload);
    const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
    return String(data?.id || data?.task_id || data?.taskId || "").trim();
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function modelId(item) {
    return String(item?.id || item?.name || item || "").replace(/^models\//, "").trim();
}

export function toBananaAjiBaseModel(model) {
    return modelId(model).replace(BANANA_AJI_SIZE_SUFFIX_RE, "");
}

function toBananaAjiRequestModel(model, size) {
    const baseModel = toBananaAjiBaseModel(model);
    const sizeKey = String(size || "").trim().toLowerCase();
    if (!baseModel || /gemini/i.test(baseModel) || !/^(?:1k|2k|4k)$/.test(sizeKey)) return baseModel;
    return `${baseModel}-${sizeKey}`;
}

function uniqueModels(models) {
    return [...new Set(models.map((item) => String(item || "").trim()).filter(Boolean))];
}

function endpointLabel(baseUrl) {
    try { return new URL(normalizeBananaBaseUrl(baseUrl)).host; }
    catch (_) { return normalizeBananaBaseUrl(baseUrl); }
}

async function probeAjiBaseUrl(baseUrl, apiKey) {
    const normalized = normalizeBananaBaseUrl(baseUrl);
    const startedAt = Date.now();
    try {
        const response = await hostFetch(`${normalized}/v1beta/models`, {
            method: "GET",
            headers: { Authorization: `Bearer ${apiKey}` },
            timeoutMs: 8000,
        });
        if (!response?.ok) throw apiError(response);
        return { provider: "aji", baseUrl: normalized, label: endpointLabel(normalized), latencyMs: Date.now() - startedAt };
    } catch (error) {
        const next = networkError("AJI", error);
        next.baseUrl = normalized;
        next.latencyMs = Date.now() - startedAt;
        throw next;
    }
}

async function resolveAjiBaseUrl(apiKey) {
    const checks = await Promise.allSettled(BANANA_AJI_ENDPOINTS.map((baseUrl) => probeAjiBaseUrl(baseUrl, apiKey)));
    const available = checks
        .filter((item) => item.status === "fulfilled")
        .map((item) => item.value)
        .sort((a, b) => a.latencyMs - b.latencyMs);
    if (available.length) return available[0];
    throw checks.find((item) => item.status === "rejected")?.reason || new Error("AJI 地址均不可用");
}

async function probeGrsBaseUrl(baseUrl, apiKey, model = "") {
    const candidates = grsBaseUrlCandidates(baseUrl || BANANA_GRS_ENDPOINT);
    const checks = await Promise.allSettled(candidates.map(async (candidate) => {
        const startedAt = Date.now();
        try {
            const useModelProbe = String(model || "").trim();
            const response = useModelProbe
                ? await hostFetch(`${candidate}/client/common/getModelStatus?model=${encodeURIComponent(useModelProbe)}`, {
                    method: "GET",
                    headers: grsHeaders(apiKey),
                    timeoutMs: 8000,
                })
                : await hostFetch(`${candidate}/client/openapi/getAPIKeyCredits?_=${Date.now()}`, {
                    method: "POST",
                    headers: grsHeaders(apiKey, { "Content-Type": "application/json" }),
                    body: JSON.stringify({ apiKey, api_key: apiKey }),
                    timeoutMs: 8000,
                });
            if (!response?.ok) throw apiError(response);
            const json = assertGrsOkJson(parseJson(response.body, {}));
            if (useModelProbe && json?.data?.status === false) throw grsBusinessError(json.data.error || "当前 GRS 模型不可用");
            return { provider: "grs", baseUrl: candidate, label: endpointLabel(candidate), latencyMs: Date.now() - startedAt };
        } catch (error) {
            const next = networkError("GRS", error);
            next.baseUrl = candidate;
            next.latencyMs = Date.now() - startedAt;
            throw next;
        }
    }));
    const available = checks
        .filter((item) => item.status === "fulfilled")
        .map((item) => item.value)
        .sort((a, b) => a.latencyMs - b.latencyMs);
    if (available.length) return available[0];
    throw checks.find((item) => item.status === "rejected")?.reason || new Error("GRS 地址均不可用");
}

export async function probeBananaProvider(config, task = {}) {
    const apiKey = String(config?.apiKey || "").trim();
    if (!apiKey) throw new Error("请先在账户管理中填写 API Key");
    if (config?.provider === "grs") return probeGrsBaseUrl(config?.baseUrl || BANANA_GRS_ENDPOINT, apiKey, task?.model);
    return resolveAjiBaseUrl(apiKey);
}

export async function resolveBananaRunConfig(config, task = {}) {
    const probe = await probeBananaProvider(config, task);
    return { ...config, baseUrl: probe.baseUrl, endpointLabel: probe.label, latencyMs: probe.latencyMs };
}

export async function fetchBananaModels(config) {
    const { baseUrl, apiKey } = requireConfig(config);
    if (config?.provider === "grs") {
        return withGrsCandidate(baseUrl, apiKey, async (grsBaseUrl) => {
            const checks = await Promise.allSettled(BANANA_GRS_MODELS.map(async (model) => {
                const response = await hostFetch(`${grsBaseUrl}/client/common/getModelStatus?model=${encodeURIComponent(model)}`, {
                    method: "GET",
                    headers: grsHeaders(apiKey),
                    timeoutMs: 8000,
                });
                if (!response?.ok) throw apiError(response);
                const json = assertGrsOkJson(parseJson(response.body, {}));
                return json?.data?.status === false ? "" : model;
            }));
            if (checks.every((item) => item.status === "rejected")) throw checks[0].reason;
            const available = checks
                .filter((item) => item.status === "fulfilled" && item.value)
                .map((item) => item.value);
            return available.length ? available : [...BANANA_GRS_MODELS];
        });
    }
    let response;
    try {
        response = await hostFetch(`${baseUrl}/v1beta/models`, {
            method: "GET",
            headers: { Authorization: `Bearer ${apiKey}` },
            timeoutMs: 15000,
        });
    } catch (error) { throw networkError("AJI", error); }
    if (!response?.ok) throw apiError(response);
    const all = (parseJson(response.body, {})?.models || []).map((item) => ({
        id: modelId(item),
        methods: Array.isArray(item?.supportedGenerationMethods) ? item.supportedGenerationMethods : [],
    })).filter((item) => item.id);
    const image = all.filter((item) => /image|banana/i.test(item.id));
    const list = uniqueModels((image.length ? image : all).map((item) => toBananaAjiBaseModel(item.id)));
    return list.length ? list : [...BANANA_AJI_MODELS];
}

export async function fetchBananaBalance(config) {
    const { baseUrl, apiKey } = requireConfig(config);
    let response;
    try {
        if (config?.provider === "grs") {
            return await withGrsCandidate(baseUrl, apiKey, async (grsBaseUrl) => {
                response = await hostFetch(`${grsBaseUrl}/client/openapi/getAPIKeyCredits?_=${Date.now()}`, {
            method: "POST",
            headers: grsHeaders(apiKey, { "Content-Type": "application/json" }),
            body: JSON.stringify({ apiKey, api_key: apiKey }),
            timeoutMs: 12000,
                });
                if (!response?.ok) throw apiError(response);
                const json = assertGrsOkJson(parseJson(response.body, {}));
                const value = Number(json?.data?.credits ?? json?.data?.credit);
                if (!Number.isFinite(value)) throw grsBusinessError("GRS 未返回可识别的余额");
                return value;
            });
        }
        response = await hostFetch(`${baseUrl}/api/usage/token`, {
            method: "GET",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            timeoutMs: 12000,
        });
    } catch (error) { throw networkError(config?.provider === "grs" ? "GRS" : "AJI", error); }
    if (!response?.ok) throw apiError(response);
    const json = parseJson(response.body, {});
    if (config?.provider !== "grs" && json?.data?.total_available != null) {
        const value = Number(json.data.total_available);
        if (!Number.isFinite(value)) throw new Error("供应商未返回可识别的余额");
        return value / 500000;
    }
    const rawValue = config?.provider === "grs"
        ? json?.data?.credits ?? json?.data?.credit
        : json?.data?.remain_quota ?? json?.remain_quota ?? json?.quota;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) throw new Error("供应商未返回可识别的余额");
    return value;
}

async function uploadGrsImage(baseUrl, apiKey, image) {
    const ext = image?.mimeType === "image/jpeg" ? "jpg" : "png";
    const tokenResponse = await hostFetch(`${baseUrl}/client/resource/newUploadTokenZH`, {
        method: "POST",
        headers: grsHeaders(apiKey, { "Content-Type": "application/json" }),
        body: JSON.stringify({ sux: ext }),
        timeoutMs: 30000,
    });
    if (!tokenResponse?.ok) throw apiError(tokenResponse);
    const tokenData = parseJson(tokenResponse.body, {})?.data || {};
    if (!tokenData.token || !tokenData.key || !tokenData.url || !tokenData.domain) throw new Error("GRS 未返回上传凭据");
    const upload = await hostFetchFormData(
        tokenData.url,
        { token: tokenData.token, key: tokenData.key },
        image.base64,
        image.fileName || `banana.${ext}`,
        image.mimeType || "image/png",
        {}
    );
    if (!upload?.ok) throw apiError(upload);
    return `${String(tokenData.domain).replace(/\/$/, "")}/${tokenData.key}`;
}

async function resolveGrsBaseUrl(baseUrl, apiKey, model) {
    return withGrsCandidate(baseUrl, apiKey, async (candidate) => {
        const response = await hostFetch(`${candidate}/client/common/getModelStatus?model=${encodeURIComponent(model || "")}`, {
            method: "GET",
            headers: grsHeaders(apiKey),
            timeoutMs: 8000,
        });
        if (!response?.ok) throw apiError(response);
        const data = assertGrsOkJson(parseJson(response.body, {}));
        if (data?.data?.status === false) throw grsBusinessError(data.data.error || "当前 GRS 模型不可用");
        return candidate;
    });
}

async function runAji(config, task, image) {
    const { baseUrl, apiKey } = requireConfig(config);
    const model = toBananaAjiRequestModel(task.model, task.size);
    const parts = [{ text: String(task.prompt || "").trim() || "generate an image" }];
    if (image?.base64) parts.push({ inlineData: { mimeType: image.mimeType || "image/png", data: image.base64 } });
    let response;
    try {
        response = await hostFetch(`${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                contents: [{ role: "user", parts }],
                generationConfig: {
                    responseModalities: ["TEXT", "IMAGE"],
                    imageConfig: { imageSize: task.size },
                },
            }),
            timeoutMs: task.timeoutMs,
        });
    } catch (error) { throw networkError("AJI", error); }
    if (!response?.ok) throw apiError(response);
    const json = parseJson(response.body, {});
    if (json?.error) throw new Error(json.error.message || "AJI 请求失败");
    return imageUrlsFromGemini(json);
}

async function pollGrsResult(baseUrl, apiKey, taskId, timeoutMs) {
    const startedAt = Date.now();
    let consecutiveErrors = 0;
    while (Date.now() - startedAt < timeoutMs) {
        await sleep(3000);
        let response;
        try {
            response = await hostFetch(`${baseUrl}/v1/draw/result`, {
                method: "POST",
                headers: grsHeaders(apiKey, { "Content-Type": "application/json" }),
                body: JSON.stringify({ id: taskId }),
                timeoutMs: 30000,
            });
        } catch (error) {
            consecutiveErrors += 1;
            if (consecutiveErrors >= 5) throw networkError("GRS", error);
            continue;
        }
        if (!response?.ok) {
            consecutiveErrors += 1;
            if (consecutiveErrors >= 5) throw apiError(response);
            continue;
        }
        consecutiveErrors = 0;
        const payload = grsPayloadFromRaw(response.body);
        const root = payload?.data && typeof payload.data === "object" ? payload.data : payload;
        const code = payload?.code ?? root?.code;
        if (code != null && Number(code) !== 0) {
            if (Number(code) === -22) throw new Error(`GRS 任务不存在或已过期：${taskId}`);
            consecutiveErrors += 1;
            if (consecutiveErrors >= 5) throw new Error(root?.msg || root?.message || payload?.msg || payload?.message || `GRS 轮询连续返回 code ${code}`);
            continue;
        }
        consecutiveErrors = 0;
        const urls = imageUrlsFromGrsPayload(payload);
        if (urls.length) return urls;
        const data = root;
        if (data?.status === "succeeded") throw new Error("GRS 任务成功但未返回图片");
    }
    throw new Error(`GRS 任务轮询超时（${Math.round(timeoutMs / 1000)}秒）`);
}

async function runGrs(config, task, image) {
    const { baseUrl, apiKey } = requireConfig(config);
    const grsBaseUrl = await resolveGrsBaseUrl(baseUrl, apiKey, task.model);
    const urls = image?.base64 ? [await uploadGrsImage(grsBaseUrl, apiKey, image)] : [];
    let response;
    try {
        response = await hostFetch(`${grsBaseUrl}/v1/draw/nano-banana`, {
            method: "POST",
            headers: grsHeaders(apiKey, { "Content-Type": "application/json" }),
            body: JSON.stringify({ model: task.model, prompt: task.prompt || "", urls, imageSize: task.size, shutProgress: true, cdn: "zh" }),
            timeoutMs: task.timeoutMs,
        });
    } catch (error) { throw networkError("GRS", error); }
    if (!response?.ok) throw apiError(response);
    const images = imageUrlsFromGrs(response.body);
    if (images.length) return images;
    const taskId = grsTaskIdFromRaw(response.body);
    if (taskId) return pollGrsResult(grsBaseUrl, apiKey, taskId, task.timeoutMs);
    return [];
}

export async function runBananaImage(config, task, image) {
    const urls = config?.provider === "grs"
        ? await runGrs(config, task, image)
        : await runAji(config, task, image);
    if (!urls.length) throw new Error("供应商未返回图片");
    return urls;
}
