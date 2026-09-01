import { readBoundedJsonResponse, readBoundedResponseBody } from "./bounded-response.js";

export const WEB_MANAGEMENT_BODY_LIMIT_BYTES = 4 * 1024 * 1024;

/** 读取受保护管理端点的文本响应，并限制声明长度与实际流字节数。 */
export function readManagementResponseBody(response: Response): Promise<string> {
    return readBoundedResponseBody(response, WEB_MANAGEMENT_BODY_LIMIT_BYTES);
}

/** 读取受保护管理端点的 JSON 响应；调用方仍需验证业务契约。 */
export function readManagementJsonResponse(response: Response): Promise<unknown> {
    return readBoundedJsonResponse(response, WEB_MANAGEMENT_BODY_LIMIT_BYTES);
}
