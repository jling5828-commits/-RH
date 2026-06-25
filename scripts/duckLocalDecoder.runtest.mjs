import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeDuckImageBytes } from "../plugin/host/duckLocalDecoder.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(repoRoot, "..");

async function exists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function expectDuckDecode(filePath, label) {
    const bytes = await fs.readFile(filePath);
    const decoded = await decodeDuckImageBytes(bytes, "image/png");
    assert.equal(decoded.ok, true, `${label} should decode: ${decoded.reason || ""} ${decoded.error || ""}`);
    assert.equal(decoded.ext, "png", `${label} should recover png payload`);
    assert.ok(decoded.bytes?.length > 0, `${label} should return recovered bytes`);
    console.log(`${label}: ok ${decoded.width}x${decoded.height}, payload ${decoded.bytes.length} bytes, k=${decoded.bitDepth}`);
}

await expectDuckDecode(path.join(workspaceRoot, "SS_tools-main", "test.png"), "SS_tools-main/test.png");

const largeSample = process.env.DUCK_LARGE_SAMPLE || "C:\\Users\\Liang\\Desktop\\F2K放大自_小梁RH_20260611161509_1.png";
if (await exists(largeSample)) {
    await expectDuckDecode(largeSample, path.basename(largeSample));
} else {
    console.log(`large sample skipped: ${largeSample}`);
}
