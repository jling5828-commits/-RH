import { hostFetch } from "../bridge/hostNetwork.js";

function cleanText(value) {
    return value == null ? "" : String(value).trim();
}

export function normalizeForgeBaseUrl(value) {
    let url = cleanText(value);
    if (!url) return "";
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
    return url.replace(/\/+$/, "");
}

function forgeUrl(baseUrl, path) {
    const base = normalizeForgeBaseUrl(baseUrl);
    const p = String(path || "");
    return `${base}${p.startsWith("/") ? p : `/${p}`}`;
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

function shortText(value, max = 800) {
    if (value == null) return "";
    let text = "";
    try {
        text = typeof value === "string" ? value : JSON.stringify(value);
    } catch (_) {
        text = String(value);
    }
    return text.length > max ? `${text.slice(0, max)}...` : text;
}

function buildForgeError(response, detail) {
    const status = response?.status || 0;
    const statusLine = status ? `HTTP ${status} ${response?.statusText || ""}`.trim() : (response?.statusText || "Network request failed");
    const message = detail?.detail || detail?.message || detail?.error || shortText(response?.body, 800);
    return [statusLine, shortText(message, 800)].filter(Boolean).join(": ");
}

async function forgeFetchJson(baseUrl, path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.body != null && !headers["Content-Type"] && !headers["content-type"]) headers["Content-Type"] = "application/json";
    const response = await hostFetch(forgeUrl(baseUrl, path), {
        method: opts.method || "GET",
        headers,
        body: opts.body == null ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body),
        timeoutMs: opts.timeoutMs ?? 20000,
    });
    if (!response?.ok) {
        const detail = parseJsonBody(response, null);
        const error = new Error(buildForgeError(response, detail));
        error.status = response?.status || 0;
        error.detail = detail;
        throw error;
    }
    return parseJsonBody(response, {});
}

function normalizeNamedList(data, key, pick) {
    const list = Array.isArray(data) ? data : Array.isArray(data?.[key]) ? data[key] : [];
    return list.map(pick).filter(Boolean);
}

const ONLINE_TRANSLATE_HEADERS = {
    Accept: "application/json,text/plain,*/*",
};

function parseGoogleTranslate(data) {
    const lines = Array.isArray(data?.[0]) ? data[0].map((part) => cleanText(part?.[0])).filter(Boolean) : [];
    return cleanText(lines.join(" "));
}

function parseBingTranslate(data) {
    return cleanText(data?.[0]?.translations?.[0]?.text || data?.translations?.[0]?.text);
}

