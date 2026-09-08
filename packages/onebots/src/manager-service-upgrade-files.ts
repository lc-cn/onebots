import { isDeepStrictEqual } from "node:util";
import { ConfigurationFile } from "./configuration/configuration-file.js";
import { parseManagerServiceRecord, type ManagerServiceRecord } from "./manager-service-journal.js";
import { captureManagerServiceRemoval } from "./manager-service-removal.js";
import { renderInstalledManagerService } from "./manager-service-definition.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import type { ManagerServiceRemovalSnapshot } from "./manager-service-removal-snapshot.js";

const failure = () => new Error("管理升级服务文件切换未确认，保留现场，禁止重派或覆盖业务数据");

/**
 * 调用者持服务级锁，已持久写入 writing 阶段并证明所有旧进程退出、维护门禁已建立。
 * 两个文件不能原子同时替换；第二步失败保留第一步结果，由原操作显式对账。
 * 不接受旧文件字节作为恢复输入，不读取或写入工作区业务配置/认证/ID。
 */
export function writeManagerServiceUpgradeFiles(
    input: ManagerServiceRecord,
    host: ServiceHost,
): ManagerServiceRemovalSnapshot {
    const record = parseManagerServiceRecord(input);
    if (record.action !== "upgrade" || !record.upgrade || record.phase !== "writing" ||
        record.status !== "running" || record.recoveryRequired ||
        host.platform !== record.upgrade.snapshot.platform)
        throw failure();
    const spec = record.managerSpec;
    const files = getServiceFiles(spec.scope, host);
    const expected = record.upgrade.snapshot.files;
    if (expected.definition.path !== files.definition || expected.metadata.path !== files.metadata)
        throw failure();
    const captured = captureManagerServiceRemoval(record.upgrade.previousSpec, host);
    try {
        if (!isDeepStrictEqual(captured.snapshot, expected) || !captured.verifyRemaining())
            throw failure();
        const definition = Buffer.from(renderInstalledManagerService(spec, host.platform, files.stateDir));
        const definitionFile = new ConfigurationFile(files.definition);
        const written = definitionFile.replaceRaw(expected.definition.sha256, definition);
        // 定义替换后原定义锚点自然失效；不得因此放弃对原元数据身份的检查。
        if (!captured.verifyFile("metadata") ||
            !definitionFile.readRaw().bytes.equals(written.bytes)) throw failure();
        new ConfigurationFile(files.metadata).replaceRaw(
            expected.metadata.sha256, Buffer.from(JSON.stringify(spec) + "\n"),
        );
        const installed = captureManagerServiceRemoval(spec, host);
        try {
            if (!installed.verifyRemaining()) throw failure();
            return structuredClone(installed.snapshot);
        } finally {
            installed.dispose();
        }
    } catch {
        throw failure();
    } finally {
        captured.dispose();
    }
}
