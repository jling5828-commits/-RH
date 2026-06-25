import React from "react";
import { usePersistedState } from "../../hooks/usePersistedState.js";
import { playSound } from "../../utils/playSound.js";
import "./MuteButton.css";

function SpeakerIcon({ muted }) {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 5 6 9H3v6h3l5 4V5Z" />
            {muted ? (
                <>
                    <path d="m18 9 5 6" />
                    <path d="m23 9-5 6" />
                </>
            ) : (
                <>
                    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                    <path d="M19 5a10 10 0 0 1 0 14" />
                </>
            )}
        </svg>
    );
}

export const MuteButton = () => {
    const [muted, setMuted] = usePersistedState("xlrh_sound_muted", false);

    const toggleMuted = (event) => {
        event.stopPropagation();
        setMuted((value) => {
            const next = !value;
            if (!next) playSound({ force: true });
            return next;
        });
    };

    return (
        <div
            className={`mute-btn-header icon-btn-header ${muted ? "muted" : ""}`}
            onClick={toggleMuted}
            role="button"
            aria-pressed={muted}
            title={muted ? "开启生成成功音效" : "关闭生成成功音效"}
        >
            <SpeakerIcon muted={muted} />
        </div>
    );
};
