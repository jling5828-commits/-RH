const SESSION_TTL_MS = 5 * 60 * 1000;
const SESSION_BYTE_LIMIT = 120 * 1024 * 1024;

const uploadSessions = new Map();
let sweepCursor = 0;

function nowMs() {
    return Date.now();
}

function cleanMimeType(mimeType) {
    const text = String(mimeType || "").trim();
    return text || "image/png";
}

function shouldKeepUntilManualRelease(record) {
    return record?.meta?.retainUntilRelease === true;
}

function debugSessionPrune(id, record) {
    try {
        if (globalThis.__XiaoLiangRH_SESSION_DEBUG__ === true) {
            console.warn("[XiaoLiangRH upload session expired]", id, record?.meta || {});
        }
    } catch {
        /* ignore */
    }
}

function sweepExpiredSessions() {
    const startedAt = nowMs();
    sweepCursor += 1;
    for (const [id, record] of uploadSessions.entries()) {
        if (shouldKeepUntilManualRelease(record)) continue;
        if (startedAt - record.createdAt >= SESSION_TTL_MS) {
            debugSessionPrune(id, record);
            uploadSessions.delete(id);
        }
    }
}

function assertBytes(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length <= 0) {
        throw new Error("[XiaoLiangRH] upload session: empty bytes");
    }
    if (bytes.length > SESSION_BYTE_LIMIT) {
        throw new Error("[XiaoLiangRH] upload session: too large");
    }
}

function createSessionId() {
    const randomPart = Math.random().toString(36).slice(2, 10);
    return `xlrh_upload_${nowMs().toString(36)}_${sweepCursor.toString(36)}_${randomPart}`;
}

function publicRecord(record) {
    if (!record) return null;
    return {
        bytes: record.bytes,
        mimeType: record.mimeType,
        meta: record.meta || {},
    };
}

function readRecord(id) {
    const key = String(id || "").trim();
    if (!key) return null;
    sweepExpiredSessions();
    return uploadSessions.get(key) || null;
}

export function putUploadSession(bytes, mimeType, meta = {}) {
    sweepExpiredSessions();
    assertBytes(bytes);
    const id = createSessionId();
    uploadSessions.set(id, {
        bytes,
        mimeType: cleanMimeType(mimeType),
        meta: meta && typeof meta === "object" ? { ...meta } : {},
        createdAt: nowMs(),
    });
    return id;
}

export function takeUploadSession(id) {
    const record = readRecord(id);
    if (!record) return null;
    uploadSessions.delete(String(id || "").trim());
    return publicRecord(record);
}

export function peekUploadSession(id) {
    return publicRecord(readRecord(id));
}

export function releaseUploadSession(id) {
    const key = String(id || "").trim();
    if (!key) return;
    uploadSessions.delete(key);
}
