// src/hooks/usePersistedState.js
import { useCallback, useState } from "react";
import { setShrinkPersistBypass } from "../bridge/persistentStorage.js";
import { THEME_STORAGE_KEY, APPEARANCE_RUNNINGHUB_KEY } from "../utils/themeConfig.js";
import {
    expandCompatStorageKeys,
    readCompatLocalStorage,
    writeCompatLocalStorage,
} from "../utils/storageKeyCompat.js";

function resolveDefaultValue(defaultValue) {
    return typeof defaultValue === "function" ? defaultValue() : defaultValue;
}

function readStoredJson(key, defaultValue) {
    try {
        const saved = readCompatLocalStorage(key);
        return saved !== null ? JSON.parse(saved) : resolveDefaultValue(defaultValue);
    } catch (_) {
        return resolveDefaultValue(defaultValue);
    }
}

function writeStoredJson(key, value) {
    try {
        writeCompatLocalStorage(key, JSON.stringify(value));
    } catch (error) {
        console.warn(`[usePersistedState] 写入 ${key} 失败:`, error);
    }
}

export function usePersistedState(key, defaultValue) {
    const [value, setValue] = useState(() => readStoredJson(key, defaultValue));

    const setPersisted = useCallback(
        (nextValue) => {
            setValue((previousValue) => {
                const resolved = typeof nextValue === "function" ? nextValue(previousValue) : nextValue;
                writeStoredJson(key, resolved);
                return resolved;
            });
        },
        [key]
    );

    return [value, setPersisted];
}

const KEEP_KEY_GROUPS = [
    ["xlrh_mode", "xlrh_credits_max", "xlrh_input_font_size", "xlrh_plugin_version"],
    ["xlrh_bg_image", "xlrh_bg_opacity", "xlrh_bg_blur", "xlrh_card_opacity"],
    [THEME_STORAGE_KEY, APPEARANCE_RUNNINGHUB_KEY],
    ["resultFolderToken"],
    ["xlrh_presets", "xlrh_presets_version", "xlrh_presets_v2", "xlrh_presets_initialized_v2"],
    ["rh_app_presets_v1"],
    ["xlrh_prompt", "xlrh_model", "xlrh_ratio", "xlrh_size", "xlrh_size_by_model", "xlrh_count"],
    ["xlrh_active_preset2", "xlrh_active_category2"],
    ["xlrh_card_order", "xlrh_settings_card_order", "xlrh_about_card_order"],
    [
        "xlrh_drawer_trigger_reverse",
        "xlrh_drawer_trigger_assistant",
        "xlrh_drawer_trigger_edit_assistant",
        "xlrh_drawer_trigger_upscale",
        "xlrh_use_drawer_bottom_dock",
    ],
    ["xlrh_analytics_anon_id", "xlrh_analytics_last_load"],
    ["xlrh_history_reverse", "xlrh_history_polish", "xlrh_history_chat", "xlrh_history_evaluate"],
    ["xlrh_last_product", "xlrh_skip_launcher_on_start", "xlrh_always_show_launcher"],
    [
        "rh_current_page",
        "rh_custom_bg_enabled",
        "rh_custom_bg_image",
        "rh_custom_bg_opacity",
        "rh_custom_bg_blur",
        "rh_theme_color_start",
        "rh_theme_color_end",
        "rh_opacity",
        "rh_blur",
        "rh_text_color",
        "rh_appearance_defaults_v2",
        "rh_auto_return_enabled",
        "rh_image_long_edge_max",
        "rh_upload_image_format",
        "rh_success_sound_file",
        "rh_fail_sound_file",
        "rh_sound_defaults_v2",
        "rh_api_key",
        "rh_webapp_id",
        "rh_saved_apps",
        "rh_settings_card_order",
        "rh_saved_apps_builtin_merged_v1",
        "rh_saved_apps_builtin_merged_v2",
        "rh_saved_apps_builtin_merged_v4",
        "rh_default_preset_bundle_applied",
        "rh_card_order_appearance_bottom_applied",
    ],
];

function collectKeepKeys() {
    return expandCompatStorageKeys(KEEP_KEY_GROUPS.flat().filter(Boolean));
}

function stackSummaryForClear() {
    try {
        return String(new Error().stack || "")
            .split("\n")
            .slice(1, 5)
            .map((line) => line.trim())
            .join(" | ");
    } catch (_) {
        return "";
    }
}

function storageKeysToClear(keepKeys) {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key || keepKeys.has(key) || key.startsWith("resultFolderTokenOverride:")) continue;
        keys.push(key);
    }
    return keys;
}

function removeLocalStorageKeys(keys) {
    keys.forEach((key) => localStorage.removeItem(key));
}

export function clearAllPersistedState(reason = "unknown") {
    const keepKeys = collectKeepKeys();
    const keysToRemove = storageKeysToClear(keepKeys);
    console.warn("[clearAllPersistedState] invoked", { reason, stackSummary: stackSummaryForClear() });

    setShrinkPersistBypass(true);
    try {
        removeLocalStorageKeys(keysToRemove);
    } finally {
        setTimeout(() => setShrinkPersistBypass(false), 900);
    }

    console.warn(
        `[clearAllPersistedState] removed=${keysToRemove.length}`,
        keysToRemove.slice(0, 20)
    );
}
