import { buildAccountConfigurationMutationRequest } from "./account-configuration-mutation.js";
import type { ManagementEvidenceIdentity } from "./management-evidence-identity.js";

/** 构造不会被浏览器预取语义误触发、并绑定配置快照身份的账号删除请求。 */
export function buildAccountRemovalRequest(
    platform: string,
    uin: string,
    identity: ManagementEvidenceIdentity,
    expectedConfigRevision: string,
): RequestInit {
    return buildAccountConfigurationMutationRequest(
        { platform, uin },
        identity,
        expectedConfigRevision,
    );
}
