import React, { useEffect, useRef, useState } from "react";

export function EditableSliderValue({ value, onCommit, parseValue, formatValue = (next) => next }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const inputRef = useRef(null);

    useEffect(() => {
        if (editing) inputRef.current?.select?.();
    }, [editing]);

    const beginEdit = () => {
        setDraft(value == null ? "" : String(value));
        setEditing(true);
    };

    const commit = () => {
        const next = parseValue ? parseValue(draft) : draft;
        setEditing(false);
        if (next !== "" && next != null && !(typeof next === "number" && Number.isNaN(next))) onCommit(next);
    };

    if (editing) {
        return (
            <input
                ref={inputRef}
                className="rh-param-slider-value rh-param-slider-value-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key === "Enter") commit();
                    if (event.key === "Escape") setEditing(false);
                }}
            />
        );
    }

    return <span className="rh-param-slider-value" onDoubleClick={beginEdit}>{formatValue(value)}</span>;
}
