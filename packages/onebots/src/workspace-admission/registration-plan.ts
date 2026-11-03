import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalConfiguration } from "../configuration/configuration-store.js";
import { AuthorityRegistry } from "./registry.js";
import { readWorkspaceBinding } from "./admission.js";
import {
    digest,
    exists,
    fileDigest,
    physicalIdentity,
    readPrivate,
    separatedPaths,
} from "./files.js";
import { assertRegistrationQuiet } from "./registration-quiet.js";
import { HASH, UUID, REGISTRATION_IMPACT, type RegistrationPlan } from "./types.js";

const lockNames = new Set([
    "manager-lock.sqlite",
    "manager-lock.sqlite-journal",
    "manager-lock.sqlite-wal",
    "manager-lock.sqlite-shm",
]);

export function isEmptyBusinessWorkspace(workspace: string): boolean {
    const entries = fs.readdirSync(workspace);
    if (entries.length === 0) return true;
    if (entries.length !== 1 || entries[0] !== ".control") return false;
    const control = path.join(workspace, ".control");
    physicalIdentity(control);
    return fs.readdirSync(control).every(name => {
        if (!lockNames.has(name)) return false;
        // 不读正在持有的数据库内容，只核验真实常规文件及权限/链接边界。
        const stat = fs.lstatSync(path.join(control, name));
        return (
            stat.isFile() &&
            !stat.isSymbolicLink() &&
            stat.nlink === 1 &&
            (process.platform === "win32" ||
                ((stat.mode & 0o077) === 0 && (!process.getuid || stat.uid === process.getuid())))
        );
    });
}
export const planDigest = (plan: Omit<RegistrationPlan, "digest">): string =>
    digest(canonicalConfiguration(plan));

/** 只读；返回计划无 token、auth target 或单独会话摘要，可以本机保存后明确确认。 */
export async function planWorkspaceRegistration(
    workspacePath: string,
    authorityPath: string,
    ids?: Partial<Pick<RegistrationPlan, "requestId" | "workspaceId" | "authorityId" | "desired">>,
): Promise<RegistrationPlan> {
    const workspace = fs.realpathSync(workspacePath);
    const authorityDirectory = path.resolve(authorityPath);
    separatedPaths(workspace, authorityDirectory);
    const rootIdentity = physicalIdentity(workspace, false);
    if (readWorkspaceBinding(workspace)) throw new Error("已有来源绑定，不能重新登记或换身份");
    const control = path.join(workspace, ".control");
    const controlIdentity = exists(control) ? physicalIdentity(control) : null;
    const kind = isEmptyBusinessWorkspace(workspace) ? "new" : "legacy";
    if (kind === "legacy") await assertRegistrationQuiet(workspace);
    let authorityId = ids?.authorityId ?? randomUUID();
    let authorityExisted = false;
    if (exists(authorityDirectory)) {
        physicalIdentity(authorityDirectory);
        if (exists(path.join(authorityDirectory, "authority.sqlite"))) {
            const registry = AuthorityRegistry.open(authorityDirectory);
            try {
                authorityId = registry.authorityId;
                authorityExisted = true;
            } finally {
                registry.close();
            }
        } else if (fs.readdirSync(authorityDirectory).length !== 0)
            throw new Error("authority 存在未知残片，不能初始化");
    } else physicalIdentity(path.dirname(authorityDirectory), false);
    const gateway = readPrivate(path.join(control, "gateway.json"));
    const desired: unknown = gateway
        ? JSON.parse(gateway.bytes.toString("utf8")).desired
        : (ids?.desired ?? "running");
    if (desired !== "running" && desired !== "stopped") throw new Error("网关运行意图不可确认");
    const plan: Omit<RegistrationPlan, "digest"> = {
        schemaVersion: 1,
        impact: REGISTRATION_IMPACT,
        requestId: ids?.requestId ?? randomUUID(),
        workspaceId: ids?.workspaceId ?? randomUUID(),
        workspace,
        authorityDirectory,
        authorityId,
        authorityExisted,
        rootIdentity,
        controlIdentity,
        kind,
        receiptDigest: fileDigest(path.join(control, "process-ownership.json")),
        authDigest: fileDigest(path.join(control, "auth.json")),
        gatewayDigest: gateway?.revision ?? null,
        desired,
    };
    return { ...plan, digest: planDigest(plan) };
}

export function parseRegistrationPlan(input: unknown): RegistrationPlan {
    if (!input || typeof input !== "object" || Array.isArray(input))
        throw new Error("登记计划无效");
    const value = input as RegistrationPlan;
    const keys =
        "authDigest,authorityDirectory,authorityExisted,authorityId,controlIdentity,desired,digest,gatewayDigest,impact,kind,receiptDigest,requestId,rootIdentity,schemaVersion,workspace,workspaceId";
    if (
        Object.keys(value).sort().join() !== keys ||
        value.schemaVersion !== 1 ||
        value.impact !== REGISTRATION_IMPACT ||
        !UUID.test(value.requestId) ||
        !UUID.test(value.workspaceId) ||
        !UUID.test(value.authorityId) ||
        !HASH.test(value.digest) ||
        typeof value.workspace !== "string" ||
        !path.isAbsolute(value.workspace) ||
        typeof value.authorityDirectory !== "string" ||
        !path.isAbsolute(value.authorityDirectory) ||
        typeof value.authorityExisted !== "boolean" ||
        !["new", "legacy"].includes(value.kind) ||
        !["running", "stopped"].includes(value.desired) ||
        [value.authDigest, value.gatewayDigest, value.receiptDigest].some(
            hash => hash !== null && (typeof hash !== "string" || !HASH.test(hash)),
        )
    )
        throw new Error("登记计划结构无效");
    const { digest: expected, ...plan } = value;
    if (planDigest(plan) !== expected) throw new Error("登记计划摘要无效");
    return value;
}
