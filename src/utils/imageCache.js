const PREVIEW_CACHE_LIMIT = 40;

class PreviewImageCache {
    constructor(limit = PREVIEW_CACHE_LIMIT) {
        this.limit = Math.max(1, Number(limit) || PREVIEW_CACHE_LIMIT);
        this.items = new Map();
    }

    set(fileName, dataUrl) {
        const key = normalizeKey(fileName);
        if (!key || !dataUrl) return;
        if (this.items.has(key)) this.items.delete(key);
        this.items.set(key, dataUrl);
        this.trim();
    }

    get(fileName) {
        const key = normalizeKey(fileName);
        if (!key || !this.items.has(key)) return null;
        const dataUrl = this.items.get(key);
        this.items.delete(key);
        this.items.set(key, dataUrl);
        return dataUrl || null;
    }

    addMany(entries) {
        if (!Array.isArray(entries)) return;
        for (const entry of entries) {
            this.set(entry?.fileName, entry?.dataUrl);
        }
    }

    trim() {
        while (this.items.size > this.limit) {
            const oldest = this.items.keys().next().value;
            if (oldest === undefined) break;
            this.items.delete(oldest);
        }
    }
}

function normalizeKey(fileName) {
    return typeof fileName === "string" ? fileName.trim() : "";
}

const previewImageCache = new PreviewImageCache();

export function injectToCache(entries) {
    previewImageCache.addMany(entries);
}

export function getFromCache(fileName) {
    return previewImageCache.get(fileName);
}

export function putToCache(fileName, dataUrl) {
    previewImageCache.set(fileName, dataUrl);
}
