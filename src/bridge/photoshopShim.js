import { photoshop } from "./uxpBridge.js";

const emptyPhotoshop = Object.freeze({
    app: undefined,
    action: undefined,
    core: undefined,
    imaging: undefined,
});

const activePhotoshop = photoshop || emptyPhotoshop;

export const app = activePhotoshop.app;
export const action = activePhotoshop.action;
export const core = activePhotoshop.core;
export const imaging = activePhotoshop.imaging;

export default activePhotoshop;
