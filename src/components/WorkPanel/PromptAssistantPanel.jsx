import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { usePersistedState } from "../../hooks/usePersistedState.js";
import { useStatus } from "../../utils/StatusContext.jsx";
import { useDrawer } from "./DrawerContext.jsx";
import PresetManager from "../../utils/PresetManager.js";
import { addPolish, addChat, updateChat } from "../../utils/InferenceHistoryManager.js";
import "./ReversePanel.css";
import "./PromptAssistantPanel.css";

const TEXT = Object.freeze({
    chatMode: "\u5bf9\u8bdd\u751f\u6210",
    polishMode: "\u672c\u5730\u6da6\u8272",
    imageReadFailed: "\u6587\u4ef6\u8bfb\u53d6\u5931\u8d25",
    imageLoadFailed: "\u56fe\u7247\u52a0\u8f7d\u5931\u8d25",
    defaultPreset: "\u5c0f\u6881\u9884\u8bbe",
    defaultSeed: "\u7cbe\u4fee\u56fe\u7247",
    promptFromMain: "\u5df2\u52a0\u8f7d\u4e3b\u63d0\u793a\u8bcd",
    tooManyImages: "\u6700\u591a\u6dfb\u52a0",
    imageUnit: "\u5f20\u56fe\u7247",
    imageAdded: "\u5df2\u6dfb\u52a0\u56fe\u7247",
    imageCompressed: "\u56fe\u7247\u5df2\u538b\u7f29\u5e76\u6dfb\u52a0",
    imageProcessFailed: "\u56fe\u7247\u5904\u7406\u5931\u8d25",
    polishLabel: "\u672c\u5730\u6da6\u8272",
    promptLabel: "\u63d0\u793a\u8bcd\u751f\u6210",
    running: "\u4e2d...",
    done: "\u5b8c\u6210",
    failed: "\u5931\u8d25",
    fillDone: "\u5df2\u586b\u5165\u63d0\u793a\u8bcd",
    appendDone: "\u5df2\u8ffd\u52a0\u5230\u63d0\u793a\u8bcd",
    savedPreset: "\u5df2\u4fdd\u5b58\u9884\u8bbe",
    saveFailed: "\u4fdd\u5b58\u5931\u8d25",
    unknownError: "\u672a\u77e5\u9519\u8bef",
    newChat: "\u5df2\u5f00\u59cb\u65b0\u5bf9\u8bdd",
    userRole: "\u6211",
    modelRole: "\u52a9\u624b",
    referenceOnly: "(\u53c2\u8003\u56fe)",
    remove: "\u79fb\u9664",
    close: "\u5173\u95ed",
    inputPrompt: "\u8f93\u5165\u63d0\u793a\u8bcd",
    loadMainPrompt: "\u4ece\u4e3b\u63d0\u793a\u8bcd\u52a0\u8f7d",
    polishPlaceholder: "\u8f93\u5165\u9700\u8981\u6574\u7406\u7684\u63d0\u793a\u8bcd\uff0cCtrl+V \u53ef\u7c98\u8d34\u53c2\u8003\u56fe",
    polishAction: "\u6574\u7406\u63d0\u793a\u8bcd",
    processing: "\u5904\u7406\u4e2d",
    polishResult: "\u6574\u7406\u7ed3\u679c",
    fill: "\u586b\u5165",
    append: "\u8ffd\u52a0",
    resultTitle: "\u751f\u6210\u7ed3\u679c / \u9884\u8bbe",
    saveToPreset: "\u4fdd\u5b58\u5230\u6211\u7684\u9884\u8bbe",
    continuePlaceholder: "\u7ee7\u7eed\u8865\u5145\u8981\u6c42\uff0cEnter \u53d1\u9001",
    firstPlaceholder: "\u63cf\u8ff0\u4f60\u60f3\u5b9e\u73b0\u7684\u6548\u679c\uff0cCtrl+V \u53ef\u7c98\u8d34\u53c2\u8003\u56fe",
    newConversation: "\u65b0\u5bf9\u8bdd",
    send: "\u53d1\u9001",
    generating: "\u751f\u6210\u4e2d",
    errorTitle: "\u64cd\u4f5c\u5931\u8d25",
    welcome: "\u544a\u8bc9\u6211\u4f60\u60f3\u8981\u7684\u753b\u9762\u6548\u679c\uff0c\u6211\u4f1a\u6574\u7406\u6210\u53ef\u4fdd\u5b58\u7684\u63d0\u793a\u8bcd\u3002",
});

