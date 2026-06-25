const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_TYPE_IHDR = [0x49, 0x48, 0x44, 0x52];
const PNG_TYPE_IDAT = [0x49, 0x44, 0x41, 0x54];
const PNG_TYPE_IEND = [0x49, 0x45, 0x4e, 0x44];
const ZLIB_STORE_BLOCK_LIMIT = 0xffff;

let pngCrcLookup = null;

function writeUint32BE(target, offset, value) {
    const n = value >>> 0;
    target[offset] = (n >>> 24) & 0xff;
    target[offset + 1] = (n >>> 16) & 0xff;
    target[offset + 2] = (n >>> 8) & 0xff;
    target[offset + 3] = n & 0xff;
}

function crcTable() {
    if (pngCrcLookup) return pngCrcLookup;
    const table = new Uint32Array(256);
    for (let byte = 0; byte < 256; byte++) {
        let value = byte;
        for (let bit = 0; bit < 8; bit++) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[byte] = value >>> 0;
    }
    pngCrcLookup = table;
    return table;
}

function crc32Range(bytes, offset, length) {
    const table = crcTable();
    let crc = 0xffffffff;
    const end = offset + length;
    for (let i = offset; i < end; i++) {
        crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
    let low = 1;
    let high = 0;
    for (let i = 0; i < bytes.length; i++) {
        low += bytes[i];
        high += low;
        low %= 65521;
        high %= 65521;
    }
    return ((high << 16) | low) >>> 0;
}

function writePngChunk(typeBytes, payload) {
    const bodyLength = payload ? payload.length : 0;
    const chunk = new Uint8Array(12 + bodyLength);
    writeUint32BE(chunk, 0, bodyLength);
    chunk.set(typeBytes, 4);
    if (bodyLength) chunk.set(payload, 8);
    writeUint32BE(chunk, 8 + bodyLength, crc32Range(chunk, 4, 4 + bodyLength));
    return chunk;
}

function storedDeflateStream(rawRows) {
    const blockCount = Math.max(1, Math.ceil(rawRows.length / ZLIB_STORE_BLOCK_LIMIT));
    const out = new Uint8Array(2 + blockCount * 5 + rawRows.length + 4);
    out[0] = 0x78;
    out[1] = 0x01;
    let cursor = 2;
    for (let block = 0; block < blockCount; block++) {
        const blockStart = block * ZLIB_STORE_BLOCK_LIMIT;
        const blockLength = Math.min(ZLIB_STORE_BLOCK_LIMIT, rawRows.length - blockStart);
        out[cursor++] = block === blockCount - 1 ? 1 : 0;
        out[cursor++] = blockLength & 0xff;
        out[cursor++] = (blockLength >>> 8) & 0xff;
        const inverse = (~blockLength) & 0xffff;
        out[cursor++] = inverse & 0xff;
        out[cursor++] = (inverse >>> 8) & 0xff;
        out.set(rawRows.subarray(blockStart, blockStart + blockLength), cursor);
        cursor += blockLength;
    }
    writeUint32BE(out, cursor, adler32(rawRows));
    return out;
}

function sanitizeDimension(value, label) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`invalid PNG ${label}`);
    return Math.max(1, Math.floor(n));
}

function packScanlines(width, height, channels, source, sourceStride) {
    const rowLength = 1 + width * channels;
    const rows = new Uint8Array(rowLength * height);
    for (let y = 0; y < height; y++) {
        let dst = y * rowLength;
        rows[dst++] = 0;
        let src = y * width * sourceStride;
        for (let x = 0; x < width; x++) {
            for (let c = 0; c < channels; c++) rows[dst++] = source[src + c] || 0;
            src += sourceStride;
        }
    }
    return rows;
}

function pngBytesFromScanlines(width, height, colorType, rows) {
    const header = new Uint8Array(13);
    writeUint32BE(header, 0, width);
    writeUint32BE(header, 4, height);
    header[8] = 8;
    header[9] = colorType;
    header[10] = 0;
    header[11] = 0;
    header[12] = 0;

    const chunks = [
        PNG_SIGNATURE,
        writePngChunk(PNG_TYPE_IHDR, header),
        writePngChunk(PNG_TYPE_IDAT, storedDeflateStream(rows)),
        writePngChunk(PNG_TYPE_IEND, new Uint8Array(0)),
    ];
    const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const png = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        png.set(chunk, offset);
        offset += chunk.length;
    }
    return png;
}

export function resampleMaskChannelToSize(interleaved, sourceW, sourceH, sourceComponents, targetW, targetH) {
    const sw = sanitizeDimension(sourceW, "mask width");
    const sh = sanitizeDimension(sourceH, "mask height");
    const tw = sanitizeDimension(targetW, "target width");
    const th = sanitizeDimension(targetH, "target height");
    const stride = Math.max(1, Number(sourceComponents) || 1);
    const out = new Uint8Array(tw * th);
    for (let y = 0; y < th; y++) {
        const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / th));
        const srcRow = sy * sw * stride;
        const dstRow = y * tw;
        for (let x = 0; x < tw; x++) {
            const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / tw));
            out[dstRow + x] = interleaved[srcRow + sx * stride] || 0;
        }
    }
    return out;
}

export function encodePNGFromRGB(width, height, rgbData, componentCount = 3) {
    const w = sanitizeDimension(width, "width");
    const h = sanitizeDimension(height, "height");
    const stride = Math.max(3, Number(componentCount) || 3);
    return pngBytesFromScanlines(w, h, 2, packScanlines(w, h, 3, rgbData, stride));
}

export function encodePNGFromRGBA(width, height, rgbaData) {
    const w = sanitizeDimension(width, "width");
    const h = sanitizeDimension(height, "height");
    return pngBytesFromScanlines(w, h, 6, packScanlines(w, h, 4, rgbaData, 4));
}
