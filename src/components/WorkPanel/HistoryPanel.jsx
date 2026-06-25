import React, { useCallback, useMemo } from "react";
import { HistoryList } from "./HistoryList.jsx";
import "./HistoryList.css";
import "./HistoryPanel.css";

const HISTORY_TABS = Object.freeze([
    { key: "reverse", label: "反推历史" },
    { key: "assistant", label: "提示词历史" },
    { key: "editAssistant", label: "修图历史" },
]);

function historyTypeFor(drawerType, assistantMode) {
    if (drawerType === "editAssistant") return "evaluate";
    if (drawerType === "assistant") return assistantMode === "polish" ? "polish" : "chat";
    return "reverse";
}

function panelTitleFor(drawerType, assistantMode) {
    if (drawerType === "editAssistant") return "修图评价";
    if (drawerType === "assistant") return assistantMode === "polish" ? "提示词 / 润色" : "提示词 / 对话";
    return "反推历史";
}

function useActionAndClose(onBackToMain) {
    return useCallback(
        (handler) => (item) => {
            handler?.(item);
            onBackToMain?.();
        },
        [onBackToMain]
    );
}

function HistoryPanelTabs({ activeType }) {
    const activeIndex = Math.max(0, HISTORY_TABS.findIndex((tab) => tab.key === activeType));
    return (
        <div className="history-panel-tabs" aria-label="历史视图">
            {HISTORY_TABS.map((tab, index) => (
                <span key={tab.key} className={`history-panel-tab ${index === activeIndex ? "active" : ""}`}>
                    {tab.label}
                </span>
            ))}
        </div>
    );
}

export const HistoryPanel = ({
    drawerType,
    assistantMode = "chat",
    drawerContentRef,
    isVisible = false,
    onFillReplace,
    onFillAppend,
    onSelect,
    onBackToMain,
}) => {
    const historyType = useMemo(() => historyTypeFor(drawerType, assistantMode), [assistantMode, drawerType]);
    const panelLabel = useMemo(() => panelTitleFor(drawerType, assistantMode), [assistantMode, drawerType]);
    const closeAfterAction = useActionAndClose(onBackToMain);
    const canFill = drawerType !== "editAssistant";

    return (
        <section className="history-panel-inner" aria-label={panelLabel}>
            <HistoryPanelTabs activeType={drawerType} />
            <div className="history-panel-list" data-panel-label={panelLabel}>
                <HistoryList
                    type={historyType}
                    drawerContentRef={drawerContentRef}
                    isVisible={isVisible}
                    canFill={canFill}
                    onSelect={closeAfterAction(onSelect)}
                    onFillReplace={closeAfterAction(onFillReplace)}
                    onFillAppend={closeAfterAction(onFillAppend)}
                />
            </div>
        </section>
    );
};

export default HistoryPanel;
