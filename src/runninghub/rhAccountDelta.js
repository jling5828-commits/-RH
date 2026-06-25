export function parseRhAccountNumber(value) {
    if (value == null || value === "") return null;
    const normalized = String(value).replace(/[,\s]/g, "").trim();
    if (!normalized) return null;
    const number = Number.parseFloat(normalized);
    return Number.isFinite(number) ? number : null;
}

export function formatRhDelta(value) {
    if (!Number.isFinite(value)) return "";
    const rounded = Math.round(value);
    if (Math.abs(value - rounded) < 1e-6) return String(rounded);
    return value.toFixed(4).replace(/\.?0+$/, "");
}

function deltaBetween(before, after, key) {
    const start = parseRhAccountNumber(before?.[key]);
    const end = parseRhAccountNumber(after?.[key]);
    return start != null && end != null ? start - end : null;
}

function pushCostLine(parts, label, value) {
    if (value != null && value > 1e-6) parts.push(`${label}${formatRhDelta(value)}`);
}

function chargedParts(before, after, labels) {
    const parts = [];
    pushCostLine(parts, labels.money, deltaBetween(before, after, "remainMoney"));
    pushCostLine(parts, labels.coins, deltaBetween(before, after, "remainCoins"));
    return parts;
}

export function buildRhSuccessSecondaryLine(elapsedSec, before, after) {
    const timePart = `耗时 ${Number(elapsedSec).toFixed(1)}s`;
    if (!before || !after) return `${timePart} · 扣费：未能对比余额`;

    const costs = chargedParts(before, after, {
        money: "余额 -",
        coins: "RH币 -",
    });
    return costs.length ? `${timePart} · ${costs.join(" · ")}` : `${timePart} · 余额/RH币未见变化（可能延迟结算）`;
}

export function buildRhCostLine(before, after) {
    if (!before || !after) return "扣费：未能对比余额";
    const costs = chargedParts(before, after, {
        money: "余额 -",
        coins: "RH币 -",
    });
    return costs.length ? costs.join(" · ") : "余额/RH币未见变化（可能延迟结算）";
}

export function formatRhAccountIdleHint(account) {
    if (!account) return "";
    const remainMoney = String(account.remainMoney || "").trim();
    const remainCoins = String(account.remainCoins || "").trim();
    return [
        remainMoney ? `余额 ${remainMoney}` : "",
        remainCoins ? `RH币 ${remainCoins}` : "",
    ].filter(Boolean).join(" · ");
}
