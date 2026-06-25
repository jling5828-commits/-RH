function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function numberCode(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return -1;
}

function envelopeMessage(source) {
    const message = source?.msg ?? source?.message ?? source?.errorMessage ?? "";
    return message == null ? "" : String(message);
}

export function normalizeTaskEnvelope(json) {
    if (!isRecord(json)) {
        return { code: -1, message: "响应不是 JSON 对象", data: null };
    }
    return {
        code: numberCode(json.code),
        message: envelopeMessage(json),
        data: Object.prototype.hasOwnProperty.call(json, "data") ? json.data : null,
    };
}

export function isEnvelopeSuccess(json) {
    return normalizeTaskEnvelope(json).code === 0;
}
