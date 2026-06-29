import { readCompatLocalStorage } from "./storageKeyCompat.js";
import { storage as bridgeStorage } from "../bridge/uxpBridge.js";
import { pluginChildNativePathAsync, pluginRuntimeHint } from "./pluginRuntimePath.js";

const SOUND_MUTED_KEY = "xlrh_sound_muted";
const SOUND_FOLDER = "voices";
export const DEFAULT_SUCCESS_SOUND = "小梁小梁图修好啦.mp3";
export const DEFAULT_FAIL_SOUND = "小梁小梁图没修好.mp3";
const DEFAULT_VOLUME = 0.6;

function soundPath(fileName) {
    const name = String(fileName || "").replace(/\\/g, "/").split("/").filter(Boolean).pop();
    return `${SOUND_FOLDER}/${name || DEFAULT_SUCCESS_SOUND}`;
}

function canReadPluginFiles() {
    try {
        const storage = require("uxp")?.storage;
        return storage?.localFileSystem && typeof storage.localFileSystem.getPluginFolder === "function";
    } catch (_) {
        return false;
    }
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer || []);
    const parts = [];
    for (let offset = 0; offset < bytes.length; offset += 8192) {
        parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
    }
    return btoa(parts.join(""));
}

function audioMimeForFile(fileName) {
    return /\.wav$/i.test(String(fileName || "")) ? "audio/wav" : "audio/mp3";
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function soundFolder() {
    const fs = require("uxp").storage.localFileSystem;
    const pluginFolder = await fs.getPluginFolder();
    try {
        const existing = await pluginFolder.getEntry(SOUND_FOLDER);
        if (existing?.isFile === false) return existing;
    } catch (_) {}
    return pluginFolder.createFolder(SOUND_FOLDER);
}

async function readPluginAudioDataUrl(fileName) {
    const name = soundPath(fileName).split("/").pop();
    const file = await (await soundFolder()).getEntry(name);
    const base64 = arrayBufferToBase64(await file.read({ format: require("uxp").storage.formats.binary }));
    if (!base64) throw new Error(`empty audio file: ${name}`);
    return `data:${audioMimeForFile(name)};base64,${base64}`;
}

async function playDataUrl(url) {
    const audio = new Audio(url);
    audio.volume = DEFAULT_VOLUME;
    await audio.play();
}

export const isSoundMuted = () => {
    try {
        return readCompatLocalStorage(SOUND_MUTED_KEY) === "true";
    } catch (_) {
        return false;
    }
};

async function playPluginSound(fileName, { retries = 2 } = {}) {
    if (!canReadPluginFiles()) return;
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            await playDataUrl(await readPluginAudioDataUrl(fileName));
            return;
        } catch (error) {
            lastError = error;
            if (attempt < retries) await delay(70 + attempt * 90);
        }
    }
    throw lastError || new Error(`failed to play ${fileName}`);
}

export const playSound = (opts = {}) => {
    if (!opts.force && isSoundMuted()) return;
    playPluginSound(opts.fileName || DEFAULT_SUCCESS_SOUND, opts).catch((error) => {
        console.warn("[xiaoliang-rh] success sound failed:", error?.message || error);
    });
};

export const playSoundFail = (opts = {}) => {
    if (isSoundMuted()) return;
    playPluginSound(opts.fileName || DEFAULT_FAIL_SOUND, opts).catch((error) => {
        console.warn("[xiaoliang-rh] fail sound failed:", error?.message || error);
    });
};

export async function listSoundFiles() {
    try {
        const folder = await soundFolder();
        const entries = await folder.getEntries();
        const names = (entries || [])
            .filter((entry) => entry?.isFile !== false && /\.(mp3|wav)$/i.test(entry.name || ""))
            .map((entry) => entry.name);
        return Array.from(new Set([DEFAULT_SUCCESS_SOUND, DEFAULT_FAIL_SOUND, ...names]));
    } catch (_) {
        return [DEFAULT_SUCCESS_SOUND, DEFAULT_FAIL_SOUND];
    }
}

export async function openSoundFolder() {
    try {
        const res = await bridgeStorage.localFileSystem.openSoundFolder(pluginRuntimeHint());
        if (res?.nativePath) return res;
        return { ...(res || { ok: true }), nativePath: await pluginChildNativePathAsync(SOUND_FOLDER) };
    } catch (error) {
        if (canReadPluginFiles()) {
            const uxp = require("uxp");
            const folder = await soundFolder();
            if (!folder?.nativePath) throw error;
            await uxp.shell.openPath(folder.nativePath);
            return { ok: true, nativePath: folder.nativePath };
        }
        throw error;
    }
}
