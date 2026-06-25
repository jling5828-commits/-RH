import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import "./Operation.css";
import {
    RhDocAppRhMeta,
    rhBuildMetaLineFull,
    rhMainDisplayMsg,
    rhSubLinePlainText,
    rhShouldShowMetaSecondRow,
    rhPopupSecondaryText,
    RH_SUCCESS_TEXT,
} from "./operation/rhOperationLines.jsx";

const FINISHED_STATUSES = new Set(["success", "error", "warning"]);
const COMPACT_DISMISS_MS = 280;

function layerPortal(children) {
    return typeof document !== "undefined" && document.body ? createPortal(children, document.body) : children;
}

function cls(...parts) {
    return parts.filter(Boolean).join(" ");
}

function clampPercent(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

function uniqueDetailErrors(errors, leadingMessage) {
    const list = [];
    const seen = new Set();
    for (const error of Array.isArray(errors) ? errors : []) {
        const text = String(error ?? "").trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        list.push(text);
    }
    if (list[0] && leadingMessage && list[0] === leadingMessage) list.shift();
    return list;
}

function statePrefix(statusType, isRunning) {
    if (statusType === "idle") return null;
    if (isRunning) return "⟳";
    if (statusType === "success") return "✅";
    if (statusType === "error") return "❌";
    if (statusType === "warning") return "⚠️";
    return null;
}

function progressState({ isRunning, statusType, progress }) {
    const numeric = progress != null && Number(progress) >= 0;
    const indeterminate = isRunning && !numeric;
    const percent = isRunning ? clampPercent(progress) : FINISHED_STATUSES.has(statusType) ? 100 : 0;
    return {
        indeterminate,
        percent,
        width: indeterminate ? undefined : percent,
        visible: isRunning || FINISHED_STATUSES.has(statusType),
        fillClass: cls(
            indeterminate && "active indeterminate",
            !indeterminate && isRunning && "active",
            !isRunning && statusType === "success" && "success",
            !isRunning && statusType === "error" && "error",
            !isRunning && statusType === "warning" && "warning"
        ),
    };
}

function runDetailTitle(state) {
    if (state === "success") return "✅ 成功详情";
    if (state === "warning") return "⚠️ 提示详情";
    if (state === "error") return "❌ 错误详情";
    if (state === "running") return "运行详情";
    return "状态信息";
}

function triggerOnKeyboard(event, callback) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    callback();
}

const IconPlay = () => (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
        <circle cx="12" cy="12" r="10" />
        <path d="M10 8.5 16 12l-6 3.5z" />
    </svg>
);

const IconLoading = () => (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="spin-anim" style={{ display: "block" }}>
        <path d="M12 2a10 10 0 1 1-9.6 7.2" />
    </svg>
);

function MainStatusContent({ isRunning, statusType, prefix, displayMsg, docName, presetName }) {
    if (isRunning) {
        return (
            <>
                {prefix ? <span className="status-prefix">{prefix}</span> : null}
                <RhDocAppRhMeta docName={docName} appName={presetName} />
            </>
        );
    }
    if (statusType === "success") {
        return (
            <>
                {prefix ? <span className="status-prefix">{prefix}</span> : null}
                <span className="status-msg status-msg--rh-line1" title={RH_SUCCESS_TEXT}>{RH_SUCCESS_TEXT}</span>
            </>
        );
    }
    return (
        <>
            {prefix ? <span className="status-prefix">{prefix}</span> : null}
            <span className="status-msg status-msg--rh-main-main" title={displayMsg}>{displayMsg}</span>
        </>
    );
}

function ProgressTrack({ model }) {
    return (
        <div className="status-progress-track">
            <div className={`status-progress-fill ${model.fillClass}`} style={{ width: model.indeterminate ? undefined : `${model.width}%` }} />
        </div>
    );
}

