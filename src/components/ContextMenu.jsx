import React, { useCallback, useEffect, useMemo, useRef } from "react";
import "./ContextMenu.css";

function clampPixel(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function normalizeItems(items) {
    return Array.isArray(items) ? items.filter(Boolean) : [];
}

export const ContextMenu = ({ visible, x, y, items, onClose }) => {
    const menuRef = useRef(null);
    const menuItems = useMemo(() => normalizeItems(items), [items]);
    const position = useMemo(() => ({ left: clampPixel(x), top: clampPixel(y) }), [x, y]);

    const closeMenu = useCallback(() => {
        if (typeof onClose === "function") onClose();
    }, [onClose]);

    useEffect(() => {
        if (!visible) return undefined;

        const handlePointerDown = (event) => {
            const menu = menuRef.current;
            if (menu && menu.contains(event.target)) return;
            closeMenu();
        };
        const handleContextMenu = (event) => {
            const menu = menuRef.current;
            if (menu && menu.contains(event.target)) return;
            closeMenu();
        };
        const handleKeyDown = (event) => {
            if (event.key === "Escape") closeMenu();
        };

        document.addEventListener("mousedown", handlePointerDown, true);
        document.addEventListener("contextmenu", handleContextMenu, true);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("mousedown", handlePointerDown, true);
            document.removeEventListener("contextmenu", handleContextMenu, true);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [visible, closeMenu]);

    const runItem = useCallback(
        async (event, item) => {
            event.preventDefault();
            event.stopPropagation();
            if (!item || item.disabled || item.separator) return;
            closeMenu();
            if (typeof item.action === "function") await item.action(item);
        },
        [closeMenu]
    );

    if (!visible || menuItems.length === 0) return null;

    return (
        <div
            ref={menuRef}
            className="context-menu"
            style={position}
            role="menu"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
        >
            {menuItems.map((item, index) => {
                if (item.separator) {
                    return <div key={item.key || `sep-${index}`} className="context-menu-separator" role="separator" />;
                }
                return (
                    <button
                        key={item.key || item.label || index}
                        type="button"
                        className={`context-menu-item${item.danger ? " danger" : ""}`}
                        disabled={!!item.disabled}
                        title={item.tip || item.title || item.label}
                        role="menuitem"
                        onClick={(event) => runItem(event, item)}
                    >
                        {item.label}
                    </button>
                );
            })}
        </div>
    );
};
