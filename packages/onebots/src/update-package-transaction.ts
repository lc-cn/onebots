import { execFileSync } from "node:child_process";
import {
    buildPackageRemovalInvocation,
    buildPackageUpdateInvocation,
    type PackageUpdateInvocation,
} from "./package-manager.js";

export interface PackageUpdateEvidence {
    name: string;
    target: string;
}

export interface PackageVersionSnapshot {
    name: string;
    current: string | null;
}

type PackageVersionResolver = (name: string, runtimeRoot: string) => string | null;
type PackageInvocationExecutor = (invocation: PackageUpdateInvocation) => void;

const executePackageInvocation: PackageInvocationExecutor = invocation => {
    execFileSync(invocation.executable, invocation.args, {
        cwd: invocation.cwd,
        env: invocation.environment,
        stdio: "inherit",
    });
};

/** 包管理器成功退出后，逐包确认实际清单版本，再允许服务预检与切换。 */
export function assertUpdatedPackageVersions(
    updates: readonly PackageUpdateEvidence[],
    runtimeRoot: string,
    resolveVersion: PackageVersionResolver,
): void {
    const mismatches = updates.flatMap(item => {
        const actual = resolveVersion(item.name, runtimeRoot);
        return actual === item.target ? [] : [{ ...item, actual }];
    });
    if (!mismatches.length) return;
    const evidence = mismatches
        .map(item => `${item.name} 期望 ${item.target}，实际 ${item.actual ?? "未安装"}`)
        .join("；");
    throw new Error(`包更新版本校验失败：${evidence}。服务预检、定义改写与重启均未执行`);
}

/** 在服务定义或进程切换前，恢复更新前的整组包版本并验证结果。 */
export function rollbackUpdatedPackages(
    snapshots: readonly PackageVersionSnapshot[],
    runtimeRoot: string,
    projectRoot: string | null,
    resolveVersion: PackageVersionResolver,
    execute: PackageInvocationExecutor = executePackageInvocation,
): void {
    const previousPackages = snapshots.flatMap(item =>
        item.current ? [`${item.name}@${item.current}`] : [],
    );
    if (previousPackages.length) {
        execute(buildPackageUpdateInvocation(runtimeRoot, previousPackages, projectRoot));
    }
    const newlyAddedPackages = snapshots.flatMap(item => (item.current ? [] : [item.name]));
    if (newlyAddedPackages.length) {
        execute(buildPackageRemovalInvocation(runtimeRoot, newlyAddedPackages, projectRoot));
    }
    const mismatches = snapshots.flatMap(item => {
        const actual = resolveVersion(item.name, runtimeRoot);
        return actual === item.current ? [] : [{ ...item, actual }];
    });
    if (!mismatches.length) return;
    const evidence = mismatches
        .map(
            item =>
                `${item.name} 期望恢复为 ${item.current ?? "未安装"}，实际 ${item.actual ?? "未安装"}`,
        )
        .join("；");
    throw new Error(`更新依赖恢复版本校验失败：${evidence}`);
}
