import React, { useCallback, useEffect, useRef, useState } from "react";

function idsEqual(a, b) {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((id, index) => id === b[index]);
}

function keyOf(id) {
    return String(id);
}

function findIndexByKey(order, idKey) {
    return order.findIndex((item) => keyOf(item) === idKey);
}

function moveIndex(order, from, to) {
    if (from === to || from < 0 || to < 0) return order;
    const next = order.slice();
    const [item] = next.splice(from, 1);
    next.splice(Math.min(to, next.length), 0, item);
    return next;
}

function targetIndexFromPointer(order, rowRefs, pointerY, draggedKey) {
    let fallback = findIndexByKey(order, draggedKey);
    if (fallback < 0) fallback = 0;

    for (let index = 0; index < order.length; index++) {
        const row = rowRefs.current.get(keyOf(order[index]));
        if (!row || typeof row.getBoundingClientRect !== "function") continue;
        const rect = row.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        if (pointerY < centerY) return index;
    }
    return Math.max(0, order.length - 1);
}

let previousBodyUserSelect = "";

function setGlobalDragStyle(active) {
    if (typeof document === "undefined") return;
    if (active) {
        previousBodyUserSelect = document.body.style.userSelect || "";
        document.body.style.userSelect = "none";
    } else {
        document.body.style.userSelect = previousBodyUserSelect;
    }
}

export function WorkbenchSortableCardList({ itemIds, onCommitOrder, renderItem }) {
    const [order, setOrder] = useState(() => (Array.isArray(itemIds) ? itemIds.slice() : []));
    const [draggedKey, setDraggedKey] = useState(null);
    const rowRefs = useRef(new Map());
    const iconRefs = useRef(new Map());
    const orderRef = useRef(order);
    const dragRef = useRef(null);

    useEffect(() => {
        orderRef.current = order;
    }, [order]);

    useEffect(() => {
        if (dragRef.current) return;
        const incoming = Array.isArray(itemIds) ? itemIds.slice() : [];
        if (!idsEqual(orderRef.current, incoming)) setOrder(incoming);
    }, [itemIds]);

    useEffect(() => () => setGlobalDragStyle(false), []);

    const setRowRef = useCallback((id, element) => {
        const key = keyOf(id);
        if (element) rowRefs.current.set(key, element);
        else rowRefs.current.delete(key);
    }, []);

    const setIconRefFor = useCallback((id) => (element) => {
        const key = keyOf(id);
        if (element) iconRefs.current.set(key, element);
        else iconRefs.current.delete(key);
    }, []);

    const commitIfChanged = useCallback(() => {
        const drag = dragRef.current;
        if (!drag) return;
        const nextOrder = orderRef.current.slice();
        dragRef.current = null;
        setDraggedKey(null);
        setGlobalDragStyle(false);
        if (!idsEqual(drag.startOrder, nextOrder)) {
            window.setTimeout(() => onCommitOrder(nextOrder), 0);
        }
    }, [onCommitOrder]);

    const handlePointerMove = useCallback((event) => {
        const drag = dragRef.current;
        if (!drag || event.pointerId !== drag.pointerId) return;
        event.preventDefault();
        const currentOrder = orderRef.current;
        const from = findIndexByKey(currentOrder, drag.idKey);
        if (from < 0) return;
        const to = targetIndexFromPointer(currentOrder, rowRefs, event.clientY, drag.idKey);
        if (to === from) return;
        const next = moveIndex(currentOrder, from, to);
        orderRef.current = next;
        setOrder(next);
    }, []);

    const handlePointerEnd = useCallback((event) => {
        const drag = dragRef.current;
        if (!drag || event.pointerId !== drag.pointerId) return;
        commitIfChanged();
    }, [commitIfChanged]);

    useEffect(() => {
        if (!draggedKey) return undefined;
        window.addEventListener("pointermove", handlePointerMove, { passive: false });
        window.addEventListener("pointerup", handlePointerEnd);
        window.addEventListener("pointercancel", handlePointerEnd);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerEnd);
            window.removeEventListener("pointercancel", handlePointerEnd);
        };
    }, [draggedKey, handlePointerMove, handlePointerEnd]);

    const makePointerDown = useCallback((id) => (event) => {
        if (event.button !== 0) return;
        const idKey = keyOf(id);
        const icon = iconRefs.current.get(idKey);
        if (!icon) return;
        const startOrder = orderRef.current.slice();
        if (findIndexByKey(startOrder, idKey) < 0) return;

        dragRef.current = { idKey, pointerId: event.pointerId, startOrder };
        setDraggedKey(idKey);
        setGlobalDragStyle(true);
        try { icon.setPointerCapture?.(event.pointerId); } catch {}
        event.preventDefault();
        event.stopPropagation();
    }, []);

    return (
        <div className={`sortable-card-list${draggedKey ? " sortable-card-list--dnd-active" : ""}`}>
            {order.map((cardId, index) => {
                const isDragging = draggedKey === keyOf(cardId);
                const sortable = {
                    isDragging,
                    setIconRef: setIconRefFor(cardId),
                    onHandlePointerDown: makePointerDown(cardId),
                };
                return (
                    <div
                        key={keyOf(cardId)}
                        ref={(element) => setRowRef(cardId, element)}
                        className={`sortable-card-item${isDragging ? " sortable-card-item--dragging" : ""}`}
                    >
                        {renderItem(cardId, index, sortable)}
                    </div>
                );
            })}
        </div>
    );
}

export function WorkbenchDragHandle({ icon, sortable }) {
    const { setIconRef, onHandlePointerDown, isDragging } = sortable;
    return (
        <span
            ref={setIconRef}
            className="title-icon"
            aria-label="拖拽以调整顺序"
            title="拖拽以调整顺序"
            onPointerDown={onHandlePointerDown}
            onClick={(event) => event.stopPropagation()}
            data-dragging={isDragging ? "1" : "0"}
        >
            {icon}
        </span>
    );
}
