const context = require.context("../../plugin/forge_presets", false, /\.json$/);

export const DEFAULT_FORGE_PRESET_FILES = Object.freeze(
    context.keys().sort((a, b) => a.localeCompare(b, "zh-Hans-CN")).map((key) => ({
        fileName: key.replace(/^\.\//, ""),
        preset: context(key),
    }))
);
