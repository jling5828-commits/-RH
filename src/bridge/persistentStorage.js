import { isInWebView, storage } from "./uxpBridge.js";

const SAVE_DELAY_MS = 300;
const RETRY_DELAY_MS = 700;
const BRIDGE_TIMEOUT_MS = 3500;
const BRIDGE_POLL_MS = 60;
const MAX_BRIDGE_ATTEMPTS = 3;
const READ_RETRY_DELAYS = [0, 80, 160, 320, 640];

const state = {
    cache: {},
    loaded: false,
    saveTimer: null,
    retryTimer: null,
};

function bridgeAvailable() {
    return typeof window !== "undefined" && !!window.uxpHost && typeof window.uxpHost.postMessage === "function";
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSettingsObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function setCache(value) {
    state.cache = isSettingsObject(value) ? value : {};
    state.loaded = true;
}

async function quarantineSettings(reason) {
    try {
        const result = await storage.quarantineAndResetSettings();
        if (result?.ok) {
            console.info(`[persistentStorage] 已隔离损坏的 settings.json（${reason}）。`);
        } else {
            console.warn("[persistentStorage] 隔离 settings.json 未成功:", result?.error || result);
        }
    } catch (error) {
        console.warn("[persistentStorage] 隔离 settings.json 异常:", error?.message || error);
    }
}

async function waitForBridge(timeoutMs = BRIDGE_TIMEOUT_MS) {
    if (bridgeAvailable()) return true;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        await sleep(BRIDGE_POLL_MS);
        if (bridgeAvailable()) return true;
    }
    return bridgeAvailable();
}

async function writeCacheNow() {
    if (!isInWebView()) return false;
    if (!state.loaded) {
        console.warn("[persistentStorage] 设置尚未加载完成，已跳过写入 settings.json。");
        return false;
    }
    try {
        await storage.writeSettings(JSON.stringify(state.cache));
        return true;
    } catch (error) {
        console.warn("[persistentStorage] writeSettings 失败:", error?.message || error);
        return false;
    }
}

function queueSave() {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
        state.saveTimer = null;
        writeCacheNow()
            .then((ok) => {
                if (ok || state.retryTimer) return;
                state.retryTimer = setTimeout(() => {
                    state.retryTimer = null;
                    writeCacheNow().catch((error) => console.warn("[persistentStorage] 重试保存失败:", error?.message || error));
                }, RETRY_DELAY_MS);
            })
            .catch((error) => console.warn("[persistentStorage] 保存失败:", error?.message || error));
    }, SAVE_DELAY_MS);
}

function flushNow() {
    if (state.saveTimer) {
        clearTimeout(state.saveTimer);
        state.saveTimer = null;
    }
    return writeCacheNow();
}

async function readSettingsOnce() {
    if (!isInWebView()) return false;
    try {
        const raw = await storage.readSettings();
        if (raw === null) {
            setCache({});
            console.info("[persistentStorage] 未读取到 settings.json，按首次启动处理。");
            return true;
        }
        if (typeof raw !== "string") {
            setCache({});
            console.warn("[persistentStorage] readSettings 返回非字符串，已使用空配置。", typeof raw);
            return true;
        }
        const text = raw.replace(/^\uFEFF/, "").trim();
        if (!text) {
            setCache({});
            console.info("[persistentStorage] settings.json 为空，已使用空配置。");
            return true;
        }
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            await quarantineSettings("JSON 解析失败");
            setCache({});
            return true;
        }
        if (!isSettingsObject(parsed)) {
            await quarantineSettings("根节点非普通对象");
            setCache({});
            return true;
        }
        setCache(parsed);
        console.info(`[persistentStorage] 已加载 ${Object.keys(state.cache).length} 个设置键。`);
        return true;
    } catch (error) {
        console.warn("[persistentStorage] 读取设置失败:", error?.message || error);
        return false;
    }
}

async function readSettingsWithRetry(delays = READ_RETRY_DELAYS) {
    const startedAt = Date.now();
    for (let index = 0; index < delays.length; index += 1) {
        if (delays[index] > 0) await sleep(delays[index]);
        if (await readSettingsOnce()) {
            console.info(`[persistentStorage] settings.json 加载成功（尝试 ${index + 1}/${delays.length}，耗时 ${Date.now() - startedAt}ms）`);
            return true;
        }
    }
    console.warn(`[persistentStorage] settings.json 加载失败（已重试 ${delays.length} 次，耗时 ${Date.now() - startedAt}ms）`);
    return false;
}

function bindLifecycleFlush() {
    if (typeof window === "undefined" || window.__xlrh_persistentFlushBound) return;
    window.__xlrh_persistentFlushBound = true;
    const save = () => flushNow().catch((error) => console.warn("[persistentStorage] 关闭前保存失败:", error?.message || error));
    window.addEventListener("pagehide", save);
    window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") save();
    });
}

export function setShrinkPersistBypass() {}

export function unlockPersistentStorageWrites() {}

export function createPersistentStorage() {
    bindLifecycleFlush();
    return {
        getItem(key) {
            return Object.prototype.hasOwnProperty.call(state.cache, key) ? state.cache[key] : null;
        },
        setItem(key, value) {
            state.cache[key] = String(value);
            queueSave();
        },
        removeItem(key) {
            delete state.cache[key];
            queueSave();
        },
        clear() {
            state.cache = {};
            queueSave();
        },
        get length() {
            return Object.keys(state.cache).length;
        },
        key(index) {
            return Object.keys(state.cache)[index] ?? null;
        },
        flush() {
            bindLifecycleFlush();
            return flushNow();
        },
    };
}

export async function initPersistentStorage() {
    if (state.loaded) return;
    const ok = await readSettingsWithRetry();
    if (!ok) {
        throw new Error("[persistentStorage] 初始化失败：无法安全加载 settings.json（已停止启动以避免覆盖本地数据）");
    }
}

export async function ensureStorageReady() {
    if (typeof window === "undefined") return;
    if (!window.__xlrh_usingPersistentStorage) return;
    if (state.loaded) return;

    let ready = bridgeAvailable();
    for (let attempt = 0; attempt < MAX_BRIDGE_ATTEMPTS && !ready; attempt += 1) {
        ready = await waitForBridge();
        if (!ready) console.warn(`[persistentStorage] uxpHost 未就绪（${attempt + 1}/${MAX_BRIDGE_ATTEMPTS}），继续等待...`);
    }
    if (!ready) {
        throw new Error(`[persistentStorage] uxpHost 在 ${MAX_BRIDGE_ATTEMPTS} 次等待后仍未就绪，已阻止启动以避免覆盖本地数据`);
    }

    window.__xlrh_storageBridgeReady = true;
    await initPersistentStorage();
}
