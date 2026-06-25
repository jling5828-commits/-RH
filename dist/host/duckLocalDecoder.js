import { Jimp } from "jimp";
import { PNG } from "pngjs/browser.js";
import jpeg from "jpeg-js";
import { Buffer } from "buffer";

const WATERMARK_SKIP_W_RATIO = 0.4;
const WATERMARK_SKIP_H_RATIO = 0.08;
const PAYLOAD_NOT_FOUND = "payload_not_found";

function readUint32BE(bytes, offset) {
    return (
        ((bytes[offset] || 0) << 24) |
        ((bytes[offset + 1] || 0) << 16) |
        ((bytes[offset + 2] || 0) << 8) |
        (bytes[offset + 3] || 0)
    ) >>> 0;
}

function toUint8Array(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value?.buffer instanceof ArrayBuffer) {
        return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength || value.length || 0);
    }
    return new Uint8Array(value || []);
}

function startsWithBytes(bytes, sig) {
    if (!bytes || bytes.length < sig.length) return false;
    for (let i = 0; i < sig.length; i++) {
        if (bytes[i] !== sig[i]) return false;
    }
    return true;
}

function isPngBytes(bytes) {
    return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function isJpegBytes(bytes) {
    return bytes && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function decodePngImageData(bytes) {
    const png = PNG.sync.read(Buffer.from(bytes));
    return {
        width: png.width,
        height: png.height,
        data: toUint8Array(png.data),
    };
}

function decodeJpegImageData(bytes) {
    const jpg = jpeg.decode(Buffer.from(bytes), { useTArray: true, formatAsRGBA: true });
    return {
        width: jpg.width,
        height: jpg.height,
        data: toUint8Array(jpg.data),
    };
}

async function imageBytesToImageData(bytes, mimeType = "image/png") {
    const uint8 = toUint8Array(bytes);
    const errors = [];
    try {
        if (isPngBytes(uint8) || /png/i.test(mimeType || "")) return decodePngImageData(uint8);
    } catch (e) {
        errors.push(`pngjs: ${e?.message || e}`);
    }
    try {
        if (isJpegBytes(uint8) || /jpe?g/i.test(mimeType || "")) return decodeJpegImageData(uint8);
    } catch (e) {
        errors.push(`jpeg-js: ${e?.message || e}`);
    }
    try {
        const image = await Jimp.read(Buffer.from(uint8));
        return {
            width: image.bitmap.width,
            height: image.bitmap.height,
            data: toUint8Array(image.bitmap.data),
        };
    } catch (jimpErr) {
        errors.push(`jimp: ${jimpErr?.message || jimpErr}`);
        if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
            throw new Error(errors.join(" | ") || String(jimpErr));
        }
        const blob = new Blob([bytes], { type: mimeType || "image/png" });
        try {
            const bitmap = await createImageBitmap(blob);
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("2d context unavailable");
            ctx.drawImage(bitmap, 0, 0);
            return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        } catch (canvasErr) {
            errors.push(`canvas: ${canvasErr?.message || canvasErr}`);
            throw new Error(errors.join(" | "));
        }
    }
}

function makePayloadNotFound(details = {}) {
    const err = new Error(PAYLOAD_NOT_FOUND);
    err.code = PAYLOAD_NOT_FOUND;
    Object.assign(err, details);
    return err;
}

function extractPayloadWithK(imageData, k) {
    const { width, height, data } = imageData;
    const skipW = Math.floor(width * WATERMARK_SKIP_W_RATIO);
    const skipH = Math.floor(height * WATERMARK_SKIP_H_RATIO);
    const mask = (1 << k) - 1;
    const skippedPixels = skipW > 0 && skipH > 0 ? skipW * skipH : 0;
    const usablePixels = Math.max(0, width * height - skippedPixels);
    const capacityBits = usablePixels * 3 * k;
    const maxPayloadBytes = Math.floor(Math.max(0, capacityBits - 32) / 8);

    if (capacityBits < 32) {
        throw makePayloadNotFound({ k, capacityBits, maxPayloadBytes });
    }

    let headerLen = 0;
    let headerBitCount = 0;
    let payload = null;
    let payloadBitCount = 0;
    let payloadBitTarget = 0;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (skipW > 0 && skipH > 0 && y < skipH && x < skipW) continue;
            const p = (y * width + x) * 4;
            const values = [data[p] & mask, data[p + 1] & mask, data[p + 2] & mask];
            for (const value of values) {
                for (let bit = k - 1; bit >= 0; bit--) {
                    const bitValue = (value >> bit) & 1;
                    if (headerBitCount < 32) {
                        headerLen = ((headerLen << 1) | bitValue) >>> 0;
                        headerBitCount += 1;
                        if (headerBitCount === 32) {
                            if (headerLen <= 0 || headerLen > maxPayloadBytes) {
                                throw makePayloadNotFound({ k, headerLen, capacityBits, maxPayloadBytes });
                            }
                            payload = new Uint8Array(headerLen);
                            payloadBitTarget = headerLen * 8;
                        }
                    } else if (payloadBitCount < payloadBitTarget) {
                        if (bitValue) payload[payloadBitCount >> 3] |= 1 << (7 - (payloadBitCount & 7));
                        payloadBitCount += 1;
                        if (payloadBitCount >= payloadBitTarget) {
                            return payload;
                        }
                    }
                }
            }
        }
    }

    if (headerBitCount < 32 || !payload || payloadBitCount < payloadBitTarget) {
        throw makePayloadNotFound({ k, headerLen, capacityBits, maxPayloadBytes, payloadBitCount, payloadBitTarget });
    }
    return payload;
}

