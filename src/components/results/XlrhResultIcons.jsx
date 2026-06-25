import React from "react";

const baseStroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
};

const glyphs = {
    trash: [
        ["path", { d: "M5.5 7.25h13" }],
        ["path", { d: "M9.25 7.25V5.1c0-.9.73-1.6 1.63-1.6h2.24c.9 0 1.63.7 1.63 1.6v2.15" }],
        ["path", { d: "M17.25 7.25l-.7 11.4c-.07 1.05-.92 1.85-1.98 1.85H9.43c-1.06 0-1.91-.8-1.98-1.85l-.7-11.4" }],
        ["path", { d: "M10.45 11.25v5.7" }],
        ["path", { d: "M13.55 11.25v5.7" }],
    ],
    refresh: [
        ["path", { d: "M19.2 8.3A7.7 7.7 0 0 0 5.1 6.7" }],
        ["path", { d: "M4.7 3.8v4.1h4.1" }],
        ["path", { d: "M4.8 15.7a7.7 7.7 0 0 0 14.1 1.6" }],
        ["path", { d: "M19.3 20.2v-4.1h-4.1" }],
    ],
    documentAdd: [
        ["path", { d: "M7 3.2h7.2l4.8 4.9v11.1c0 1-.8 1.8-1.8 1.8H7c-1 0-1.8-.8-1.8-1.8V5c0-1 .8-1.8 1.8-1.8z" }],
        ["path", { d: "M14.1 3.4v5h4.7" }],
        ["path", { d: "M12 12.2v5.1" }],
        ["path", { d: "M9.45 14.75h5.1" }],
    ],
    feather: [
        ["path", { d: "M19.2 4.8c-2.2-2.2-5.7-2.15-7.85.1L5.1 11.4v7.5h7.5l6.5-6.25c2.25-2.15 2.3-5.65.1-7.85z" }],
        ["path", { d: "M16.5 7.5L3 21" }],
        ["path", { d: "M15.8 15.1H9.2" }],
        ["path", { d: "M12.5 11.8h-3" }],
    ],
    place: [
        ["path", { d: "M5 5h14v14H5z", strokeDasharray: "3 3" }],
        ["path", { d: "M12 8.8v6.4" }],
        ["path", { d: "M8.8 12h6.4" }],
        ["path", { d: "M7.2 7.2l2.05 2.05" }],
        ["path", { d: "M16.8 16.8l-2.05-2.05" }],
    ],
    folder: [
        ["path", { d: "M3.2 7.1c0-1 .8-1.8 1.8-1.8h4.1l2 2.45H19c1 0 1.8.8 1.8 1.8v7.35c0 1-.8 1.8-1.8 1.8H5c-1 0-1.8-.8-1.8-1.8z" }],
        ["path", { d: "M3.5 9.15h17" }],
    ],
    navPrev: [["path", { d: "M14.6 6.5L9.4 12l5.2 5.5" }]],
    navNext: [["path", { d: "M9.4 6.5l5.2 5.5-5.2 5.5" }]],
    newest: [
        ["path", { d: "M5.2 6.5v11" }],
        ["path", { d: "M9.2 8.5l5 3.5-5 3.5" }],
        ["path", { d: "M14.4 8.5l4.4 3.5-4.4 3.5" }],
    ],
    oldest: [
        ["path", { d: "M18.8 6.5v11" }],
        ["path", { d: "M14.8 8.5l-5 3.5 5 3.5" }],
        ["path", { d: "M9.6 8.5L5.2 12l4.4 3.5" }],
    ],
    deleteCurrent: [
        ["path", { d: "M7 3.2h7.1l4.9 4.9v11.1c0 1-.8 1.8-1.8 1.8H7c-1 0-1.8-.8-1.8-1.8V5c0-1 .8-1.8 1.8-1.8z" }],
        ["path", { d: "M14.1 3.4v5h4.7" }],
        ["path", { d: "M9.2 14.6h5.6" }],
    ],
    deleteAll: [
        ["path", { d: "M5.2 7.1h13.6" }],
        ["path", { d: "M8.3 7.1V5.4c0-.9.7-1.6 1.6-1.6h4.2c.9 0 1.6.7 1.6 1.6v1.7" }],
        ["path", { d: "M17.4 7.1l-.55 10.6c-.06 1.25-.92 2.1-2.15 2.1H9.3c-1.23 0-2.09-.85-2.15-2.1L6.6 7.1" }],
        ["path", { d: "M2.8 11h4" }],
        ["path", { d: "M17.2 11h4" }],
    ],
};

function renderGlyph(nodes) {
    return nodes.map(([tag, props], index) => React.createElement(tag, { key: index, ...props }));
}

function ResultGlyph({ name, className, size }) {
    const nodes = glyphs[name] || glyphs.refresh;
    const sizeProps = size ? { width: size, height: size } : null;
    return React.createElement(
        "svg",
        { viewBox: "0 0 24 24", className, ...baseStroke, ...sizeProps },
        renderGlyph(nodes)
    );
}

export const IconTrash = () => React.createElement(ResultGlyph, { name: "trash" });
export const IconRefresh = () => React.createElement(ResultGlyph, { name: "refresh" });
export const IconNewDoc = () => React.createElement(ResultGlyph, { name: "documentAdd" });
export const IconFeather = () => React.createElement(ResultGlyph, { name: "feather" });
export const IconPlace = () => React.createElement(ResultGlyph, { name: "place" });
export const IconFolder = () => React.createElement(ResultGlyph, { name: "folder", size: 28 });
export const IconFolderSmall = () => React.createElement(ResultGlyph, { name: "folder" });
export const IconNavPrev = () => React.createElement(ResultGlyph, { name: "navPrev" });
export const IconNavNext = () => React.createElement(ResultGlyph, { name: "navNext" });
export const IconJumpToNewest = () => React.createElement(ResultGlyph, { name: "newest", className: "xres-jump-icon" });
export const IconJumpToOldest = () => React.createElement(ResultGlyph, { name: "oldest", className: "xres-jump-icon" });
export const IconDeleteCurrent = () => React.createElement(ResultGlyph, { name: "deleteCurrent", className: "xres-delete-icon" });
export const IconDeleteAll = () => React.createElement(ResultGlyph, { name: "deleteAll", className: "xres-delete-icon" });
