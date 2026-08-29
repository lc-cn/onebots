import { WeComKfError } from "./errors.js";

export const MAX_KF_UPLOAD_BYTES = 20 * 1024 * 1024;

/** 严格解码上传接口使用的 Base64，拒绝空值、非规范字符和超限内容。 */
export function decodeKfBase64(value: string, field = "data"): Buffer {
    if (!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u.test(value))
        throw invalid(`${field} 必须是有效 Base64`);
    const bytes = Buffer.from(value, "base64");
    assertKfUploadSize(bytes.length);
    return bytes;
}

/** 校验微信客服临时素材的统一安全上限。 */
export function assertKfUploadSize(size: number): void {
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_KF_UPLOAD_BYTES)
        throw invalid(`上传文件必须在 1 到 ${MAX_KF_UPLOAD_BYTES} 字节之间`);
}

function invalid(message: string): WeComKfError {
    return new WeComKfError(`微信客服 ${message}`, { code: "WECOM_KF_INVALID_UPLOAD" });
}
