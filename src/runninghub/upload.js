import { fetchProxyFormDataFromUploadSession, rhUploadBinaryInHost } from "../bridge/uxpBridge.js";
import { hostFetchFormData } from "../bridge/hostNetwork.js";
import { normalizeTaskEnvelope } from "./envelope.js";
import { PLUGIN_HTTP_USER_AGENT_RH } from "../pluginMeta.js";
import { rhJoinUrl } from "./http.js";
import { RH_PATH } from "./constants.js";
import { formatRhError } from "./rhErrorCodes.js";
import { extractDownloadUrlFromData } from "./rhUploadResponseParse.js";

const FILE_NAME_KEYS = Object.freeze(["fileName", "file_name", "path", "filePath", "file_path"]);

function cleanText(value) {
    return value == null ? "" : String(value).trim();
}

function uploadHeaders(apiKey) {
    return {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": PLUGIN_HTTP_USER_AGENT_RH,
    };
}

function fieldValue(data, keys) {
    if (typeof data === "string") return data.trim();
    if (!data || typeof data !== "object") return "";
    for (const key of keys) {
        const value = cleanText(data[key]);
        if (value) return value;
    }
    return "";
}

function uploadError(source, fallback = "上传失败") {
    const error = new Error(formatRhError(source || {}) || fallback);
    if (source?.status != null) error.status = source.status;
    if (source?.code != null) error.code = source.code;
    if (source?.rawBody) error.rawBody = source.rawBody;
    return error;
}

function parseUploadJson(rawText) {
    try {
        return JSON.parse(rawText || "{}");
    } catch {
        throw uploadError({ rawBody: String(rawText || "").slice(0, 300), message: "上传响应不是合法 JSON" });
    }
}

function uploadedAssetFromData(data) {
    const fileName = fieldValue(data, FILE_NAME_KEYS);
    if (!fileName) {
        const error = new Error("上传成功但 RunningHub 未返回 fileName");
        error.data = data;
        throw error;
    }
    const record = data && typeof data === "object" ? data : {};
    return {
        fileName,
        downloadUrl: extractDownloadUrlFromData(record) || undefined,
        type: typeof record.type === "string" ? record.type : undefined,
        size: record.size != null ? String(record.size) : undefined,
    };
}

function makeUploadInput(baseUrl, apiKey, fileBase64, fileName, mimeType, opts = {}) {
    const uploadSessionId = cleanText(opts.uploadSessionId);
    return {
        baseUrl,
        apiKey,
        fileBase64: uploadSessionId ? "" : String(fileBase64 || ""),
        fileName: cleanText(fileName) || "image.png",
        mimeType: cleanText(mimeType) || "image/png",
        timeoutMs: opts.timeoutMs,
        uploadSessionId,
    };
}

function hostUploadPayload(input) {
    const payload = {
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        fileBase64: input.fileBase64,
        fileName: input.fileName,
        mimeType: input.mimeType,
        timeoutMs: input.timeoutMs,
    };
    if (input.uploadSessionId) payload.uploadSessionId = input.uploadSessionId;
    return payload;
}

async function uploadWithHost(input) {
    const result = await rhUploadBinaryInHost(hostUploadPayload(input));
    if (result?.ok && result.fileName) {
        return {
            fileName: result.fileName,
            downloadUrl: result.downloadUrl,
            type: result.type,
            size: result.size,
        };
    }
    throw uploadError(result, "上传失败");
}

async function uploadWithProxy(input) {
    const url = rhJoinUrl(input.baseUrl, RH_PATH.UPLOAD_BINARY);
    const headers = uploadHeaders(input.apiKey);
    const response = input.uploadSessionId
        ? await fetchProxyFormDataFromUploadSession(url, {}, input.uploadSessionId, input.fileName, input.mimeType, headers, "file")
        : await hostFetchFormData(url, {}, input.fileBase64, input.fileName, input.mimeType, headers);

    if (!response?.ok) {
        throw uploadError({ status: response?.status, message: response?.statusText || "" }, "上传失败");
    }

    const envelope = normalizeTaskEnvelope(parseUploadJson(response.body));
    if (envelope.code !== 0) {
        throw uploadError({ code: envelope.code, message: envelope.message }, "上传失败");
    }
    return uploadedAssetFromData(envelope.data);
}

export async function rhUploadBinary(baseUrl, apiKey, fileBase64, fileName, mimeType = "image/png", opts = {}) {
    const input = makeUploadInput(baseUrl, apiKey, fileBase64, fileName, mimeType, opts);
    try {
        return await uploadWithHost(input);
    } catch {
        return uploadWithProxy(input);
    }
}
