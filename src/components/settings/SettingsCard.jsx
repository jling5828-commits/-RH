import React, { useCallback, useMemo, useState } from "react";

function joinClassNames(parts) {
    return parts.filter(Boolean).join(" ");
}

function useOpenState(defaultOpen) {
    const [open, setOpen] = useState(Boolean(defaultOpen));
    const toggle = useCallback(() => setOpen((value) => !value), []);
    return [open, toggle];
}

function CardHeading({ dragHandle, icon, title }) {
    return (
        <span className="header-title">
            {dragHandle || <span className="title-icon">{icon}</span>}
            <span>{title}</span>
        </span>
    );
}

function CollapseIndicator({ open }) {
    return (
        <div className={joinClassNames(["collapse-arrow", open ? "expanded" : "collapsed"])} aria-hidden="true">
            <span className="arrow-icon" />
        </div>
    );
}

export const SettingsCard = ({ cardClass, icon, title, defaultOpen = true, dragHandle, children }) => {
    const [open, toggleOpen] = useOpenState(defaultOpen);
    const className = useMemo(
        () => joinClassNames(["xlrh-card", cardClass, open ? "" : "is-collapsed"]),
        [cardClass, open]
    );

    const handleHeaderKeyDown = useCallback((event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggleOpen();
    }, [toggleOpen]);

    return (
        <div className={className}>
            <div
                className="card-header"
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={toggleOpen}
                onKeyDown={handleHeaderKeyDown}
            >
                <CardHeading dragHandle={dragHandle} icon={icon} title={title} />
                <div className="header-right">
                    <CollapseIndicator open={open} />
                </div>
            </div>
            <div className={joinClassNames(["card-content", open ? "" : "collapsed"])}>{children}</div>
        </div>
    );
};
