import React, { useMemo, useState } from "react";
import { versions } from "uxp";
import os from "os";
import { PLUGIN_CHINESE_NAME } from "../pluginMeta.js";
import { IconRhGlyph } from "./ProductSwitcherMenu.jsx";
import "./About.css";

function runtimeItems() {
    return [
        { label: "插件", value: `v${versions.plugin || "-"}` },
        { label: "系统", value: `${os.platform()} ${os.release()}` },
        { label: "UXP", value: versions.uxp || "-" },
    ];
}

const CAPABILITY_ROWS = Object.freeze([
    { title: "RunningHub 应用", text: "读取应用参数、管理预设集合、并行提交任务。" },
    { title: "回图工作台", text: "保存返图、记录任务上下文，并按设置贴回 PS。" },
    { title: "本地增强", text: "小黄鸭解码、缓存目录、上传质量与交互设置都在本地闭环。" },
]);

export const About = ({ dialog }) => {
    const [showTip, setShowTip] = useState(false);
    const runtime = useMemo(runtimeItems, []);

    const close = () => {
        if (dialog && typeof dialog.close === "function") dialog.close("ok");
    };

    return (
        <form method="dialog" className="xlrh-about">
            <div className="xlrh-about__body">
                <header className="xlrh-about__masthead">
                    <div className="xlrh-about__mark" aria-hidden="true">
                        <IconRhGlyph className="xlrh-about__mark-icon" />
                    </div>
                    <div className="xlrh-about__titlebox">
                        <div className="xlrh-about__eyebrow">Photoshop AI 修图面板</div>
                        <h1 className="xlrh-about__title">{PLUGIN_CHINESE_NAME}</h1>
                        <div className="xlrh-about__version">V{versions.plugin || "-"}</div>
                    </div>
                </header>

                <section className="xlrh-about__section" aria-label="核心能力">
                    {CAPABILITY_ROWS.map((item) => (
                        <div className="xlrh-about__line" key={item.title}>
                            <div className="xlrh-about__line-dot" aria-hidden="true" />
                            <div className="xlrh-about__line-main">
                                <div className="xlrh-about__line-title">{item.title}</div>
                                <div className="xlrh-about__line-text">{item.text}</div>
                            </div>
                        </div>
                    ))}
                </section>

                <section className="xlrh-about__creator" aria-label="作者信息">
                    <div className="xlrh-about__avatar-wrap">
                        <img src="icons/avatar.png" className="xlrh-about__avatar" alt="" />
                    </div>
                    <div className="xlrh-about__creator-main">
                        <div className="xlrh-about__creator-name">小梁</div>
                        <div className="xlrh-about__contact-row">
                            <span>QQ 2225143208</span>
                            <span>抖音 43253732344</span>
                        </div>
                    </div>
                    <button type="button" className="xlrh-about__tip-button" onClick={() => setShowTip((value) => !value)}>
                        请小梁吃泡椒竹笋
                    </button>
                </section>

                {showTip ? (
                    <section className="xlrh-about__tip" aria-label="支持小梁">
                        <p>如果觉得插件好用，可以请小梁吃包泡椒竹笋，金额随意。</p>
                        <div className="xlrh-about__qr-wrap">
                            <img src="icons/qrcode_tip.png" className="xlrh-about__qr" alt="打赏二维码" />
                        </div>
                    </section>
                ) : null}

                <section className="xlrh-about__runtime" aria-label="运行环境">
                    {runtime.map((item) => (
                        <div className="xlrh-about__runtime-item" key={item.label}>
                            <span className="xlrh-about__runtime-label">{item.label}</span>
                            <span className="xlrh-about__runtime-value">{item.value}</span>
                        </div>
                    ))}
                </section>
            </div>

            <footer className="xlrh-about__footer">
                <div className="xlrh-about__copyright">© 2026 小梁 · {PLUGIN_CHINESE_NAME}</div>
                <sp-button variant="primary" onClick={close}>确定</sp-button>
            </footer>
        </form>
    );
};
