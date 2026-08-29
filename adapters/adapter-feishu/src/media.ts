import { materializeMediaSource, type MediaSourceInput } from "onebots";
import { FeishuError } from "./errors.js";

export interface FeishuMediaClient {
    readonly endpoint: string;
    getTenantAccessToken(): Promise<string>;
    invalidateTenantAccessToken(token: string): void;
}

/** 上传消息图片并返回只能由当前应用使用的 image_key。 */
export async function uploadFeishuImage(
    client: FeishuMediaClient,
    input: MediaSourceInput,
): Promise<string> {
    const media = await materializeMediaSource(input);
    const form = new FormData();
    form.set("image_type", "message");
    form.set(
        "image",
        new Blob([new Uint8Array(media.data)], { type: media.contentType }),
        media.filename,
    );
    return upload(client, "/im/v1/images", form, "image_key");
}

/** 上传消息文件、语音或视频并返回 file_key。 */
export async function uploadFeishuFile(
    client: FeishuMediaClient,
    input: MediaSourceInput & { fileType: string; duration?: number },
): Promise<string> {
    const media = await materializeMediaSource(input);
    const form = new FormData();
    form.set("file_type", input.fileType);
    form.set("file_name", media.filename);
    if (input.duration !== undefined) form.set("duration", String(input.duration));
    form.set(
        "file",
        new Blob([new Uint8Array(media.data)], { type: media.contentType }),
        media.filename,
    );
    return upload(client, "/im/v1/files", form, "file_key");
}

async function upload(
    client: FeishuMediaClient,
    path: string,
    body: FormData,
    key: "image_key" | "file_key",
): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const token = await client.getTenantAccessToken();
        let response: Response;
        try {
            response = await fetch(`${client.endpoint}${path}`, {
                method: "POST",
                headers: { authorization: `Bearer ${token}` },
                body,
            });
        } catch (error) {
            throw FeishuError.wrap(error, "FEISHU_NETWORK_ERROR", `POST ${path}`);
        }
        const payload = await parseUploadResponse(response, path);
        if (payload.code === 99991663 && attempt === 0) {
            client.invalidateTenantAccessToken(token);
            continue;
        }
        const value = payload.data?.[key];
        if (!response.ok || payload.code !== 0 || typeof value !== "string" || !value) {
            throw new FeishuError(`飞书媒体上传失败: ${payload.msg || `HTTP ${response.status}`}`, {
                code: response.ok ? "FEISHU_API_ERROR" : "FEISHU_HTTP_ERROR",
                operation: `POST ${path}`,
                status: response.status,
                details: payload,
            });
        }
        return value;
    }
    throw new FeishuError("飞书媒体上传令牌刷新后仍然失败", {
        code: "FEISHU_API_ERROR",
        operation: `POST ${path}`,
    });
}

async function parseUploadResponse(
    response: Response,
    path: string,
): Promise<{ code?: number; msg?: string; data?: Record<string, unknown> }> {
    let value: unknown;
    try {
        value = await response.json();
    } catch (error) {
        throw new FeishuError("飞书媒体上传返回结构无效", {
            code: "FEISHU_INVALID_RESPONSE",
            operation: `POST ${path}`,
            status: response.status,
            cause: error,
        });
    }
    if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new FeishuError("飞书媒体上传返回结构无效", {
            code: "FEISHU_INVALID_RESPONSE",
            operation: `POST ${path}`,
            status: response.status,
            details: value,
        });
    return value as { code?: number; msg?: string; data?: Record<string, unknown> };
}
