import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { BaseApp, ValidationError } from "@onebots/core";

export const MANAGEMENT_CONFIG_REVISION_HEADER = "X-OneBots-Config-Revision";
export const MANAGEMENT_EXPECTED_CONFIG_REVISION_HEADER = "X-OneBots-Expected-Config-Revision";

interface ManagementConfigRevisionContext {
    get?(name: string): string;
    set(name: string, value: string): void;
}

export function createManagementConfigRevision(content: string): string {
    return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function setManagementConfigRevision(
    context: Pick<ManagementConfigRevisionContext, "set">,
    content: string,
): string {
    const revision = createManagementConfigRevision(content);
    context.set(MANAGEMENT_CONFIG_REVISION_HEADER, revision);
    return revision;
}

/** 防止同一运行实例中的旧编辑页覆盖另一项已经完成的配置修改。 */
export function assertManagementConfigRevisionPrecondition(
    context: Pick<ManagementConfigRevisionContext, "get">,
    operation: string,
    configPath = BaseApp.configPath,
): void {
    const rawExpected = context.get?.(MANAGEMENT_EXPECTED_CONFIG_REVISION_HEADER) ?? "";
    if (!rawExpected) return;
    const expected = rawExpected.trim();
    if (!/^sha256:[a-f0-9]{64}$/u.test(expected)) {
        throw new ValidationError(`${operation}请求的配置修订号无效`);
    }
    const current = createManagementConfigRevision(readFileSync(configPath, "utf8"));
    if (expected !== current) {
        throw new ManagementConfigRevisionMismatchError(
            `${operation}使用的配置已经过期，请重新读取后再操作`,
        );
    }
}

export class ManagementConfigRevisionMismatchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ManagementConfigRevisionMismatchError";
    }
}
