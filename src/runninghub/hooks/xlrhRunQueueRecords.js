const RH_QUEUE_RECOVERY_KEY = "rh_task_queue_recovery_v1";
const RH_QUEUE_RECOVERY_LIMIT = 12;

export const XLRH_RUN_DONE_RETAIN_MS = 60 * 1000;
export const XLRH_RECOVERED_RUN_MESSAGE = "上次关闭时任务可能仍在 RunningHub 运行，请到 RunningHub 或返图目录确认结果";

function objectOrNull(value) {
    return value && typeof value === "object" ? value : null;
}

function finiteNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function copyUploadSlot(slotRaw) {
    const slot = objectOrNull(slotRaw) || {};
    return {
        fileName: slot.fileName,
        mimeType: slot.mimeType,
        uploadWidth: slot.uploadWidth,
        uploadHeight: slot.uploadHeight,
        uploadFormat: slot.uploadFormat,
        uploadByteLength: slot.uploadByteLength,
        aspectRatio: slot.aspectRatio,
    };
}

export function compactRunSnapshot(snapshot) {
    const snap = objectOrNull(snapshot);
    if (!snap) return null;
    const pendingUploads = {};
    const uploads = objectOrNull(snap.pendingUploads) || {};
    for (const [key, slot] of Object.entries(uploads)) {
        pendingUploads[key] = copyUploadSlot(slot);
    }
    return {
        kind: snap.kind,
        appMetaName: snap.appMetaName,
        webappIdTrim: snap.webappIdTrim,
        apiKeyModeLabel: snap.apiKeyModeLabel,
        uploadEstimate: snap.uploadEstimate,
        pendingUploads,
    };
}

export function compactRunResult(detail) {
    const rd = objectOrNull(detail);
    if (!rd) return null;
    return {
        message: rd.message,
        secondaryMessage: rd.secondaryMessage,
        saved: rd.saved,
        images: rd.images,
        time: rd.time,
        cost: rd.cost,
        errors: Array.isArray(rd.errors) ? rd.errors.slice(0, 5).map((error) => String(error).slice(0, 180)) : [],
    };
}

export function withDisplayImageCount(detail) {
    const rd = objectOrNull(detail);
    if (!rd) return detail ?? null;
    const images = rd.images ?? rd.saved;
    return images == null ? { ...rd } : { ...rd, images };
}

export function toRecoverableRun(run, { restored = false } = {}) {
    const src = objectOrNull(run);
    if (!src) return null;
    const originalStatus = src.status || "warning";
    const recoveringActiveRun = restored && originalStatus === "running";
    const status = recoveringActiveRun ? "warning" : originalStatus;
    const startTime = finiteNumber(src.startTime, Date.now()) || Date.now();
    const completedAt = src.completedAt
        ? finiteNumber(src.completedAt, Date.now())
        : recoveringActiveRun || (status !== "running" && status !== "cancelled")
          ? Date.now()
          : undefined;
    const elapsedSec = finiteNumber(src.elapsedSec, completedAt ? (completedAt - startTime) / 1000 : 0);

    return {
        id: String(src.id || `rh_recovered_${startTime}`),
        status,
        progress: status === "running" ? finiteNumber(src.progress, 0) : 100,
        message: recoveringActiveRun ? XLRH_RECOVERED_RUN_MESSAGE : (src.message || src.stageText || ""),
        stageText: recoveringActiveRun ? "本地队列已恢复" : (src.stageText || ""),
        elapsedSec,
        startTime,
        completedAt,
        stepPercent: null,
        resultDetail: recoveringActiveRun
            ? { message: XLRH_RECOVERED_RUN_MESSAGE, saved: 0, images: 0, time: null, cost: null, errors: [] }
            : compactRunResult(src.resultDetail),
        isBatch: !!src.isBatch,
        taskCount: src.taskCount ?? 1,
        docName: src.docName ?? "—",
        presetName: src.presetName ?? "—",
        size: src.size ?? "—",
        uploadEstimate: src.uploadEstimate || src.snapshot?.uploadEstimate || "",
        apiKeyModeLabel: src.apiKeyModeLabel || src.snapshot?.apiKeyModeLabel || "",
        taskId: src.taskId || "",
        snapshot: compactRunSnapshot(src.snapshot),
        placeStatus: src.placeStatus || undefined,
        placeError: src.placeError || undefined,
        placeSavedFileNames: Array.isArray(src.placeSavedFileNames) ? src.placeSavedFileNames.map(String) : undefined,
        placeBounds: src.placeBounds || undefined,
        placeToken: src.placeToken || undefined,
        placeDocId: src.placeDocId ?? undefined,
        placeGroupName: src.placeGroupName || undefined,
        recovered: restored,
    };
}

