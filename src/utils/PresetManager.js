import { readCompatLocalStorage, writeCompatLocalStorage } from "./storageKeyCompat.js";

const PRESETS_KEY = "xlrh_prompt_presets_v1";
const CATEGORIES_KEY = "xlrh_prompt_categories_v1";
const REFS_KEY = "xlrh_prompt_refs_v1";
const ORDER_KEY = "xlrh_prompt_order_v1";

const BUILTIN_CATEGORIES = Object.freeze(["人像", "产品", "场景", "我的"]);
const REF_KEYS = Object.freeze(["ref1", "ref2", "ref3", "ref4", "ref5", "ref6"]);

const DEFAULT_PRESETS = Object.freeze([
    Object.freeze({ id: "xlrh_builtin_portrait_clean", name: "自然精修", category: "人像", prompt: "natural portrait retouching, clean skin texture, soft light, realistic detail" }),
    Object.freeze({ id: "xlrh_builtin_product_clear", name: "产品质感", category: "产品", prompt: "premium product photography, crisp edges, clean background, refined material detail" }),
    Object.freeze({ id: "xlrh_builtin_scene_light", name: "氛围光影", category: "场景", prompt: "cinematic lighting, coherent shadows, atmospheric depth, balanced color grading" }),
]);

function uniqueList(items) {
    const seen = new Set();
    const list = [];
    for (const item of items || []) {
        const value = String(item || "").trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        list.push(value);
    }
    return list;
}

