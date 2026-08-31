import { createHmac, randomBytes } from "node:crypto";

const processFingerprintKey = randomBytes(32);

export interface SecretLogEvidence {
    present: boolean;
    fingerprint?: string;
}

/** 使用仅存在于当前进程内的随机密钥生成短指纹，日志不保留秘密原文或可离线重算的摘要。 */
export function createSecretLogEvidence(secret?: string): SecretLogEvidence {
    if (!secret) return { present: false };
    return {
        present: true,
        fingerprint: createHmac("sha256", processFingerprintKey)
            .update(secret)
            .digest("hex")
            .slice(0, 16),
    };
}