export function loadRecoveredRhRuns() {
    try {
        if (typeof localStorage !== "undefined") localStorage.removeItem(RH_QUEUE_RECOVERY_KEY);
    } catch (_) {
        // Queue recovery is intentionally disabled.
    }
    return [];
}

export function saveRecoveredRhRuns(runs) {
    try {
        if (typeof localStorage === "undefined") return;
        localStorage.removeItem(RH_QUEUE_RECOVERY_KEY);
    } catch (_) {
        // Queue recovery is intentionally disabled.
    }
}

export function countRhRunning(runs) {
    return (Array.isArray(runs) ? runs : []).filter((run) => run?.status === "running").length;
}

export function latestRhRun(runs) {
    return Array.isArray(runs) && runs.length > 0 ? runs[runs.length - 1] : null;
}

export function compactRhRuns(runs) {
    return Array.isArray(runs) && runs.length >= 2 ? runs.slice(0, -1) : [];
}

export function appendXlrhRun(runs, entry) {
    const list = Array.isArray(runs) ? runs : [];
    const tail = list[list.length - 1];
    const replaceTail = tail && tail.status !== "running" && tail.placeStatus !== "pending";
    return replaceTail ? [...list.slice(0, -1), entry] : [...list, entry];
}

export function pruneCompletedRhRuns(runs, retainMs = XLRH_RUN_DONE_RETAIN_MS, now = Date.now()) {
    const list = Array.isArray(runs) ? runs : [];
    const cutoff = Number(now) - Number(retainMs);
    let changed = false;
    const next = [];
    for (const run of list) {
        if (!run || run.status === "running" || run.status === "cancelled") {
            next.push(run);
            continue;
        }
        if (run.status !== "success" && run.status !== "error") {
            next.push(run);
            continue;
        }
        const completedAt = Number(run.completedAt);
        if (Number.isFinite(completedAt) && completedAt <= cutoff) {
            changed = true;
            continue;
        }
        next.push(run);
    }
    return changed ? next : list;
}

function newRhRunId(seed = "") {
    const suffix = Math.random().toString(36).slice(2, 8);
    return seed ? `rh_${seed}_${suffix}` : `rh_${Date.now()}_${suffix}`;
}

export function makeRhRunPlan(meta, options = {}) {
    const runId = options.runId || newRhRunId(options.seed);
    const abortController = options.abortController || new AbortController();
    const startTime = options.startTime || Date.now();
    const runMeta = { ...(meta || {}) };
    const snapshot = objectOrNull(runMeta.snapshot) || runMeta.snapshot;
    const isBatch = !!runMeta.isBatch;
    const preparingText = isBatch ? "批处理准备中..." : "准备中...";

    return {
        runId,
        abortController,
        startTime,
        meta: runMeta,
        entry: {
            id: runId,
            status: "running",
            progress: 0,
            message: preparingText,
            stageText: preparingText,
            elapsedSec: 0,
            startTime,
            stepPercent: null,
            resultDetail: null,
            abortController,
            isBatch,
            taskCount: runMeta.taskCount ?? 1,
            docName: runMeta.docName ?? "—",
            presetName: runMeta.presetName ?? "—",
            size: runMeta.size ?? "—",
            uploadEstimate: runMeta.uploadEstimate ?? snapshot?.uploadEstimate ?? "",
            apiKeyModeLabel: runMeta.apiKeyModeLabel ?? snapshot?.apiKeyModeLabel ?? "",
            snapshot,
        },
    };
}

export function makeRhBatchPlans(items) {
    const base = Date.now();
    return (Array.isArray(items) ? items : []).map((item, index) =>
        makeRhRunPlan({ ...(item || {}), isBatch: false, taskCount: 1 }, { seed: `${base}_${index}`, startTime: Date.now() })
    );
}
