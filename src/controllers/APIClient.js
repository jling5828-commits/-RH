/**
 * APIClient.js
 * 已清理 - 保留空实现以避免构建错误
 */

export class APIClient {
    static async callUpscale(params) {
        return { success: false, error: "该功能暂不可用" };
    }

    static async call(mode, params) {
        return { success: false, error: "该功能暂不可用" };
    }

    static getConfig(mode) {
        return { baseUrl: "", apiKey: "" };
    }
}