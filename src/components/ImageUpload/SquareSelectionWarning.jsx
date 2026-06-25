import React, { useCallback, useEffect, useState } from "react";
import { clearActiveSelection, getActiveSelectionCaptureInfo } from "./captureUtils.js";
import "./SquareSelectionWarning.css";

let skipSquareSelectionWarningThisSession = false;

function isSquare(info) {
    const width = Math.max(1, Math.round(Number(info?.width) || 0));
    const height = Math.max(1, Math.round(Number(info?.height) || 0));
    return Math.abs(width - height) <= 1;
}

function sizeText(info) {
    const width = Math.max(1, Math.round(Number(info?.width) || 0));
    const height = Math.max(1, Math.round(Number(info?.height) || 0));
    return `${width} × ${height}`;
}

export function useSquareSelectionWarning(pushStatus) {
    const [pending, setPending] = useState(null);

    useEffect(() => () => {
        pending?.resolve?.(false);
    }, [pending]);

    const confirmCaptureSelection = useCallback(async ({ mode = "canvas", clearCapture } = {}) => {
        if (skipSquareSelectionWarningThisSession) return true;
        let info = null;
        try {
            info = await getActiveSelectionCaptureInfo(mode);
        } catch (_) {
            return true;
        }
        if (!info || isSquare(info)) return true;
        return new Promise((resolve) => setPending({ info, clearCapture, resolve }));
    }, []);

    const finish = useCallback((value) => {
        const item = pending;
        setPending(null);
        item?.resolve?.(value);
    }, [pending]);

    const skipAndContinue = useCallback(() => {
        skipSquareSelectionWarningThisSession = true;
        finish(true);
    }, [finish]);

    const modifyNow = useCallback(async () => {
        const item = pending;
        setPending(null);
        try {
            await Promise.resolve(item?.clearCapture?.());
            await clearActiveSelection();
            pushStatus?.("已清空本次捕获图像并清除当前选区", 3500);
        } catch (error) {
            pushStatus?.(`清除选区失败：${error?.message || error}`, 5000);
        }
        item?.resolve?.(false);
    }, [pending, pushStatus]);

    const warningDialog = pending ? (
        <div className="xl-popup-overlay xlrh-square-warning-overlay">
            <div className="xl-popup-dialog xlrh-square-warning-dialog" role="dialog" aria-modal="true" aria-label="选区比例提醒" onClick={(event) => event.stopPropagation()}>
                <div className="xl-popup-icon xlrh-square-warning-icon">!</div>
                <div className="xl-popup-title">选区不是 1:1</div>
                <div className="xl-popup-subtitle">当前选区 {sizeText(pending.info)}，不是正方形。</div>
                <div className="xl-popup-body">
                    <div className="xlrh-square-warning-note">立即修改会清空这次捕获的图像，并清除当前不是 1:1 的选区。</div>
                </div>
                <div className="xl-popup-actions xlrh-square-warning-actions">
                    <button type="button" className="xl-btn xl-btn-secondary" onClick={skipAndContinue}>不再提示</button>
                    <button type="button" className="xl-btn xl-btn-primary" onClick={modifyNow}>立即修改</button>
                </div>
            </div>
        </div>
    ) : null;

    return { confirmCaptureSelection, warningDialog };
}