const MODES = Object.freeze([
    { key: "chat", label: TEXT.chatMode },
    { key: "polish", label: TEXT.polishMode },
]);

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const LOCAL_TASK_DELAY = 160;

function cls(...values) {
    return values.filter(Boolean).join(" ");
}

function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function dataUrlSize(dataUrl) {
    if (!dataUrl || typeof dataUrl !== "string") return 0;
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return 0;
    return Math.ceil(((dataUrl.length - comma - 1) * 3) / 4);
}

function compressImageToMaxSize(file, maxBytes) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error(TEXT.imageReadFailed));
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error(TEXT.imageLoadFailed));
            image.onload = () => {
                const canvas = document.createElement("canvas");
                let { width, height } = image;
                const maxEdge = 2048;
                if (width > maxEdge || height > maxEdge) {
                    const scale = maxEdge / Math.max(width, height);
                    width = Math.max(1, Math.round(width * scale));
                    height = Math.max(1, Math.round(height * scale));
                }
                canvas.width = width;
                canvas.height = height;
                canvas.getContext("2d").drawImage(image, 0, 0, width, height);

                let quality = 0.9;
                let output = canvas.toDataURL("image/jpeg", quality);
                while (quality > 0.25 && dataUrlSize(output) > maxBytes) {
                    quality -= 0.1;
                    output = canvas.toDataURL("image/jpeg", quality);
                }
                resolve(output);
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

function normalizePromptText(text) {
    return String(text || "")
        .replace(/[\uFF0C\u3002\uFF1B\u3001]/g, ", ")
        .replace(/\s+/g, " ")
        .replace(/,\s*,+/g, ", ")
        .trim();
}

function presetNameFromText(text) {
    const compact = String(text || "").replace(/\s+/g, "").trim();
    return (compact ? compact.slice(0, 12) : "") || TEXT.defaultPreset;
}

function polishPromptText(text, imageCount) {
    const source = normalizePromptText(text);
    const parts = [source, "clean composition", "natural lighting", "fine details", "balanced color", "high quality retouching"];
    if (imageCount > 0) parts.push(`reference image guided, ${imageCount} reference${imageCount > 1 ? "s" : ""}`);
    return parts.filter(Boolean).join(", ");
}

function buildPromptFromChat(messages, imageCount) {
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    const seed = normalizePromptText(lastUser?.text || TEXT.defaultSeed);
    return {
        presetName: presetNameFromText(seed),
        prompt: [
            seed || "professional photo retouching",
            "clear subject",
            "refined texture",
            "coherent lighting",
            "natural color grading",
            "production ready result",
            imageCount > 0 ? "use attached reference images as visual guidance" : "",
        ].filter(Boolean).join(", "),
    };
}

function LoadingDot() {
    return <span className="xlrh-assist-spinner" />;
}

function AssistantImages({ images, removingIndex, disabled, onRemove }) {
    if (!images.length) return null;
    return (
        <div className="xlrh-assist-images">
            {images.map((dataUrl, index) => (
                <div key={`${index}_${dataUrl.slice(0, 32)}`} className={cls("xlrh-assist-thumb", removingIndex === index && "is-removing")}>
                    <img src={dataUrl} className="xlrh-assist-thumb-img" alt="" />
                    <button
                        type="button"
                        className="xlrh-assist-thumb-remove"
                        onMouseDown={(event) => {
                            event.stopPropagation();
                            event.preventDefault();
                            onRemove(index);
                        }}
                        disabled={disabled}
                        title={TEXT.remove}
                    >
                        x
                    </button>
                </div>
            ))}
        </div>
    );
}

function ProgressButton({ busy, progress, children }) {
    return (
        <>
            {busy ? (
                <span className="xlrh-assist-btn-fill" style={{ width: `${progress}%` }}>
                    <span className="xlrh-assist-btn-sheen" />
                </span>
            ) : null}
            <span className="xlrh-assist-btn-text">{children}</span>
        </>
    );
}

const PromptAssistantPanelInner = ({ prompt, setPrompt, onPresetSaved, onClearPreset }, ref) => {
    const { pushStatus } = useStatus();
    const { setAssistantTaskRunning, closeDrawer } = useDrawer();
    const [mode, setMode] = usePersistedState("xlrh_assistant_mode", "chat");
    const [polishInput, setPolishInput] = useState("");
    const [polishResult, setPolishResult] = useState("");
    const [polishImages, setPolishImages] = useState([]);
    const [chatMessages, setChatMessages] = useState([]);
    const [chatInput, setChatInput] = useState("");
    const [chatImages, setChatImages] = useState([]);
    const [parsedResult, setParsedResult] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [removingPolishIndex, setRemovingPolishIndex] = useState(null);
    const [removingChatIndex, setRemovingChatIndex] = useState(null);
    const [errorDialog, setErrorDialog] = useState({ visible: false, message: "" });
    const mountedRef = useRef(true);
    const currentSessionIdRef = useRef(null);
    const stateRef = useRef({ chatMessages: [], parsedResult: null });
    stateRef.current = { chatMessages, parsedResult };

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useImperativeHandle(ref, () => ({
        loadFromHistory(item) {
            if (!item) return;
            if (item.messages != null) {
                setChatMessages(item.messages || []);
                setParsedResult(item.parsedResult || null);
                setMode("chat");
                currentSessionIdRef.current = item.id || null;
                return;
            }
            setPolishInput(item.input || "");
            setPolishResult(item.result || "");
            setMode("polish");
        },
        async saveCurrentChat() {
            const snapshot = stateRef.current;
            const shouldSave = snapshot.chatMessages.length > 0 || snapshot.parsedResult?.prompt?.trim();
            if (!shouldSave) return;
            const id = currentSessionIdRef.current;
            const updated = id && (await updateChat(id, snapshot));
            if (!updated) currentSessionIdRef.current = await addChat(snapshot);
        },
    }), [setMode]);

    const runLocalTask = useCallback(async (label, worker) => {
        setIsLoading(true);
        setAssistantTaskRunning(true);
        setProgress(12);
        pushStatus(`${label}${TEXT.running}`, 0);
        try {
            await wait(LOCAL_TASK_DELAY);
            if (!mountedRef.current) return null;
            setProgress(58);
            const result = await worker();
            if (!mountedRef.current) return null;
            setProgress(100);
            pushStatus(`${label}${TEXT.done}`, 2200);
            return result;
        } catch (error) {
            const message = error?.message || `${label}${TEXT.failed}`;
            setErrorDialog({ visible: true, message });
            pushStatus(`${label}${TEXT.failed}`, 3000);
            return null;
        } finally {
            setAssistantTaskRunning(false);
            if (mountedRef.current) {
                setIsLoading(false);
                window.setTimeout(() => mountedRef.current && setProgress(0), 350);
            }
        }
    }, [pushStatus, setAssistantTaskRunning]);

    const addImage = useCallback((dataUrl, setImages) => {
        setImages((previous) => previous.length >= MAX_IMAGES ? previous : [...previous, dataUrl]);
    }, []);

    const handlePaste = useCallback((event, setImages, currentCount) => {
        const items = event.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
            if (!item.type || !item.type.startsWith("image/")) continue;
            event.preventDefault();
            if (currentCount >= MAX_IMAGES) {
                pushStatus(`${TEXT.tooManyImages} ${MAX_IMAGES} ${TEXT.imageUnit}`, 1800);
                return;
            }
            const file = item.getAsFile();
            if (!file) return;
            if (file.size > MAX_IMAGE_BYTES) {
                compressImageToMaxSize(file, MAX_IMAGE_BYTES)
                    .then((dataUrl) => {
                        if (!mountedRef.current) return;
                        addImage(dataUrl, setImages);
                        pushStatus(TEXT.imageCompressed, 1600);
                    })
                    .catch(() => pushStatus(TEXT.imageProcessFailed, 2400));
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                if (!mountedRef.current) return;
                addImage(reader.result, setImages);
                pushStatus(TEXT.imageAdded, 1400);
            };
            reader.onerror = () => pushStatus(TEXT.imageReadFailed, 2200);
            reader.readAsDataURL(file);
            return;
        }
    }, [addImage, pushStatus]);

    const removeImage = useCallback((setImages, setRemoving, index) => {
        setRemoving(index);
        window.setTimeout(() => {
            setImages((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
            setRemoving(null);
        }, 180);
    }, []);

    const loadFromPrompt = useCallback(() => {
        setPolishInput(prompt || "");
        pushStatus(TEXT.promptFromMain, 1800);
    }, [prompt, pushStatus]);

    const handlePolish = useCallback(async () => {
        const hasInput = polishInput.trim() || polishImages.length > 0;
        if (!hasInput || isLoading) return;
        const result = await runLocalTask(TEXT.polishLabel, async () => polishPromptText(polishInput, polishImages.length));
        if (!result) return;
        setPolishResult(result);
        setPolishImages([]);
        addPolish({ input: polishInput.trim(), result, imageCount: polishImages.length });
    }, [isLoading, polishImages.length, polishInput, runLocalTask]);

    const handleChatSend = useCallback(async () => {
        const hasInput = chatInput.trim() || chatImages.length > 0;
        if (!hasInput || isLoading) return;
        const userMessage = {
            role: "user",
            text: chatInput.trim() || TEXT.referenceOnly,
            images: chatImages.length ? [...chatImages] : undefined,
        };
        const nextMessages = [...chatMessages, userMessage];
        setChatMessages(nextMessages);
        setChatInput("");
        setChatImages([]);

        const generated = await runLocalTask(TEXT.promptLabel, async () => buildPromptFromChat(nextMessages, chatImages.length));
        if (!generated) return;
        const assistantText = `\u3010\u9884\u8bbe\u3011${generated.presetName}\n\u3010\u63d0\u793a\u8bcd\u3011\n${generated.prompt}`;
        const finalMessages = [...nextMessages, { role: "model", text: assistantText }];
        setChatMessages(finalMessages);
        setParsedResult(generated);

        const snapshot = { messages: finalMessages, parsedResult: generated };
        const id = currentSessionIdRef.current;
        const updated = id && (await updateChat(id, snapshot));
        if (!updated) currentSessionIdRef.current = await addChat(snapshot);
    }, [chatImages, chatInput, chatMessages, isLoading, runLocalTask]);

    const resultText = mode === "polish" ? polishResult : parsedResult?.prompt;

    const fillPrompt = useCallback((append) => {
        const text = String(resultText || "").trim();
        if (!text) return;
        onClearPreset?.();
        if (append) setPrompt(prompt ? `${prompt}\n${text}` : text);
        else setPrompt(text);
        pushStatus(append ? TEXT.appendDone : TEXT.fillDone, 1800);
        closeDrawer?.();
    }, [closeDrawer, onClearPreset, prompt, pushStatus, resultText, setPrompt]);

    const handleSaveToPreset = useCallback(() => {
        if (!parsedResult?.prompt?.trim()) return;
        const name = parsedResult.presetName || TEXT.defaultPreset;
        try {
            PresetManager.add(name, "\u6211\u7684", parsedResult.prompt.trim());
            pushStatus(`${TEXT.savedPreset} ${name}`, 2500);
            onPresetSaved?.();
        } catch (error) {
            pushStatus(`${TEXT.saveFailed}: ${error?.message || TEXT.unknownError}`, 3000);
        }
    }, [onPresetSaved, parsedResult, pushStatus]);

    const handleResetChat = useCallback(async () => {
        const shouldSave = chatMessages.length > 0 || parsedResult?.prompt?.trim();
        if (shouldSave) {
            const snapshot = { messages: chatMessages, parsedResult: parsedResult || null };
            const id = currentSessionIdRef.current;
            const updated = id && (await updateChat(id, snapshot));
            if (!updated) await addChat(snapshot);
        }
        setChatMessages([]);
        setParsedResult(null);
        setChatImages([]);
        currentSessionIdRef.current = null;
        pushStatus(TEXT.newChat, 1800);
    }, [chatMessages, parsedResult, pushStatus]);

    const hasPolishResult = Boolean(polishResult.trim());
    const hasChatResult = Boolean(parsedResult?.prompt?.trim());
    const displayMessages = mode === "chat" ? [{ role: "model", text: TEXT.welcome }, ...chatMessages] : [];

    return (
        <div className="xlrh-assist-shell">
            <div className="xlrh-assist-section xlrh-assist-section--mode">
                <div className="xlrh-assist-tabs">
                    {MODES.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            className={cls("xlrh-assist-tab", mode === item.key && "is-active")}
                            onClick={() => setMode(item.key)}
                            disabled={isLoading}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="xlrh-assist-rule" />

            {mode === "polish" ? (
                <div className="xlrh-assist-section xlrh-assist-section--polish">
                    <div className="xlrh-assist-row">
                        <label className="xlrh-assist-label">{TEXT.inputPrompt}</label>
                        <button type="button" className="xlrh-assist-btn xlrh-assist-btn--quiet" onClick={loadFromPrompt} disabled={isLoading}>
                            {TEXT.loadMainPrompt}
                        </button>
                    </div>
                    <textarea
                        className="xlrh-assist-textarea xlrh-assist-textarea--input"
                        placeholder={TEXT.polishPlaceholder}
                        value={polishInput}
                        onChange={(event) => setPolishInput(event.target.value)}
                        onPaste={(event) => handlePaste(event, setPolishImages, polishImages.length)}
                        disabled={isLoading}
                        rows={3}
                    />
                    <AssistantImages
                        images={polishImages}
                        removingIndex={removingPolishIndex}
                        disabled={isLoading}
                        onRemove={(index) => removeImage(setPolishImages, setRemovingPolishIndex, index)}
                    />
                    <div className="xlrh-assist-actions">
                        <button
                            type="button"
                            className={cls("xlrh-assist-btn", "xlrh-assist-btn--primary", isLoading && "is-progress")}
                            onClick={handlePolish}
                            disabled={(!polishInput.trim() && polishImages.length === 0) || isLoading}
                        >
                            <ProgressButton busy={isLoading} progress={progress}>
                                {isLoading ? <><LoadingDot />{TEXT.processing} {Math.round(progress)}%</> : TEXT.polishAction}
                            </ProgressButton>
                        </button>
                    </div>
                    {hasPolishResult ? (
                        <div className="xlrh-assist-result">
                            <label className="xlrh-assist-label">{TEXT.polishResult}</label>
                            <textarea
                                className="xlrh-assist-textarea xlrh-assist-textarea--result"
                                value={polishResult}
                                onChange={(event) => setPolishResult(event.target.value)}
                                disabled={isLoading}
                                rows={4}
                            />
                            <div className="xlrh-assist-fill-row">
                                <button type="button" className="xlrh-assist-btn xlrh-assist-btn--fill" onClick={() => fillPrompt(false)} disabled={isLoading}>{TEXT.fill}</button>
                                <button type="button" className="xlrh-assist-btn xlrh-assist-btn--append" onClick={() => fillPrompt(true)} disabled={isLoading}>{TEXT.append}</button>
                            </div>
                        </div>
                    ) : null}
                </div>
            ) : (
                <>
                    <div className="xlrh-assist-section xlrh-assist-section--chat">
                        <div className="xlrh-assist-chat-list">
                            {displayMessages.map((message, index) => (
                                <div key={index} className={cls("xlrh-assist-msg", message.role === "user" ? "is-user" : "is-model")}>
                                    <span className="xlrh-assist-msg-role">{message.role === "user" ? TEXT.userRole : TEXT.modelRole}</span>
                                    <span className="xlrh-assist-msg-text">{message.text}</span>
                                </div>
                            ))}
                        </div>
                        {hasChatResult ? (
                            <div className="xlrh-assist-result">
                                <label className="xlrh-assist-label">{TEXT.resultTitle}: {parsedResult.presetName}</label>
                                <textarea
                                    className="xlrh-assist-textarea xlrh-assist-textarea--result"
                                    value={parsedResult.prompt}
                                    onChange={(event) => setParsedResult({ ...parsedResult, prompt: event.target.value })}
                                    disabled={isLoading}
                                    rows={4}
                                />
                                <div className="xlrh-assist-fill-row">
                                    <button type="button" className="xlrh-assist-btn xlrh-assist-btn--save" onClick={handleSaveToPreset} disabled={isLoading}>{TEXT.saveToPreset}</button>
                                    <button type="button" className="xlrh-assist-btn xlrh-assist-btn--fill" onClick={() => fillPrompt(false)} disabled={isLoading}>{TEXT.fill}</button>
                                    <button type="button" className="xlrh-assist-btn xlrh-assist-btn--append" onClick={() => fillPrompt(true)} disabled={isLoading}>{TEXT.append}</button>
                                </div>
                            </div>
                        ) : null}
                    </div>

                    <div className="xlrh-assist-rule" />

                    <div className="xlrh-assist-section xlrh-assist-section--input">
                        <textarea
                            className="xlrh-assist-chat-input"
                            placeholder={displayMessages.length <= 1 ? TEXT.firstPlaceholder : TEXT.continuePlaceholder}
                            value={chatInput}
                            onChange={(event) => setChatInput(event.target.value)}
                            onPaste={(event) => handlePaste(event, setChatImages, chatImages.length)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" && !event.shiftKey) {
                                    event.preventDefault();
                                    handleChatSend();
                                }
                            }}
                            disabled={isLoading}
                            rows={2}
                        />
                        <AssistantImages
                            images={chatImages}
                            removingIndex={removingChatIndex}
                            disabled={isLoading}
                            onRemove={(index) => removeImage(setChatImages, setRemovingChatIndex, index)}
                        />
                        <div className="xlrh-assist-chat-actions">
                            <button type="button" className="xlrh-assist-btn xlrh-assist-btn--quiet" onClick={handleResetChat} disabled={isLoading}>{TEXT.newConversation}</button>
                            <button
                                type="button"
                                className={cls("xlrh-assist-btn", "xlrh-assist-btn--primary", isLoading && "is-progress")}
                                onClick={handleChatSend}
                                disabled={(!chatInput.trim() && chatImages.length === 0) || isLoading}
                            >
                                <ProgressButton busy={isLoading} progress={progress}>
                                    {isLoading ? <><LoadingDot />{TEXT.generating} {Math.round(progress)}%</> : TEXT.send}
                                </ProgressButton>
                            </button>
                        </div>
                    </div>
                </>
            )}

            {errorDialog.visible ? (
                <div className="xlrh-assist-error-overlay" onClick={() => setErrorDialog({ visible: false, message: "" })}>
                    <div className="xlrh-assist-error-dialog" onClick={(event) => event.stopPropagation()}>
                        <div className="xlrh-assist-error-header">
                            <span>{TEXT.errorTitle}</span>
                            <button type="button" className="xlrh-assist-error-close" onClick={() => setErrorDialog({ visible: false, message: "" })}>x</button>
                        </div>
                        <div className="xlrh-assist-error-body">{errorDialog.message}</div>
                        <div className="xlrh-assist-error-actions">
                            <button type="button" className="xlrh-assist-error-btn" onClick={() => setErrorDialog({ visible: false, message: "" })}>{TEXT.close}</button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
};

export const PromptAssistantPanel = forwardRef(PromptAssistantPanelInner);
