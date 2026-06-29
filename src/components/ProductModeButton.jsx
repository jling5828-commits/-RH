import React from "react";
import "./ProductModeButton.css";

export const PRODUCT_MODE_ORDER = Object.freeze([
    { id: "runninghub", label: "runninghub", title: "RunningHub" },
    { id: "banana", label: "banana", title: "Banana" },
    { id: "comfy", label: "comfy ui", title: "Comfy UI" },
    { id: "forge", label: "forge ui", title: "Forge UI" },
]);

export function nextProductMode(activeProduct) {
    const index = PRODUCT_MODE_ORDER.findIndex((item) => item.id === activeProduct);
    return PRODUCT_MODE_ORDER[((index < 0 ? 0 : index) + 1) % PRODUCT_MODE_ORDER.length].id;
}

export function ProductModeButton({ activeProduct, onChange }) {
    return (
        <div className="xlrh-product-mode-panel" role="navigation" aria-label="板块切换">
            {PRODUCT_MODE_ORDER.map((item) => (
                <button
                    key={item.id}
                    type="button"
                    className={"xlrh-product-mode-item" + (item.id === activeProduct ? " is-current" : "")}
                    onClick={() => item.id !== activeProduct && onChange?.(item.id)}
                    aria-current={item.id === activeProduct ? "page" : undefined}
                    title={item.title}
                >
                    {item.label}
                </button>
            ))}
        </div>
    );
}
