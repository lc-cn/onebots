import { Buffer } from "node:buffer";
import { materializeMediaSource, type Adapter } from "onebots";

/** 将标准 upload_file 参数统一物化为 ICQQ 可上传的字节。 */
export async function materializeICQQUpload(params: Adapter.UploadFileParams): Promise<Buffer> {
    const candidates = [params.url, params.path, params.data].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (candidates.length !== 1) {
        throw new TypeError("ICQQ upload_file 必须且只能提供 url、path、data 之一");
    }
    const source = params.data ? `base64://${params.data}` : candidates[0]!;
    const media = await materializeMediaSource({ source, filename: params.name });
    return Buffer.from(media.data);
}
