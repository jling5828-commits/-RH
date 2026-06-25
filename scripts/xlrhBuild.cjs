#!/usr/bin/env node
/* eslint-env node */

const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const WEBPACK_BIN = path.join(ROOT, "node_modules", "webpack", "bin", "webpack.js");
const SELF_CHECK = path.join(ROOT, "scripts", "pluginSelfCheck.cjs");

const rawArgs = process.argv.slice(2);
const modeArg = rawArgs.find((arg) => arg === "development" || arg === "production") || "development";
const verifyDist = rawArgs.includes("--verify-dist");

function runNodeScript(script, args = []) {
    const result = spawnSync(process.execPath, [script, ...args], {
        cwd: ROOT,
        env: { ...process.env, NODE_ENV: modeArg === "production" ? "production" : process.env.NODE_ENV || "development" },
        stdio: "inherit",
    });
    if (result.error) {
        console.error(`[xlrh-build] ${path.basename(script)} failed to start: ${result.error.message}`);
        process.exit(1);
    }
    if (result.status !== 0) process.exit(result.status || 1);
}

runNodeScript(SELF_CHECK);
runNodeScript(WEBPACK_BIN, ["--mode", modeArg]);
if (verifyDist) runNodeScript(SELF_CHECK, ["--dist"]);
