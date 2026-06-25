import { readCompatLocalStorage, writeCompatLocalStorage } from "./storageKeyCompat.js";

const HISTORY_STORAGE_KEYS = Object.freeze({
    reverse: "xlrh_history_reverse",
    polish: "xlrh_history_polish",
    chat: "xlrh_history_chat",
    evaluate: "xlrh_history_evaluate",
});
const HISTORY_LABELS = Object.freeze({
    reverse: "反推",
    polish: "润色",
    chat: "对话",
    evaluate: "修图评价",
});
const HISTORY_LIMIT = 50;
const THUMBNAIL_LIMIT = 64;
const CHAT_THUMBNAIL_LIMIT = 2;
const FILENAME_BLOCKLIST = /[/\\:*?"<>|]/g;

function makeHistoryId() {
    return `h_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function storageKey(type) {
    return HISTORY_STORAGE_KEYS[type] || "";
}

function asText(value) {
    return String(value || "");
}

function readItems(type) {
    const key = storageKey(type);
    if (!key) return [];
    try {
        const parsed = JSON.parse(readCompatLocalStorage(key) || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeItems(type, items) {
    const key = storageKey(type);
    if (!key) return;
    try {
        writeCompatLocalStorage(key, JSON.stringify(Array.isArray(items) ? items : []));
    } catch (error) {
        console.warn("[XLRH History] save failed:", error);
    }
}

function limited(items) {
    return items.length > HISTORY_LIMIT ? items.slice(0, HISTORY_LIMIT) : items;
}

function addItem(type, item) {
    writeItems(type, limited([item, ...readItems(type)]));
    return item.id;
}

function fitInsideBox(width, height, maxSize) {
    if (width <= maxSize && height <= maxSize) return { width, height };
    const scale = maxSize / Math.max(width, height);
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function drawThumb(dataUrl, maxSize) {
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
            try {
                const size = fitInsideBox(image.width, image.height, maxSize);
                const canvas = document.createElement("canvas");
                canvas.width = size.width;
                canvas.height = size.height;
                const context = canvas.getContext("2d");
                if (!context) {
                    resolve(null);
                    return;
                }
                context.drawImage(image, 0, 0, size.width, size.height);
                resolve(canvas.toDataURL("image/jpeg", 0.7));
            } catch {
                resolve(null);
            }
        };
        image.onerror = () => resolve(null);
        image.src = dataUrl;
    });
}

export function compressToThumbnail(dataUrl, maxSize = THUMBNAIL_LIMIT) {
    if (!dataUrl || typeof dataUrl !== "string") return Promise.resolve(null);
    return drawThumb(dataUrl, maxSize);
}

export async function compressImagesToThumbnails(dataUrls) {
    if (!Array.isArray(dataUrls) || dataUrls.length === 0) return [];
    const thumbs = await Promise.all(dataUrls.map((url) => compressToThumbnail(url)));
    return thumbs.filter(Boolean);
}

async function messageSnapshot(messages = []) {
    const source = Array.isArray(messages) ? messages : [];
    const output = [];

    for (const message of source) {
        const row = { role: message.role, text: asText(message.text) };
        if (Array.isArray(message.images) && message.images.length) {
            row.thumbnails = await compressImagesToThumbnails(message.images.slice(0, CHAT_THUMBNAIL_LIMIT));
        } else if (Array.isArray(message.thumbnails) && message.thumbnails.length) {
            row.thumbnails = message.thumbnails;
        }
        output.push(row);
    }

    return output;
}

export function addReverse(data = {}) {
    return addItem("reverse", {
        id: makeHistoryId(),
        ts: Date.now(),
        source: data.source || "main",
        length: data.length || "default",
        style: data.style || "objective",
        result: asText(data.result),
        thumb: data.thumb || null,
    });
}

export function addPolish(data = {}) {
    return addItem("polish", {
        id: makeHistoryId(),
        ts: Date.now(),
        input: asText(data.input),
        result: asText(data.result),
        imageCount: data.imageCount || 0,
    });
}

export async function addChat(data = {}) {
    return addItem("chat", {
        id: makeHistoryId(),
        ts: Date.now(),
        messages: await messageSnapshot(data.messages),
        parsedResult: data.parsedResult || null,
    });
}

export async function updateChat(id, data = {}) {
    const items = readItems("chat");
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return false;

    items[index] = {
        ...items[index],
        messages: await messageSnapshot(data.messages),
        parsedResult: data.parsedResult || null,
    };
    writeItems("chat", items);
    return true;
}

export function addEvaluate(data = {}) {
    return addItem("evaluate", {
        id: makeHistoryId(),
        ts: Date.now(),
        result: asText(data.result),
        thumb: data.thumb || null,
    });
}

export function list(type) {
    return readItems(type);
}

export function get(type, id) {
    return readItems(type).find((item) => item.id === id) || null;
}

export function remove(type, id) {
    writeItems(type, readItems(type).filter((item) => item.id !== id));
}

export function clear(type) {
    if (storageKey(type)) writeItems(type, []);
}

function messagesMatch(messages, needle) {
    return Array.isArray(messages) && messages.some((message) => asText(message.text).toLowerCase().includes(needle));
}

function itemMatches(item, needle) {
    const fields = [item.result, item.input, item.text, item.parsedResult?.prompt];
    return fields.some((field) => asText(field).toLowerCase().includes(needle)) || messagesMatch(item.messages, needle);
}

export function search(type, keyword) {
    const items = readItems(type);
    const needle = asText(keyword).trim().toLowerCase();
    return needle ? items.filter((item) => itemMatches(item, needle)) : items;
}

function safeFilenamePart(value, maxLen) {
    return asText(value).replace(/\s+/g, " ").trim().slice(0, maxLen).replace(FILENAME_BLOCKLIST, "_");
}

function summarySource(item) {
    return item?.parsedResult?.presetName
        || item?.parsedResult?.prompt
        || item?.result
        || item?.input
        || item?.messages?.[0]?.text
        || "导出";
}

function itemSummary(item) {
    const maxLen = item?.parsedResult?.presetName ? 30 : 20;
    return safeFilenamePart(summarySource(item), maxLen) || "导出";
}

function timestampForFilename(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const time = `${pad(date.getHours())}-${pad(date.getMinutes())}`;
    return `${day}_${time}`;
}

export function getExportFilename(type) {
    const label = HISTORY_LABELS[type] || type;
    return `${timestampForFilename()}_${label}_${itemSummary(readItems(type)[0])}`;
}

function textExport(type, items) {
    const label = HISTORY_LABELS[type] || type;
    const lines = [`# ${label} 历史记录\n`, `导出时间: ${new Date().toLocaleString()}\n`, "---\n"];
    items.forEach((item, index) => {
        lines.push(`## ${index + 1}. ${new Date(item.ts).toLocaleString()}\n`);
        if (item.result) lines.push(`${item.result}\n`);
        if (item.input) lines.push(`输入: ${item.input}\n`);
        if (Array.isArray(item.messages)) {
            item.messages.forEach((message) => lines.push(`[${message.role}]: ${message.text}\n`));
            if (item.parsedResult?.prompt) lines.push(`提示词: ${item.parsedResult.prompt}\n`);
        }
        lines.push("\n");
    });
    return lines.join("");
}

export function exportHistory(type, format = "json") {
    const items = readItems(type);
    const label = HISTORY_LABELS[type] || type;
    return format === "txt"
        ? textExport(type, items)
        : JSON.stringify({ type: label, exportedAt: Date.now(), items }, null, 2);
}
