import React, { useEffect, useMemo, useState } from "react";
import { usePersistedState } from "../../hooks/usePersistedState.js";

const LOCAL_ONLY_KEY = "__xlrh_collapsible_card_local_only__";

function buildCardClass(cardClass, isOpen) {
    return ["xlrh-card", cardClass, isOpen ? "" : "is-collapsed"].filter(Boolean).join(" ");
}

function CardHeaderTitle({ dragHandle, icon, title }) {
    return (
        <span className="header-title">
            {dragHandle || <span className="title-icon">{icon}</span>}
            {title}
        </span>
    );
}

function HeaderExtra({ children }) {
    if (children == null) return null;
    const stop = (event) => event.stopPropagation();
    return (
        <div className="card-header-extra" onClick={stop} onMouseDown={stop}>
            {children}
        </div>
    );
}

export const CollapsibleCard = ({
    cardClass,
    icon,
    title,
    subText,
    headerExtra,
    dragHandle,
    defaultOpen = true,
    persist = true,
    storageKey,
    expandRef,
    children,
}) => {
    const persistedKey = persist && storageKey ? storageKey : LOCAL_ONLY_KEY;
    const [persistedOpen, setPersistedOpen] = usePersistedState(persistedKey, defaultOpen);
    const [localOpen, setLocalOpen] = useState(defaultOpen);
    const openState = persist ? persistedOpen : localOpen;
    const setOpenState = persist ? setPersistedOpen : setLocalOpen;

    useEffect(() => {
        if (!expandRef) return undefined;
        expandRef.current = { expand: () => setOpenState(true) };
        return () => { expandRef.current = null; };
    }, [expandRef, setOpenState]);

    const headerRight = useMemo(() => (
        <div className="header-right">
            {subText ? <span className="header-sub">{subText}</span> : null}
            <HeaderExtra>{headerExtra}</HeaderExtra>
            <div className={`collapse-arrow ${openState ? "expanded" : "collapsed"}`}>
                <span className="arrow-icon" />
            </div>
        </div>
    ), [subText, headerExtra, openState]);

    return (
        <div className={buildCardClass(cardClass, openState)}>
            <div className="card-header" onClick={() => setOpenState((value) => !value)}>
                <CardHeaderTitle dragHandle={dragHandle} icon={icon} title={title} />
                {headerRight}
            </div>
            <div className={`card-content ${openState ? "" : "collapsed"}`}>{children}</div>
        </div>
    );
};
