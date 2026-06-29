import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./CustomSelect.css";

const DROPDOWN_PORTAL_Z_INDEX = 100020;
const DROPDOWN_MARGIN = 8;
const DROPDOWN_MAX_HEIGHT = 240;
const DEFAULT_CLASS_PREFIX = "xlrh-param-select";
const CLOSE_CUSTOM_SELECTS_EVENT = "xlrh-close-custom-selects";
const OUTSIDE_CLOSE_EVENTS = ["pointerdown", "mousedown", "click"];
let customSelectIdSeed = 0;

function composeClass(...parts) {
    return parts.filter(Boolean).join(" ");
}

function optionLabel(option, getItemLabel) {
    return getItemLabel ? getItemLabel(option) : option;
}

function optionTitle(option, label, getItemTitle) {
    if (getItemTitle) return getItemTitle(option);
    return typeof label === "string" ? label : undefined;
}

function buildPortalGeometry(anchor, placement) {
    if (!anchor || typeof window === "undefined") return null;
    const rect = anchor.getBoundingClientRect();
    const base = {
        left: rect.left,
        width: rect.width,
        maxHeight: DROPDOWN_MAX_HEIGHT,
    };
    if (placement === "down") {
        return {
            ...base,
            top: rect.bottom + 2,
            maxHeight: Math.min(DROPDOWN_MAX_HEIGHT, Math.max(DROPDOWN_MARGIN, window.innerHeight - rect.bottom - DROPDOWN_MARGIN)),
        };
    }
    return {
        ...base,
        bottom: window.innerHeight - rect.top + 2,
        maxHeight: Math.min(DROPDOWN_MAX_HEIGHT, Math.max(DROPDOWN_MARGIN, rect.top - DROPDOWN_MARGIN)),
    };
}

function portalStyleFromGeometry(geometry, placement) {
    if (!geometry) return undefined;
    const style = {
        position: "fixed",
        left: geometry.left,
        width: geometry.width,
        maxHeight: geometry.maxHeight,
        zIndex: DROPDOWN_PORTAL_Z_INDEX,
    };
    if (placement === "down") return { ...style, top: geometry.top, bottom: "auto" };
    return { ...style, bottom: geometry.bottom, top: "auto" };
}

function skin(prefix) {
    const base = String(prefix || DEFAULT_CLASS_PREFIX).trim() || DEFAULT_CLASS_PREFIX;
    return {
        root: `${base}-box`,
        rootOpen: `${base}-box--open`,
        rootClosing: `${base}-box--closing`,
        rootDisabled: `${base}-box--disabled`,
        rootDown: `${base}--down`,
        rootPortal: `${base}--portal-anchor`,
        label: `${base}-label`,
        divider: `${base}-divider`,
        content: `${base}-content`,
        value: `${base}-value`,
        suffix: `${base}-extra`,
        caret: `${base}-caret`,
        caretOpen: `${base}-caret--open`,
        menu: `${base}-menu`,
        menuOpen: `${base}-menu--open`,
        menuClosing: `${base}-menu--closing`,
        menuDown: `${base}-menu--down`,
        menuPortal: `${base}-menu--portal`,
        item: `${base}-item`,
        itemLabel: `${base}-item-label`,
        itemDelete: `${base}-item-delete`,
        itemActive: `${base}-item--active`,
        itemPlain: `${base}-item--plain`,
        itemRich: `${base}-item--rich`,
    };
}

function makeCloseEvent(sourceId) {
    const detail = { sourceId };
    if (typeof window !== "undefined" && typeof window.CustomEvent === "function") {
        return new window.CustomEvent(CLOSE_CUSTOM_SELECTS_EVENT, { detail });
    }
    const event = new window.Event(CLOSE_CUSTOM_SELECTS_EVENT);
    Object.defineProperty(event, "detail", { value: detail });
    return event;
}

