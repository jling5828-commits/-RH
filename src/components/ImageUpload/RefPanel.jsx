import React, { useMemo } from "react";
import { usePersistedState } from "../../hooks/usePersistedState.js";
import { useStatus } from "../../utils/StatusContext.jsx";
import RefCard from "./RefCard";

const REF_SLOTS = Object.freeze([
    Object.freeze({ key: "ref1", index: 0 }),
    Object.freeze({ key: "ref2", index: 1 }),
    Object.freeze({ key: "ref3", index: 2 }),
]);

function refPanelSummary(enabled = {}, previews = {}) {
    let enabledCount = 0;
    let hasPreview = false;

    for (const slot of REF_SLOTS) {
        if (enabled[slot.key]) enabledCount += 1;
        if (previews[slot.key]) hasPreview = true;
    }

    if (enabledCount) return `${enabledCount} 启用`;
    return hasPreview ? "已取图" : "";
}

function handleHeaderKey(event, onToggle) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onToggle();
}

function RefPanelHeader({ collapsed, summary, onToggle }) {
    return (
        <div
            className="xlup-ref-header"
            role="button"
            tabIndex={0}
            title={collapsed ? "展开参考图面板" : "折叠参考图面板"}
            onClick={onToggle}
            onKeyDown={(event) => handleHeaderKey(event, onToggle)}
        >
            <span className={`xlup-ref-arrow ${collapsed ? "" : "expanded"}`}>▸</span>
            <span className="xlup-ref-title">参考图</span>
            {collapsed && summary ? <span className="xlup-ref-summary">{summary}</span> : null}
        </div>
    );
}

function RefSlotCard({ slot, state, actions }) {
    const { refEnabled, refPreviews, refModes, refErrors, isLoading, loadingTarget } = state;
    return (
        <RefCard
            refKey={slot.key}
            index={slot.index}
            active={Boolean(refEnabled[slot.key])}
            preview={refPreviews[slot.key]}
            mode={refModes[slot.key]}
            isThisLoading={isLoading && loadingTarget === slot.key}
            errorMsg={refErrors[slot.key]}
            isLoading={isLoading}
            onToggle={() => actions.toggle(slot.key)}
            onModeChange={(mode) => actions.setMode(slot.key, mode)}
            onCapture={() => actions.capture(slot.key)}
            onClear={actions.clear ? () => actions.clear(slot.key) : undefined}
        />
    );
}

const RefPanel = ({
    refEnabled,
    refPreviews,
    refModes,
    refErrors,
    isLoading,
    loadingTarget,
    onToggleRef,
    onSetRefMode,
    onCaptureRef,
    onClearRef,
}) => {
    const { pushStatus } = useStatus();
    const [collapsed, setCollapsed] = usePersistedState("xlrh_ref_collapsed", true);
    const summary = useMemo(() => refPanelSummary(refEnabled, refPreviews), [refEnabled, refPreviews]);

    const togglePanel = () => {
        setCollapsed((value) => {
            const next = !value;
            pushStatus(next ? "参考图面板：已折叠" : "参考图面板：已展开");
            return next;
        });
    };

    const slotState = { refEnabled, refPreviews, refModes, refErrors, isLoading, loadingTarget };
    const slotActions = { toggle: onToggleRef, setMode: onSetRefMode, capture: onCaptureRef, clear: onClearRef };

    return (
        <div className="xlup-ref-panel">
            <RefPanelHeader collapsed={collapsed} summary={summary} onToggle={togglePanel} />
            <div className={`xlup-ref-section ${collapsed ? "collapsed" : ""}`}>
                {REF_SLOTS.map((slot) => (
                    <RefSlotCard key={slot.key} slot={slot} state={slotState} actions={slotActions} />
                ))}
            </div>
        </div>
    );
};

export default RefPanel;
