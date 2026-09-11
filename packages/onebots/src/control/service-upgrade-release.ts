import {
    readRunningManagerCandidate,
    managerCandidateDigest,
} from "../manager-runtime/identity.js";
import type { GenerationActivationController } from "./generation-activation.js";
import { advanceManagerUpgrade, readManagerUpgradePending } from "../service-upgrade-workspace.js";

export interface ManagerUpgradeIdentity {
    managerId: string;
    candidateDigest: string | null;
}

/** 只接受可信 host 自身的模块地址；每次查询重核，并拒绝启动后的身份替换。 */
export function createManagerUpgradeIdentity(
    managerId: string,
    hostModuleUrl: string,
): () => ManagerUpgradeIdentity {
    const read = () => {
        try {
            return managerCandidateDigest(readRunningManagerCandidate(hostModuleUrl));
        } catch {
            // 普通安装或损坏收据不能证明候选身份，不向客户端暴露文件系统细节。
            return null;
        }
    };
    const initial = read();
    return () => {
        const current = read();
        return { managerId, candidateDigest: initial && initial === current ? current : null };
    };
}

/** 本机OS事务确认请求；当前host持工作区锁，候选身份由host自身工件证明提供。 */
export async function releaseManagerUpgrade(input: {
    workspace: string;
    managerId: string;
    body: unknown;
    lifecycle: Pick<GenerationActivationController, "runConfigurationTransaction">;
    verifyCandidate(digest: string): boolean;
    isAvailable(): boolean;
}): Promise<void> {
    const value = input.body;
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("升级确认请求无效");
    const request = value as Record<string, unknown>;
    if (
        Object.keys(request).sort().join() !== "candidateDigest,managerId,operationId" ||
        request.managerId !== input.managerId ||
        typeof request.operationId !== "string" ||
        typeof request.candidateDigest !== "string"
    )
        throw new Error("升级确认身份不匹配");
    const matchingMarker = () => {
        if (!input.isAvailable()) throw new Error("管理服务正在关闭，不能确认升级");
        const marker = readManagerUpgradePending(input.workspace);
        if (
            !marker ||
            marker.operationId !== request.operationId ||
            marker.candidateDigest !== request.candidateDigest ||
            !input.verifyCandidate(marker.candidateDigest)
        )
            throw new Error("升级候选身份不匹配");
        return marker;
    };
    // 已完成确认只读返回，不依赖后来网关是否出现新的恢复需求。
    if (matchingMarker().phase === "released") return;
    await input.lifecycle.runConfigurationTransaction(async port => {
        const marker = matchingMarker();
        if (marker.phase === "released") return;
        if (marker.phase === "releasing") throw new Error("升级确认曾中断，请先对账，禁止重派");
        const state = port.gatewayStatus();
        if (state.recoveryRequired || port.hasLiveChildren())
            throw new Error("网关状态未确认，不能释放升级维护");
        advanceManagerUpgrade(input.workspace, marker, "releasing", input.managerId);
        // 意图已持久化。任何启动异常或完成日志未知都保留releasing，不能回退或重派。
        if (state.desired === "running") {
            const operation = await port.start();
            if (operation.status !== "succeeded") throw new Error("升级后网关恢复未确认");
        }
        advanceManagerUpgrade(
            input.workspace,
            { ...marker, phase: "releasing", managerId: input.managerId },
            "released",
            input.managerId,
        );
    });
}

/** 可信host在启动时传入自身import.meta.url；不允许从请求或网关runtimeRoot提供路径。 */
export function createManagerUpgradeRelease(
    workspace: string,
    managerId: string,
    hostModuleUrl: string,
    lifecycle: Pick<GenerationActivationController, "runConfigurationTransaction">,
    isAvailable: () => boolean,
): (body: unknown) => Promise<void> {
    const input = { workspace, managerId, hostModuleUrl, lifecycle, isAvailable };
    let identity: string | undefined;
    try {
        identity = managerCandidateDigest(readRunningManagerCandidate(input.hostModuleUrl));
    } catch {
        /* 普通安装不具备候选收据；仍允许诊断，但不能确认升级。 */
    }
    return body =>
        releaseManagerUpgrade({
            ...input,
            body,
            verifyCandidate: digest =>
                Boolean(
                    identity &&
                    identity === digest &&
                    managerCandidateDigest(readRunningManagerCandidate(input.hostModuleUrl)) ===
                        digest,
                ),
        });
}
