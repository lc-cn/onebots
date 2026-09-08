import fs from "node:fs";
import path from "node:path";
import {
    GenerationInstaller,
    type GenerationInstallerOptions,
} from "../installation/generation-installer.js";
import { type GenerationPlan } from "../installation/generation-plan.js";
import { type VerifiedGeneration } from "../installation/generation-store.js";
import { verifyGeneration } from "../installation/generation-verify.js";
import {
    verifyManagerCandidate,
    type ManagerCandidateVerification,
} from "../verification/manager-candidate.js";

const PROOF = "manager-verification.json";
interface ManagerProof {
    schemaVersion: 1;
    candidateId: string;
    verification: ManagerCandidateVerification;
}
export interface VerifiedManagerCandidate extends VerifiedGeneration {
    management: ManagerCandidateVerification;
}
export type ManagerCandidateInstallerOptions = Omit<GenerationInstallerOptions, "verify">;

/**
 * 管理程序使用独立版本仓库，复用依赖安装事务，不修改服务定义或活动网关指针。
 * 调用方须持有此仓库的排他锁直到 close 完成；不能传入业务网关的版本仓库。
 * 下载/验证执行器由可信宿主决定，不能暴露为 HTTP 请求参数。
 */
export class ManagerCandidateInstaller {
    private readonly installer: GenerationInstaller;
    constructor(private readonly options: ManagerCandidateInstallerOptions) {
        this.installer = new GenerationInstaller({
            ...options,
            verify: async (directory, plan, verificationOptions) => {
                assertManagerPlan(plan);
                const dependencies = await verifyGeneration(directory, plan, verificationOptions);
                const management = await verifyManagerCandidate(
                    directory,
                    plan,
                    verificationOptions,
                );
                verificationOptions.signal?.throwIfAborted();
                // 两项检查均完成才写独立证明，之后由安装器提交绑定候选ID的版本收据。
                const descriptor = fs.openSync(path.join(directory, PROOF), "wx", 0o600);
                try {
                    fs.writeFileSync(
                        descriptor,
                        JSON.stringify({
                            schemaVersion: 1,
                            candidateId: path.basename(directory),
                            verification: management,
                        } satisfies ManagerProof),
                    );
                    fs.fsyncSync(descriptor);
                } finally {
                    fs.closeSync(descriptor);
                }
                return dependencies;
            },
        });
    }

    async install(id: string, plan: GenerationPlan, options: { signal?: AbortSignal } = {}) {
        assertManagerPlan(plan);
        // 管理程序只安装公开宿主及依赖，不接受平台私有下载凭据。
        await this.installer.install(id, plan, { signal: options.signal });
        return this.status(id);
    }

    status(id: string) {
        const operation = this.installer.status(id);
        if (operation.phase === "verified") this.readCandidate(operation.candidateId!);
        return operation;
    }

    readCandidate(id: string): VerifiedManagerCandidate {
        const candidate = this.options.store.readVerified(id);
        const file = path.join(candidate.directory, PROOF);
        const stat = fs.lstatSync(file);
        if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.nlink !== 1 ||
            stat.size > 4096 ||
            (stat.mode & 0o077) !== 0 ||
            (process.getuid && stat.uid !== process.getuid())
        )
            throw new Error("管理程序候选启动证明无效");
        const expected: ManagerProof = {
            schemaVersion: 1,
            candidateId: candidate.id,
            verification: {
                schemaVersion: 1,
                planDigest: candidate.planDigest,
                hostVersion: candidate.receipt.hostVersion,
                coreVersion: candidate.receipt.coreVersion,
                nodeAbi: candidate.receipt.nodeAbi,
                platform: candidate.receipt.platform,
                arch: candidate.receipt.arch,
                checks: {
                    managementStartup: true,
                    webAssets: true,
                    anonymousDenied: true,
                    maintenance: true,
                    closed: true,
                },
            },
        };
        if (JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8"))) !== JSON.stringify(expected))
            throw new Error("管理程序候选启动证明与版本收据不一致");
        return { ...candidate, management: expected.verification };
    }

    close(): Promise<void> {
        return this.installer.close();
    }
}
function assertManagerPlan(plan: GenerationPlan): void {
    if (
        plan.extensions.length ||
        plan.selection.adapters.length ||
        plan.selection.protocols.length ||
        plan.selection.applications.length ||
        plan.builtinApplications.length
    )
        throw new Error("管理程序候选不能包含平台、协议或框架扩展");
}
