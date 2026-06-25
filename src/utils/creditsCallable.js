/**
 * creditsCallable.js
 * 已清理 - 保留空实现以避免构建错误
 */

const CREDITS_MAX_STORAGE_KEY = "xlrh_credits_max";

export function getCreditsMaxForCacheKey(cacheKey) {
    return null;
}

export function updateCreditsMaxForCacheKey(cacheKey, current) {
    // no-op
}

export function getCostPerCall(mode, cacheKey, model) {
    return null;
}

export function getCallableCount(credits, costPerCall, count = 1, mode) {
    return null;
}

export async function fetchCreditsForce(mode, baseUrl, apiKey) {
    return null;
}
