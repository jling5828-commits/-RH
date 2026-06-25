const RH_ANALYTICS_CHANNEL = "runninghub";

function detailObject(value) {
    return value && typeof value === "object" ? value : {};
}

function firstError(detail) {
    return Array.isArray(detail.errors) && detail.errors.length > 0 ? String(detail.errors[0]) : "";
}

function runTimeText(elapsedSec) {
    return elapsedSec != null ? `${Number(elapsedSec).toFixed(1)}s` : null;
}

export function buildRhAnalyticsSuccessNote(snapshot, resultDetail, isBatch) {
    const rd = detailObject(resultDetail);
    const saved = rd.saved ?? rd.images ?? 0;
    const time = rd.time != null ? String(rd.time) : "";
    const core = (isBatch ? `共 ${saved} 张 ${time}` : `${saved} 张 ${time}`).trim();
    const snap = detailObject(snapshot);
    const appName = snap.appMetaName != null ? String(snap.appMetaName).trim() : "";
    const appId = snap.webappIdTrim != null ? String(snap.webappIdTrim).trim() : "";
    const name = appName && appName !== "—" ? appName : "";
    const id = appId && appId !== "—" ? appId : "";
    if (!name && !id) return core;
    return `${name && id ? `${name} ${id}` : name || id} / ${core}`.trim();
}

export function makeRhInvocationDetail(status, resultDetail, elapsedSec, caughtCancelled = false, caughtMessage = "") {
    const rd = detailObject(resultDetail);
    if (caughtCancelled || status === "cancelled") {
        return {
            message: "已取消",
            images: 0,
            time: rd.time != null ? String(rd.time) : runTimeText(elapsedSec),
            cost: null,
            errors: [],
            secondaryMessage: rd.secondaryMessage,
        };
    }
    if (status === "success") {
        return {
            message: rd.message,
            images: rd.images ?? rd.saved ?? 0,
            time: rd.time != null ? String(rd.time) : null,
            cost: rd.secondaryMessage != null ? String(rd.secondaryMessage) : rd.cost,
            errors: rd.errors,
            secondaryMessage: rd.secondaryMessage,
        };
    }
    return {
        message: rd.message || caughtMessage || "失败",
        images: rd.images ?? rd.saved ?? 0,
        time: rd.time != null ? String(rd.time) : runTimeText(elapsedSec),
        cost: rd.secondaryMessage != null ? String(rd.secondaryMessage) : rd.cost,
        errors: Array.isArray(rd.errors) ? rd.errors : rd.message ? [String(rd.message)] : [],
        secondaryMessage: rd.secondaryMessage,
    };
}

export function makeRhOperationState(run) {
    if (!run) {
        return {
            progress: 0,
            statusText: "",
            stageText: "",
            statusType: "idle",
            resultDetail: null,
            elapsedSec: null,
            docName: "",
            presetName: "",
            size: "—",
            taskCount: 1,
        };
    }

    const result = detailObject(run.resultDetail);
    const isCancelled = run.status === "cancelled";
    const statusType = isCancelled ? "warning" : run.status;
    let statusText = isCancelled ? "任务已取消" : (result.message ?? run.message ?? "处理中...");
    const error = firstError(result);
    if ((run.status === "error" || run.status === "warning") && error && !statusText.includes(error)) {
        statusText += `（${error.slice(0, 80)}）`;
    }

    const operationDetail = run.resultDetail
        ? {
              message: result.message,
              secondaryMessage: result.secondaryMessage,
              images: result.images ?? result.saved,
              time: result.time,
              cost: result.cost,
              errors: result.errors,
          }
        : isCancelled
          ? { message: "任务已取消（已尝试通知 RunningHub 终止；扣费以平台为准）" }
          : null;

    return {
        progress: run.status === "running" ? (run.progress ?? 0) : 100,
        statusText,
        stageText: run.status === "running" ? run.stageText : "",
        statusType,
        resultDetail: operationDetail,
        elapsedSec: run.elapsedSec,
        docName: run.docName ?? "",
        presetName: run.presetName ?? "",
        size: run.size ?? "—",
        taskCount: run.taskCount ?? 1,
    };
}

export function toastForRhStatus(status, resultDetail) {
    const rd = detailObject(resultDetail);
    if (status === "success") {
        const message = rd.message ? String(rd.message) : "完成";
        return { message, duration: message.includes("小黄鸭") ? 15000 : 4000 };
    }
    if (status === "cancelled") return { message: "已取消", duration: 4000 };
    if (status === "warning") return { message: "部分完成", duration: 4000 };
    return { message: "失败", duration: 4000 };
}

export function rhReportPayload({ status, snapshot, resultDetail, isBatch, cancelled, failMessage }) {
    return {
        status,
        channel: RH_ANALYTICS_CHANNEL,
        cancelled: cancelled || status === "cancelled",
        resultDetail,
        successNote: status === "success" ? buildRhAnalyticsSuccessNote(snapshot, resultDetail, !!isBatch) : undefined,
        failNote:
            status === "error" || status === "warning"
                ? String(firstError(detailObject(resultDetail)) || resultDetail?.message || failMessage || "未知失败")
                : undefined,
    };
}
