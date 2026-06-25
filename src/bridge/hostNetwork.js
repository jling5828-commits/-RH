import * as uxpBridge from "./uxpBridge.js";

function forward(method, args) {
    return uxpBridge[method](...args);
}

export function hostFetch(...args) {
    return forward("fetchProxy", args);
}

export function hostFetchFormData(...args) {
    return forward("fetchProxyFormData", args);
}

export function hostFetchFormDataMultiFiles(...args) {
    return forward("fetchProxyFormDataMultiFiles", args);
}

export function hostInvoke(command, payload) {
    return uxpBridge.invoke(command, payload);
}
