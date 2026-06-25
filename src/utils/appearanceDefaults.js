const BACKDROP_LIMIT_BYTES = 4 * 1024 * 1024;

const APPEARANCE_DEFAULT_PAIRS = [
    ["bgBlur", 2],
    ["bgOpacity", 0.5],
    ["cardOpacity", 0.3],
];

export const APPEARANCE_DEFAULTS = Object.freeze(Object.fromEntries(APPEARANCE_DEFAULT_PAIRS));

export const APPEARANCE_SNAP_BLUR_EPS = 0.22;
export const APPEARANCE_SNAP_PERCENT_EPS = 4;
export const LAUNCHER_BG_MAX_DATA_URL_LENGTH = BACKDROP_LIMIT_BYTES;

export function createAppearanceDefaults() {
    return Object.fromEntries(APPEARANCE_DEFAULT_PAIRS);
}
