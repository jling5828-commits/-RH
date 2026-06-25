/**
 * ReversePanel.jsx
 * 小梁RH 已移除本地反推入口；抽屉中仅保留一个轻量占位面板。
 */

import React, { useImperativeHandle } from "react";
import "./ReversePanel.css";

function ReversePanelBody(_props, ref) {
    useImperativeHandle(ref, () => ({
        loadFromHistory() {
            return false;
        },
    }), []);

    return (
        <section className="reverse-panel-inner" aria-label="反推提示词">
            <p className="reverse-panel-hint" role="status">
                反推提示词功能暂不可用，请使用 RunningHub 平台功能。
            </p>
        </section>
    );
}

export const ReversePanel = React.forwardRef(ReversePanelBody);
