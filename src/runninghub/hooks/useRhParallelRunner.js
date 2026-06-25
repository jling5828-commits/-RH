import { useCallback, useEffect, useRef, useState } from "react";
import { playSound, playSoundFail } from "../../utils/playSound.js";
import { reportGenerateOutcome } from "../../utils/analytics.js";
import {
    XLRH_RUN_DONE_RETAIN_MS,
    appendXlrhRun,
    compactRhRuns,
    countRhRunning,
    latestRhRun,
    loadRecoveredRhRuns,
    makeRhBatchPlans,
    makeRhRunPlan,
    saveRecoveredRhRuns,
    withDisplayImageCount,
} from "./xlrhRunQueueRecords.js";
import {
    makeRhInvocationDetail,
    makeRhOperationState,
    rhReportPayload,
    toastForRhStatus,
} from "./xlrhRunQueueDisplay.js";

export const RH_MAX_CONCURRENT = 8;

function acceptedStatus(value) {
    return value === "success" || value === "error" || value === "warning" || value === "cancelled" ? value : "error";
}

function elapsedSeconds(startTime) {
    return (Date.now() - startTime) / 1000;
}

function isAbortLike(error, signal) {
    const message = error?.message ? String(error.message) : String(error || "");
    return signal?.aborted || /取消|cancelled|aborted/i.test(message);
}

function updateRunById(setRuns, runId, patch) {
    setRuns((runs) => runs.map((run) => (run.id === runId ? { ...run, ...patch } : run)));
}

function pickStartCapacity(runs, wanted) {
    const room = RH_MAX_CONCURRENT - countRhRunning(runs);
    return room <= 0 ? 0 : Math.min(wanted, room);
}

/**
 * @param {object} opts
 * @param {(msg: string, dur?: number) => void} opts.pushStatus
 * @param {(rec: { mode: string, timestamp: number, isBatch?: boolean, resultDetail?: object }) => void} [opts.pushInvocation]
 * @param {string} [opts.successSoundFile]
 * @param {string} [opts.failSoundFile]
 * @param {(ctx: {
 *   runId: string,
 *   snapshot: unknown,
 *   signal: AbortSignal,
 *   updateRun: (u: Record<string, unknown>) => void,
 *   startTime: number,
 * }) => Promise<{ status: string; resultDetail?: object | null; elapsedSec: number }>} opts.runExecutor
 */
