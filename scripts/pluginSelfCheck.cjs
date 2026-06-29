#!/usr/bin/env node
/* eslint-env node */

const fs = require("fs");
const path = require("path");
const { TextDecoder } = require("util");

const ROOT = path.resolve(__dirname, "..");
const CHECK_DIST = process.argv.includes("--dist");
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const TEXT_EXTS = new Set([".js", ".jsx", ".css", ".json", ".html", ".md", ".txt", ".cjs", ".mjs"]);
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const SKIP_FILES = new Set(["package-lock.json", "pluginSelfCheck.cjs"]);

const REQUIRED_PLUGIN_FILES = [
    "app.html",
    "index.html",
    "manifest.json",
    "icons/duck_toggle.png",
    "icons/icon.png",
    "icons/icon@2x.png",
    "icons/icon_24.png",
    "icons/icon_24@2x.png",
    "voices/小梁小梁图修好啦.mp3",
    "voices/小梁小梁图没修好.mp3",
];

const REQUIRED_PNG_SIZES = {
    "icons/icon.png": [23, 23],
    "icons/icon@2x.png": [46, 46],
    "icons/icon_24.png": [23, 23],
    "icons/icon_24@2x.png": [46, 46],
};

const codePoints = (...codes) => String.fromCodePoint(...codes);
const oldWord = (...codes) => ({ label: "old marker", value: codePoints(...codes) });

const OLD_BRAND_PATTERNS = [
    oldWord(0x48, 0x48),
    oldWord(0x48, 0x48, 0x50, 0x53),
    oldWord(0x60E0, 0x7ED8),
    oldWord(0x62, 0x61, 0x6E, 0x61, 0x6E, 0x61),
];

const BANANA_FEATURE_FILES = new Set([
    "src/components/ProductModeButton.jsx",
    "src/comfy/ComfyShell.jsx",
    "src/forge/ForgeShell.jsx",
    "src/hooks/usePersistedState.js",
    "src/runninghub/ui/RhWorkPanel.jsx",
    "src/runninghub/ui/RunninghubShell.jsx",
    "src/utils/dropdownFocusEffect.js",
    "src/utils/resultFolderTokens.js",
]);

function isAllowedBananaFeatureMarker(fileRel, marker) {
    return marker.value === "banana" && (fileRel.startsWith("src/banana/") || BANANA_FEATURE_FILES.has(fileRel));
}

const MOJIBAKE_FRAGMENTS = [
    codePoints(0x704F, 0x5FDD, 0x6CF5),
    codePoints(0x93BB, 0x63B2, 0x6B22),
    codePoints(0x93C8, 0x778F),
    codePoints(0x95C1, 0x70A9),
    codePoints(0x7F02, 0x4F5B),
];

const STALE_DIST_FILES = [
    `host/${"co"}mfyHiddenWebviewHost.js`,
    `host/${"co"}mfySdpppHostClient.js`,
    `host/${"co"}mfyTempUploadStore.js`,
];

let errorCount = 0;
let warnCount = 0;

function rel(p) {
    return path.relative(ROOT, p).replace(/\\/g, "/");
}

function reportError(message) {
    errorCount += 1;
    console.error(`[plugin-check][error] ${message}`);
}

function reportWarn(message) {
    warnCount += 1;
    console.warn(`[plugin-check][warn] ${message}`);
}

function walkFiles(start, out) {
    if (!fs.existsSync(start)) return;
    const stat = fs.statSync(start);
    if (stat.isDirectory()) {
        const base = path.basename(start);
        if (SKIP_DIRS.has(base)) return;
        for (const name of fs.readdirSync(start)) {
            if (!CHECK_DIST && name === "dist") continue;
            walkFiles(path.join(start, name), out);
        }
        return;
    }
    if (!stat.isFile()) return;
    if (SKIP_FILES.has(path.basename(start))) return;
    if (!TEXT_EXTS.has(path.extname(start).toLowerCase())) return;
    out.push(start);
}

function readUtf8Strict(file) {
    const bytes = fs.readFileSync(file);
    try {
        return UTF8_DECODER.decode(bytes);
    } catch (e) {
        reportError(`${rel(file)} is not valid UTF-8`);
        return null;
    }
}

function firstLine(text, predicate) {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
        if (predicate(lines[i])) return i + 1;
    }
    return 0;
}

function hasClassicMojibake(text) {
    return MOJIBAKE_FRAGMENTS.some((fragment) => text.includes(fragment));
}

