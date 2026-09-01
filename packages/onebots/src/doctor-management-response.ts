import { readBoundedResponseBody } from "./bounded-response.js";

export const DOCTOR_MANAGEMENT_BODY_LIMIT_BYTES = 4 * 1024 * 1024;

/** 解析受保护管理端点的有限 JSON 响应，防止诊断路径接收无界正文。 */
export async function readDoctorManagementJson(response: Response): Promise<unknown> {
    return JSON.parse(await readBoundedResponseBody(response, DOCTOR_MANAGEMENT_BODY_LIMIT_BYTES));
}
