import { readCompatLocalStorage, writeCompatLocalStorage } from "./storageKeyCompat.js";

const COLOR_ROWS = [
    ["result", "#FFB7C5"],
    ["input", "#5ac8fa"],
    ["param", "#ff9f1c"],
    ["operate", "#08d966"],
    ["topbar", "#FFB7C5"],
    ["uploadImage", "#5ac8fa"],
    ["rhAccount", "#5ac8fa"],
    ["rhConfig", "#ff9f1c"],
    ["rhAppearance", "#ff9f1c"],
];

function objectFromRows(rows) {
    return rows.reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
    }, {});
}

export const DEFAULT_COLORS = objectFromRows(COLOR_ROWS);
export const APPEARANCE_CUSTOM_DEFAULTS = objectFromRows(COLOR_ROWS);
export const BAR_KEYS = COLOR_ROWS.map(([key]) => key);

export const RUNNINGHUB_APPEARANCE_KEYS = [
    "result",
    "input",
    "param",
    "operate",
    "uploadImage",
    "topbar",
    "rhAccount",
    "rhConfig",
    "rhAppearance",
];

export const RUNNINGHUB_SETTINGS_APPEARANCE_KEYS = ["topbar", "rhAccount", "rhConfig", "rhAppearance"];

export const RUNNINGHUB_APPEARANCE_LABELS = Object.freeze({
    result: "返图区域",
    input: "图像上传",
    param: "调用参数",
    operate: "操作台",
    uploadImage: "上传项（多图）",
    topbar: "顶栏",
    rhAccount: "账户信息",
    rhConfig: "RunningHub 配置",
    rhAppearance: "外观偏好",
});

export const DEFAULT_TOPBAR_FILL = "hsla(350, 100%, 93%, 0.75)";
export const DEFAULT_TOPBAR_BORDER = "hsla(348, 100%, 86%, 0.8)";

const PRESET_ROWS = [
    ["sakura", "樱花粉", "#FFB7C5", "柔和樱花粉"],
    ["violet", "紫罗兰", "#a78bfa", "优雅紫罗兰"],
    ["skyblue", "浅蓝", "#5ac8fa", "清爽浅蓝"],
    ["mint", "薄荷绿", "#08d966", "清新薄荷绿"],
    ["coral", "珊瑚橙", "#ff9f1c", "温暖珊瑚橙"],
    ["rose", "蔷薇红", "#e879a4", "温柔蔷薇红"],
    ["teal", "青玉", "#14b8a6", "清透青玉色"],
    ["indigo", "靛蓝", "#6366f1", "沉稳靛蓝"],
    ["blush", "豆沙", "#d4a5a5", "低调豆沙粉"],
    ["glass", "玻璃", "#8b93a6", "黑白灰玻璃，与工作台选择页风格统一"],
];

export const THEME_PRESETS = PRESET_ROWS.map(([id, name, color, desc]) => ({ id, name, color, desc }));
export const DEFAULT_THEME_PRESET_ID = "sakura";

export const THEME_STORAGE_KEY = "xlrh_ui_theme";
export const APPEARANCE_RUNNINGHUB_KEY = "xlrh_appearance_runninghub";

export const PRODUCT_THEME_IDS = Object.freeze({
    RUNNINGHUB: "runninghub",
});

export const THEME_MODE = Object.freeze({
    DEFAULT: "default",
    PRESET: "preset",
    CUSTOM: "custom",
});

const LAUNCHER_RH_ACCENT_HEX = "#5ac8fa";
const GLASS_ACCENT = "#d8dce6";
const GLASS_SHADOW = "rgba(255, 255, 255, 0.22)";

function isHexColor(value) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}

function defaultThemeConfig() {
    return { mode: THEME_MODE.PRESET, presetId: DEFAULT_THEME_PRESET_ID };
}

function findPreset(presetId) {
    return THEME_PRESETS.find((preset) => preset.id === presetId) || null;
}

function productAppearanceKey(productId) {
    return productId === PRODUCT_THEME_IDS.RUNNINGHUB ? APPEARANCE_RUNNINGHUB_KEY : null;
}