function checkTextFiles() {
    const files = [];
    for (const target of ["src", "plugin", "scripts", "webpack.config.js", "package.json"]) {
        walkFiles(path.join(ROOT, target), files);
    }

    for (const file of files) {
        const fileRel = rel(file);
        const text = readUtf8Strict(file);
        if (text == null) continue;

        if (text.includes("\uFFFD")) {
            reportError(`${fileRel}:${firstLine(text, (s) => s.includes("\uFFFD")) || 1} contains replacement character`);
        }
        if (/[\uE000-\uF8FF]/u.test(text)) {
            reportError(`${fileRel}:${firstLine(text, (s) => /[\uE000-\uF8FF]/u.test(s)) || 1} contains private-use character`);
        }
        if (hasClassicMojibake(text)) {
            reportError(`${fileRel}:${firstLine(text, (s) => hasClassicMojibake(s)) || 1} contains classic mojibake`);
        }

        for (const marker of OLD_BRAND_PATTERNS) {
            if (text.includes(marker.value) && !isAllowedBananaFeatureMarker(fileRel, marker)) {
                const line = firstLine(text, (s) => s.includes(marker.value));
                reportError(`${fileRel}:${line || 1} contains old platform/author marker`);
            }
        }
    }
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (e) {
        reportError(`${rel(file)} is not valid JSON: ${e.message}`);
        return null;
    }
}

function checkManifest(baseDir) {
    const manifestPath = path.join(ROOT, baseDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
        reportError(`${baseDir}/manifest.json is missing`);
        return;
    }

    const manifest = readJson(manifestPath);
    if (!manifest) return;
    if (manifest.id !== "XiaoLiangRH") reportError(`${baseDir}/manifest.json id changed: ${manifest.id}`);
    if (manifest.name !== "小梁RH") reportError(`${baseDir}/manifest.json name must be 小梁RH, got ${manifest.name}`);

    const panel = Array.isArray(manifest.entrypoints)
        ? manifest.entrypoints.find((entry) => entry && entry.type === "panel")
        : null;
    if (!panel) reportError(`${baseDir}/manifest.json panel entrypoint is missing`);
    else if (panel.id !== "xiaoliangRhPanel") reportError(`${baseDir}/manifest.json panel id must remain xiaoliangRhPanel, got ${panel.id}`);
}

function checkPluginAssets() {
    for (const file of REQUIRED_PLUGIN_FILES) {
        if (!fs.existsSync(path.join(ROOT, "plugin", file))) reportError(`plugin/${file} is missing`);
    }
    checkPngSizes("plugin");
}

function checkDist() {
    const dist = path.join(ROOT, "dist");
    if (!fs.existsSync(dist)) {
        reportWarn("dist is missing; run npm.cmd run build to generate it");
        return;
    }
    checkManifest("dist");
    for (const file of STALE_DIST_FILES) {
        if (fs.existsSync(path.join(dist, file))) reportError(`dist contains stale file: ${file}`);
    }
    for (const file of REQUIRED_PLUGIN_FILES) {
        if (!fs.existsSync(path.join(dist, file))) reportError(`dist/${file} is missing`);
    }
    checkPngSizes("dist");
}

function checkPngSizes(baseDir) {
    for (const [file, [expectedWidth, expectedHeight]] of Object.entries(REQUIRED_PNG_SIZES)) {
        const fullPath = path.join(ROOT, baseDir, file);
        if (!fs.existsSync(fullPath)) continue;
        const buffer = fs.readFileSync(fullPath);
        const validPng = buffer.length >= 24
            && buffer.toString("ascii", 1, 4) === "PNG"
            && buffer.readUInt32BE(12) === 0x49484452;
        if (!validPng) {
            reportError(`${baseDir}/${file} is not a valid PNG`);
            continue;
        }
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        if (width !== expectedWidth || height !== expectedHeight) {
            reportError(`${baseDir}/${file} must be ${expectedWidth}x${expectedHeight}, got ${width}x${height}`);
        }
    }
}

function main() {
    checkTextFiles();
    checkManifest("plugin");
    checkPluginAssets();
    if (CHECK_DIST) checkDist();
    if (warnCount > 0) console.warn(`[plugin-check] warnings: ${warnCount}`);
    if (errorCount > 0) {
        console.error(`[plugin-check] failed: ${errorCount} error(s)`);
        process.exit(1);
    }
    console.log(`[plugin-check] ok${warnCount ? ` (${warnCount} warning(s))` : ""}`);
}

main();
