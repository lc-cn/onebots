/** 保留 CI 子命令失败原因；必须先脱敏再截断，避免截断留下凭据前缀。 */
export function ciCommandDiagnostic(result, secrets = []) {
    let output = [result.stdout ?? "", result.stderr ?? "", result.error?.code ?? ""].join("\n");
    for (const secret of secrets) {
        if (secret) output = output.replaceAll(secret, "[REDACTED]");
    }
    return output
        .replace(/\x1b\[[0-9;]*m/g, "")
        .trim()
        .slice(0, 2048);
}
