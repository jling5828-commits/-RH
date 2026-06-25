import React from "react";

export const RH_SUCCESS_TEXT = "\u5c0f\u6881\u56fe\u4fee\u597d\u4e86";

const EMPTY_TEXT = "-";
const META_JOINER = " / ";
const COPY = Object.freeze({
    idleMain: "\u7b49\u5f85\u4efb\u52a1\u6307\u4ee4...",
    doneMain: "\u5904\u7406\u5b8c\u6210",
    errorMain: "\u4efb\u52a1\u5931\u8d25",
    warnMain: "\u4efb\u52a1\u672a\u5b8c\u6210",
    idleSub: "\u914d\u7f6e Key \u4e0e\u5e94\u7528\u540e\u8fd0\u884c / \u70b9\u51fb\u5c55\u5f00\u8be6\u60c5",
    elapsed: "\u8017\u65f6",
    moreErrorsSuffix: "\u6761\u539f\u56e0 / \u70b9\u5f00\u67e5\u770b",
    metaHint: "\u6587\u6863 / \u5e94\u7528 / RH \u89c1\u4e0b\u884c",
});

function cleanText(value, fallback = EMPTY_TEXT) {
    const text = value == null ? "" : String(value).trim();
    return text.length > 0 ? text : fallback;
}

function shorten(value, limit = 72) {
    const text = cleanText(value, "");
    return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function joinMeta(parts) {
    return parts.map((part) => cleanText(part)).join(META_JOINER);
}

function firstDetailError(detail) {
    const errors = Array.isArray(detail?.errors) ? detail.errors : [];
    return cleanText(errors[0], "");
}

function attachShortError(message, detail) {
    const base = cleanText(message, "");
    const first = firstDetailError(detail);
    if (!first || base.includes(first)) return base;
    const clipped = shorten(first);
    return base.length > 100 ? clipped : `${base} / ${clipped}`;
}

function resultBits(detail) {
    const bits = [];
    if (detail?.time) bits.push(`${COPY.elapsed} ${detail.time}`);
    if (detail?.cost) bits.push(String(detail.cost));
    return bits;
}

export function RhDocAppRhMeta({ docName, appName }) {
    const doc = cleanText(docName);
    const app = cleanText(appName);
    const title = joinMeta([doc, app, "RH"]);

    return (
        <div className="rh-meta-trilogy" title={title}>
            <span className="rh-meta-trilogy__seg rh-meta-trilogy__doc">{doc}</span>
            <span className="rh-meta-trilogy__sep">{META_JOINER}</span>
            <span className="rh-meta-trilogy__seg rh-meta-trilogy__app">{app}</span>
            <span className="rh-meta-trilogy__sep">{META_JOINER}</span>
            <span className="rh-meta-trilogy__rh">RH</span>
        </div>
    );
}

export function rhBuildMetaLineFull(docName, presetName) {
    return joinMeta([docName, presetName, "RH"]);
}

export function rhMainDisplayMsg({ statusType, isRunning, metaLineFull, resultDetail, statusText }) {
    if (statusType === "idle") return COPY.idleMain;
    if (isRunning) return cleanText(metaLineFull, "RH");
    if (statusType === "success") return RH_SUCCESS_TEXT;

    const rawMessage = resultDetail?.message ?? statusText;
    if (statusType === "error") return attachShortError(rawMessage ?? COPY.errorMain, resultDetail);
    if (statusType === "warning") return attachShortError(rawMessage ?? COPY.warnMain, resultDetail);
    return cleanText(rawMessage, COPY.doneMain);
}

export function rhSubLinePlainText({ isRunning, stageText, elapsedSec, statusType, resultDetail }) {
    if (isRunning) {
        const stage = cleanText(stageText, "");
        if (!stage) return "";
        const elapsed = elapsedSec == null ? "" : ` / ${Number(elapsedSec).toFixed(1)}s`;
        return `${stage}${elapsed}`;
    }

    if (statusType === "success") {
        if (resultDetail?.secondaryMessage) return resultDetail.secondaryMessage;
        return resultBits(resultDetail).join(" / ");
    }

    if (statusType === "idle") return COPY.idleSub;

    if (statusType === "error" || statusType === "warning") {
        const bits = resultBits(resultDetail);
        const errorCount = Array.isArray(resultDetail?.errors) ? resultDetail.errors.length : 0;
        if (errorCount > 1) bits.push(`\u5171 ${errorCount} ${COPY.moreErrorsSuffix}`);
        return bits.length > 0 ? bits.join(" / ") : COPY.metaHint;
    }

    return "";
}

export function rhShouldShowMetaSecondRow(isRunning, statusType) {
    return !isRunning && statusType !== "idle" && statusType !== "success";
}

export function rhPopupSecondaryText({ isRunning, statusType, resultDetail, metaLineFull }) {
    if (isRunning) return "";
    if (resultDetail?.secondaryMessage) return resultDetail.secondaryMessage;
    const plain = rhSubLinePlainText({ isRunning: false, stageText: "", elapsedSec: null, statusType, resultDetail });
    return plain || cleanText(metaLineFull, "");
}
