import { materializeMediaSource, type MediaSourceInput } from "onebots";

export interface FeishuMediaClient {
    readonly endpoint: string;
    getTenantAccessToken(): Promise<string>;
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
    const token = await client.getTenantAccessToken();
    const response = await fetch(`${client.endpoint}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body,
    });
    const payload = (await response.json()) as {
        code?: number;
        msg?: string;
        data?: Record<string, unknown>;
    };
    const value = payload.data?.[key];
    if (!response.ok || payload.code !== 0 || typeof value !== "string" || !value) {
        throw new Error(`飞书媒体上传失败: ${payload.msg || `HTTP ${response.status}`}`);
    }
    return value;
}