function MainStatusBar({
    barState,
    progressModel,
    prefix,
    displayMsg,
    docName,
    presetName,
    metaLine,
    subLine,
    subLineNode,
    topInfoSlot,
    onOpen,
    onCancelRun,
    mainRunIdForCancel,
}) {
    const hasCancel = mainRunIdForCancel != null && typeof onCancelRun === "function";
    return (
        <div className={cls("col-a-info", topInfoSlot && "col-a-info--with-top-slot")}>
            <div
                className={cls(
                    "status-bar status-bar-main",
                    barState,
                    "status-bar--rh",
                    progressModel.visible && "status-bar-main--rh-run-percent",
                    topInfoSlot && "status-bar--with-top-slot",
                    hasCancel && "status-bar-main--has-main-cancel"
                )}
                role="button"
                tabIndex={0}
                onClick={onOpen}
                onKeyDown={(event) => triggerOnKeyboard(event, onOpen)}
                title={`${metaLine}\n点击查看完整信息`}
            >
                {topInfoSlot ? <div className="rh-op-top-slot">{topInfoSlot}</div> : null}
                <div className="status-text-row">
                    <div className="status-main">
                        <MainStatusContent isRunning={barState === "running"} statusType={barState} prefix={prefix} displayMsg={displayMsg} docName={docName} presetName={presetName} />
                    </div>
                </div>
                <div className={`status-sub ${subLine || subLineNode ? "visible" : ""}`}>{subLineNode ?? subLine}</div>
                {progressModel.visible ? <span className="status-percent status-percent-bottom-right visible">{Math.round(progressModel.percent)}%</span> : null}
                <ProgressTrack model={progressModel} />
                {hasCancel ? (
                    <button
                        type="button"
                        className="status-bar-main-cancel status-bar-main-cancel--rh"
                        aria-label="取消任务"
                        title="取消任务"
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onCancelRun(mainRunIdForCancel);
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                    >
                        <span className="status-bar-main-cancel-icon" aria-hidden>×</span>
                    </button>
                ) : null}
            </div>
        </div>
    );
}

function RunCommandButton({ queueCount, onRun, onAddToBatch, addToBatchBusy }) {
    const title = addToBatchBusy
        ? "正在冻结批处理项…"
        : queueCount > 0
          ? `左键: 运行批量 (${queueCount} 项) · 右键: 按选区冻结入队（无选区则全画布）`
          : "左键: 开始运行 · 右键: 按选区冻结入批处理（无选区则全画布）";
    return (
        <div className="col-b-action">
            <div
                className={`sakura-btn ${queueCount > 0 ? "has-batch" : ""}`}
                onClick={() => onRun?.()}
                onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!addToBatchBusy && typeof onAddToBatch === "function") onAddToBatch();
                }}
                title={title}
            >
                {addToBatchBusy ? <IconLoading /> : queueCount > 0 ? <span className="sakura-btn-count">{queueCount}</span> : <IconPlay />}
            </div>
        </div>
    );
}

function buildPopupContext({ detailRun, fallback }) {
    const running = detailRun ? detailRun.status === "running" : fallback.isRunning;
    const statusType = detailRun ? (detailRun.status === "cancelled" ? "warning" : detailRun.status) : fallback.statusType;
    const barState = running ? "running" : statusType;
    const docName = detailRun?.docName ?? fallback.docName;
    const presetName = detailRun?.presetName ?? fallback.presetName;
    const resultDetail = detailRun?.resultDetail ?? fallback.resultDetail;
    const runMessage = detailRun?.message;
    const stageText = detailRun?.stageText ?? fallback.stageText;
    const elapsedSec = detailRun?.elapsedSec ?? fallback.elapsedSec;
    const progress = detailRun ? detailRun.progress : fallback.progress;
    const metaLine = rhBuildMetaLineFull(docName, presetName);
    const displayMsg = rhMainDisplayMsg({
        statusType,
        isRunning: running,
        metaLineFull: metaLine,
        resultDetail,
        statusText: runMessage ?? fallback.statusText,
    });
    const primary = String(resultDetail?.message ?? runMessage ?? fallback.statusText ?? displayMsg ?? "").trim();
    return {
        running,
        barState,
        statusType,
        stageText,
        elapsedSec,
        progress,
        progressKnown: progress != null && Number(progress) >= 0,
        resultDetail,
        metaLine,
        title: runDetailTitle(barState),
        primary,
        errors: uniqueDetailErrors(resultDetail?.errors, primary),
        secondary: rhPopupSecondaryText({ isRunning: running, statusType, resultDetail, metaLineFull: metaLine }),
    };
}

