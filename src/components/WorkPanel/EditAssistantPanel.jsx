import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useStatus } from "../../utils/StatusContext.jsx";
import { useDrawer } from "./DrawerContext.jsx";
import { addEvaluate, compressToThumbnail } from "../../utils/InferenceHistoryManager.js";
import "./ReversePanel.css";
import "./EditAssistantPanel.css";

const SESSION_IMAGE_PREFIX = "xiaoliangRh-session:";
const STEP_DELAY_MS = 120;

function isDeferredImage(value) {
    return typeof value === "string" && value.indexOf(SESSION_IMAGE_PREFIX) === 0;
}

function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getImageSize(dataUrl) {
    if (!dataUrl || typeof dataUrl !== "string" || isDeferredImage(dataUrl)) {
        return Promise.resolve(null);
    }
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.width, height: image.height });
        image.onerror = () => resolve(null);
        image.src = dataUrl;
    });
}

function formatSize(size) {
    if (!size) return "未读取到尺寸";
    return `${size.width} x ${size.height}`;
}

function buildLocalReview(size) {
    const orientation = size
        ? size.width === size.height
            ? "方图"
            : size.width > size.height
                ? "横图"
                : "竖图"
        : "未知画幅";

    return [
        "本地修图检查清单",
        "",
        `画面尺寸: ${formatSize(size)}`,
        `画幅判断: ${orientation}`,
        "",
        "建议检查:",
        "1. 先看主体轮廓是否完整，边缘是否出现糊边、断裂或多余残影。",
        "2. 再看皮肤、布料、金属、文字等高频区域，确认纹理没有被过度磨平。",
        "3. 检查光源方向和阴影落点，避免局部修补后出现明暗不一致。",
        "4. 放大到 100% 查看眼睛、手指、发丝、饰品等细节，优先修复最容易露馅的位置。",
        "5. 最后缩小看整体色调，确认主体和背景没有分离感。",
        "",
        "下一步:",
        "如果需要 AI 深度评价，建议在 RunningHub 主面板选择对应修图/质检应用执行。",
    ].join("\n");
}

async function resolveMainImage(uploadData, imageUploadRef, pushStatus) {
    let image = uploadData?.main || null;
    if (image && !isDeferredImage(image)) return image;

    if (imageUploadRef?.current?.ensureUploadDataReady) {
        pushStatus("正在获取主图...", 0);
        const data = await imageUploadRef.current.ensureUploadDataReady({
            purpose: "evaluate",
            requireMainCapture: true,
        });
        image = data?.main || null;
    }

    return image && !isDeferredImage(image) ? image : null;
}

