import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PromptSection } from "./PromptSection.jsx";
import { OptionalParams } from "./OptionalParams.jsx";
import { useDrawer } from "./WorkPanel/DrawerContext.jsx";
import { REF_KEYS, createEmptyRefMap } from "./ImageUpload/constants.js";
import PresetManager from "../utils/PresetManager.js";
import "./Parameter.css";

const DIALOG_ANIMATION_MS = 160;
const TEXTAREA_MIN_HEIGHT = 44;
const TEXTAREA_MAX_HEIGHT = 260;
const DEFAULT_CATEGORY = "我的";

function uniqueValues(values) {
    const seen = new Set();
    return values.filter((value) => {
        const text = String(value || "").trim();
        if (!text || seen.has(text)) return false;
        seen.add(text);
        return true;
    });
}

function loadCategoryChoices(defaultCategory) {
    let stored = [];
    try {
        stored = PresetManager.getCategories() || [];
    } catch (_) {
        stored = [];
    }
    return uniqueValues([defaultCategory || DEFAULT_CATEGORY, ...stored]);
}

function buildRefDraft(initialRefs, currentRefPreviews) {
    const next = createEmptyRefMap();
    for (const key of REF_KEYS) next[key] = initialRefs?.[key] || currentRefPreviews?.[key] || null;
    return next;
}

function useTextareaAutoHeight(textareaRef, value) {
    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.style.height = "auto";
        const wanted = Math.max(TEXTAREA_MIN_HEIGHT, Math.min(TEXTAREA_MAX_HEIGHT, textarea.scrollHeight));
        textarea.style.height = `${wanted}px`;
    }, [textareaRef, value]);
}

function DialogControl({ id, label, children, className = "" }) {
    return (
        <div className={`preset-editor-control-box ${className}`.trim()}>
            {id ? (
                <label className="preset-editor-control-label" htmlFor={id}>{label}</label>
            ) : (
                <span className="preset-editor-control-label">{label}</span>
            )}
            <div className="preset-editor-control-divider" aria-hidden="true" />
            <div className="preset-editor-control-content">{children}</div>
        </div>
    );
}

function CategoryPicker({ categories, value, onChange }) {
    return (
        <div className="preset-editor-category-bar preset-editor-category-bar--inline">
            {categories.map((category) => (
                <button
                    key={category}
                    type="button"
                    className={`preset-editor-category-pill ${category === value ? "active" : ""}`}
                    onClick={() => onChange(category)}
                >
                    {category}
                </button>
            ))}
        </div>
    );
}

