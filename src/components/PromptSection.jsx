import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./PromptSection.css";
import { usePersistedState } from "../hooks/usePersistedState.js";
import PresetManager from "../utils/PresetManager.js";
import { useStatus } from "../utils/StatusContext.jsx";
import { REF_KEYS, createEmptyRefMap } from "./ImageUpload/constants.js";
import { readPresetPreviewMap, removePresetPreviewThumb } from "../utils/presetPreviewStore.js";

function presetRefSlots(preset) {
    if (!preset) return [];
    return REF_KEYS.filter((key) => Boolean(preset[`hasRef${key.slice(3)}`]));
}

function presetHasAnyRef(preset) {
    return presetRefSlots(preset).length > 0;
}

function splitPresetName(name) {
    const chars = [...String(name || "预设")];
    if (chars.length <= 4) return [chars.join(""), ""];
    const mid = Math.ceil(chars.length / 2);
    return [chars.slice(0, mid).join(""), chars.slice(mid).join("")];
}

function pointMenuPosition(event) {
    return { left: event.clientX, top: event.clientY };
}

function usePromptAutosize(ref, value) {
    useEffect(() => {
        const node = ref.current;
        if (!node) return;
        node.style.height = "auto";
        const nextHeight = Math.max(37, Math.min(472, node.scrollHeight));
        node.style.height = `${nextHeight}px`;
        node.style.overflowY = node.scrollHeight > nextHeight + 2 ? "auto" : "hidden";
    }, [ref, value]);
}

function PresetTile({ preset, active, onUse, onMore, onContextMenu }) {
    const [line1, line2] = splitPresetName(preset.name);
    return (
        <div
            className={`preset-item ${active ? "active" : ""} ${presetHasAnyRef(preset) ? "has-ref" : ""}`}
            title={preset.name}
            onClick={() => onUse(preset)}
            onContextMenu={(event) => {
                event.preventDefault();
                onContextMenu(event, preset);
            }}
        >
            <span className="preset-item-drag-handle" aria-hidden="true">::</span>
            <span className="preset-item-label">
                <span className="preset-item-label-line">{line1}</span>
                {line2 ? <span className="preset-item-label-line">{line2}</span> : null}
            </span>
            <button
                type="button"
                className="preset-item-more"
                title="更多操作"
                onClick={(event) => {
                    event.stopPropagation();
                    onMore(event, preset);
                }}
            >
                ...
            </button>
            {presetHasAnyRef(preset) ? <span className="preset-ref-dot" /> : null}
        </div>
    );
}

function InlineDialog({ dialog, onClose, onConfirm, value, onValueChange }) {
    if (!dialog) return null;
    const isAdd = dialog.type === "addCategory";
    return (
        <div className="preset-editor-overlay preset-editor-overlay--in-card" onMouseDown={onClose}>
            <div className="preset-editor-panel preset-editor-panel--in-card preset-inline-dialog-panel" onMouseDown={(event) => event.stopPropagation()}>
                <div className="preset-editor-header-row">
                    <div className="preset-editor-title-wrap">
                        <span className="preset-editor-title-icon" aria-hidden="true">+</span>
                        <div className="preset-editor-title">{isAdd ? "新增分类" : "删除分类"}</div>
                    </div>
                    <div className="preset-editor-header-actions">
                        <button type="button" className="preset-editor-btn cancel preset-editor-btn--header" onClick={onClose}>取消</button>
                        <button
                            type="button"
                            className={`preset-editor-btn save preset-editor-btn--header ${isAdd ? "" : "preset-inline-dialog-btn--danger"}`}
                            onClick={onConfirm}
                        >
                            {isAdd ? "保存" : "删除"}
                        </button>
                    </div>
                </div>
                <div className="preset-inline-dialog-body">
                    {isAdd ? (
                        <div className="preset-editor-control-box">
                            <label className="preset-editor-control-label" htmlFor="xlrh-inline-cat-name">名称</label>
                            <div className="preset-editor-control-divider" aria-hidden="true" />
                            <div className="preset-editor-control-content">
                                <input
                                    id="xlrh-inline-cat-name"
                                    className="preset-editor-control-input"
                                    value={value}
                                    onChange={(event) => onValueChange(event.target.value)}
                                    autoFocus
                                />
                            </div>
                        </div>
                    ) : (
                        <p className="preset-inline-dialog-message">确定删除分类「{dialog.name}」？仅空分类可删除。</p>
                    )}
                </div>
            </div>
        </div>
    );
}

