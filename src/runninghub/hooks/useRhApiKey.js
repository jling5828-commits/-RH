import { useState, useEffect, useCallback } from "react";
import {
    RH_API_KEY_CHANGED_EVENT,
    readRhApiKey,
    readRhApiKeys,
    readRhApiKeyMode,
    persistRhApiKey,
    persistRhApiKeyForMode,
    persistRhApiKeyMode,
} from "../rhApiKeyStorage.js";

export function useRhApiKey() {
    const [apiKey, setApiKeyState] = useState(() => readRhApiKey());
    const [apiKeys, setApiKeysState] = useState(() => readRhApiKeys());
    const [apiKeyMode, setApiKeyModeState] = useState(() => readRhApiKeyMode());

    const syncFromStorage = useCallback(() => {
        setApiKeyState(readRhApiKey());
        setApiKeysState(readRhApiKeys());
        setApiKeyModeState(readRhApiKeyMode());
    }, []);

    useEffect(() => {
        const h = () => syncFromStorage();
        window.addEventListener(RH_API_KEY_CHANGED_EVENT, h);
        window.addEventListener("storage", h);
        return () => {
            window.removeEventListener(RH_API_KEY_CHANGED_EVENT, h);
            window.removeEventListener("storage", h);
        };
    }, [syncFromStorage]);

    const setApiKey = useCallback((key) => {
        const next = String(key || "").trim();
        persistRhApiKey(next);
        setApiKeyState(next);
        setApiKeysState(readRhApiKeys());
    }, []);

    const setApiKeyForMode = useCallback((mode, key) => {
        persistRhApiKeyForMode(mode, key);
        syncFromStorage();
    }, [syncFromStorage]);

    const setApiKeyMode = useCallback((mode) => {
        persistRhApiKeyMode(mode);
        syncFromStorage();
    }, [syncFromStorage]);

    return {
        apiKey,
        apiKeys,
        apiKeyMode,
        setApiKey,
        setApiKeyForMode,
        setApiKeyMode,
        syncFromStorage,
    };
}
