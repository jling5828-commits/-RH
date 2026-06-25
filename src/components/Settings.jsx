import React, { useCallback, useMemo, useState } from "react";
import { SortableContainer, SortableElement, SortableHandle, arrayMove } from "react-sortable-hoc";
import { usePersistedState } from "../hooks/usePersistedState.js";
import { SettingsCard } from "./settings/SettingsCard.jsx";
import { ProviderSettings } from "./settings/ProviderSettings.jsx";
import { BackgroundSettings } from "./settings/BackgroundSettings.jsx";
import "./Settings.css";

const SETTINGS_LAYOUT_KEY = "xlrh_settings_card_order";
const SETTINGS_MODEL = Object.freeze([
    Object.freeze({ id: "provider", cardClass: "provider-card", icon: "API", title: "服务提供商 (Service Provider)", Component: ProviderSettings }),
    Object.freeze({ id: "background", cardClass: "background-card", icon: "UI", title: "外观偏好", Component: BackgroundSettings }),
]);
const SETTINGS_IDS = Object.freeze(SETTINGS_MODEL.map((item) => item.id));
const SETTINGS_BY_ID = Object.freeze(Object.fromEntries(SETTINGS_MODEL.map((item) => [item.id, item])));

function sanitizeOrder(order) {
    const seen = new Set();
    const saved = Array.isArray(order) ? order : [];
    const validSaved = saved.filter((id) => {
        if (!SETTINGS_BY_ID[id] || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
    return [...validSaved, ...SETTINGS_IDS.filter((id) => !seen.has(id))];
}

function nextOrder(current, oldIndex, newIndex) {
    const order = sanitizeOrder(current);
    return oldIndex === newIndex ? order : arrayMove(order, oldIndex, newIndex);
}

const SettingsDragGrip = SortableHandle(({ label }) => (
    <span
        className="title-icon"
        aria-label="拖拽以调整顺序"
        title="拖拽以调整顺序"
        onClick={(event) => event.stopPropagation()}
    >
        {label}
    </span>
));

const SortableSettingsRow = SortableElement(({ children }) => <div className="sortable-card-item">{children}</div>);
const SortableSettingsStack = SortableContainer(({ children, isSorting }) => (
    <div className={`sortable-card-list${isSorting ? " sortable-card-list--sorting" : ""}`}>{children}</div>
));

function SettingsCardEntry({ config }) {
    const { Component } = config;
    return (
        <SettingsCard
            cardClass={config.cardClass}
            icon={config.icon}
            title={config.title}
            defaultOpen={true}
            dragHandle={<SettingsDragGrip label={config.icon} />}
        >
            <Component />
        </SettingsCard>
    );
}

export const Settings = () => {
    const [cardOrder, setCardOrder] = usePersistedState(SETTINGS_LAYOUT_KEY, SETTINGS_IDS);
    const [sorting, setSorting] = useState(false);

    const cards = useMemo(() => sanitizeOrder(cardOrder).map((id) => SETTINGS_BY_ID[id]).filter(Boolean), [cardOrder]);
    const finishSort = useCallback(({ oldIndex, newIndex }) => {
        setSorting(false);
        setCardOrder((current) => nextOrder(current, oldIndex, newIndex));
    }, [setCardOrder]);

    return (
        <div className="settings-container">
            <SortableSettingsStack
                isSorting={sorting}
                onSortStart={() => setSorting(true)}
                onSortEnd={finishSort}
                useDragHandle
                transitionDuration={280}
                distance={5}
                axis="y"
                lockAxis="y"
                disableAutoscroll
                collection="settings"
            >
                {cards.map((card, index) => (
                    <SortableSettingsRow key={card.id} index={index}>
                        <SettingsCardEntry config={card} />
                    </SortableSettingsRow>
                ))}
            </SortableSettingsStack>
        </div>
    );
};
