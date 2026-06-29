import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom";
import {
    clear as clearHistory,
    exportHistory,
    getExportFilename,
    list,
    remove as removeHistory,
    search as searchHistory,
} from "../../utils/InferenceHistoryManager.js";
import "./HistoryList.css";

const PAGE_STEP = 20;
const EXPORT_MENU = Object.freeze({ width: 88, height: 72, gap: 4 });
const EXPORT_PORTAL_CLASS = "xlrh-ledger-export-menu-portal";

const PREVIEW_READER = Object.freeze({
    reverse: (item) => item?.result,
    evaluate: (item) => item?.result,
    polish: (item) => item?.result || item?.input,
    chat: (item) => item?.messages?.[0]?.text || item?.parsedResult?.prompt,
});

function clean(value) {
    return String(value || "").trim();
}

function compactPreview(item, type) {
    const reader = PREVIEW_READER[type] || PREVIEW_READER.reverse;
    const value = clean(reader(item));
    return value.length > 50 ? `${value.slice(0, 50)}...` : value;
}

function historyTime(ts) {
    const stamp = new Date(ts);
    const now = new Date();
    const time = stamp.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    if (stamp.toDateString() === now.toDateString()) return time;
    return `${stamp.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })} ${time}`;
}

function loadRecords(type, keyword) {
    const query = clean(keyword);
    return query ? searchHistory(type, query) : list(type);
}

function canApplyHistory(item) {
    return Boolean(item?.result || item?.parsedResult?.prompt);
}

function downloadBlobText(content, filename, mimeType) {
    try {
        const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        return true;
    } catch (error) {
        console.warn("[XLRH Ledger] export failed:", error);
        return false;
    }
}

function rectForExportMenu(button) {
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
    const shouldOpenUp = viewportHeight && viewportHeight - rect.bottom < EXPORT_MENU.height && rect.top > EXPORT_MENU.height;
    return {
        top: shouldOpenUp ? rect.top - EXPORT_MENU.height - EXPORT_MENU.gap : rect.bottom + EXPORT_MENU.gap,
        left: rect.right - EXPORT_MENU.width,
        width: EXPORT_MENU.width,
    };
}

function usePagedHistory(type, visible) {
    const [keyword, setKeyword] = useState("");
    const [records, setRecords] = useState(() => loadRecords(type, ""));
    const [limit, setLimit] = useState(PAGE_STEP);

    const reload = useCallback(() => {
        setRecords(loadRecords(type, keyword));
        setLimit(PAGE_STEP);
    }, [keyword, type]);

    useEffect(() => { reload(); }, [reload]);
    useEffect(() => { if (visible) reload(); }, [visible, reload]);

    const more = useCallback(() => {
        setLimit((value) => Math.min(value + PAGE_STEP, records.length));
    }, [records.length]);

    return { keyword, setKeyword, records, limit, reload, more };
}

function useExportPopover(buttonRef, open, setOpen) {
    const [anchor, setAnchor] = useState(null);

    const refresh = useCallback(() => {
        setAnchor(rectForExportMenu(buttonRef.current));
    }, [buttonRef]);

    const toggle = useCallback(() => {
        setAnchor(rectForExportMenu(buttonRef.current));
        setOpen((value) => !value);
    }, [buttonRef, setOpen]);

    useEffect(() => {
        if (!open) return undefined;
        const close = (event) => {
            const target = event.target;
            if (buttonRef.current?.contains(target)) return;
            if (target?.closest?.(`.${EXPORT_PORTAL_CLASS}`)) return;
            setOpen(false);
        };
        refresh();
        document.addEventListener("mousedown", close, true);
        window.addEventListener("resize", refresh);
        return () => {
            document.removeEventListener("mousedown", close, true);
            window.removeEventListener("resize", refresh);
        };
    }, [buttonRef, open, refresh, setOpen]);

    return { anchor, toggle };
}

function useMoreSentinel(enabled, onMore, rootRef) {
    const ref = useRef(null);

    useEffect(() => {
        const node = ref.current;
        if (!enabled || !node || typeof IntersectionObserver === "undefined") return undefined;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) onMore();
            },
            { root: rootRef.current, rootMargin: "40px", threshold: 0 }
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [enabled, onMore, rootRef]);

    return ref;
}

