const FALLBACK_SIZE = Object.freeze({ width: 512, height: 512 });

function fallbackSize() {
    return { ...FALLBACK_SIZE };
}

function isByteBuffer(value) {
    return value && typeof value.length === "number";
}

function byteAt(bytes, index) {
    return bytes[index] & 0xff;
}

function readU16BE(bytes, offset) {
    return (byteAt(bytes, offset) << 8) + byteAt(bytes, offset + 1);
}

function readU32BE(bytes, offset) {
    return (
        byteAt(bytes, offset) * 0x1000000 +
        (byteAt(bytes, offset + 1) << 16) +
        (byteAt(bytes, offset + 2) << 8) +
        byteAt(bytes, offset + 3)
    );
}

function isPng(bytes, mime) {
    if (String(mime || "").toLowerCase() === "image/png") return true;
    return bytes.length >= 8 &&
        byteAt(bytes, 0) === 0x89 &&
        byteAt(bytes, 1) === 0x50 &&
        byteAt(bytes, 2) === 0x4e &&
        byteAt(bytes, 3) === 0x47 &&
        byteAt(bytes, 4) === 0x0d &&
        byteAt(bytes, 5) === 0x0a &&
        byteAt(bytes, 6) === 0x1a &&
        byteAt(bytes, 7) === 0x0a;
}

function parsePngSize(bytes) {
    if (bytes.length < 24) return null;
    const width = readU32BE(bytes, 16);
    const height = readU32BE(bytes, 20);
    return width > 0 && height > 0 ? { width, height } : null;
}

function isJpeg(bytes, mime) {
    if (String(mime || "").toLowerCase() === "image/jpeg") return true;
    return bytes.length >= 2 && byteAt(bytes, 0) === 0xff && byteAt(bytes, 1) === 0xd8;
}

function isStartOfFrame(marker) {
    return (
        marker >= 0xc0 && marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
    );
}

function parseJpegSize(bytes) {
    if (bytes.length < 4 || byteAt(bytes, 0) !== 0xff || byteAt(bytes, 1) !== 0xd8) return null;

    let cursor = 2;
    while (cursor + 3 < bytes.length) {
        if (byteAt(bytes, cursor) !== 0xff) {
            cursor += 1;
            continue;
        }

        while (cursor < bytes.length && byteAt(bytes, cursor) === 0xff) cursor += 1;
        if (cursor >= bytes.length) break;

        const marker = byteAt(bytes, cursor);
        cursor += 1;

        if (marker === 0xd9 || marker === 0xda) break;
        if (marker >= 0xd0 && marker <= 0xd7) continue;
        if (cursor + 1 >= bytes.length) break;

        const segmentLength = readU16BE(bytes, cursor);
        if (segmentLength < 2 || cursor + segmentLength > bytes.length) break;

        if (isStartOfFrame(marker) && segmentLength >= 7) {
            const height = readU16BE(bytes, cursor + 3);
            const width = readU16BE(bytes, cursor + 5);
            if (width > 0 && height > 0) return { width, height };
        }

        cursor += segmentLength;
    }
    return null;
}

export function parseImageDimensionsFromBytes(uint8, mime) {
    try {
        if (!isByteBuffer(uint8)) return fallbackSize();
        const bytes = uint8 instanceof Uint8Array ? uint8 : Uint8Array.from(uint8);
        const size = isPng(bytes, mime)
            ? parsePngSize(bytes)
            : isJpeg(bytes, mime)
                ? parseJpegSize(bytes)
                : null;
        return size || fallbackSize();
    } catch (_) {
        return fallbackSize();
    }
}
