import React from "react";
import "./UpscalePanel.css";

export function UpscalePanel() {
    return (
        <div className="upscale-panel">
            <section className="upscale-section upscale-section-input">
                <div className="upscale-section-title">超清</div>
                <div className="upscale-exec-card has-result">
                    <div className="upscale-exec-info-col">
                        <div className="upscale-status-bar success">
                            <div className="status-text-row">
                                <span className="status-prefix">状态</span>
                                <span className="status-msg">当前版本未启用本地超清模块</span>
                            </div>
                            <div className="status-sub visible">请使用 RunningHub 应用完成放大流程。</div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}

export default UpscalePanel;
