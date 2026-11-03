/** 原生 helper 不参与管理配对；过滤副本，不消费主进程尚待处理的部署码。 */
export function nativeHelperEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const sanitized = { ...env };
    delete sanitized.ONEBOTS_BOOTSTRAP_CODE;
    delete sanitized.ONEBOTS_RECOVERY_CODE;
    return sanitized;
}
