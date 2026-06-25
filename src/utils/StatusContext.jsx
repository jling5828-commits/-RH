import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { updateCreditsMaxForCacheKey } from "./creditsCallable.js";
import { logStatusMessage } from "./runtimeLogger.js";

export const INVOCATION_MAX = 50;
export const CREDITS_CACHE_TTL_MS = 60 * 1000;

const DEFAULT_STATUS_TEXT = "系统就绪";
const ERROR_STATUS_MIN_DURATION_MS = 12000;

const STATUS_MATCHERS = Object.freeze({
    error: [
        "失败", "错误", "异常", "报错", "不足", "拒绝", "无效", "无法", "缺少", "超时", "中断",
        "failed", "failure", "error", "exception", "invalid", "timeout", "denied", "rejected",
    ],
    warning: ["取消", "等待", "重试", "警告", "warning", "cancel", "retry"],
});

const StatusContext = createContext(null);

function containsAny(text, list) {
    const value = String(text || "").toLowerCase();
    return list.some((item) => value.includes(String(item).toLowerCase()));
}

function statusPriority(text) {
    if (containsAny(text, STATUS_MATCHERS.error)) return 2;
    if (containsAny(text, STATUS_MATCHERS.warning)) return 1;
    return 0;
}

function guardedDuration(priority, duration) {
    const requested = Number(duration);
    const normalized = Number.isFinite(requested) ? requested : 4000;
    return priority >= 2 ? Math.max(normalized, ERROR_STATUS_MIN_DURATION_MS) : normalized;
}

function nextInvocationList(prev, record) {
    if (!record || !record.mode) return prev;
    const timestamp = record.timestamp ?? Date.now();
    return [{ ...record, timestamp }, ...prev].slice(0, INVOCATION_MAX);
}

function clearTimer(timerRef) {
    if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
    }
}

export const useStatus = () => {
    const context = useContext(StatusContext);
    if (!context) {
        throw new Error("useStatus must be used inside StatusProvider");
    }
    return context;
};

export const StatusProvider = ({ children }) => {
    const [statusText, setStatusText] = useState(DEFAULT_STATUS_TEXT);
    const [credits, setCreditsState] = useState(null);
    const [creditsCacheVersion, setCreditsCacheVersion] = useState(0);
    const [invocationHistory, setInvocationHistory] = useState([]);

    const timerRef = useRef(null);
    const statusGuardRef = useRef({ priority: 0, until: 0 });
    const creditsCacheRef = useRef({});

    useEffect(() => () => clearTimer(timerRef), []);

    const resetStatus = useCallback(() => {
        clearTimer(timerRef);
        statusGuardRef.current = { priority: 0, until: 0 };
        setStatusText("");
    }, []);

    const pushStatus = useCallback((text, duration = 4000) => {
        const message = String(text ?? "");
        logStatusMessage(message, duration);

        const now = Date.now();
        const priority = statusPriority(message);
        const guard = statusGuardRef.current;
        if (guard.priority >= 2 && now < guard.until && priority < guard.priority) return;

        const displayMs = guardedDuration(priority, duration);
        statusGuardRef.current = {
            priority,
            until: displayMs > 0 ? now + displayMs : priority >= 2 ? now + ERROR_STATUS_MIN_DURATION_MS : 0,
        };

        clearTimer(timerRef);
        setStatusText(message);
        if (displayMs > 0) {
            timerRef.current = setTimeout(() => {
                statusGuardRef.current = { priority: 0, until: 0 };
                setStatusText("");
                timerRef.current = null;
            }, displayMs);
        }
    }, []);

    const setCredits = useCallback((current) => {
        setCreditsState(typeof current === "number" && Number.isFinite(current) ? current : null);
    }, []);

    const updateCreditsCache = useCallback((cacheKey, current) => {
        if (!cacheKey || typeof current !== "number" || !Number.isFinite(current)) return;
        creditsCacheRef.current[cacheKey] = { current, fetchedAt: Date.now() };
        updateCreditsMaxForCacheKey(cacheKey, current);
        setCreditsCacheVersion((version) => version + 1);
    }, []);

    const refreshCredits = useCallback(() => {}, []);
    const refreshCreditsForce = useCallback(async () => null, []);

    const pushInvocation = useCallback((record) => {
        setInvocationHistory((prev) => nextInvocationList(prev, record));
    }, []);

    const value = useMemo(() => ({
        CREDITS_CACHE_TTL_MS,
        credits,
        creditsCacheRef,
        creditsCacheVersion,
        invocationHistory,
        pushInvocation,
        pushStatus,
        refreshCredits,
        refreshCreditsForce,
        resetStatus,
        setCredits,
        statusText,
        updateCreditsCache,
    }), [
        credits,
        creditsCacheVersion,
        invocationHistory,
        pushInvocation,
        pushStatus,
        refreshCredits,
        refreshCreditsForce,
        resetStatus,
        setCredits,
        statusText,
        updateCreditsCache,
    ]);

    return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
};
