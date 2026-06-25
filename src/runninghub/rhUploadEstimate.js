function base64ByteLength(base64) {
    const s = String(base64 || "").replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
    if (!s) return 0;
    const padding = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((s.length * 3) / 4) - padding);
}

export function formatRhUploadBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n <= 0) return "";
    if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 1 : 2)}MB`;
    return `${Math.max(1, Math.round(n / 1024))}KB`;
}

function formatMime(mimeType, fileName = "") {
    const mime = String(mimeType || "").toLowerCase();
    const name = String(fileName || "").toLowerCase();
    if (mime.includes("jpeg") || name.endsWith(".jpg") || name.endsWith(".jpeg")) return "JPG";
    if (mime.includes("png") || name.endsWith(".png")) return "PNG";
    if (mime.includes("webp") || name.endsWith(".webp")) return "WEBP";
    if (mime.includes("image/")) return mime.replace(/^image\//, "").toUpperCase();
    return "FILE";
}

function formatDimensions(slot) {
    const w = Number(slot?.uploadWidth || slot?.width || 0);
    const h = Number(slot?.uploadHeight || slot?.height || 0);
    if (!w || !h) return "";
    return `${Math.round(w)}x${Math.round(h)}`;
}

export function buildRhUploadEstimateInfo(rows, pendingUploads) {
    const imageRows = (rows || []).filter((row) => row && row.fieldType === "IMAGE");
    let totalBytes = 0;
    let knownBytes = 0;
    let unknownSessionCount = 0;
    let maxBytes = 0;
    const items = [];
    for (const row of imageRows) {
        const key = `${row.nodeId}::${row.fieldName}`;
        const slot = pendingUploads?.[key] || {};
        const byteLength = Number(slot.uploadByteLength || slot.byteLength || 0) || base64ByteLength(slot.base64);
        if (byteLength > 0) {
            totalBytes += byteLength;
            knownBytes += byteLength;
            maxBytes = Math.max(maxBytes, byteLength);
        } else if (slot.uploadSessionId) {
            unknownSessionCount += 1;
        }
        items.push({
            key,
            fileName: slot.fileName || "",
            mimeType: slot.mimeType || "",
            format: formatMime(slot.mimeType, slot.fileName),
            dimensions: formatDimensions(slot),
            byteLength,
            hasUploadSession: !!slot.uploadSessionId,
        });
    }
    return {
        imageCount: imageRows.length,
        totalBytes,
        knownBytes,
        maxBytes,
        unknownSessionCount,
        exactBytes: unknownSessionCount === 0,
        items,
    };
}

export function buildRhUploadEstimate(rows, pendingUploads) {
    const imageRows = (rows || []).filter((row) => row && row.fieldType === "IMAGE");
    const parts = [];
    let totalBytes = 0;
    let exactBytes = true;
    for (const row of imageRows) {
        const key = `${row.nodeId}::${row.fieldName}`;
        const slot = pendingUploads?.[key] || {};
        const fmt = formatMime(slot.mimeType, slot.fileName);
        const dims = formatDimensions(slot);
        const byteLength = Number(slot.uploadByteLength || slot.byteLength || 0) || base64ByteLength(slot.base64);
        if (byteLength > 0) totalBytes += byteLength;
        else if (slot.uploadSessionId) exactBytes = false;
        const size = byteLength > 0 ? formatRhUploadBytes(byteLength) : slot.uploadSessionId ? "宿主缓存" : "";
        const alpha = fmt === "JPG" ? "无透明" : fmt === "PNG" ? "可能含透明" : "";
        parts.push([fmt, dims, size, alpha].filter(Boolean).join(" "));
    }
    if (!parts.length) return "";
    const total = totalBytes > 0 ? `${exactBytes ? "约" : "已知约"}${formatRhUploadBytes(totalBytes)}` : "";
    return [parts.join("；"), total].filter(Boolean).join(" · ");
}
