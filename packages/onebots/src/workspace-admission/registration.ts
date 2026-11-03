import fs from "node:fs";
import path from "node:path";
import { acquireControlWorkspace } from "../control/workspace.js";
import {
    planAuthenticationBinding,
    applyAuthenticationBinding,
    verifyAuthenticationBinding,
} from "../control/auth-binding.js";
import { planWorkspaceProcessGenesis } from "../service-process-genesis.js";
import { createDefaultServiceHost } from "../service-host.js";
import { createWindowsPrivateDirectory } from "../windows-private-file.js";
import { AuthorityRegistry, acquireAuthorityLock } from "./registry.js";
import {
    applyPrivateTarget,
    digest,
    exists,
    fileDigest,
    physicalIdentity,
    openPhysicalDirectory,
    sameIdentity,
    separatedPaths,
} from "./files.js";
import { isEmptyBusinessWorkspace, parseRegistrationPlan } from "./registration-plan.js";
import { assertRegistrationQuiet } from "./registration-quiet.js";
import {
    BINDING_FILE,
    UUID,
    authenticationContext,
    type RegistrationPlan,
    type RegistrationRecord,
} from "./types.js";

function ensurePrivateDirectory(directory: string): void {
    if (process.platform === "win32" && !exists(directory))
        createWindowsPrivateDirectory(directory);
    else if (!exists(directory)) fs.mkdirSync(directory, { mode: 0o700 });
    physicalIdentity(directory);
}

function checkRoot(plan: RegistrationPlan): void {
    if (
        fs.realpathSync(plan.workspace) !== plan.workspace ||
        !sameIdentity(plan.rootIdentity, physicalIdentity(plan.workspace, false))
    )
        throw new Error("工作区根目录已变化，登记计划过期");
    separatedPaths(plan.workspace, plan.authorityDirectory);
}
async function checkBeforePrepare(plan: RegistrationPlan): Promise<void> {
    checkRoot(plan);
    const control = path.join(plan.workspace, ".control");
    if (plan.controlIdentity && !sameIdentity(plan.controlIdentity, physicalIdentity(control)))
        throw new Error("管理目录物理身份已变化，登记计划过期");
    if (exists(path.join(control, BINDING_FILE))) throw new Error("已有来源引用，禁止重新登记");
    if (plan.kind === "new") {
        if (!isEmptyBusinessWorkspace(plan.workspace))
            throw new Error("工作区已包含数据，不能按新安装登记");
    } else await assertRegistrationQuiet(plan.workspace);
    for (const [name, expected] of [
        ["auth.json", plan.authDigest],
        ["gateway.json", plan.gatewayDigest],
        ["process-ownership.json", plan.receiptDigest],
    ] as const)
        if (fileDigest(path.join(control, name)) !== expected)
            throw new Error("登记计划依赖的状态已变化");
}

