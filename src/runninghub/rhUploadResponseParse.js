const URL_FIELD_SEEDS = Object.freeze([
    "download.url",
    "file.url",
    "image.url",
    "result.url",
    "public.url",
]);

function fieldNameVariants(seed) {
    const [prefix, suffix] = String(seed || "").split(".");
    if (!prefix || !suffix) return [];
    const suffixTitle = suffix.charAt(0).toUpperCase() + suffix.slice(1);
    return [`${prefix}_${suffix}`, `${prefix}${suffixTitle}`];
}

function buildUploadUrlFields() {
    const fields = ["url"];
    for (const seed of URL_FIELD_SEEDS) fields.push(...fieldNameVariants(seed));
    return Object.freeze(fields);
}

const RH_UPLOAD_URL_FIELDS = buildUploadUrlFields();

function cleanHttpUrl(value) {
    const text = typeof value === "string" ? value.trim() : "";
    return /^https?:\/\//i.test(text) ? text : "";
}

function ownValue(source, key) {
    return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
}

export function extractDownloadUrlFromData(data) {
    if (!data || typeof data !== "object") return "";
    for (const key of RH_UPLOAD_URL_FIELDS) {
        const found = cleanHttpUrl(ownValue(data, key));
        if (found) return found;
    }
    return "";
}
