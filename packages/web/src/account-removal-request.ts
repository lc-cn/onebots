import {
    MANAGEMENT_EXPECTED_CONFIG_REVISION_HEADER,
    MANAGEMENT_EXPECTED_INSTANCE_HEADER,
} from "./management-evidence-identity.js";

/** 构造不会被浏览器预取语义误触发、并绑定配置快照身份的账号删除请求。 */
export function buildAccountRemovalRequest(
    platform: string,
    uin: string,
    expectedInstanceId: string,
    expectedConfigRevision: string,
): RequestInit {
    return {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            [MANAGEMENT_EXPECTED_INSTANCE_HEADER]: expectedInstanceId,
            [MANAGEMENT_EXPECTED_CONFIG_REVISION_HEADER]: expectedConfigRevision,
        },
        body: JSON.stringify({ platform, uin }),
    };
}