/** 显式首次登记或同一事务续办；调用绝不启动业务或签发配对码。 */
export async function registerWorkspace(input: unknown, confirmation: string) {
    const plan = parseRegistrationPlan(input);
    if (confirmation !== plan.digest) throw new Error("请明确确认完整登记计划摘要");
    checkRoot(plan);
    const control = path.join(plan.workspace, ".control");
    if (process.platform === "win32") ensurePrivateDirectory(control);
    const unlockWorkspace = acquireControlWorkspace(
        plan.workspace,
        process.platform === "win32" ? createDefaultServiceHost() : undefined,
    );
    let unlockAuthority: (() => void) | undefined;
    let registry: AuthorityRegistry | undefined;
    let opened: ReturnType<typeof openPhysicalDirectory> | undefined;
    try {
        checkRoot(plan);
        if (
            plan.authorityExisted &&
            !exists(path.join(plan.authorityDirectory, "authority.sqlite"))
        )
            throw new Error("原 authority 登记簿缺失，禁止补建");
        if (exists(path.join(plan.authorityDirectory, "authority.sqlite"))) {
            const previous = AuthorityRegistry.open(plan.authorityDirectory);
            try {
                if (previous.authorityId !== plan.authorityId)
                    throw new Error("authority 已变化，计划过期");
            } finally {
                previous.close();
            }
        } else if (
            exists(plan.authorityDirectory) &&
            fs
                .readdirSync(plan.authorityDirectory)
                .some(
                    name =>
                        ![
                            `${plan.workspaceId}.sqlite`,
                            `${plan.workspaceId}.sqlite-journal`,
                            `${plan.workspaceId}.sqlite-wal`,
                            `${plan.workspaceId}.sqlite-shm`,
                        ].includes(name),
                )
        ) {
            throw new Error("authority 存在未确认残片，禁止初始化");
        }
        ensurePrivateDirectory(plan.authorityDirectory);
        unlockAuthority = acquireAuthorityLock(plan.authorityDirectory, plan.workspaceId);
        registry = AuthorityRegistry.open(plan.authorityDirectory, plan.authorityId);
        opened = openPhysicalDirectory(control);
        const identity = opened.identity;
        let record = registry.findById(plan.requestId);
        if (record) {
            if (record.plan.digest !== plan.digest || !sameIdentity(record.identity, identity))
                throw new Error("登记请求或物理身份不匹配，禁止重放");
            if (record.status === "committed") return result(record);
            if (plan.kind === "legacy") {
                await assertRegistrationQuiet(plan.workspace);
                if (
                    fileDigest(path.join(control, "process-ownership.json")) !==
                        plan.receiptDigest ||
                    fileDigest(path.join(control, "gateway.json")) !== plan.gatewayDigest
                )
                    throw new Error("原登记计划的进程或网关证明已变化，保留现场");
            }
        } else {
            if (registry.byPhysical(JSON.stringify(identity)))
                throw new Error("该物理对象已有登记，禁止换身份");
            await checkBeforePrepare(plan);
            const binding = {
                schemaVersion: 1 as const,
                authorityId: plan.authorityId,
                workspaceId: plan.workspaceId,
                bindingRevision: 1,
                operationId: plan.requestId,
            };
            const authentication = planAuthenticationBinding(
                plan.workspace,
                authenticationContext(binding),
            );
            if (authentication.previousDigest !== plan.authDigest)
                throw new Error("认证状态已变化，登记计划过期");
            record = {
                schemaVersion: 1,
                status: "prepared",
                plan,
                identity,
                binding,
                authentication,
                genesis: plan.kind === "new" ? planWorkspaceProcessGenesis(plan.desired) : null,
            };
            registry.prepare(record);
        }
        // 所有跨文件目标均来自已提交 prepared，未知字节不覆盖。认证迁移独立拥有自己的状态。
        if (!sameIdentity(identity, physicalIdentity(control))) throw new Error("管理目录已替换");
        if (record.genesis) {
            const expectedNames =
                process.platform === "win32"
                    ? ["gateway.json"]
                    : ["gateway.json", "process-ownership.json"];
            if (Object.keys(record.genesis).sort().join() !== expectedNames.sort().join())
                throw new Error("初始进程计划损坏");
            for (const [name, bytes] of Object.entries(record.genesis)) {
                if (typeof bytes !== "string") throw new Error("初始进程目标损坏");
                applyPrivateTarget(path.join(control, name), null, bytes);
            }
        }
        applyAuthenticationBinding(plan.workspace, record.authentication);
        applyPrivateTarget(path.join(control, BINDING_FILE), null, JSON.stringify(record.binding));
        if (!verifyAuthenticationBinding(plan.workspace, authenticationContext(record.binding)))
            throw new Error("认证登记上下文未确认");
        if (fileDigest(path.join(control, BINDING_FILE)) !== digest(JSON.stringify(record.binding)))
            throw new Error("来源引用写入未确认");
        checkRoot(plan);
        if (!sameIdentity(identity, physicalIdentity(control)))
            throw new Error("登记提交前管理目录已替换");
        registry.commit(record);
        return result({ ...record, status: "committed" });
    } finally {
        try {
            registry?.close();
        } finally {
            try {
                unlockAuthority?.();
            } finally {
                try {
                    opened?.close();
                } finally {
                    unlockWorkspace();
                }
            }
        }
    }
}

function result(record: RegistrationRecord) {
    return {
        schemaVersion: 1,
        requestId: record.plan.requestId,
        status: record.status,
        workspaceId: record.binding.workspaceId,
        managementSessionsRevoked: true,
        next: "登记没有启动管理服务或网关。先用新程序 serve 或系统服务 start 启动已登记管理端，再在本机运行 auth bootstrap（首次安装）或 auth recover（已配对旧安装）完成设备配对。",
    };
}

export async function resumeWorkspaceRegistration(
    workspace: string,
    authorityDirectory: string,
    requestId: string,
) {
    if (!UUID.test(requestId)) throw new Error("登记请求 ID 无效");
    const registry = AuthorityRegistry.open(authorityDirectory);
    let record: RegistrationRecord | undefined;
    try {
        record = registry.findById(requestId);
    } finally {
        registry.close();
    }
    if (
        !record ||
        record.plan.workspace !== fs.realpathSync(workspace) ||
        record.plan.authorityDirectory !== path.resolve(authorityDirectory)
    )
        throw new Error("找不到该工作区的登记请求");
    return registerWorkspace(record.plan, record.plan.digest);
}
