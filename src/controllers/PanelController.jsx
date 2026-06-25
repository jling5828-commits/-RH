import ReactDOM from "react-dom";

function normalizeMenuItems(menuItems) {
    if (!Array.isArray(menuItems)) return [];
    return menuItems.map((item) => ({
        id: item.id,
        label: item.label,
        enabled: item.enabled !== false,
        checked: item.checked === true,
    }));
}

function resolvePanelAttachment(eventOrNode) {
    if (!eventOrNode) return null;
    if (typeof eventOrNode.appendChild === "function") return eventOrNode;
    if (eventOrNode.node && typeof eventOrNode.node.appendChild === "function") return eventOrNode.node;
    if (eventOrNode.target && typeof eventOrNode.target.appendChild === "function") return eventOrNode.target;
    return null;
}

function preparePanelRoot(root, panelId) {
    root.dataset.xiaoliangRhPanel = panelId || "main";
    Object.assign(root.style, {
        width: "100%",
        height: "100vh",
        minHeight: "100vh",
        margin: "0",
        padding: "0",
        overflow: "hidden",
        boxSizing: "border-box",
    });
}

export class PanelController {
    constructor(Component, options = {}) {
        this.id = options.id || "";
        this.Component = Component;
        this.root = null;
        this.attachment = null;
        this.rawMenuItems = Array.isArray(options.menuItems) ? options.menuItems : [];
        this.menuItems = normalizeMenuItems(this.rawMenuItems);

        this.create = this.create.bind(this);
        this.show = this.show.bind(this);
        this.hide = this.hide.bind(this);
        this.destroy = this.destroy.bind(this);
        this.invokeMenu = this.invokeMenu.bind(this);
    }

    create() {
        if (this.root) return this.root;
        const root = document.createElement("div");
        preparePanelRoot(root, this.id);
        ReactDOM.render(this.Component({ panel: this }), root);
        this.root = root;
        return root;
    }

    show(attachment) {
        const root = this.create();
        const host = resolvePanelAttachment(attachment);
        if (!host) return root;
        if (root.parentNode && root.parentNode !== host) {
            root.parentNode.removeChild(root);
        }
        if (root.parentNode !== host) host.appendChild(root);
        this.attachment = host;
        return root;
    }

    hide() {
        if (this.root?.parentNode) this.root.parentNode.removeChild(this.root);
        this.attachment = null;
    }

    destroy() {
        if (!this.root) return;
        try { ReactDOM.unmountComponentAtNode(this.root); } catch (err) { console.warn("[PanelController] unmount failed", err); }
        this.hide();
        this.root = null;
    }

    invokeMenu(id) {
        const item = this.rawMenuItems.find((entry) => entry && entry.id === id);
        if (typeof item?.oninvoke === "function") item.oninvoke();
    }
}
