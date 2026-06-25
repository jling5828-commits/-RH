import { useCallback, useEffect, useRef, useState } from "react";

function clearTimer(timerRef) {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
}

export function useResultPopover({ closeDelay = 120, hoverDelay = 200 } = {}) {
    const rootRef = useRef(null);
    const hoverTimerRef = useRef(null);
    const closeTimerRef = useRef(null);
    const [visible, setVisible] = useState(false);
    const [byClick, setByClick] = useState(false);
    const [closing, setClosing] = useState(false);

    const showFromHover = useCallback(() => {
        if (byClick) return;
        clearTimer(hoverTimerRef);
        clearTimer(closeTimerRef);
        setClosing(false);
        setVisible(true);
    }, [byClick]);

    const hideFromHover = useCallback(() => {
        if (byClick) return;
        clearTimer(hoverTimerRef);
        hoverTimerRef.current = setTimeout(() => {
            setVisible(false);
            hoverTimerRef.current = null;
        }, hoverDelay);
    }, [byClick, hoverDelay]);

    const keepOpen = useCallback(() => {
        clearTimer(hoverTimerRef);
    }, []);

    const close = useCallback(() => {
        if (closeTimerRef.current) return;
        clearTimer(hoverTimerRef);
        setClosing(true);
        closeTimerRef.current = setTimeout(() => {
            setVisible(false);
            setByClick(false);
            setClosing(false);
            closeTimerRef.current = null;
        }, closeDelay);
    }, [closeDelay]);

    const toggleFromClick = useCallback(() => {
        clearTimer(hoverTimerRef);
        clearTimer(closeTimerRef);
        setClosing(false);
        setByClick(!visible);
        setVisible(!visible);
    }, [visible]);

    useEffect(() => {
        if (!visible || !byClick) return undefined;
        const closeWhenOutside = (event) => {
            const root = rootRef.current;
            if (root && !root.contains(event.target)) close();
        };
        document.addEventListener("mousedown", closeWhenOutside, true);
        return () => document.removeEventListener("mousedown", closeWhenOutside, true);
    }, [byClick, close, visible]);

    useEffect(() => () => {
        clearTimer(hoverTimerRef);
        clearTimer(closeTimerRef);
    }, []);

    return {
        rootRef,
        visible,
        byClick,
        closing,
        close,
        toggleFromClick,
        wrapHoverProps: {
            onMouseEnter: showFromHover,
            onMouseLeave: hideFromHover,
        },
        menuHoverProps: {
            onMouseEnter: keepOpen,
            onMouseLeave: hideFromHover,
        },
    };
}
