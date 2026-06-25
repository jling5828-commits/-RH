const QUERY_KEYS = Object.freeze(["webappId", "webappid", "webAppId", "appId", "appid", "workflowId", "workflowid", "id", "code"]);
const PATH_MARKERS = new Set(["app", "apps", "workflow", "workflows", "community", "detail", "webapp"]);

function cleanText(value) {
    return value == null ? "" : String(value).trim();
}

function decodeText(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function urlLike(value) {
    return /[/?#]/.test(value) || /runninghub\.(?:cn|ai)/i.test(value);
}

function urlFromText(value) {
    const decoded = decodeText(value);
    if (/^https?:\/\//i.test(decoded)) return decoded;
    if (/runninghub\.(?:cn|ai)/i.test(decoded)) return `https://${decoded.replace(/^\/+/, "")}`;
    return "";
}

function idFromSearch(url) {
    const areas = [url.searchParams];
    if (url.hash && url.hash.includes("?")) areas.push(new URLSearchParams(url.hash.slice(url.hash.indexOf("?") + 1)));
    for (const params of areas) {
        for (const key of QUERY_KEYS) {
            const value = cleanText(params.get(key));
            if (value) return value;
        }
    }
    return "";
}

function idFromPath(url) {
    const parts = url.pathname.split("/").map(cleanText).filter(Boolean);
    for (let index = 0; index < parts.length - 1; index++) {
        if (PATH_MARKERS.has(parts[index].toLowerCase())) return parts[index + 1];
    }
    return parts.length ? parts[parts.length - 1] : "";
}

export function normalizeRhAppIdHost(rawValue) {
    const value = cleanText(rawValue);
    if (!value) return "";
    if (!urlLike(value)) return value;

    const urlText = urlFromText(value);
    if (urlText) {
        try {
            const url = new URL(urlText);
            return idFromSearch(url) || idFromPath(url) || value;
        } catch {
            /* fall through to numeric extraction */
        }
    }

    const numeric = decodeText(value).match(/\d{5,}/);
    return numeric ? numeric[0] : value;
}

export function webappIdToCanonicalStringHost(raw) {
    if (raw == null) return "";
    if (typeof raw === "bigint") return raw.toString();
    const text = normalizeRhAppIdHost(raw);
    if (!text) return "";
    if (/^\d+$/.test(text)) return text;
    const numeric = Number(text);
    return Number.isFinite(numeric) && numeric > 0 ? String(Math.trunc(numeric)) : text;
}
