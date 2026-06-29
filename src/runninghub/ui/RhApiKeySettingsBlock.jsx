/**
 * RH API Key settings: two key slots with one active mode switch.
 */
import React, { useState, useCallback, useEffect, useRef } from "react";
import { safeOpenExternal } from "../../utils/safeOpenExternal.js";

const IconEye = () => (
    <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

const IconEyeOff = () => (
    <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C5 20 1 12 1 12a20.29 20.29 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A10.45 10.45 0 0 1 12 4c7 0 11 8 11 8a20.5 20.5 0 0 1-2.16 3.19" />
        <path d="M14.12 14.12a3 3 0 0 1-4.24-4.24" />
        <path d="M1 1l22 22" />
    </svg>
);

export const IconExternalLink = () => (
    <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <path d="M15 3h6v6" />
        <path d="M10 14 21 3" />
    </svg>
);

const API_KEY_MODES = [
    {
        id: "consumer",
        label: "消费级-会员 ( 扣RH币 )",
        switchLabel: "消费级-会员",
        placeholder: "填写消费级/会员 API Key",
        keyUrl: "https://www.runninghub.cn/enterprise-api/consumerApi",
    },
    {
        id: "enterprise",
        label: "企业级-共享 ( 扣余额 )",
        switchLabel: "企业级-共享",
        placeholder: "填写企业级/共享 API Key",
        keyUrl: "https://www.runninghub.cn/enterprise-api/sharedApi",
    },
];

export function RhSecureKeyField({ value, onValueChange, placeholder }) {
    const [visible, setVisible] = useState(false);
    const [focused, setFocused] = useState(false);
    const blurTimer = useRef(null);
    const inputRef = useRef(null);
    const showPlain = visible;

    const handleInput = useCallback((e) => {
        const v = e.target.value;
        if (v !== value) onValueChange(v);
    }, [value, onValueChange]);

    const handleFocus = useCallback(() => {
        if (blurTimer.current) {
            clearTimeout(blurTimer.current);
            blurTimer.current = null;
        }
        setFocused(true);
    }, []);

    const handleBlur = useCallback(() => {
        blurTimer.current = setTimeout(() => setFocused(false), 150);
    }, []);

    useEffect(() => () => {
        if (blurTimer.current) clearTimeout(blurTimer.current);
    }, []);

    return (
        <div className={`rh-secure-key-row ${focused ? "is-focused" : ""}`}>
            <div className="rh-secure-key-input">
                <input
                    ref={inputRef}
                    type={showPlain ? "text" : "password"}
                    value={value}
                    placeholder={placeholder || "输入 API Key"}
                    onChange={handleInput}
                    onInput={handleInput}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    className="rh-settings-input"
                />
            </div>
            <div
                className={`rh-secure-key-toggle ${showPlain ? "is-visible" : ""}`}
                onClick={() => setVisible((v) => !v)}
                title={showPlain ? "隐藏 Key" : "显示 Key"}
            >
                {showPlain ? <IconEye /> : <IconEyeOff />}
            </div>
        </div>
    );
}

export function RhApiKeySettingsBlock({
    apiKeys,
    apiKeyMode,
    setApiKeyForMode,
    setApiKeyMode,
    pushStatus,
}) {
    const selectedMode = apiKeyMode === "consumer" ? "consumer" : "enterprise";
    const keys = apiKeys && typeof apiKeys === "object" ? apiKeys : {};

    const handleOpenKeyPage = useCallback(async (event, item) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        if (!item?.keyUrl) return;

        const opened = await safeOpenExternal(item.keyUrl, { pushStatus });
        if (opened && typeof pushStatus === "function") {
            pushStatus(`已打开 ${item.switchLabel} API Key 页面`, 3000);
        }
    }, [pushStatus]);

    const stopNestedButtonEvent = useCallback((event) => {
        event?.stopPropagation?.();
    }, []);

    return (
        <>
            <div className="rh-config-row1">
                <label className="rh-config-label">API Key</label>
            </div>
            <div className="rh-key-mode-switch" role="tablist" aria-label="API Key 切换">
                {API_KEY_MODES.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        className={`rh-key-mode-btn ${selectedMode === item.id ? "is-active" : ""}`}
                        onClick={() => setApiKeyMode(item.id)}
                        role="tab"
                        aria-selected={selectedMode === item.id}
                    >
                        {item.switchLabel}
                    </button>
                ))}
            </div>
            <div className="rh-config-row2">
                <div className="rh-key-field-list">
                    {API_KEY_MODES.map((item) => (
                        <div
                            key={item.id}
                            className={`rh-key-field-card ${selectedMode === item.id ? "is-active" : ""}`}
                            onClick={() => setApiKeyMode(item.id)}
                        >
                            <div className="rh-key-field-head">
                                <div className="rh-key-field-title-wrap">
                                    <span className="rh-key-field-title">{item.label}</span>
                                    <button
                                        type="button"
                                        className="rh-key-field-link-btn"
                                        onPointerDown={stopNestedButtonEvent}
                                        onMouseDown={stopNestedButtonEvent}
                                        onTouchStart={stopNestedButtonEvent}
                                        onClick={(event) => handleOpenKeyPage(event, item)}
                                        title={`打开${item.switchLabel} API Key 页面`}
                                        aria-label={`打开${item.switchLabel} API Key 页面`}
                                    >
                                        <span className="rh-key-field-link-text">跳转</span>
                                        <IconExternalLink />
                                    </button>
                                </div>
                                {selectedMode === item.id && <span className="rh-key-field-badge">当前使用</span>}
                            </div>
                            <RhSecureKeyField
                                value={String(keys[item.id] || "").trim()}
                                onValueChange={(key) => setApiKeyForMode(item.id, key)}
                                placeholder={item.placeholder}
                            />
                        </div>
                    ))}
                </div>
            </div>
        </>
    );
}
