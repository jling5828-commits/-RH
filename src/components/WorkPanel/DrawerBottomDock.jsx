import React, { useCallback, useMemo, useState } from "react";
import { useDrawer } from "./DrawerContext.jsx";
import "./DrawerBottomDock.css";

const DOCK_TOOLS = Object.freeze([
    Object.freeze({ id: "reverse", text: "反推", glyph: "↩", tone: "reverse", anchor: 12.5, busyFlag: "reverseTaskRunning" }),
    Object.freeze({ id: "assistant", text: "提示词", glyph: "✎", tone: "assistant", anchor: 37.5, busyFlag: "assistantTaskRunning" }),
    Object.freeze({ id: "editAssistant", text: "修图", glyph: "▣", tone: "editAssistant", anchor: 62.5, busyFlag: "editAssistantTaskRunning" }),
    Object.freeze({ id: "upscale", text: "超清", glyph: "↑", tone: "upscale", anchor: 87.5, busyFlag: "upscaleTaskRunning" }),
]);

function classNames(...parts) {
    return parts.filter(Boolean).join(" ");
}

function useTapAnimation() {
    const [tap, setTap] = useState({ pressed: "", pop: "" });

    return {
        pressed: tap.pressed,
        pop: tap.pop,
        play(id) {
            setTap({ pressed: id, pop: id });
            window.setTimeout(() => setTap((current) => ({ ...current, pressed: "" })), 120);
            window.setTimeout(() => setTap((current) => ({ ...current, pop: "" })), 400);
        },
    };
}

function useDockBusyMap(drawer) {
    return useMemo(() => {
        const busy = {};
        DOCK_TOOLS.forEach((tool) => {
            busy[tool.id] = Boolean(drawer[tool.busyFlag]);
        });
        return busy;
    }, [drawer.reverseTaskRunning, drawer.assistantTaskRunning, drawer.editAssistantTaskRunning, drawer.upscaleTaskRunning]);
}

function DockToolButton({ tool, active, busy, pressed, pop, onClick }) {
    return (
        <button
            type="button"
            className={classNames(
                "drawer-dock-item",
                tool.tone,
                active && "active",
                busy && "task-running",
                pressed && "pressed",
                pop && "pop"
            )}
            title={busy ? `${tool.text}（运行中）` : `${tool.text}（点击打开）`}
            aria-label={tool.text}
            aria-pressed={active}
            aria-busy={busy}
            onClick={onClick}
        >
            <span className="drawer-dock-icon" aria-hidden="true">{tool.glyph}</span>
            <span className="drawer-dock-label">{tool.text}</span>
        </button>
    );
}

export const DrawerBottomDock = () => {
    const drawer = useDrawer();
    const animation = useTapAnimation();
    const busyMap = useDockBusyMap(drawer);

    const requestOpen = useCallback((tool) => {
        animation.play(tool.id);
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => drawer.openDrawer(tool.id, { fromDock: true, left: tool.anchor }));
        });
    }, [animation, drawer.openDrawer]);

    return (
        <nav className="drawer-dock" aria-label="抽屉工具栏">
            {DOCK_TOOLS.map((tool) => {
                const isActive = drawer.isDrawerOpen && !drawer.isDrawerClosing && drawer.drawerType === tool.id;
                return (
                    <DockToolButton
                        key={tool.id}
                        tool={tool}
                        active={isActive}
                        busy={busyMap[tool.id]}
                        pressed={animation.pressed === tool.id}
                        pop={animation.pop === tool.id}
                        onClick={() => requestOpen(tool)}
                    />
                );
            })}
        </nav>
    );
};
