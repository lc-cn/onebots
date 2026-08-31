import { Account, Adapter } from "onebots";
import { MatrixError } from "./errors.js";
import type { MatrixConfig } from "./types.js";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** 宿主负责 I/O；适配器只接收已读取的数据，避免本地文件泄漏与服务端请求伪造。 */
export function materializeMatrixUpload(params: Adapter.UploadFileParams): Uint8Array {
    if (params.path) {
        throw new MatrixError("Matrix upload_file 不读取宿主本地路径，请传入 base64 data", {
            code: "MATRIX_LOCAL_PATH_REJECTED",
        });
    }
    if (params.url) {
        throw new MatrixError("Matrix upload_file 不抓取远程 URL；请由宿主读取并传入 base64 data", {
            code: "MATRIX_REMOTE_SOURCE_REJECTED",
        });
    }
    if (!params.data) throw MatrixError.invalid("Matrix upload_file 必须提供 base64 data");
    const encoded = params.data.startsWith("data:")
        ? params.data.slice(params.data.indexOf(",") + 1)
        : params.data;
    if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded) || encoded.length % 4 !== 0) {
        throw MatrixError.invalid("upload_file.data 不是有效 base64");
    }
    const data = new Uint8Array(Buffer.from(encoded, "base64"));
    if (data.byteLength > MAX_UPLOAD_BYTES) {
        throw MatrixError.invalid("Matrix 上传源超过 100 MiB 限制");
    }
    return data;
}

export function normalizeMatrixConfig(config: Account.Config<"matrix">): MatrixConfig {
    return {
        account_id: config.account_id,
        homeserver_url: config.homeserver_url,
        access_token: config.access_token,
        user_id: config.user_id,
        device_id: config.device_id,
        receive_mode: config.receive_mode,
        appservice_id: config.appservice_id,
        as_token: config.as_token,
        hs_token: config.hs_token,
        appservice_path: config.appservice_path,
        sync_timeout_ms: config.sync_timeout_ms,
        sync_retry_min_ms: config.sync_retry_min_ms,
        sync_retry_max_ms: config.sync_retry_max_ms,
        initial_sync_limit: config.initial_sync_limit,
        lazy_load_members: config.lazy_load_members,
        sync_presence: config.sync_presence,
        event_types: config.event_types,
        direct_room_ids: config.direct_room_ids,
    };
}