const EditAssistantPanelInner = ({ uploadData, imageUploadRef }, ref) => {
    const { pushStatus } = useStatus();
    const { setEditAssistantTaskRunning } = useDrawer();
    const [evaluateResult, setEvaluateResult] = useState("");
    const [isEvaluateError, setIsEvaluateError] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [errorMessage, setErrorMessage] = useState("");
    const mountedRef = useRef(true);

    const mainPreview = useMemo(() => {
        const value = uploadData?.main || null;
        return value && !isDeferredImage(value) ? value : null;
    }, [uploadData]);

    const hasMainImage = Boolean(uploadData?.main || uploadData?.mainUploadReady || mainPreview);
    const canEvaluate = hasMainImage && !isLoading;

    useImperativeHandle(ref, () => ({
        loadFromHistory(item) {
            setEvaluateResult(item?.result || "");
            setIsEvaluateError(false);
            setErrorMessage("");
            setProgress(0);
        },
    }), []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const resetPanel = useCallback(() => {
        setEvaluateResult("");
        setIsEvaluateError(false);
        setErrorMessage("");
        setProgress(0);
        pushStatus("已清空修图评价", 1800);
    }, [pushStatus]);

    const handleEvaluate = useCallback(async () => {
        if (!canEvaluate) return;

        setIsLoading(true);
        setEditAssistantTaskRunning(true);
        setIsEvaluateError(false);
        setErrorMessage("");
        setEvaluateResult("");
        setProgress(12);

        try {
            const image = await resolveMainImage(uploadData, imageUploadRef, pushStatus);
            if (!image) throw new Error("没有读取到可评价的主图，请先准备主图。 ");

            if (!mountedRef.current) return;
            setProgress(38);
            await wait(STEP_DELAY_MS);

            const size = await getImageSize(image);
            if (!mountedRef.current) return;
            setProgress(72);
            await wait(STEP_DELAY_MS);

            const result = buildLocalReview(size);
            setEvaluateResult(result);
            setProgress(100);
            pushStatus("修图检查清单已生成", 2500);

            const thumb = await compressToThumbnail(image);
            addEvaluate({ result, thumb });
        } catch (error) {
            if (!mountedRef.current) return;
            const message = error?.message || "修图评价失败";
            setIsEvaluateError(true);
            setErrorMessage(message);
            setEvaluateResult(`[修图评价失败]\n${message}`);
            pushStatus("修图评价失败", 3000);
        } finally {
            setEditAssistantTaskRunning(false);
            if (mountedRef.current) {
                setIsLoading(false);
                window.setTimeout(() => mountedRef.current && setProgress(0), 350);
            }
        }
    }, [canEvaluate, imageUploadRef, pushStatus, setEditAssistantTaskRunning, uploadData]);

    return (
        <div className="edit-assistant-panel-inner">
            {!hasMainImage ? (
                <div className="reverse-panel-hint" role="status">
                    请先在图像上传区域准备主图，再生成修图检查清单。
                </div>
            ) : null}

            {mainPreview ? (
                <div className="edit-assistant-preview-wrap">
                    <img src={mainPreview} className="edit-assistant-preview" alt="主图预览" />
                </div>
            ) : null}

            <div className={`reverse-row reverse-actions reverse-actions-row ${isLoading ? "reverse-actions-loading" : ""}`}>
                {evaluateResult.trim() ? (
                    <button
                        type="button"
                        className="reverse-btn reverse-btn-cancel"
                        onClick={resetPanel}
                        disabled={isLoading}
                        title="清空当前评价"
                    >
                        新评价
                    </button>
                ) : null}
                <button
                    type="button"
                    className={`reverse-btn reverse-btn-primary ${isLoading ? "reverse-btn-as-progress" : ""}`}
                    onClick={handleEvaluate}
                    disabled={!canEvaluate}
                    title={canEvaluate ? "生成本地修图检查清单" : "请先准备主图"}
                >
                    {isLoading ? (
                        <span className="reverse-btn-progress-fill" style={{ width: `${progress}%` }}>
                            <span className="reverse-btn-shimmer" />
                        </span>
                    ) : null}
                    <span className="reverse-btn-inner">
                        {isLoading ? `分析中 ${Math.round(progress)}%` : "生成检查清单"}
                    </span>
                </button>
            </div>

            <div className={`reverse-row reverse-result-block edit-assistant-result-block ${isLoading ? "reverse-result-loading" : ""}`}>
                <label className="reverse-label">评价结果</label>
                <textarea
                    className={`reverse-result-textarea edit-assistant-result-textarea ${isEvaluateError ? "reverse-result-error" : ""}`}
                    value={evaluateResult}
                    readOnly
                    placeholder={isLoading ? "正在分析画面..." : "检查结果会显示在这里。"}
                    rows={18}
                />
            </div>

            {errorMessage ? (
                <div className="assistant-error-overlay" onClick={() => setErrorMessage("")}>
                    <div className="assistant-error-dialog" onClick={(event) => event.stopPropagation()}>
                        <div className="assistant-error-header">
                            <span>修图评价失败</span>
                            <button type="button" className="assistant-error-close" onClick={() => setErrorMessage("")}>x</button>
                        </div>
                        <div className="assistant-error-body">{errorMessage}</div>
                        <div className="assistant-error-actions">
                            <button type="button" className="assistant-error-btn" onClick={() => setErrorMessage("")}>关闭</button>
                            <button type="button" className="assistant-error-btn primary" onClick={handleEvaluate}>重试</button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
};

export const EditAssistantPanel = forwardRef(EditAssistantPanelInner);