function requestCloseCustomSelects(sourceId) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(makeCloseEvent(sourceId));
    if (typeof document !== "undefined") document.dispatchEvent(makeCloseEvent(sourceId));
}

export function CustomSelect({
    label,
    value,
    displayValue,
    options,
    onChange,
    canDeleteItem,
    onDeleteItem,
    deleteItemLabel = "删除",
    disabled,
    getItemLabel,
    getItemTitle,
    getItemContent,
    compareValue,
    suffix,
    controlTitle,
    dropdownPlacement = "up",
    useDropdownPortal = true,
    portalDropdownClassName = "",
    classPrefix = DEFAULT_CLASS_PREFIX,
}) {
    const [phase, setPhase] = useState("closed");
    const [portalGeometry, setPortalGeometry] = useState(null);
    const rootRef = useRef(null);
    const dropdownRef = useRef(null);
    const closeTimerRef = useRef(0);
    const instanceIdRef = useRef(`select-${++customSelectIdSeed}`);
    const classes = useMemo(() => skin(classPrefix), [classPrefix]);
    const isOpen = phase === "open";
    const isClosing = phase === "closing";
    const isVisible = phase !== "closed";
    const isDropDown = dropdownPlacement === "down";

    const finishClose = useCallback(() => {
        if (typeof window !== "undefined") window.clearTimeout(closeTimerRef.current);
        setPhase("closed");
    }, []);

    const closeMenu = useCallback(() => {
        setPhase((current) => {
            if (current === "closed") return current;
            if (typeof window === "undefined") return "closed";
            window.clearTimeout(closeTimerRef.current);
            closeTimerRef.current = window.setTimeout(finishClose, 180);
            return "closing";
        });
    }, [finishClose]);

    const toggleMenu = useCallback(() => {
        if (disabled) return;
        if (isOpen) {
            closeMenu();
            return;
        }
        if (typeof window !== "undefined") window.clearTimeout(closeTimerRef.current);
        requestCloseCustomSelects(instanceIdRef.current);
        setPhase("open");
    }, [closeMenu, disabled, isOpen]);

    useEffect(() => () => {
        if (typeof window !== "undefined") window.clearTimeout(closeTimerRef.current);
    }, []);

    useEffect(() => {
        if (disabled) finishClose();
    }, [disabled, finishClose]);

    useEffect(() => {
        const closeOthers = (event) => {
            if (event?.detail?.sourceId === instanceIdRef.current) return;
            finishClose();
        };
        window.addEventListener(CLOSE_CUSTOM_SELECTS_EVENT, closeOthers);
        document.addEventListener(CLOSE_CUSTOM_SELECTS_EVENT, closeOthers);
        return () => {
            window.removeEventListener(CLOSE_CUSTOM_SELECTS_EVENT, closeOthers);
            document.removeEventListener(CLOSE_CUSTOM_SELECTS_EVENT, closeOthers);
        };
    }, [finishClose]);

    const refreshPortalGeometry = useCallback(() => {
        if (!useDropdownPortal) return;
        setPortalGeometry(buildPortalGeometry(rootRef.current, dropdownPlacement));
    }, [dropdownPlacement, useDropdownPortal]);

    useLayoutEffect(() => {
        if (!useDropdownPortal || !isVisible) {
            setPortalGeometry(null);
            return undefined;
        }
        refreshPortalGeometry();
        window.addEventListener("scroll", refreshPortalGeometry, true);
        window.addEventListener("resize", refreshPortalGeometry);
        return () => {
            window.removeEventListener("scroll", refreshPortalGeometry, true);
            window.removeEventListener("resize", refreshPortalGeometry);
        };
    }, [isVisible, refreshPortalGeometry, useDropdownPortal]);

    useEffect(() => {
        if (!isVisible) return undefined;
        const onOutsideEvent = (event) => {
            const target = event.target;
            if (rootRef.current?.contains(target)) return;
            if (useDropdownPortal && dropdownRef.current?.contains(target)) return;
            closeMenu();
        };
        const onKeyDown = (event) => {
            if (event.key === "Escape") closeMenu();
        };
        const onWindowBlur = () => finishClose();
        OUTSIDE_CLOSE_EVENTS.forEach((type) => document.addEventListener(type, onOutsideEvent, true));
        document.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("blur", onWindowBlur);
        return () => {
            OUTSIDE_CLOSE_EVENTS.forEach((type) => document.removeEventListener(type, onOutsideEvent, true));
            document.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("blur", onWindowBlur);
        };
    }, [closeMenu, finishClose, isVisible, useDropdownPortal]);

    const portalClass = useMemo(() => {
        const extra = String(portalDropdownClassName || "").trim();
        return composeClass(useDropdownPortal && classes.menuPortal, useDropdownPortal && extra);
    }, [classes.menuPortal, portalDropdownClassName, useDropdownPortal]);

    const itemContentFactory = getItemContent || ((option) => optionLabel(option, getItemLabel));
    const activeValue = compareValue ?? displayValue ?? value;
    const optionItems = Array.isArray(options) ? options : [];
    const dropdownStyle = useDropdownPortal ? portalStyleFromGeometry(portalGeometry, dropdownPlacement) : undefined;

    const dropdownList = (
        <div
            ref={useDropdownPortal ? dropdownRef : undefined}
            className={composeClass(
                classes.menu,
                portalClass,
                isDropDown && classes.menuDown,
                isVisible && classes.menuOpen,
                isClosing && classes.menuClosing
            )}
            style={dropdownStyle}
            onAnimationEnd={(event) => {
                if (event.currentTarget === event.target && isClosing) finishClose();
            }}
        >
            {optionItems.map((option, index) => {
                const labelValue = optionLabel(option, getItemLabel);
                const title = optionTitle(option, labelValue, getItemTitle);
                const rich = !!getItemContent;
                const selected = activeValue === option;
                const canDelete = typeof canDeleteItem === "function" && canDeleteItem(option);
                return (
                    <div
                        key={`${index}-${String(option)}`}
                        className={composeClass(classes.item, rich ? classes.itemRich : classes.itemPlain, selected && classes.itemActive)}
                        style={{ animationDelay: isOpen ? `${index * 0.025}s` : "0s" }}
                        title={title || (typeof labelValue === "string" ? labelValue : undefined)}
                        onClick={() => {
                            onChange(option);
                            closeMenu();
                        }}
                    >
                        <span className={classes.itemLabel}>{itemContentFactory(option)}</span>
                        {canDelete ? (
                            <button
                                type="button"
                                className={classes.itemDelete}
                                title="删除预设"
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onDeleteItem?.(option);
                                    setPhase("open");
                                }}
                            >
                                {deleteItemLabel}
                            </button>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );

    return (
        <div
            ref={rootRef}
            className={composeClass(
                classes.root,
                isOpen && classes.rootOpen,
                isClosing && classes.rootClosing,
                disabled && classes.rootDisabled,
                isDropDown && classes.rootDown,
                useDropdownPortal && classes.rootPortal
            )}
            title={controlTitle || undefined}
        >
            <div className={classes.label}>{label}</div>
            <div className={classes.divider} />
            <div className={classes.content} onClick={toggleMenu} onMouseEnter={refreshPortalGeometry}>
                <div className={classes.value}>{displayValue || value}</div>
                {suffix ? (
                    <div className={classes.suffix} onClick={(event) => event.stopPropagation()}>
                        {suffix}
                    </div>
                ) : null}
                <div className={composeClass(classes.caret, isVisible && classes.caretOpen)}>{"\u25be"}</div>
            </div>
            {useDropdownPortal ? null : dropdownList}
            {useDropdownPortal && isVisible && portalGeometry && typeof document !== "undefined" && document.body
                ? createPortal(dropdownList, document.body)
                : null}
        </div>
    );
}