function extractBingTranslateToken(pageText) {
    const page = String(pageText || "");
    const ig = page.match(/IG:"([^"]+)"/)?.[1] || page.match(/"IG":"([^"]+)"/)?.[1];
    const iidRaw = page.match(/data-iid="([^"]+)"/)?.[1] || "translator.5028";
    const tokenMatch = page.match(/params_AbusePreventionHelper\s*=\s*\[\s*([^,\]]+)\s*,\s*"([^"]+)"/);
    const key = cleanText(tokenMatch?.[1]).replace(/^["']|["']$/g, "");
    const token = cleanText(tokenMatch?.[2]);
    if (!ig || !key || !token) throw new Error("Bing 网页令牌获取失败");
    return { ig, iid: /\.\d+$/.test(iidRaw) ? iidRaw : `${iidRaw}.1`, key, token };
}

async function translateWithBingWeb(q) {
    const page = await hostFetch("https://www.bing.com/translator", { method: "GET", headers: ONLINE_TRANSLATE_HEADERS, timeoutMs: 12000 });
    if (!page?.ok) throw new Error(buildForgeError(page, null));
    const { ig, iid, key, token } = extractBingTranslateToken(page.body);
    const body = new URLSearchParams({ fromLang: "auto-detect", to: "en", text: q, key, token }).toString();
    const response = await hostFetch(`https://www.bing.com/ttranslatev3?isVertical=1&IG=${encodeURIComponent(ig)}&IID=${encodeURIComponent(iid)}`, {
        method: "POST",
        headers: { ...ONLINE_TRANSLATE_HEADERS, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body,
        timeoutMs: 12000,
    });
    if (!response?.ok) throw new Error(buildForgeError(response, parseJsonBody(response, null)));
    const value = parseBingTranslate(parseJsonBody(response, null));
    if (!value) throw new Error("Bing 在线翻译未返回结果");
    return value;
}

async function translateWithGoogleWeb(q) {
    const params = new URLSearchParams({ client: "gtx", sl: "auto", tl: "en", dt: "t", q });
    const response = await hostFetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`, { method: "GET", headers: ONLINE_TRANSLATE_HEADERS, timeoutMs: 12000 });
    if (!response?.ok) throw new Error(buildForgeError(response, parseJsonBody(response, null)));
    const value = parseGoogleTranslate(parseJsonBody(response, null));
    if (!value) throw new Error("在线翻译未返回结果");
    return value;
}

export async function testForgeConnection(baseUrl) {
    const url = normalizeForgeBaseUrl(baseUrl);
    if (!url) throw new Error("请输入 Forge UI 地址");
    const options = await forgeFetchJson(url, "/sdapi/v1/options", { timeoutMs: 8000 });
    return { ok: true, baseUrl: url, options };
}

export async function fetchForgeModels(baseUrl) {
    return normalizeNamedList(await forgeFetchJson(baseUrl, "/sdapi/v1/sd-models", { timeoutMs: 12000 }), "", (item) => item?.title || item?.model_name);
}

export async function fetchForgeSamplers(baseUrl) {
    return normalizeNamedList(await forgeFetchJson(baseUrl, "/sdapi/v1/samplers", { timeoutMs: 12000 }), "", (item) => item?.name);
}

export async function fetchForgeSchedulers(baseUrl) {
    return normalizeNamedList(await forgeFetchJson(baseUrl, "/sdapi/v1/schedulers", { timeoutMs: 12000 }), "", (item) => item?.name || item?.label);
}

export async function fetchForgeLoras(baseUrl) {
    return normalizeNamedList(await forgeFetchJson(baseUrl, "/sdapi/v1/loras", { timeoutMs: 12000 }), "", (item) => item?.name || item?.alias);
}

export async function refreshForgeLoras(baseUrl) {
    try {
        await forgeFetchJson(baseUrl, "/sdapi/v1/refresh-loras", { method: "POST", body: {}, timeoutMs: 12000 });
    } catch (_) {
        /* Older builds may not expose refresh-loras; list fetch below is still valid. */
    }
    return fetchForgeLoras(baseUrl);
}

export async function translateForgePrompt(text) {
    const q = cleanText(text);
    if (!q) throw new Error("请输入要翻译的中文");
    const errors = [];
    for (const translate of [translateWithBingWeb, translateWithGoogleWeb]) {
        try {
            return await translate(q);
        } catch (error) {
            errors.push(error?.message || String(error));
        }
    }
    throw new Error(`在线翻译失败：${errors.join(" / ")}`);
}

export async function fetchForgeControlNetModules(baseUrl) {
    return normalizeNamedList(await forgeFetchJson(baseUrl, "/controlnet/module_list", { timeoutMs: 12000 }), "module_list", (item) => String(item || "").trim());
}

export async function fetchForgeControlNetModels(baseUrl) {
    return normalizeNamedList(await forgeFetchJson(baseUrl, "/controlnet/model_list", { timeoutMs: 12000 }), "model_list", (item) => String(item || "").trim());
}

export async function runForgeImg2Img(baseUrl, payload, signal) {
    if (signal?.aborted) throw new Error("已取消");
    return forgeFetchJson(baseUrl, "/sdapi/v1/img2img", {
        method: "POST",
        body: payload,
        timeoutMs: 0,
    });
}

export async function getForgeProgress(baseUrl) {
    return forgeFetchJson(baseUrl, "/sdapi/v1/progress?skip_current_image=true", { timeoutMs: 8000 });
}

export async function interruptForge(baseUrl) {
    return forgeFetchJson(baseUrl, "/sdapi/v1/interrupt", { method: "POST", body: {}, timeoutMs: 8000 });
}