export const PromptSection = ({
    prompt,
    setPrompt,
    editorState,
    setEditorState,
    isRunning = false,
    onPresetLoadRefs,
    onPresetClearRefs,
    currentRefPreviews,
    presetRefreshTrigger = 0,
    clearPresetRef,
    overlayMountEl,
}) => {
    const { pushStatus } = useStatus();
    const textareaRef = useRef(null);
    const [presets, setPresets] = useState(() => PresetManager.getAll());
    const [activePresetId, setActivePresetId] = usePersistedState("xlrh_active_prompt_preset", null);
    const [activeCategory, setActiveCategory] = usePersistedState("xlrh_active_prompt_category", "人像");
    const [originalPrompt, setOriginalPrompt] = useState(prompt || "");
    const [menu, setMenu] = useState(null);
    const [categoryMenu, setCategoryMenu] = useState(null);
    const [dialog, setDialog] = useState(null);
    const [categoryInput, setCategoryInput] = useState("");
    const [previewTick, setPreviewTick] = useState(0);

    usePromptAutosize(textareaRef, prompt);

    const refreshPresets = useCallback(() => {
        PresetManager.init();
        setPresets(PresetManager.getAll());
    }, []);

    useEffect(() => {
        refreshPresets();
    }, [refreshPresets, presetRefreshTrigger]);

    useEffect(() => {
        const sync = () => setPreviewTick((value) => value + 1);
        window.addEventListener("xlrh-preset-preview-updated", sync);
        return () => {
            window.removeEventListener("xlrh-preset-preview-updated", sync);
        };
    }, []);

    const previewMap = useMemo(() => readPresetPreviewMap(), [previewTick]);
    const categories = useMemo(() => PresetManager.getCategories(), [presets, previewTick]);

    useEffect(() => {
        if (!categories.includes(activeCategory)) setActiveCategory(categories[0] || "我的");
    }, [activeCategory, categories, setActiveCategory]);

    const activePreset = useMemo(
        () => presets.find((preset) => preset.id === activePresetId) || null,
        [activePresetId, presets]
    );
    const isModified = Boolean(activePreset && prompt !== originalPrompt);
    const filteredPresets = useMemo(
        () => presets.filter((preset) => preset.category === activeCategory),
        [activeCategory, presets]
    );

    const clearActivePreset = useCallback(() => {
        const slots = presetRefSlots(activePreset);
        setActivePresetId(null);
        setOriginalPrompt(prompt || "");
        if (slots.length && onPresetClearRefs) onPresetClearRefs(slots);
        pushStatus("已取消当前预设", 1600);
    }, [activePreset, onPresetClearRefs, prompt, pushStatus, setActivePresetId]);

    useEffect(() => {
        if (!clearPresetRef) return undefined;
        clearPresetRef.current = clearActivePreset;
        return () => {
            clearPresetRef.current = null;
        };
    }, [clearPresetRef, clearActivePreset]);

    const usePreset = useCallback(async (preset, promptOverride) => {
        if (!preset) return;
        const nextPrompt = promptOverride != null ? String(promptOverride) : preset.prompt || "";
        setActivePresetId(preset.id);
        setActiveCategory(preset.category || "我的");
        setPrompt(nextPrompt);
        setOriginalPrompt(nextPrompt);
        setMenu(null);
        if (onPresetLoadRefs) {
            const refs = await PresetManager.loadRefs(preset.id);
            onPresetLoadRefs(refs);
        }
        pushStatus(`已加载预设: ${preset.name}`, 1600);
    }, [onPresetLoadRefs, pushStatus, setActiveCategory, setActivePresetId, setPrompt]);

    useEffect(() => {
        const activate = async (event) => {
            const presetId = event?.detail?.presetId;
            if (!presetId) return;
            const preset = PresetManager.getAll().find((item) => item.id === presetId);
            if (!preset) return;
            await usePreset(preset, event.detail?.promptOverride);
        };
        window.addEventListener("xlrh-activate-preset-from-external", activate);
        return () => {
            window.removeEventListener("xlrh-activate-preset-from-external", activate);
        };
    }, [usePreset]);

    const handlePresetClick = useCallback((preset) => {
        if (preset.id === activePresetId) {
            clearActivePreset();
            return;
        }
        usePreset(preset);
    }, [activePresetId, clearActivePreset, usePreset]);

    const openMenu = useCallback((event, preset) => {
        setCategoryMenu(null);
        setMenu({ presetId: preset.id, ...pointMenuPosition(event) });
    }, []);

    const closeMenus = useCallback(() => {
        setMenu(null);
        setCategoryMenu(null);
    }, []);

    useEffect(() => {
        if (!menu && !categoryMenu) return undefined;
        const close = () => closeMenus();
        window.addEventListener("mousedown", close);
        window.addEventListener("scroll", close, true);
        window.addEventListener("resize", close);
        return () => {
            window.removeEventListener("mousedown", close);
            window.removeEventListener("scroll", close, true);
            window.removeEventListener("resize", close);
        };
    }, [categoryMenu, closeMenus, menu]);

    const saveActivePreset = useCallback(() => {
        if (!activePreset || !isModified) return;
        try {
            const updated = PresetManager.update(activePreset.id, { prompt: prompt.trim() });
            setOriginalPrompt(updated.prompt || "");
            refreshPresets();
            pushStatus(`已保存: ${updated.name}`, 1800);
        } catch (error) {
            pushStatus(`保存失败: ${error.message}`, 3000);
        }
        setMenu(null);
    }, [activePreset, isModified, prompt, pushStatus, refreshPresets]);

    const removePreset = useCallback((preset) => {
        if (!preset) return;
        PresetManager.remove(preset.id);
        removePresetPreviewThumb(preset.id);
        if (preset.id === activePresetId) setActivePresetId(null);
        refreshPresets();
        setMenu(null);
        pushStatus(`已删除预设: ${preset.name}`, 1800);
    }, [activePresetId, pushStatus, refreshPresets, setActivePresetId]);

    const openAddPreset = useCallback(() => {
        setMenu(null);
        setEditorState?.({
            mode: "add",
            defaultCategory: activeCategory,
            initialPrompt: prompt,
            onSave: async ({ name, prompt: nextPrompt, category, refImages }) => {
                const preset = PresetManager.add(name, category || activeCategory, nextPrompt);
                if (refImages) await PresetManager.saveRefs(preset.id, refImages);
                refreshPresets();
                await usePreset(preset);
                pushStatus(`新增成功: ${preset.name}`, 1800);
            },
        });
    }, [activeCategory, prompt, pushStatus, refreshPresets, setEditorState, usePreset]);

    const openEditPreset = useCallback(async (preset) => {
        if (!preset) return;
        setMenu(null);
        const initialRefs = await PresetManager.loadRefs(preset.id);
        setEditorState?.({
            mode: "edit",
            presetId: preset.id,
            initialName: preset.name,
            defaultCategory: preset.category || activeCategory,
            initialPrompt: preset.prompt || "",
            initialRefs,
            onSave: async ({ name, prompt: nextPrompt, category, refImages }) => {
                const updated = PresetManager.update(preset.id, {
                    name,
                    prompt: nextPrompt,
                    category: category || preset.category || activeCategory,
                });
                await PresetManager.saveRefs(preset.id, refImages || createEmptyRefMap());
                refreshPresets();
                await usePreset(updated);
                pushStatus(`已更新: ${updated.name}`, 1800);
            },
        });
    }, [activeCategory, pushStatus, refreshPresets, setEditorState, usePreset]);

    const confirmAddCategory = useCallback(() => {
        const result = PresetManager.addCustomCategory(categoryInput);
        if (!result.ok) {
            pushStatus(result.message || "新增分类失败", 2200);
            return;
        }
        setActiveCategory(result.name);
        setCategoryInput("");
        setDialog(null);
        refreshPresets();
        pushStatus(`已新增分类: ${result.name}`, 1800);
    }, [categoryInput, pushStatus, refreshPresets, setActiveCategory]);

    const confirmDeleteCategory = useCallback(() => {
        if (!dialog?.name) return;
        const result = PresetManager.removeCustomCategory(dialog.name);
        if (!result.ok) {
            pushStatus(result.message || "删除分类失败", 2200);
            setDialog(null);
            return;
        }
        setActiveCategory("我的");
        setDialog(null);
        refreshPresets();
        pushStatus(`已删除分类: ${dialog.name}`, 1800);
    }, [dialog, pushStatus, refreshPresets, setActiveCategory]);

    const menuPreset = menu ? presets.find((preset) => preset.id === menu.presetId) : null;

    return (
        <>
            <div className="prompt-section">
                <div className="prompt-textarea-wrapper" style={{ minHeight: "37px" }}>
                    <textarea
                        ref={textareaRef}
                        className="prompt-sp-textarea"
                        rows={1}
                        value={prompt}
                        readOnly={Boolean(editorState)}
                        disabled={isRunning}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder="输入提示词..."
                    />
                </div>

                <div className="prompt-preset-divider" />

                <div className="preset-category-block has-category-selected">
                    <div className="preset-panel">
                        <div className="preset-category-row">
                            <div className="preset-category-segmented" role="tablist">
                                {categories.map((category) => (
                                    <button
                                        key={category}
                                        type="button"
                                        className={`preset-category-segment ${activeCategory === category ? "active" : ""} ${activePreset?.category === category ? "preset-category-segment--preset-source" : ""}`}
                                        onClick={() => setActiveCategory(category)}
                                        onContextMenu={(event) => {
                                            event.preventDefault();
                                            setMenu(null);
                                            setCategoryMenu({ name: category, ...pointMenuPosition(event) });
                                        }}
                                    >
                                        {category}
                                    </button>
                                ))}
                                <button
                                    type="button"
                                    className="preset-category-segment"
                                    title="新增分类"
                                    onClick={() => {
                                        setCategoryInput("");
                                        setDialog({ type: "addCategory" });
                                    }}
                                >
                                    +
                                </button>
                            </div>
                        </div>

                        <div className="preset-panel-main">
                            <div className="preset-category-grid-shell">
                                <div className="preset-grid preset-category-grid-inner">
                                    {filteredPresets.map((preset) => (
                                        <PresetTile
                                            key={preset.id}
                                            preset={preset}
                                            active={activePresetId === preset.id}
                                            onUse={handlePresetClick}
                                            onMore={openMenu}
                                            onContextMenu={openMenu}
                                        />
                                    ))}
                                    {!filteredPresets.length ? <div className="preset-empty">暂无预设</div> : null}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="preset-toolbar">
                    <div className="toolbar-group">
                        <button type="button" className="toolbar-btn" onClick={openAddPreset}>新增预设</button>
                        <button type="button" className="toolbar-btn" onClick={saveActivePreset} disabled={!isModified}>保存修改</button>
                    </div>
                </div>
            </div>

            {menu && menuPreset ? (
                <div className="preset-context-menu" style={{ left: `${menu.left}px`, top: `${menu.top}px` }} onMouseDown={(event) => event.stopPropagation()}>
                    <button type="button" className="preset-context-menu__item" onClick={() => usePreset(menuPreset)}>使用预设</button>
                    <button type="button" className="preset-context-menu__item" onClick={() => openEditPreset(menuPreset)}>编辑</button>
                    <button type="button" className="preset-context-menu__item" disabled={!(activePresetId === menuPreset.id && isModified)} onClick={saveActivePreset}>保存修改</button>
                    <div className="preset-context-menu__sep" role="separator" />
                    <button type="button" className="preset-context-menu__item danger" onClick={() => removePreset(menuPreset)}>删除</button>
                </div>
            ) : null}

            {categoryMenu ? (
                <div className="preset-context-menu" style={{ left: `${categoryMenu.left}px`, top: `${categoryMenu.top}px` }} onMouseDown={(event) => event.stopPropagation()}>
                    <button
                        type="button"
                        className="preset-context-menu__item"
                        onClick={() => {
                            setCategoryInput("");
                            setDialog({ type: "addCategory" });
                            setCategoryMenu(null);
                        }}
                    >
                        新增分类
                    </button>
                    <button
                        type="button"
                        className="preset-context-menu__item danger"
                        disabled={PresetManager.isBuiltinCategory(categoryMenu.name)}
                        onClick={() => {
                            setDialog({ type: "deleteCategory", name: categoryMenu.name });
                            setCategoryMenu(null);
                        }}
                    >
                        删除分类
                    </button>
                </div>
            ) : null}

            <InlineDialog
                dialog={dialog}
                value={categoryInput}
                onValueChange={setCategoryInput}
                onClose={() => setDialog(null)}
                onConfirm={dialog?.type === "addCategory" ? confirmAddCategory : confirmDeleteCategory}
            />
        </>
    );
};