export function useRhParallelRunner({ pushStatus, pushInvocation, runExecutor, successSoundFile, failSoundFile }) {
    const [activeRuns, setActiveRuns] = useState(() => loadRecoveredRhRuns());
    const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
    const [cancelTargetId, setCancelTargetId] = useState(null);
    const runExecutorRef = useRef(runExecutor);
    const recoveryToastShownRef = useRef(false);

    runExecutorRef.current = runExecutor;

    const runningCount = countRhRunning(activeRuns);
    const isRunning = runningCount > 0;
    const latestRun = latestRhRun(activeRuns);
    const runsForCompact = compactRhRuns(activeRuns);
    const latestRunIdForCancel = latestRun?.status === "running" ? latestRun.id : null;
    const opState = makeRhOperationState(latestRun);

    const updateRun = useCallback((runId, updates) => {
        updateRunById(setActiveRuns, runId, updates);
    }, []);

    useEffect(() => {
        if (!isRunning) return undefined;
        const tick = () => {
            setActiveRuns((runs) =>
                runs.map((run) =>
                    run.status === "running"
                        ? { ...run, elapsedSec: elapsedSeconds(run.startTime) }
                        : run
                )
            );
        };
        tick();
        const timer = setInterval(tick, 100);
        return () => clearInterval(timer);
    }, [isRunning]);

    useEffect(() => {
        saveRecoveredRhRuns(activeRuns);
    }, [activeRuns]);

    useEffect(() => {
        if (recoveryToastShownRef.current) return;
        const restored = activeRuns.filter((run) => run.recovered).length;
        if (restored <= 0) return;
        recoveryToastShownRef.current = true;
        pushStatus(`已恢复 ${restored} 条上次任务记录，请确认返图目录或 RunningHub 任务结果`, 7000);
    }, [activeRuns, pushStatus]);

    const finishRun = useCallback(
        (runId, meta, result, startTime) => {
            const status = acceptedStatus(result?.status);
            const resultDetail = withDisplayImageCount(result?.resultDetail);
            const elapsedSec = result?.elapsedSec ?? elapsedSeconds(startTime);
            updateRun(runId, {
                ...result,
                status,
                resultDetail,
                elapsedSec,
                completedAt: Date.now(),
            });

            if (status === "success") playSound({ fileName: successSoundFile });
            if (status === "error" || status === "warning") playSoundFail({ fileName: failSoundFile });

            const toast = toastForRhStatus(status, resultDetail);
            pushStatus(toast.message, toast.duration);
            reportGenerateOutcome(rhReportPayload({
                status,
                snapshot: meta.snapshot,
                resultDetail,
                isBatch: meta.isBatch,
            }));
            pushInvocation?.({
                mode: "runninghub",
                timestamp: Date.now(),
                isBatch: !!meta.isBatch,
                resultDetail: makeRhInvocationDetail(status, resultDetail, elapsedSec, false),
            });
        },
        [failSoundFile, pushStatus, pushInvocation, successSoundFile, updateRun]
    );

    const failRun = useCallback(
        (runId, meta, error, abortController, startTime) => {
            const message = error?.message || "未知错误";
            const cancelled = isAbortLike(error, abortController.signal);
            const elapsedSec = elapsedSeconds(startTime);
            const resultDetail = cancelled
                ? null
                : { message, saved: 0, images: 0, time: null, cost: null, errors: [message] };

            updateRun(runId, {
                status: cancelled ? "cancelled" : "error",
                resultDetail,
                elapsedSec,
                completedAt: cancelled ? undefined : Date.now(),
            });

            if (!cancelled) {
                playSoundFail({ fileName: failSoundFile });
                pushStatus(message, 6000);
            }
            reportGenerateOutcome(rhReportPayload({
                status: cancelled ? "cancelled" : "error",
                snapshot: meta.snapshot,
                resultDetail,
                isBatch: meta.isBatch,
                cancelled,
                failMessage: message,
            }));
            pushInvocation?.({
                mode: "runninghub",
                timestamp: Date.now(),
                isBatch: !!meta.isBatch,
                resultDetail: makeRhInvocationDetail(
                    cancelled ? "cancelled" : "error",
                    cancelled ? { message: "已取消" } : resultDetail,
                    elapsedSec,
                    cancelled,
                    message
                ),
            });
        },
        [failSoundFile, pushStatus, pushInvocation, updateRun]
    );

    const beginRunLifecycle = useCallback(
        (plan) => {
            const { runId, meta, abortController, startTime } = plan;
            const updateOneRun = (updates) => updateRun(runId, updates);
            runExecutorRef
                .current({
                    runId,
                    snapshot: meta.snapshot,
                    signal: abortController.signal,
                    updateRun: updateOneRun,
                    startTime,
                })
                .then((result) => finishRun(runId, meta, result, startTime))
                .catch((error) => failRun(runId, meta, error, abortController, startTime));
        },
        [finishRun, failRun, updateRun]
    );

    const handleCancelRun = useCallback((runId) => {
        setCancelTargetId(runId);
        setCancelDialogOpen(true);
    }, []);

    const confirmCancelRun = useCallback(() => {
        if (cancelTargetId) {
            setActiveRuns((runs) => {
                const target = runs.find((run) => run.id === cancelTargetId);
                try {
                    target?.abortController?.abort?.();
                } catch (_) {
                    // Abort is best-effort.
                }
                return runs.map((run) => (run.id === cancelTargetId ? { ...run, status: "cancelled" } : run));
            });
            pushStatus("已取消任务", 3000);
        }
        setCancelTargetId(null);
        setCancelDialogOpen(false);
    }, [cancelTargetId, pushStatus]);

    const dismissCancelDialog = useCallback(() => {
        setCancelTargetId(null);
        setCancelDialogOpen(false);
    }, []);

    const handleDismissRun = useCallback((runId) => {
        setActiveRuns((runs) => runs.filter((run) => run.id !== runId));
    }, []);

    const retryPlaceForRun = useCallback(
        async (runId) => {
            const run = activeRuns.find((item) => item.id === runId);
            if (!run || run.placeStatus !== "pending") {
                console.warn("[useRhParallelRunner] cannot retry place: run is not pending");
                return;
            }
            if (!run.placeSavedFileNames || !run.placeToken) {
                updateRun(runId, { placeStatus: "failed", placeError: "缺少贴回参数" });
                return;
            }

            try {
                pushStatus("正在重试贴回图片...", 3000);
                const { performAutoPlace } = await import("../../utils/autoPlace.js");
                await performAutoPlace(
                    run.placeSavedFileNames,
                    run.placeGroupName || "RunningHub 生成",
                    run.placeBounds,
                    run.placeToken,
                    run.placeDocId,
                    { force: true }
                );
                updateRun(runId, { placeStatus: "placed", placeError: null });
                pushStatus("贴回成功", 3000);
            } catch (error) {
                console.warn("[useRhParallelRunner] retry place failed:", error);
                const canRetry = error && typeof error === "object" && error.canRetry === true;
                const reason = error && typeof error === "object" && error.reason ? String(error.reason) : String(error);
                updateRun(runId, canRetry ? { placeError: reason } : { placeStatus: "failed", placeError: reason });
                pushStatus(canRetry ? "仍无法贴图，请稍后重试" : `贴回失败：${reason}`, canRetry ? 4000 : 5000);
            }
        },
        [activeRuns, pushStatus, updateRun]
    );

    const enqueueRun = useCallback(
        (meta) => {
            const plan = makeRhRunPlan(meta);
            let accepted = false;
            setActiveRuns((runs) => {
                if (pickStartCapacity(runs, 1) <= 0) return runs;
                accepted = true;
                return appendXlrhRun(runs, plan.entry);
            });

            if (!accepted) {
                pushStatus(`最多同时 ${RH_MAX_CONCURRENT} 个 RunningHub 任务，请等待或取消后再试`, 5000);
                return;
            }

            pushStatus(meta?.isBatch ? "RunningHub 批处理运行中..." : "RunningHub 任务运行中...", 0);
            beginRunLifecycle(plan);
        },
        [pushStatus, beginRunLifecycle]
    );

    const enqueueBatchItemRuns = useCallback(
        async (items, options = {}) => {
            if (!items?.length) return 0;
            const plans = makeRhBatchPlans(items);
            const staggerMs = typeof options.staggerMs === "number" && options.staggerMs > 0 ? options.staggerMs : 0;
            let toStart = [];

            setActiveRuns((runs) => {
                const take = pickStartCapacity(runs, plans.length);
                if (take <= 0) return runs;
                toStart = plans.slice(0, take);
                return toStart.reduce((next, plan) => appendXlrhRun(next, plan.entry), runs);
            });

            if (toStart.length === 0) {
                pushStatus(`最多同时 ${RH_MAX_CONCURRENT} 个 RunningHub 任务，请等待或取消后再试`, 5000);
                return 0;
            }

            pushStatus(`RunningHub：已提交 ${toStart.length} 个并行任务...`, 0);
            for (let index = 0; index < toStart.length; index += 1) {
                if (staggerMs > 0 && index > 0) {
                    await new Promise((resolve) => setTimeout(resolve, staggerMs));
                }
                beginRunLifecycle(toStart[index]);
            }
            return toStart.length;
        },
        [pushStatus, beginRunLifecycle]
    );

    return {
        isRunning,
        runningCount,
        activeRuns,
        runsForCompact,
        fakeProgressByRun: {},
        completedRetainSec: XLRH_RUN_DONE_RETAIN_MS / 1000,
        opState,
        cancelDialogOpen,
        dismissCancelDialog,
        confirmCancelRun,
        handleCancelRun,
        handleDismissRun,
        retryPlaceForRun,
        enqueueRun,
        enqueueBatchItemRuns,
        latestRunIdForCancel,
    };
}