function readJson(key) {
    try {
        const raw = readCompatLocalStorage(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function normalizeColorMap(input) {
    return input && typeof input === "object" ? { ...input } : {};
}

export function getAppearancePickerDefault(key) {
    const color = APPEARANCE_CUSTOM_DEFAULTS[key] ?? DEFAULT_COLORS[key];
    return isHexColor(color) ? color : "#888888";
}

export function getAppearanceSeedForProduct(productId) {
    const keys = productId === PRODUCT_THEME_IDS.RUNNINGHUB ? RUNNINGHUB_APPEARANCE_KEYS : [];
    return keys.reduce((seed, key) => {
        seed[key] = getAppearancePickerDefault(key);
        return seed;
    }, {});
}

export function hexToRgba(hex, alpha = 0.5) {
    const clean = isHexColor(hex) ? hex.trim().slice(1) : "888888";
    const channels = [0, 2, 4].map((start) => parseInt(clean.slice(start, start + 2), 16));
    return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
}

export function hexToTopbarFill(hex) {
    return hexToRgba(hex, 0.75);
}

export function hexToTopbarIconColor(hex) {
    return `color-mix(in srgb, ${hex} 24%, #121010)`;
}

export function hexToTopbarIconHoverColor(hex) {
    return `color-mix(in srgb, ${hex} 14%, #1f1d1e)`;
}

export function loadThemeConfig() {
    const parsed = readJson(THEME_STORAGE_KEY);
    if (parsed?.mode === THEME_MODE.PRESET && findPreset(parsed.presetId)) {
        return { mode: THEME_MODE.PRESET, presetId: parsed.presetId };
    }
    return defaultThemeConfig();
}

export function loadProductAppearance(productId) {
    const key = productAppearanceKey(productId);
    if (!key) return { useCustom: false, customColors: {} };
    const parsed = readJson(key);
    return {
        useCustom: Boolean(parsed?.useCustom),
        customColors: normalizeColorMap(parsed?.customColors),
    };
}

export function saveProductAppearance(productId, data) {
    const key = productAppearanceKey(productId);
    if (!key) return;
    writeCompatLocalStorage(key, JSON.stringify({
        useCustom: Boolean(data?.useCustom),
        customColors: normalizeColorMap(data?.customColors),
    }));
}

export function normalizeRunninghubCustomColors(input) {
    const colors = normalizeColorMap(input);
    let didChange = false;
    const moves = [
        ["provider", ["rhAccount", "rhConfig"]],
        ["background", ["rhAppearance"]],
    ];
    for (const [fromKey, targets] of moves) {
        if (!Object.prototype.hasOwnProperty.call(colors, fromKey)) continue;
        const value = colors[fromKey];
        if (typeof value === "string") {
            targets.forEach((target) => {
                if (colors[target] == null) colors[target] = value;
            });
        }
        delete colors[fromKey];
        didChange = true;
    }
    return { colors, didChange };
}

export function getGlobalPresetMainColor() {
    return (findPreset(loadThemeConfig().presetId) || THEME_PRESETS[0]).color;
}

function setBarColor(vars, key, color, shadow = hexToRgba(color, 0.5)) {
    vars[`--xlrh-bar-${key}`] = color;
    vars[`--xlrh-bar-${key}-shadow`] = shadow;
}

function setAllBars(vars, color, shadow) {
    BAR_KEYS.forEach((key) => setBarColor(vars, key, color, shadow));
}

function setTopbar(vars, color, fill = hexToTopbarFill(color), border = hexToRgba(color, 0.8)) {
    vars["--xlrh-topbar-fill"] = fill;
    vars["--xlrh-topbar-border"] = border;
    vars["--xlrh-topbar-icon"] = hexToTopbarIconColor(color);
    vars["--xlrh-topbar-icon-hover"] = hexToTopbarIconHoverColor(color);
}

function launcherGlassVars() {
    return {
        "--xlrh-launcher-topbar-bg": "rgba(255, 255, 255, 0.06)",
        "--xlrh-launcher-settings-bg": "rgba(255, 255, 255, 0.06)",
        "--xlrh-launcher-settings-bg-hover": "rgba(255, 255, 255, 0.12)",
        "--xlrh-launcher-btn-bg": "rgba(255, 255, 255, 0.04)",
        "--xlrh-launcher-btn-bg-hover": "rgba(255, 255, 255, 0.08)",
        "--xlrh-launcher-btn-rh-hover-border": "rgba(120, 180, 255, 0.55)",
        "--xlrh-fg": "#e8e8e8",
        "--xlrh-muted": "rgba(255, 255, 255, 0.45)",
    };
}

function launcherTintVars(color) {
    return {
        "--xlrh-launcher-topbar-bg": hexToRgba(color, 0.1),
        "--xlrh-launcher-settings-bg": hexToRgba(color, 0.08),
        "--xlrh-launcher-settings-bg-hover": hexToRgba(color, 0.16),
        "--xlrh-launcher-btn-bg": hexToRgba(color, 0.07),
        "--xlrh-launcher-btn-bg-hover": hexToRgba(color, 0.14),
        "--xlrh-launcher-btn-rh-hover-border": hexToRgba(LAUNCHER_RH_ACCENT_HEX, 0.55),
        "--xlrh-fg": "#e8e8e8",
        "--xlrh-muted": "rgba(255, 255, 255, 0.45)",
    };
}

function launcherVars(config) {
    if (config.mode === THEME_MODE.PRESET && config.presetId === "glass") return launcherGlassVars();
    const presetColor = config.mode === THEME_MODE.PRESET ? findPreset(config.presetId)?.color : null;
    return launcherTintVars(isHexColor(presetColor) ? presetColor : DEFAULT_COLORS.topbar);
}

function applyDefaultBars(vars) {
    BAR_KEYS.forEach((key) => setBarColor(vars, key, DEFAULT_COLORS[key]));
    setTopbar(vars, DEFAULT_COLORS.topbar);
}

function applyPresetBars(vars, presetId) {
    if (presetId === "glass") {
        setAllBars(vars, GLASS_ACCENT, GLASS_SHADOW);
        setTopbar(vars, GLASS_ACCENT, "rgba(255, 255, 255, 0.14)", "rgba(255, 255, 255, 0.28)");
        return;
    }
    const color = findPreset(presetId)?.color || THEME_PRESETS[0].color;
    setAllBars(vars, color);
    setTopbar(vars, color);
}

export function computeThemeVariables(config) {
    const vars = {};
    if (config?.mode === THEME_MODE.PRESET && config.presetId) applyPresetBars(vars, config.presetId);
    else applyDefaultBars(vars);
    return { ...vars, ...launcherVars(config || defaultThemeConfig()) };
}

export function computeThemeVariablesForProduct(productId) {
    const base = computeThemeVariables(loadThemeConfig());
    if (productId !== PRODUCT_THEME_IDS.RUNNINGHUB) return base;

    const { useCustom, customColors } = loadProductAppearance(productId);
    if (!useCustom || Object.keys(customColors).length === 0) return base;

    const vars = { ...base };
    Object.entries(customColors).forEach(([key, color]) => {
        if (BAR_KEYS.includes(key) && isHexColor(color)) setBarColor(vars, key, color);
    });
    if (isHexColor(customColors.topbar)) setTopbar(vars, customColors.topbar);
    return vars;
}
