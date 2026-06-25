const storage = require("uxp").storage;
const shell = require("uxp").shell;
const os = require("os");

const fs = storage.localFileSystem;
const HEALTH_URL = "http://127.0.0.1:17861/health";
const SHUTDOWN_URL = "http://127.0.0.1:17861/shutdown";
const MONITOR_EXE = "bin/hw-monitor-server/xiaoliang-rh-hw-monitor.exe";
const HEALTH_TIMEOUT_MS = 900;
const SHUTDOWN_TIMEOUT_MS = 2000;
const LAUNCH_COOLDOWN_MS = 90000;

let lastLaunchAt = 0;

async function withTimeout(url, init, timeoutMs) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
        return await fetch(url, { ...init, signal: controller ? controller.signal : undefined });
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function getNestedEntry(root, relativePath) {
    const parts = String(relativePath).replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter(Boolean);
    let current = root;
    for (const [index, part] of parts.entries()) {
        try {
            current = await current.getEntry(part);
        } catch {
            return null;
        }
        if (!current || (index < parts.length - 1 && current.isFile)) return null;
    }
    return current;
}

async function getPluginFileEntry(pluginFolder, relativePath) {
    const normalized = String(relativePath).replace(/\\/g, "/").replace(/^\/+/, "");
    try {
        const direct = await pluginFolder.getEntry(normalized);
        if (direct?.isFile) return direct;
    } catch {
        // Some UXP versions do not resolve slash paths in one call.
    }
    const nested = await getNestedEntry(pluginFolder, normalized);
    return nested?.isFile ? nested : null;
}

async function openMonitorExecutable(pluginFolder) {
    const exe = await getPluginFileEntry(pluginFolder, MONITOR_EXE);
    if (!exe?.nativePath) {
        return {
            ok: false,
            detail: "missing_xiaoliang_rh_hw_monitor_exe",
            hint: "EXE 文件不存在，可能被安全软件隔离或删除；请恢复白名单后重试",
        };
    }
    await shell.openPath(exe.nativePath);
    console.info("[XiaoLiangRH][hw-monitor] 已请求启动 xiaoliang-rh-hw-monitor.exe");
    return { ok: true, launched: true };
}

async function isMonitorHealthy() {
    try {
        const response = await withTimeout(HEALTH_URL, { method: "GET" }, HEALTH_TIMEOUT_MS);
        return !!response?.ok;
    } catch {
        return false;
    }
}

export async function requestHwMonitorShutdown() {
    try {
        await withTimeout(SHUTDOWN_URL, { method: "POST" }, SHUTDOWN_TIMEOUT_MS);
        console.info("[XiaoLiangRH][hw-monitor] 已请求 17861/shutdown");
    } catch {
        // 未监听、超时或非小梁RH服务时静默忽略。
    }
}

export async function maybeStartHwMonitorServer(opts = {}) {
    if (await isMonitorHealthy()) {
        console.info("[XiaoLiangRH][hw-monitor] 17861/health ok，未启动新进程");
        return { ok: true, skipped: "already_running" };
    }

    if (!(os.platform && os.platform() === "win32")) {
        console.info("[XiaoLiangRH][hw-monitor] 自动拉起仅支持 Windows");
        return {
            ok: true,
            skipped: "non_windows",
            detail: "自动拉起监控仅支持 Windows；请在本机自行启动服务或使用 Python metrics-agent",
        };
    }

    const now = Date.now();
    if (opts.force !== true && now - lastLaunchAt < LAUNCH_COOLDOWN_MS) {
        console.info("[XiaoLiangRH][hw-monitor] 短时间内已尝试启动，跳过");
        return { ok: true, skipped: "cooldown", detail: "短时间内已尝试启动，请稍候或点设置中「重试启动」" };
    }
    lastLaunchAt = now;

    try {
        const pluginFolder = await fs.getPluginFolder();
        const result = await openMonitorExecutable(pluginFolder);
        if (result.ok && result.launched) return { ok: true, launched: true };
        console.warn(
            "[XiaoLiangRH][hw-monitor] 无法启动 EXE:",
            result.detail || "",
            result.hint || "",
            "请重新构建插件并确认 dist 内含 bin/hw-monitor-server/xiaoliang-rh-hw-monitor.exe"
        );
        return { ok: false, detail: result.detail || "exe_launch_failed", hint: result.hint || "" };
    } catch (error) {
        const detail = error?.message ? String(error.message) : String(error);
        console.warn("[XiaoLiangRH][hw-monitor] openPath exe 异常:", detail);
        return { ok: false, detail };
    }
}