function readJson(key, fallback) {
    try {
        const raw = readCompatLocalStorage(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return parsed == null ? fallback : parsed;
    } catch (_) {
        return fallback;
    }
}

function writeJson(key, value) {
    writeCompatLocalStorage(key, JSON.stringify(value));
}

function makeId() {
    return `xlrh_preset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanPreset(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = String(raw.name || "").trim();
    const prompt = String(raw.prompt || "").trim();
    if (!name && !prompt) return null;
    return {
        id: String(raw.id || makeId()),
        name: name || "未命名",
        category: String(raw.category || "我的").trim() || "我的",
        prompt,
        createdAt: Number(raw.createdAt || Date.now()),
        updatedAt: Number(raw.updatedAt || raw.createdAt || Date.now()),
    };
}

function readPresetsRaw() {
    const parsed = readJson(PRESETS_KEY, null);
    if (!Array.isArray(parsed)) return DEFAULT_PRESETS.map((preset) => ({ ...preset }));
    const presets = parsed.map(cleanPreset).filter(Boolean);
    return presets.length ? presets : DEFAULT_PRESETS.map((preset) => ({ ...preset }));
}

function savePresets(presets) {
    writeJson(PRESETS_KEY, (presets || []).map(cleanPreset).filter(Boolean));
}

function readRefsMap() {
    const parsed = readJson(REFS_KEY, {});
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function saveRefsMap(map) {
    writeJson(REFS_KEY, map && typeof map === "object" ? map : {});
}

function withRefFlags(preset, refsMap) {
    const refs = refsMap?.[preset.id] || {};
    const next = { ...preset };
    for (const key of REF_KEYS) {
        next[`hasRef${key.slice(3)}`] = Boolean(refs[key]);
    }
    return next;
}

function readCustomCategories() {
    const parsed = readJson(CATEGORIES_KEY, []);
    return uniqueList(Array.isArray(parsed) ? parsed : []);
}

function saveCustomCategories(categories) {
    writeJson(CATEGORIES_KEY, uniqueList(categories).filter((cat) => !BUILTIN_CATEGORIES.includes(cat)));
}

function readOrderMap() {
    const parsed = readJson(ORDER_KEY, {});
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function saveOrderMap(map) {
    writeJson(ORDER_KEY, map && typeof map === "object" ? map : {});
}

const PresetManager = {
    init() {
        const presets = readPresetsRaw();
        savePresets(presets);
        saveCustomCategories(readCustomCategories());
        return presets.length;
    },

    getAll() {
        const refsMap = readRefsMap();
        return readPresetsRaw().map((preset) => withRefFlags(preset, refsMap));
    },

    getCategories() {
        const fromPresets = readPresetsRaw().map((preset) => preset.category);
        return uniqueList([...BUILTIN_CATEGORIES, ...readCustomCategories(), ...fromPresets]);
    },

    isBuiltinCategory(name) {
        return BUILTIN_CATEGORIES.includes(String(name || "").trim());
    },

    add(name, category, prompt) {
        const now = Date.now();
        const preset = cleanPreset({
            id: makeId(),
            name,
            category: category || "我的",
            prompt,
            createdAt: now,
            updatedAt: now,
        });
        if (!preset) throw new Error("预设内容为空");
        savePresets([preset, ...readPresetsRaw()]);
        if (!this.isBuiltinCategory(preset.category)) this.addCustomCategory(preset.category);
        return preset;
    },

    update(id, patch = {}) {
        const targetId = String(id || "");
        const presets = readPresetsRaw();
        const index = presets.findIndex((preset) => preset.id === targetId);
        if (index < 0) throw new Error("预设不存在");
        const updated = cleanPreset({ ...presets[index], ...patch, id: targetId, updatedAt: Date.now() });
        if (!updated) throw new Error("预设内容为空");
        presets[index] = updated;
        savePresets(presets);
        if (!this.isBuiltinCategory(updated.category)) this.addCustomCategory(updated.category);
        return updated;
    },

    remove(id) {
        const targetId = String(id || "");
        const before = readPresetsRaw();
        savePresets(before.filter((preset) => preset.id !== targetId));
        const refs = readRefsMap();
        delete refs[targetId];
        saveRefsMap(refs);
        return before.length;
    },

    async loadRefs(id) {
        const refs = readRefsMap()[String(id || "")] || {};
        const next = {};
        for (const key of REF_KEYS) next[key] = refs[key] || null;
        return next;
    },

    async saveRefs(id, refImages = {}) {
        const targetId = String(id || "");
        if (!targetId) return false;
        const refsMap = readRefsMap();
        const nextRefs = {};
        for (const key of REF_KEYS) {
            if (refImages[key]) nextRefs[key] = refImages[key];
        }
        if (Object.keys(nextRefs).length) refsMap[targetId] = nextRefs;
        else delete refsMap[targetId];
        saveRefsMap(refsMap);
        return true;
    },

    addCustomCategory(name) {
        const value = String(name || "").trim();
        if (!value) return { ok: false, message: "分类名为空" };
        if (BUILTIN_CATEGORIES.includes(value)) return { ok: true, name: value, builtin: true };
        const categories = readCustomCategories();
        if (!categories.includes(value)) saveCustomCategories([...categories, value]);
        return { ok: true, name: value };
    },

    removeCustomCategory(name) {
        const value = String(name || "").trim();
        if (!value || BUILTIN_CATEGORIES.includes(value)) return { ok: false, message: "内置分类不能删除" };
        const used = readPresetsRaw().some((preset) => preset.category === value);
        if (used) return { ok: false, message: "分类下还有预设" };
        saveCustomCategories(readCustomCategories().filter((category) => category !== value));
        return { ok: true, name: value };
    },

    getOrderByCategory() {
        return readOrderMap();
    },

    reorderInCategory(category, ids) {
        const key = String(category || "").trim();
        if (!key) return false;
        const order = readOrderMap();
        order[key] = Array.isArray(ids) ? ids.map(String) : [];
        saveOrderMap(order);
        return true;
    },

    async exportAll() {
        const payload = {
            version: 1,
            exportedAt: new Date().toISOString(),
            categories: readCustomCategories(),
            presets: readPresetsRaw(),
            refs: readRefsMap(),
            order: readOrderMap(),
        };
        writeJson("xlrh_prompt_presets_last_export_v1", payload);
        return payload.presets.length;
    },

    async importFrom(payload) {
        if (!payload || typeof payload !== "object") return { imported: 0, skipped: 0 };
        const incoming = Array.isArray(payload.presets) ? payload.presets.map(cleanPreset).filter(Boolean) : [];
        if (!incoming.length) return { imported: 0, skipped: 0 };
        const current = readPresetsRaw();
        const seen = new Set(current.map((preset) => preset.id));
        const additions = [];
        for (const preset of incoming) {
            if (seen.has(preset.id)) continue;
            seen.add(preset.id);
            additions.push(preset);
        }
        savePresets([...additions, ...current]);
        if (Array.isArray(payload.categories)) saveCustomCategories([...readCustomCategories(), ...payload.categories]);
        if (payload.refs && typeof payload.refs === "object") saveRefsMap({ ...readRefsMap(), ...payload.refs });
        if (payload.order && typeof payload.order === "object") saveOrderMap({ ...readOrderMap(), ...payload.order });
        return { imported: additions.length, skipped: incoming.length - additions.length };
    },
};

export default PresetManager;