function DetailDialog({ context, onClose }) {
    if (!context) return null;
    const footer = context.resultDetail?.time || context.resultDetail?.images != null || context.resultDetail?.cost;
    return layerPortal(
        <div className="error-popup-overlay" onClick={onClose}>
            <div className="error-popup-card" onClick={(event) => event.stopPropagation()}>
                <div className={`error-popup-header error-popup-header--${context.barState}`}>
                    <span>{context.title}</span>
                    <span className="error-popup-close" onClick={onClose}>✕</span>
                </div>
                <div className="error-popup-body">
                    <div className="error-popup-primary">{context.primary}</div>
                    {!context.running && context.secondary ? <div className="error-popup-secondary">{context.secondary}</div> : null}
                    {!context.running ? <div className="error-popup-meta">任务信息：{context.metaLine}</div> : null}
                    {context.running ? (
                        <div className="error-popup-running-extra">
                            {context.stageText ? <div>阶段：{context.stageText}</div> : null}
                            {context.elapsedSec != null ? <div>已用时：{Number(context.elapsedSec).toFixed(1)}s</div> : null}
                            <div>进度：{context.progressKnown ? `${Number(context.progress).toFixed(1)}%` : "进行中…"}</div>
                        </div>
                    ) : null}
                    {context.errors.length > 0 ? (
                        <div className="error-popup-errors">
                            <div className="error-popup-errors-title">失败原因：</div>
                            {context.errors.map((error, index) => <div key={index} className="error-popup-error-item">{String(error)}</div>)}
                        </div>
                    ) : null}
                </div>
                {footer ? (
                    <div className="error-popup-footer">
                        {context.resultDetail?.images != null && `${context.resultDetail.images} 张`}
                        {context.resultDetail?.time && ` · 耗时: ${context.resultDetail.time}`}
                        {context.resultDetail?.cost && ` · ${context.resultDetail.cost}`}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function CancelDialog({ open, onConfirm, onDismiss }) {
    if (!open) return null;
    return layerPortal(
        <div className="error-popup-overlay" onClick={onDismiss}>
            <div className="error-popup-card" onClick={(event) => event.stopPropagation()}>
                <div className="error-popup-header" style={{ color: "#ffb840" }}>
                    <span>⚠️ 取消任务</span>
                    <span className="error-popup-close" onClick={onDismiss}>✕</span>
                </div>
                <div className="error-popup-body">
                    确定要取消该 RunningHub 任务吗？
                    {"\n\n"}
                    确认后将尝试通知平台终止任务；是否计费以 RunningHub 平台规则为准。
                </div>
                <div className="cancel-confirm-actions">
                    <div className="cancel-confirm-btn no" onClick={onDismiss}>继续等待</div>
                    <div className="cancel-confirm-btn yes" onClick={onConfirm}>确认取消</div>
                </div>
            </div>
        </div>
    );
}

function BatchList({ items, onClearBatch, onRemoveFromBatch }) {
    if (!items.length) return null;
    return (
        <div className="batch-list">
            <div className="batch-list-header">
                <span>批处理 ({items.length})</span>
                <button type="button" className="batch-clear-btn" onClick={onClearBatch} title="清空批处理">清空</button>
            </div>
            <div className="batch-list-body">
                {items.map((item, index) => (
                    <div key={index} className="batch-row">
                        <span className="batch-col idx">#{index + 1}</span>
                        <span className="batch-col doc" title={item.docName}>{item.docName || "—"}</span>
                        <span className="batch-col preset" title={item.presetName}>{item.presetName || "—"}</span>
                        {typeof onRemoveFromBatch === "function" ? (
                            <button type="button" className="batch-remove-btn" onClick={() => onRemoveFromBatch(index)} title="移除此项">×</button>
                        ) : null}
                    </div>
                ))}
            </div>
        </div>
    );
}

function compactRunModel(run) {
    const pendingPlace = run.placeStatus === "pending";
    const terminal = run.status !== "running";
    const progress = run.status === "running" ? run.progress : 100;
    const state = run.status === "cancelled" ? "warning" : run.status;
    const prefix = run.status === "running"
        ? "⟳"
        : run.status === "success"
          ? pendingPlace ? "📥" : "✅"
          : run.status === "error"
            ? "❌"
            : run.status === "cancelled"
              ? "⚠️"
              : "➜";
    const fillClass = run.status === "running" ? "active" : run.status === "success" ? "success" : run.status === "error" ? "error" : "warning";

    if (run.status === "running") {
        return {
            pendingPlace,
            terminal,
            progress,
            state,
            prefix,
            fillClass,
            line1: <RhDocAppRhMeta docName={run.docName} appName={run.presetName} />,
            line2: `${run.stageText || run.message || "处理中"} · ${Number(run.elapsedSec || 0).toFixed(1)}s`,
            showSub: true,
        };
    }

    if (run.status === "success") {
        const text = pendingPlace ? "成功 · 待返回" : RH_SUCCESS_TEXT;
        return {
            pendingPlace,
            terminal,
            progress,
            state,
            prefix,
            fillClass,
            line1: <span className="status-msg status-msg--rh-line1" title={text}>{text}</span>,
            line2: rhSubLinePlainText({ isRunning: false, stageText: "", elapsedSec: null, statusType: "success", resultDetail: run.resultDetail }),
            showSub: !!rhSubLinePlainText({ isRunning: false, stageText: "", elapsedSec: null, statusType: "success", resultDetail: run.resultDetail }),
        };
    }

    let message = run.resultDetail?.message || (run.status === "cancelled" ? "已取消" : run.message) || "处理完成";
    if ((run.status === "error" || run.status === "warning") && run.resultDetail?.errors?.length > 0) {
        const first = String(run.resultDetail.errors[0]).slice(0, 40);
        if (first && !message.includes(first)) message += `:${first}`;
    }
    const shortMessage = message.length > 48 ? `${message.slice(0, 48)}…` : message;
    return {
        pendingPlace,
        terminal,
        progress,
        state,
        prefix,
        fillClass,
        line1: shortMessage,
        line2: <RhDocAppRhMeta docName={run.docName} appName={run.presetName} />,
        showSub: true,
    };
}

function CompactRunRow({ run, exiting, onOpen, onCancelRun, onDismiss, onRetryPlace }) {
    const model = compactRunModel(run);
    const showCorner = typeof onCancelRun === "function" && typeof onDismiss === "function";
    return (
        <div className={`run-task-row run-task-card-enter ${exiting ? "run-task-card-exit" : ""}`}>
            <div className="run-task-info-col">
                <div
                    className={cls("status-bar status-bar-compact", model.state, "status-bar--rh", showCorner && "status-bar-compact--corner-action")}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen(run)}
                    onKeyDown={(event) => triggerOnKeyboard(event, () => onOpen(run))}
                    title="点击查看完整信息"
                >
                    <div className="status-text-row">
                        <div className="status-main">
                            <span className="status-prefix">{model.prefix}</span>
                            {typeof model.line1 === "string" ? <span className="status-msg status-msg--rh-main-main" title={model.line1}>{model.line1}</span> : model.line1}
                        </div>
                    </div>
                    <div className={`status-sub ${model.showSub ? "visible" : ""}`}>{model.line2}</div>
                    <span className="status-percent status-percent-bottom-right visible">{Math.round(model.progress || 0)}%</span>
                    <ProgressTrack model={{ fillClass: model.fillClass, indeterminate: false, width: Math.min(100, model.progress || 0) }} />
                    {showCorner ? (
                        <>
                            {model.pendingPlace && typeof onRetryPlace === "function" ? (
                                <button
                                    type="button"
                                    className="status-bar-compact-retry status-bar-compact-retry--rh"
                                    aria-label="重试贴回"
                                    title="重试贴回图片"
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        onRetryPlace(run.id);
                                    }}
                                    onPointerDown={(event) => event.stopPropagation()}
                                >
                                    <span aria-hidden>↻</span>
                                </button>
                            ) : null}
                            <button
                                type="button"
                                className={cls("status-bar-compact-cancel", model.terminal ? "status-bar-compact-cancel--done" : "status-bar-compact-cancel--run", "status-bar-compact-cancel--rh")}
                                aria-label={model.terminal ? "关闭" : "取消任务"}
                                title={model.terminal ? "关闭" : "取消任务"}
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    if (run.status === "running") onCancelRun(run.id);
                                    else onDismiss(run.id);
                                }}
                                onPointerDown={(event) => event.stopPropagation()}
                            >
                                <span aria-hidden>×</span>
                            </button>
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function CompactRuns({ runs, exitingId, onOpen, onCancelRun, onDismissRun, onRetryPlace }) {
    if (!runs.length) return null;
    return (
        <div className="run-tasks-list">
            {runs.map((run) => (
                <CompactRunRow
                    key={run.id}
                    run={run}
                    exiting={exitingId === run.id}
                    onOpen={onOpen}
                    onCancelRun={onCancelRun}
                    onDismiss={onDismissRun}
                    onRetryPlace={onRetryPlace}
                />
            ))}
        </div>
    );
}

export function Operation({
    isRunning,
    onRun,
    progress = 0,
    statusText,
    stageText,
    resultDetail,
    statusType = "idle",
    elapsedSec = null,
    docName = "",
    presetName = "",
    topInfoSlot = null,
    batchQueue = [],
    onAddToBatch,
    onClearBatch,
    onRemoveFromBatch,
    activeRuns = [],
    runsForCompact = [],
    onCancelRun,
    onDismissRun,
    onRetryPlace,
    cancelDialogOpen = false,
    onConfirmCancel,
    onDismissCancelDialog,
    addToBatchBusy = false,
    mainRunIdForCancel = null,
}) {
    const [detailRunId, setDetailRunId] = useState(null);
    const [detailOpen, setDetailOpen] = useState(false);
    const [exitingId, setExitingId] = useState(null);

    const barState = isRunning ? "running" : statusType;
    const metaLine = rhBuildMetaLineFull(docName, presetName);
    const displayMsg = rhMainDisplayMsg({ statusType, isRunning, metaLineFull: metaLine, resultDetail, statusText });
    const subLineAsMeta = rhShouldShowMetaSecondRow(isRunning, statusType);
    const subLine = subLineAsMeta ? "" : rhSubLinePlainText({ isRunning, stageText, elapsedSec, statusType, resultDetail });
    const subLineNode = subLineAsMeta ? <RhDocAppRhMeta docName={docName} appName={presetName} /> : null;
    const mainProgress = progressState({ isRunning, statusType, progress });

    const detailRun = useMemo(() => {
        if (detailRunId == null) return null;
        return activeRuns.find((run) => run.id === detailRunId) || runsForCompact.find((run) => run.id === detailRunId) || null;
    }, [activeRuns, detailRunId, runsForCompact]);

    useEffect(() => {
        if (detailRunId == null || detailRun) return;
        setDetailOpen(false);
        setDetailRunId(null);
    }, [detailRun, detailRunId]);

    const popupContext = detailOpen
        ? buildPopupContext({
              detailRun,
              fallback: { isRunning, statusType, docName, presetName, resultDetail, statusText, stageText, elapsedSec, progress },
          })
        : null;

    const dismissCompactRun = (id) => {
        setExitingId(id);
        window.setTimeout(() => {
            if (typeof onDismissRun === "function") onDismissRun(id);
            setExitingId(null);
        }, COMPACT_DISMISS_MS);
    };

    return (
        <div className={`op-wrapper${topInfoSlot ? " op-wrapper--with-top-slot" : ""}`}>
            <div className={`op-layout${topInfoSlot ? " op-layout--with-top-slot" : ""}`}>
                <MainStatusBar
                    barState={barState}
                    progressModel={mainProgress}
                    prefix={statePrefix(statusType, isRunning)}
                    displayMsg={displayMsg}
                    docName={docName}
                    presetName={presetName}
                    metaLine={metaLine}
                    subLine={subLine}
                    subLineNode={subLineNode}
                    topInfoSlot={topInfoSlot}
                    onOpen={() => {
                        setDetailRunId(null);
                        setDetailOpen(true);
                    }}
                    onCancelRun={onCancelRun}
                    mainRunIdForCancel={mainRunIdForCancel}
                />
                <RunCommandButton queueCount={batchQueue.length} onRun={onRun} onAddToBatch={onAddToBatch} addToBatchBusy={addToBatchBusy} />
            </div>

            <DetailDialog context={popupContext} onClose={() => { setDetailOpen(false); setDetailRunId(null); }} />
            <CancelDialog open={cancelDialogOpen} onConfirm={onConfirmCancel} onDismiss={onDismissCancelDialog} />
            <BatchList items={batchQueue} onClearBatch={onClearBatch} onRemoveFromBatch={onRemoveFromBatch} />
            <CompactRuns
                runs={runsForCompact}
                exitingId={exitingId}
                onOpen={(run) => {
                    setDetailRunId(run?.id ?? null);
                    setDetailOpen(true);
                }}
                onCancelRun={onCancelRun}
                onDismissRun={dismissCompactRun}
                onRetryPlace={onRetryPlace}
            />
        </div>
    );
}