function PresetReferenceStrip({ refs, onRemove }) {
    const visibleKeys = REF_KEYS.filter((key) => refs?.[key]);
    if (!visibleKeys.length) return null;

    return (
        <div className="preset-editor-row preset-editor-row--refs">
            <label className="preset-editor-label">参考图会随预设保存</label>
            <div className="preset-editor-refs">
                {visibleKeys.map((key) => (
                    <div key={key} className="preset-editor-ref-item">
                        <img src={refs[key]} className="preset-editor-ref-img" alt={key} />
                        <button
                            type="button"
                            className="preset-editor-ref-remove"
                            onClick={() => onRemove(key)}
                            title="移除参考图"
                        >
                            x
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

function PresetDialogHeader({ title, canSave, onCancel, onSave }) {
    return (
        <div className="preset-editor-header-row">
            <div className="preset-editor-title-wrap">
                <span className="preset-editor-title-icon" aria-hidden="true">+</span>
                <div className="preset-editor-title">{title}</div>
            </div>
            <div className="preset-editor-header-actions">
                <button type="button" className="preset-editor-btn cancel preset-editor-btn--header" onClick={onCancel}>
                    取消
                </button>
                <button type="button" className="preset-editor-btn save preset-editor-btn--header" onClick={onSave} disabled={!canSave}>
                    保存
                </button>
            </div>
        </div>
    );
}

function AddPresetDialog({
    mode = "add",
    defaultCategory,
    initialPrompt = "",
    initialName = "",
    initialRefs = null,
    currentRefPreviews,
    onSave,
    onCancel,
}) {
    const [name, setName] = useState(initialName || "");
    const [category, setCategory] = useState(defaultCategory || DEFAULT_CATEGORY);
    const [content, setContent] = useState(initialPrompt || "");
    const [refDraft, setRefDraft] = useState(() => buildRefDraft(initialRefs, currentRefPreviews));
    const [closing, setClosing] = useState(false);
    const overlayRef = useRef(null);
    const textareaRef = useRef(null);
    const backdropMouseDownRef = useRef(false);

    const categories = useMemo(() => loadCategoryChoices(defaultCategory), [defaultCategory]);
    const dialogTitle = mode === "edit" ? "编辑预设" : "新增预设";
    const canSave = name.trim().length > 0 && !closing;

    useTextareaAutoHeight(textareaRef, content);

    const closeAfterAnimation = useCallback(() => {
        if (closing) return;
        setClosing(true);
        window.setTimeout(() => onCancel?.(), DIALOG_ANIMATION_MS);
    }, [closing, onCancel]);

    const saveAfterAnimation = useCallback(() => {
        if (!canSave) return;
        const payload = {
            name: name.trim(),
            category: category || DEFAULT_CATEGORY,
            prompt: content.trim(),
            refImages: refDraft,
        };
        setClosing(true);
        window.setTimeout(() => {
            Promise.resolve(onSave?.(payload)).catch(() => {});
        }, DIALOG_ANIMATION_MS);
    }, [canSave, category, content, name, onSave, refDraft]);

    const removeRef = useCallback((key) => {
        setRefDraft((current) => ({ ...current, [key]: null }));
    }, []);

    const rememberBackdropMouseDown = useCallback((event) => {
        backdropMouseDownRef.current = event.target === overlayRef.current;
    }, []);

    const closeFromBackdrop = useCallback((event) => {
        const shouldClose = event.target === overlayRef.current && backdropMouseDownRef.current;
        backdropMouseDownRef.current = false;
        if (shouldClose) closeAfterAnimation();
    }, [closeAfterAnimation]);

    return (
        <div
            ref={overlayRef}
            className={`preset-editor-overlay preset-editor-overlay--in-card ${closing ? "is-exiting" : ""}`}
            onMouseDown={rememberBackdropMouseDown}
            onMouseUp={closeFromBackdrop}
        >
            <div
                className={`preset-editor-panel preset-editor-panel--in-card ${closing ? "is-exiting" : ""}`}
                role="dialog"
                aria-modal="true"
                onMouseDown={(event) => event.stopPropagation()}
                onMouseUp={(event) => event.stopPropagation()}
            >
                <PresetDialogHeader
                    title={dialogTitle}
                    canSave={canSave}
                    onCancel={closeAfterAnimation}
                    onSave={saveAfterAnimation}
                />

                <div className="preset-editor-fixed-top">
                    <DialogControl id="xlrh-preset-name" label="名称">
                        <input
                            id="xlrh-preset-name"
                            className="preset-editor-control-input"
                            type="text"
                            value={name}
                            placeholder="预设名称"
                            onChange={(event) => setName(event.target.value)}
                        />
                    </DialogControl>
                    <DialogControl label="分类" className="preset-editor-control-box--category">
                        <div className="preset-editor-control-content--category">
                            <CategoryPicker categories={categories} value={category} onChange={setCategory} />
                        </div>
                    </DialogControl>
                </div>

                <div className="preset-add-middle">
                    <DialogControl id="xlrh-preset-content" label="内容" className="preset-add-content-box">
                        <textarea
                            id="xlrh-preset-content"
                            ref={textareaRef}
                            className="preset-add-content-textarea"
                            placeholder="预设提示词内容..."
                            value={content}
                            onChange={(event) => setContent(event.target.value)}
                            spellCheck={false}
                        />
                    </DialogControl>
                    <PresetReferenceStrip refs={refDraft} onRemove={removeRef} />
                </div>
            </div>
        </div>
    );
}

function DrawerShortcutButton({ className, title, onClick, children }) {
    return (
        <button type="button" className={`drawer-entry-btn ${className}`} onClick={onClick} title={title}>
            {children}
        </button>
    );
}

function shouldShowPresetDialog(editorState) {
    return editorState?.mode === "add" || editorState?.mode === "edit";
}

export const Parameter = ({
    prompt,
    setPrompt,
    model,
    setModel,
    ratio,
    setRatio,
    size,
    setSize,
    count,
    setCount,
    isRunning,
    onPresetLoadRefs,
    onPresetClearRefs,
    currentRefPreviews,
    presetRefreshTrigger = 0,
    clearPresetRef,
}) => {
    const [editorState, setEditorState] = useState(null);
    const [paramCardMountEl, setParamCardMountEl] = useState(null);
    const { openReverse, openAssistant, openEditAssistant } = useDrawer();

    const bindParamCard = useCallback((node) => setParamCardMountEl(node), []);
    const closeEditor = useCallback(() => setEditorState(null), []);
    const saveEditor = useCallback(async (payload) => {
        if (editorState?.onSave) await editorState.onSave(payload);
        setEditorState(null);
    }, [editorState]);

    return (
        <div className="param-card-inner" ref={bindParamCard}>
            <div className="param-section-block">
                <div className="section-label-row">
                    <label className="section-label">提示词 / 预设</label>
                    <div className="drawer-entry-btns">
                        <DrawerShortcutButton className="drawer-entry-reverse" onClick={openReverse} title="图片反推">
                            反推
                        </DrawerShortcutButton>
                        <DrawerShortcutButton className="drawer-entry-assistant" onClick={openAssistant} title="提示词小助手">
                            提示词
                        </DrawerShortcutButton>
                        <DrawerShortcutButton className="drawer-entry-editAssistant" onClick={openEditAssistant} title="修图评价小助手">
                            修图
                        </DrawerShortcutButton>
                    </div>
                </div>
                <PromptSection
                    prompt={prompt}
                    setPrompt={setPrompt}
                    editorState={editorState}
                    setEditorState={setEditorState}
                    isRunning={isRunning}
                    onPresetLoadRefs={onPresetLoadRefs}
                    onPresetClearRefs={onPresetClearRefs}
                    currentRefPreviews={currentRefPreviews}
                    presetRefreshTrigger={presetRefreshTrigger}
                    clearPresetRef={clearPresetRef}
                    overlayMountEl={paramCardMountEl}
                />
            </div>

            <div className="section-divider" />

            <div className="param-section-block">
                <label className="section-label">选择参数</label>
                <OptionalParams
                    model={model}
                    setModel={setModel}
                    ratio={ratio}
                    setRatio={setRatio}
                    size={size}
                    setSize={setSize}
                    count={count}
                    setCount={setCount}
                    editorOpen={editorState !== null}
                />
            </div>

            {shouldShowPresetDialog(editorState) ? (
                <AddPresetDialog
                    mode={editorState.mode}
                    defaultCategory={editorState.defaultCategory}
                    initialPrompt={editorState.initialPrompt ?? prompt}
                    initialName={editorState.initialName || ""}
                    initialRefs={editorState.initialRefs || null}
                    currentRefPreviews={currentRefPreviews}
                    onSave={saveEditor}
                    onCancel={closeEditor}
                />
            ) : null}
        </div>
    );
};