function HistoryExportMenu({ anchor, onExportJson, onExportTxt }) {
    if (typeof document === "undefined" || !document.body || !anchor) return null;
    return ReactDOM.createPortal(
        <div
            className={`xlrh-ledger-export-menu ${EXPORT_PORTAL_CLASS}`}
            style={{ position: "fixed", top: anchor.top, left: anchor.left, minWidth: anchor.width }}
            onClick={(event) => event.stopPropagation()}
        >
            <button type="button" className="xlrh-ledger-export-item" onClick={onExportJson} title="导出 JSON 格式">JSON</button>
            <button type="button" className="xlrh-ledger-export-item" onClick={onExportTxt} title="导出 TXT 格式">TXT</button>
        </div>,
        document.body
    );
}

function ClearHistoryDialog({ targetRef, onCancel, onConfirm }) {
    if (typeof document === "undefined" || !document.body) return null;
    return ReactDOM.createPortal(
        <div className="xlrh-ledger-confirm-overlay" onClick={onCancel}>
            <div className="xlrh-ledger-confirm-dialog" onClick={(event) => event.stopPropagation()}>
                <div className="xlrh-ledger-confirm-title">确定清空全部历史记录？</div>
                <div className="xlrh-ledger-confirm-actions">
                    <button type="button" className="xlrh-ledger-confirm-btn xlrh-ledger-confirm-cancel" onClick={onCancel}>取消</button>
                    <button type="button" className="xlrh-ledger-confirm-btn xlrh-ledger-confirm-ok" onClick={onConfirm}>确定</button>
                </div>
            </div>
        </div>,
        targetRef?.current || document.body
    );
}

function HistoryToolbar({ keyword, onKeyword, hasRecords, exportOpen, exportAnchor, exportButtonRef, onToggleExport, onExport, onClear }) {
    return (
        <div className="xlrh-ledger-toolbar">
            <input
                type="text"
                className="xlrh-ledger-search"
                placeholder="搜索历史..."
                value={keyword}
                onChange={(event) => onKeyword(event.target.value)}
            />
            <div className="xlrh-ledger-actions">
                {hasRecords ? (
                    <div className="xlrh-ledger-export-wrap">
                        <button ref={exportButtonRef} type="button" className="xlrh-ledger-btn" title="导出" onClick={onToggleExport}>
                            <span>导出</span>
                            <span className={"xlrh-ledger-export-caret" + (exportOpen ? " open" : "")}>▼</span>
                        </button>
                        {exportOpen ? (
                            <HistoryExportMenu
                                anchor={exportAnchor}
                                onExportJson={() => onExport("json")}
                                onExportTxt={() => onExport("txt")}
                            />
                        ) : null}
                    </div>
                ) : null}
                {hasRecords ? (
                    <button type="button" className="xlrh-ledger-btn xlrh-ledger-btn-clear" onClick={onClear} title="清空全部">
                        清空
                    </button>
                ) : null}
            </div>
        </div>
    );
}

function stopAndRun(event, item, handler) {
    event.stopPropagation();
    handler?.(item);
}

function HistoryRow({ item, type, canFill, onSelect, onFillReplace, onFillAppend, onRemove }) {
    const fillable = canFill && canApplyHistory(item);
    const preview = compactPreview(item, type);

    return (
        <div className={`xlrh-ledger-row ${fillable ? "is-selectable" : ""}`} onClick={() => onSelect?.(item)}>
            <div className="xlrh-ledger-row-main">
                <span className="xlrh-ledger-time">{historyTime(item.ts)}</span>
                <span className="xlrh-ledger-preview">{preview || "(无内容)"}</span>
            </div>
            <div className="xlrh-ledger-row-actions">
                {fillable ? (
                    <>
                        <button type="button" className="xlrh-ledger-fill" title="填入（替换）" onClick={(event) => stopAndRun(event, item, onFillReplace)}>
                            填入
                        </button>
                        <button type="button" className="xlrh-ledger-fill" title="追加" onClick={(event) => stopAndRun(event, item, onFillAppend)}>
                            追加
                        </button>
                    </>
                ) : null}
                <button
                    type="button"
                    className="xlrh-ledger-delete"
                    title="删除"
                    onClick={(event) => {
                        event.stopPropagation();
                        onRemove?.(item.id);
                    }}
                >
                    ×
                </button>
            </div>
        </div>
    );
}

