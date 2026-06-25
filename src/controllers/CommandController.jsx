import ReactDOM from "react-dom";

const MODAL_DEFAULTS = Object.freeze({
    resize: "none",
    size: Object.freeze({ width: 480, height: 320 }),
});
const MODAL_STYLE = Object.freeze({
    width: "100%",
    height: "100%",
    margin: "0",
    padding: "0",
    border: "0",
    overflow: "hidden",
    boxSizing: "border-box",
    background: "transparent",
});
const FALLBACK_TITLE = "小梁RH";

function commandTitle(id) {
    return id ? String(id) : FALLBACK_TITLE;
}

function dialogOptionsFor(id, overrides = {}) {
    return {
        ...MODAL_DEFAULTS,
        title: commandTitle(id),
        size: { ...MODAL_DEFAULTS.size },
        ...overrides,
    };
}

function createCommandDialog(id) {
    const dialog = document.createElement("dialog");
    dialog.dataset.xiaoliangRhCommand = id || "command";
    Object.assign(dialog.style, MODAL_STYLE);
    return dialog;
}

function renderCommandComponent(Component, dialog) {
    ReactDOM.render(Component({ dialog }), dialog);
    return dialog;
}

function attachDialog(dialog) {
    if (!dialog.parentNode) document.body.appendChild(dialog);
}

function removeDialog(dialog) {
    if (dialog.parentNode) dialog.remove();
}

export class CommandController {
    constructor(Component, { id, ...dialogOptions } = {}) {
        this.id = id || "";
        this.Component = Component;
        this.dialogOptions = dialogOptionsFor(this.id, dialogOptions);
        this.dialog = null;
        this.run = this.run.bind(this);
    }

    getDialog() {
        if (!this.dialog) {
            this.dialog = renderCommandComponent(this.Component, createCommandDialog(this.id));
        }
        return this.dialog;
    }

    async run() {
        const dialog = this.getDialog();
        attachDialog(dialog);
        try {
            await dialog.showModal(this.dialogOptions);
        } finally {
            removeDialog(dialog);
        }
    }
}
