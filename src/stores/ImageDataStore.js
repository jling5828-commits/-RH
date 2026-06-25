const REF_SLOT_KEYS = Object.freeze(["ref1", "ref2", "ref3", "ref4", "ref5", "ref6"]);

function mainSlot() {
    return {
        previewBase64: null,
        uploadBuffer: null,
        uploadFormat: null,
        width: null,
        height: null,
    };
}

function refSlot() {
    return {
        previewBase64: null,
        uploadBuffer: null,
        uploadFormat: null,
    };
}

function buildRefSlots() {
    return Object.fromEntries(REF_SLOT_KEYS.map((key) => [key, refSlot()]));
}

const listeners = new Set();

const storeState = {
    main: mainSlot(),
    refs: buildRefSlots(),
    selectionBounds: null,
    mainPreviewSnapshot: null,
};

function clonePlain(value) {
    if (value == null) return value;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return value;
    }
}

function refSnapshot(slot) {
    return {
        previewBase64: slot?.previewBase64 || null,
        hasUploadData: !!slot?.uploadBuffer,
    };
}

function publicSnapshot() {
    const refs = {};
    for (const key of REF_SLOT_KEYS) refs[key] = refSnapshot(storeState.refs[key]);
    return {
        main: {
            previewBase64: storeState.main.previewBase64,
            width: storeState.main.width,
            height: storeState.main.height,
            uploadFormat: storeState.main.uploadFormat,
            hasUploadData: !!storeState.main.uploadBuffer,
        },
        refs,
        selectionBounds: clonePlain(storeState.selectionBounds),
        mainPreviewSnapshot: clonePlain(storeState.mainPreviewSnapshot),
    };
}

function emitChange() {
    const snapshot = publicSnapshot();
    for (const listener of Array.from(listeners)) {
        try {
            listener(snapshot);
        } catch (error) {
            console.warn("[ImageDataStore] listener failed:", error);
        }
    }
}

function refByKey(key) {
    return Object.prototype.hasOwnProperty.call(storeState.refs, key) ? storeState.refs[key] : null;
}

function patchMain(patch) {
    storeState.main = { ...storeState.main, ...patch };
    emitChange();
}

function patchRef(key, patch) {
    const slot = refByKey(key);
    if (!slot) return;
    storeState.refs[key] = { ...slot, ...patch };
    emitChange();
}

const ImageDataStore = {
    getAll() {
        return publicSnapshot();
    },

    getMainPreview() {
        return storeState.main.previewBase64;
    },

    getMainUploadBuffer() {
        return storeState.main.uploadBuffer;
    },

    getMainUploadFormat() {
        return storeState.main.uploadFormat;
    },

    getMainDimensions() {
        const { width, height } = storeState.main;
        return { width, height };
    },

    setMainPreview(previewBase64) {
        patchMain({ previewBase64 });
    },

    setMainUpload(uploadBuffer, uploadFormat, width, height) {
        patchMain({ uploadBuffer, uploadFormat, width, height });
    },

    getRefPreview(key) {
        return refByKey(key)?.previewBase64 || null;
    },

    getRefUploadBuffer(key) {
        return refByKey(key)?.uploadBuffer || null;
    },

    getRefUploadFormat(key) {
        return refByKey(key)?.uploadFormat || null;
    },

    setRefPreview(key, previewBase64) {
        patchRef(key, { previewBase64 });
    },

    setRefUpload(key, uploadBuffer, uploadFormat) {
        patchRef(key, { uploadBuffer, uploadFormat });
    },

    getSelectionBounds() {
        return storeState.selectionBounds;
    },

    setSelectionBounds(bounds) {
        storeState.selectionBounds = bounds;
        emitChange();
    },

    getMainPreviewSnapshot() {
        return storeState.mainPreviewSnapshot;
    },

    setMainPreviewSnapshot(snapshot) {
        storeState.mainPreviewSnapshot = snapshot || null;
        emitChange();
    },

    clearMain() {
        storeState.main = mainSlot();
        storeState.mainPreviewSnapshot = null;
        emitChange();
    },

    clearMainUpload() {
        patchMain({ uploadBuffer: null, uploadFormat: null, width: null, height: null });
    },

    clearRefUpload(key) {
        patchRef(key, { uploadBuffer: null, uploadFormat: null });
    },

    clearRef(key) {
        if (!refByKey(key)) return;
        storeState.refs[key] = refSlot();
        emitChange();
    },

    subscribe(listener) {
        if (typeof listener !== "function") return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
    },

    _notify() {
        emitChange();
    },
};

export default ImageDataStore;