function HistoryRows({ rows, type, canFill, onSelect, onFillReplace, onFillAppend, onRemove, sentinelRef, hasMore, remaining, onLoadMore, keyword }) {
    if (!rows.length) {
        return <div className="xlrh-ledger-empty">{keyword.trim() ? "无匹配记录" : "暂无历史记录"}</div>;
    }

    return (
        <>
            {rows.map((item) => (
                <HistoryRow
                    key={item.id}
                    item={item}
                    type={type}
                    canFill={canFill}
                    onSelect={onSelect}
                    onFillReplace={onFillReplace}
                    onFillAppend={onFillAppend}
                    onRemove={onRemove}
                />
            ))}
            {hasMore ? (
                <div ref={sentinelRef} className="xlrh-ledger-sentinel">
                    <button type="button" className="xlrh-ledger-load-more" onClick={onLoadMore}>
                        加载更多（{remaining} 条）
                    </button>
                </div>
            ) : null}
        </>
    );
}

export const HistoryList = ({
    type,
    drawerContentRef,
    isVisible = false,
    onSelect,
    onFillReplace,
    onFillAppend,
    canFill = false,
    onItemsChange,
}) => {
    const { keyword, setKeyword, records, limit, reload, more } = usePagedHistory(type, isVisible);
    const [exportOpen, setExportOpen] = useState(false);
    const [clearOpen, setClearOpen] = useState(false);
    const exportButtonRef = useRef(null);
    const scrollRef = useRef(null);
    const rows = useMemo(() => records.slice(0, limit), [records, limit]);
    const hasMore = limit < records.length;
    const sentinelRef = useMoreSentinel(hasMore, more, scrollRef);
    const exportMenu = useExportPopover(exportButtonRef, exportOpen, setExportOpen);

    const notifyChange = useCallback(() => {
        reload();
        onItemsChange?.();
    }, [onItemsChange, reload]);

    const removeItem = useCallback((id) => {
        removeHistory(type, id);
        notifyChange();
    }, [notifyChange, type]);

    const clearItems = useCallback(() => {
        clearHistory(type);
        setClearOpen(false);
        notifyChange();
    }, [notifyChange, type]);

    const exportItems = useCallback((format) => {
        const json = format === "json";
        const ext = json ? "json" : "txt";
        const mime = json ? "application/json" : "text/plain;charset=utf-8";
        downloadBlobText(exportHistory(type, format), `${getExportFilename(type)}.${ext}`, mime);
        setExportOpen(false);
    }, [type]);

    return (
        <div className="xlrh-ledger">
            <HistoryToolbar
                keyword={keyword}
                onKeyword={setKeyword}
                hasRecords={records.length > 0}
                exportOpen={exportOpen}
                exportAnchor={exportMenu.anchor}
                exportButtonRef={exportButtonRef}
                onToggleExport={exportMenu.toggle}
                onExport={exportItems}
                onClear={() => setClearOpen(true)}
            />
            <div className="xlrh-ledger-scroll" ref={scrollRef}>
                <HistoryRows
                    rows={rows}
                    type={type}
                    canFill={canFill}
                    onSelect={onSelect}
                    onFillReplace={onFillReplace}
                    onFillAppend={onFillAppend}
                    onRemove={removeItem}
                    sentinelRef={sentinelRef}
                    hasMore={hasMore}
                    remaining={records.length - limit}
                    onLoadMore={more}
                    keyword={keyword}
                />
            </div>
            {clearOpen ? <ClearHistoryDialog targetRef={drawerContentRef} onCancel={() => setClearOpen(false)} onConfirm={clearItems} /> : null}
        </div>
    );
};

export const HistorySection = ({ type, defaultOpen = false, onSelect, onFillReplace, onFillAppend, canFill }) => {
    const [open, setOpen] = useState(defaultOpen);
    const [version, setVersion] = useState(0);
    const count = useMemo(() => list(type).length, [type, version]);
    const refreshCount = useCallback(() => setVersion((value) => value + 1), []);
    const toggle = useCallback(() => setOpen((value) => !value), []);

    return (
        <div className="xlrh-ledger-fold">
            <div
                className={`xlrh-ledger-fold-head ${open ? "is-open" : ""}`}
                role="button"
                tabIndex={0}
                onClick={toggle}
                onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggle();
                    }
                }}
            >
                <span className="xlrh-ledger-fold-title">历史{count > 0 ? <span>({count})</span> : null}</span>
                <span className="xlrh-ledger-fold-arrow">▼</span>
            </div>
            {open ? (
                <div className="xlrh-ledger-fold-body">
                    <HistoryList
                        type={type}
                        canFill={canFill}
                        onSelect={onSelect}
                        onFillReplace={onFillReplace}
                        onFillAppend={onFillAppend}
                        onItemsChange={refreshCount}
                    />
                </div>
            ) : null}
        </div>
    );
};
