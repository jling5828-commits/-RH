const CODE_MESSAGES = new Map([
    [301, "参数错误：必填参数缺失或类型不符，请核对应用参数"],
    [380, "工作流不存在：请确认工作流 ID 是否正确"],
    [412, "API 路径异常：请检查接口地址是否正确"],
    [415, "独占 API 资源不足：请等待 30-120 秒后再试"],
    [416, "账户余额不足：请充值后重试"],
    [421, "共享 API 并发已满：请排队、降低并发或联系扩容"],
    [423, "未找到任务：任务 ID 可能错误或已被清理"],
    [433, "工作流校验失败：请检查节点参数、字段名和连接关系"],
    [435, "未找到 48G 实例：如需 48G 显存请提交 instanceType: plus"],
    [436, "独占会员到期：独占资源服务暂不可用"],
    [500, "服务端异常：请稍后重试或联系 RunningHub 支持"],
    [801, "免费用户不支持 API Key：请升级账户等级"],
    [802, "API Key 未授权或已失效：请检查密钥和权限"],
    [803, "nodeInfoList 不匹配：节点 ID 或字段名与应用定义不一致"],
    [804, "任务正在运行：请等待当前任务结果"],
    [805, "任务状态异常：任务可能已中断或取消"],
    [806, "未找到 Key 对应用户：请检查当前账号或密钥"],
    [807, "未找到任务记录：请确认任务 ID"],
    [808, "文件上传失败：请检查网络或重新上传"],
    [809, "文件过大：请压缩或降低上传尺寸"],
    [810, "工作流未保存或未运行：请在平台保存并手动运行一次"],
    [811, "企业 API Key 无效：请检查密钥或企业权限"],
    [812, "企业账户余额不足：请充值或更换 Key"],
    [813, "任务已排队：平台已受理，无需重复提交"],
    [901, "WebApp 不存在：请检查应用 ID"],
    [1000, "未知错误：请重试或联系支持"],
    [1001, "请求链接无效：请检查调用链接"],
    [1002, "API Key 无效：请检查密钥"],
    [1003, "请求频率超限：请降低提交速度"],
    [1004, "任务不存在或已过期：请检查任务 ID"],
    [1005, "系统内部错误：请稍后重试"],
    [1006, "任务执行超时：请重试"],
    [1007, "参数校验失败：请检查输入内容"],
    [1008, "文件大小超出限制：请压缩后重试"],
    [1009, "请求方法不支持：请确认 GET/POST"],
    [1010, "服务暂不可用：请稍后重试"],
    [1011, "系统繁忙：请稍后重试"],
    [1012, "上游响应异常：请稍后重试或联系支持"],
    [1013, "文件处理失败：请检查链接或重新上传"],
    [1014, "访问被拒绝：标准模型 API 需要企业级共享 Key"],
    [1015, "生成失败：请重试"],
    [1101, "节点信息异常：工作流节点数据解析失败"],
    [1501, "内容审核未通过：请修改提示词或图片"],
    [1504, "模型响应超时：请稍后重试"],
    [1505, "禁止生成真人：请修改提示词或参考图"],
]);