function decodeUtf8(bytes) {
    try {
        if (typeof TextDecoder === "function") return new TextDecoder("utf-8").decode(bytes);
    } catch (_) {}
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    try {
        return decodeURIComponent(escape(s));
    } catch (_) {
        return s;
    }
}

function parsePayload(headerBytes) {
    let idx = 0;
    if (!headerBytes || headerBytes.length < 1) throw new Error("Header corrupted");

    const hasPassword = headerBytes[idx] === 1;
    idx += 1;
    if (hasPassword) throw new Error("Password protected duck image is not supported");

    if (headerBytes.length < idx + 1) throw new Error("Header corrupted");
    const extLen = headerBytes[idx];
    idx += 1;
    if (headerBytes.length < idx + extLen + 4) throw new Error("Header corrupted");

    const ext = decodeUtf8(headerBytes.slice(idx, idx + extLen)).trim().replace(/^\./, "").toLowerCase() || "png";
    idx += extLen;
    const dataLen = readUint32BE(headerBytes, idx);
    idx += 4;
    const data = headerBytes.slice(idx);
    if (data.length !== dataLen) throw new Error("Data length mismatch");
    return { bytes: data, ext };
}

function normalizeDecodedExt(ext) {
    const e = String(ext || "png").replace(/^\./, "").toLowerCase();
    if (e === "jpeg") return "jpg";
    if (e === "binpng") return "mp4";
    return e || "png";
}

export async function decodeDuckImageBytes(bytes, mimeType = "image/png") {
    let imageData;
    try {
        imageData = await imageBytesToImageData(bytes, mimeType);
    } catch (e) {
        return {
            ok: false,
            error: e && typeof e === "object" && "message" in e ? String(e.message) : String(e || "image decode failed"),
            reason: "image_read_failed",
        };
    }

    let lastError = null;
    const diagnostics = [];
    for (const k of [2, 6, 8]) {
        try {
            const header = extractPayloadWithK(imageData, k);
            const decoded = parsePayload(header);
            return {
                ok: true,
                bytes: decoded.bytes,
                ext: normalizeDecodedExt(decoded.ext),
                bitDepth: k,
                width: imageData.width,
                height: imageData.height,
            };
        } catch (e) {
            lastError = e;
            diagnostics.push({
                k,
                reason: e?.code || e?.message || PAYLOAD_NOT_FOUND,
                headerLen: Number.isFinite(e?.headerLen) ? e.headerLen : undefined,
                maxPayloadBytes: Number.isFinite(e?.maxPayloadBytes) ? e.maxPayloadBytes : undefined,
            });
        }
    }
    const rawMessage = lastError && typeof lastError === "object" && "message" in lastError
        ? String(lastError.message)
        : String(lastError || "decode failed");
    const cleanError = /invalid array length|payload length invalid|insufficient image data|payload_not_found/i.test(rawMessage)
        ? ""
        : rawMessage;
    const diagnosticText = diagnostics
        .map((d) => {
            const parts = [`k${d.k}`];
            if (d.headerLen != null) parts.push(`header=${d.headerLen}`);
            if (d.maxPayloadBytes != null) parts.push(`cap=${d.maxPayloadBytes}`);
            return parts.join(" ");
        })
        .join("; ");
    return {
        ok: false,
        error: cleanError || diagnosticText,
        reason: PAYLOAD_NOT_FOUND,
        width: imageData.width,
        height: imageData.height,
        diagnostics,
    };
}
