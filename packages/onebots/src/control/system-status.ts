import { statfs } from "node:fs/promises";
import * as os from "node:os";
import { Logger } from "@onebots/core";
import type { ControlSystemStatus } from "@onebots/core/control";

interface DiskStats {
    bsize: number;
    blocks: number;
    bfree: number;
    bavail: number;
}

/** 系统 API 被宿主限制时，资源信息缺失不能使管理服务启动或状态查询失败。 */
export function createSafeSystemStatus(workspace: string) {
    let sample: ReturnType<typeof createSystemStatus> | undefined;
    let retryAt = 0;
    return (): ControlSystemStatus | undefined => {
        if (Date.now() < retryAt) return undefined;
        try {
            sample ??= createSystemStatus(workspace);
            return sample();
        } catch (error) {
            new Logger("onebots:control").error("无法读取运行环境资源", {
                reason: error instanceof Error ? error.message : String(error),
            });
            retryAt = Date.now() + 30_000;
            return undefined;
        }
    };
}

/** 按需刷新且合并并发采样；磁盘 IO 永远不阻塞管理状态接口。 */
export function createSystemStatus(
    workspace: string,
    readDisk: (path: string) => Promise<DiskStats> = statfs,
    now: () => number = Date.now,
) {
    const cpus = os.cpus();
    const device = {
        nodeVersion: process.version,
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        cpuModel: cpus[0]?.model || "未知",
        logicalCpus: cpus.length,
    };
    let disk: ControlSystemStatus["disk"] = { state: "pending" };
    let nextSample = 0;
    let pending = false;
    return (): ControlSystemStatus => {
        if (!pending && now() >= nextSample) {
            pending = true;
            void Promise.resolve()
                .then(() => readDisk(workspace))
                .then(stats => {
                    const total = stats.blocks * stats.bsize;
                    const used = (stats.blocks - stats.bfree) * stats.bsize;
                    const available = stats.bavail * stats.bsize;
                    if (
                        ![total, used, available].every(Number.isSafeInteger) ||
                        total <= 0 ||
                        used < 0 ||
                        available < 0 ||
                        used > total ||
                        available > total
                    ) {
                        throw new Error("文件系统容量数据无效");
                    }
                    disk = {
                        state: "ready",
                        sampledAt: new Date(now()).toISOString(),
                        total,
                        used,
                        available,
                    };
                })
                .catch((error: unknown) => {
                    // 不向浏览器泄露路径或底层错误；失败后按同一采样间隔重试。
                    new Logger("onebots:control").error("无法读取工作区磁盘容量", {
                        reason: error instanceof Error ? error.message : String(error),
                    });
                    disk = { state: "unavailable", sampledAt: new Date(now()).toISOString() };
                })
                .finally(() => {
                    pending = false;
                    nextSample = now() + 30_000;
                });
        }
        const memory = process.memoryUsage();
        return {
            ...device,
            sampledAt: new Date(now()).toISOString(),
            uptimeSeconds: os.uptime(),
            managerUptimeSeconds: process.uptime(),
            memory: {
                total: os.totalmem(),
                free: os.freemem(),
                managerRss: memory.rss,
                heapUsed: memory.heapUsed,
                heapTotal: memory.heapTotal,
            },
            disk: { ...disk },
        };
    };
}