const MESSAGE_RULES = [
    [/Network request failed|Failed to fetch|Load failed|HTTP 0|RH_NETWORK_FAILED|TypeError:\s*fetch/i, "RunningHub 网络请求失败：请检查网络/VPN/代理/防火墙或稍后重试"],
    [/RH_REQUEST_TIMEOUT/i, "RunningHub 请求超时：请检查网络/VPN/代理/防火墙后重试"],
    [/暂无权限调用该内容|无权限调用该内容|无权调用|联系发布者开通|no permission|permission denied|unauthori[sz]ed|forbidden/i, "当前 API Key 无权调用该 AI 应用：请联系发布者开通，或更换已授权的应用/Key"],
    [/TASK_CREATE_FAILED_BY_NOT_ENOUGH_POWER_VALUE/i, "RH币/算力不足：平台拒绝创建任务；若当前是企业共享 Key，请核对 Key 权限和该应用是否绑定企业扣费"],
    [/TASK_CREATE_FAILED_BY_NOT_ENOUGH_WALLET/i, "账户余额不足：请充值后重试"],
    [/TASK_INSTANCE_MAXED/i, "独占 API 资源不足：请等待 30-120 秒后再试"],
    [/TASK_QUEUE_MAXED/i, "共享 API 并发已满：请排队、降低并发或联系扩容"],
    [/PARAMS_INVALID|Invalid parameters/i, "参数错误：必填参数缺失或类型不符，请核对应用参数"],
    [/WORKFLOW_NOT_EXISTS/i, "工作流不存在：请确认工作流 ID 是否正确"],
    [/TOKEN_INVALID/i, "API 路径异常：请检查接口地址是否正确"],
    [/TASK_NOT_FOUNED|TASK_NOT_FOUND|Task not found/i, "未找到任务：任务 ID 可能错误或已被清理"],
    [/VALIDATE_PROMPT_FAILED/i, "工作流校验失败：请检查节点参数、字段名和连接关系"],
    [/TASK_USER_EXCLAPI_INSTANCE_NOT_FOUND/i, "未找到 48G 实例：如需 48G 显存请提交 instanceType: plus"],
    [/TASK_USER_EXCLAPI_REQUIRED/i, "独占会员到期：独占资源服务暂不可用"],
    [/APIKEY_UNSUPPORTED_FREE_USER/i, "免费用户不支持 API Key：请升级账户等级"],
    [/APIKEY_UNAUTHORIZED/i, "API Key 未授权或已失效：请检查密钥和权限"],
    [/APIKEY_INVALID_NODE_INFO/i, "nodeInfoList 不匹配：节点 ID 或字段名与应用定义不一致"],
    [/APIKEY_TASK_IS_RUNNING/i, "任务正在运行：请等待当前任务结果"],
    [/APIKEY_TASK_STATUS_ERROR/i, "任务状态异常：任务可能已中断或取消"],
    [/APIKEY_USER_NOT_FOUND/i, "未找到 Key 对应用户：请检查当前账号或密钥"],
    [/APIKEY_TASK_NOT_FOUND/i, "未找到任务记录：请确认任务 ID"],
    [/APIKEY_UPLOAD_FAILED|upload failed/i, "文件上传失败：请检查网络或重新上传"],
    [/APIKEY_FILE_SIZE_EXCEEDED|File size limit exceeded/i, "文件过大：请压缩或降低上传尺寸"],
    [/WORKFLOW_NOT_SAVED_OR_NOT_RUNNING/i, "工作流未保存或未运行：请在平台保存并手动运行一次"],
    [/CORPAPIKEY_INVALID/i, "企业 API Key 无效：请检查密钥或企业权限"],
    [/CORPAPIKEY_INSUFFICIENT_FUNDS/i, "企业账户余额不足：请充值或更换 Key"],
    [/APIKEY_TASK_IS_QUEUED/i, "任务已排队：平台已受理，无需重复提交"],
    [/WEBAPP_NOT_EXISTS/i, "WebApp 不存在：请检查应用 ID"],
    [/Access Denied: Standard Model API/i, "访问被拒绝：标准模型 API 需要企业级共享 Key"],
    [/Content verification failed/i, "内容审核未通过：请修改提示词或图片"],
    [/Model timed out/i, "模型响应超时：请稍后重试"],
    [/Photorealistic real people are prohibited/i, "禁止生成真人：请修改提示词或参考图"],
    [/Rate limit exceeded/i, "请求频率超限：请降低提交速度"],
    [/Service unavailable|System is currently busy/i, "服务繁忙：请稍后重试"],
];

const HTTP_MESSAGES = new Map([
    [400, "请求参数错误：请核对应用参数"],
    [401, "API Key 无效或鉴权失败：请检查 Key 并确认已开通权限"],
    [403, "API Key 无权限：请确认 Key 是否绑定当前应用或余额是否充足"],
    [404, "接口地址不存在：请检查 URL 是否正确"],
    [408, "请求超时：请稍后重试"],
    [413, "上传文件过大：请降低尺寸或压缩后重试"],
    [429, "请求过于频繁：请稍后重试"],
    [500, "服务端内部错误：请稍后重试"],
    [502, "网关错误：请稍后重试"],
    [503, "服务暂不可用：请稍后重试"],
    [504, "网关超时：请稍后重试"],
]);

function toFiniteNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return null;
}

function text(value) {
    return value == null ? "" : String(value).trim();
}

function messageFromRules(value) {
    const raw = text(value);
    if (!raw) return "";
    const matched = MESSAGE_RULES.find(([pattern]) => pattern.test(raw));
    return matched ? matched[1] : "";
}

function safeJson(value) {
    try {
        return JSON.stringify(value);
    } catch {
        return "";
    }
}

export function isRhPermissionError(opts = {}) {
    const status = toFiniteNumber(opts.status);
    const code = toFiniteNumber(opts.code);
    if (status === 401 || status === 403 || code === 802 || code === 811 || code === 1014) return true;
    const value = [
        opts.message,
        opts.errorMessage,
        opts.errorCode,
        opts.rawBody,
        opts.detail && safeJson(opts.detail),
    ].filter(Boolean).join(" ");
    return /暂无权限调用该内容|无权限调用该内容|无权调用|联系发布者开通|no permission|permission denied|unauthori[sz]ed|forbidden|Access Denied/i.test(value);
}

export function formatRhError(opts = {}) {
    const code = toFiniteNumber(opts.code);
    if (code != null && CODE_MESSAGES.has(code)) return CODE_MESSAGES.get(code);

    const platformText = text(opts.message) || text(opts.errorMessage) || text(opts.errorCode);
    if (/^RunningHub\s+.*(?:网络请求失败|请求超时)：/.test(platformText)) return platformText;
    const ruleMessage = messageFromRules(platformText) || messageFromRules(opts.errorCode);
    if (ruleMessage) return ruleMessage;

    const status = toFiniteNumber(opts.status);
    if (status != null && HTTP_MESSAGES.has(status)) return HTTP_MESSAGES.get(status);

    if (platformText) return platformText;
    if (code != null) return `RunningHub 请求失败（code=${code}）`;
    return "RunningHub 请求失败，请稍后重试";
}
