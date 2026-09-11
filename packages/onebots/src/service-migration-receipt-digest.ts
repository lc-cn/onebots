import { createHash } from "node:crypto";
import { canonicalServiceJson, closedServiceObject } from "./service-operation-storage.js";
import type { ServiceMigrationReloadOldReceipt } from "./service-migration-types.js";

/** 对严格闭合的 reload-old 收据生成唯一摘要，供 start-old 收据复验。 */
export function digestServiceMigrationReloadOldReceipt(input: unknown): string {
    const value = closedServiceObject(input, [
        "schemaVersion",
        "backupDigest",
        "rollbackContractDigest",
        "enabled",
        "loaded",
        "definitionPath",
    ]);
    if (
        value.schemaVersion !== 1 ||
        typeof value.backupDigest !== "string" ||
        !/^[0-9a-f]{64}$/.test(value.backupDigest) ||
        typeof value.rollbackContractDigest !== "string" ||
        !/^[0-9a-f]{64}$/.test(value.rollbackContractDigest) ||
        typeof value.enabled !== "boolean" ||
        typeof value.loaded !== "boolean" ||
        typeof value.definitionPath !== "string" ||
        !value.definitionPath.startsWith("/") ||
        value.definitionPath.length > 4096 ||
        /[\u0000\r\n]/u.test(value.definitionPath)
    )
        throw new Error("旧运行工件与服务回退契约不匹配，禁止切换");
    return createHash("sha256")
        .update(canonicalServiceJson(value as unknown as ServiceMigrationReloadOldReceipt))
        .digest("hex");
}
