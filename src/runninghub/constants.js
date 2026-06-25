export const RH_DEFAULT_BASE_URL = "https://www.runninghub.cn";

function apiPath(prefix, suffix) {
    return `${prefix}${suffix}`;
}

function definePaths(prefix, spec) {
    return Object.freeze(Object.fromEntries(spec.map(([name, suffix]) => [name, apiPath(prefix, suffix)])));
}

const APP_PATHS = definePaths("/api", [
    ["PARSE_APP", "/webapp/apiCallDemo"],
    ["GET_JSON_API_FORMAT", "/openapi/getJsonApiFormat"],
]);

const TASK_PATHS = definePaths("/task/openapi", [
    ["AI_APP_RUN", "/ai-app/run"],
    ["TASK_STATUS", "/status"],
    ["TASK_OUTPUTS_LEGACY", "/outputs"],
    ["CANCEL_TASK", "/cancel"],
    ["TASK_UPLOAD", "/upload"],
]);

const ACCOUNT_PATHS = definePaths("/uc/openapi", [
    ["ACCOUNT_STATUS", "/accountStatus"],
]);

const OPENAPI_V2_PATHS = definePaths("/openapi/v2", [
    ["UPLOAD_BINARY", "/media/upload/binary"],
    ["QUERY_V2", "/query"],
]);

export const RH_PATH = Object.freeze({
    ...APP_PATHS,
    ...TASK_PATHS,
    ...ACCOUNT_PATHS,
    ...OPENAPI_V2_PATHS,
});

export const RH_PARSE_FALLBACKS = Object.freeze([
    "/uc/openapi/app",
    "/uc/openapi/community/app",
    "/uc/openapi/workflow",
]);

export const RH_DEFAULT_POLL_INITIAL_MS = 1000;
export const RH_DEFAULT_POLL_MAX_MS = 8000;
export const RH_DEFAULT_GLOBAL_TIMEOUT_MS = 30 * 60 * 1000;
export const RH_DEFAULT_STATUS_MAX_ERRORS = 5;
export const RH_DEFAULT_UNKNOWN_STATUS_MAX = 8;
export const RH_LIST_ALLOW_EMPTY_SELECTION = false;

export const RH_POLL_DEFAULTS = Object.freeze({
    initialMs: RH_DEFAULT_POLL_INITIAL_MS,
    maxMs: RH_DEFAULT_POLL_MAX_MS,
    timeoutMs: RH_DEFAULT_GLOBAL_TIMEOUT_MS,
    maxStatusErrors: RH_DEFAULT_STATUS_MAX_ERRORS,
    maxUnknownStatus: RH_DEFAULT_UNKNOWN_STATUS_MAX,
});
