import { copyFile, chmod, lstat, mkdtemp, realpath, unlink, rmdir } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { closedServiceObject } from "./service-operation-storage.js";
import { assertSystemNativeDependencies } from "./service-migration-native-dependencies.js";
import { hashRuntimeFile } from "./service-migration-runtime-tree-scan.js";
import {
    captureLegacyRuntimeTree,
    verifyLegacyRuntimeTree,
    type LegacyRuntimeTreeReceipt,
} from "./service-migration-runtime-tree.js";

export interface LegacyNodeRuntimeReceipt {
    schemaVersion: 1;
    tree: LegacyRuntimeTreeReceipt;
    version: string;
    platform: string;
    arch: string;
}
const execute = promisify(execFile);
const invalid = () => new Error("旧 Node 运行时无法独立保留，请保留原安装并检查原生依赖");
const probe = `
const crypto = require('node:crypto');
require('node:tls').createSecureContext();
if (crypto.createHash('sha256').update('onebots').digest('hex').length !== 64) process.exit(1);
process.stdout.write(JSON.stringify({version:process.version,platform:process.platform,arch:process.arch}));
`;
/** 仅执行已静态检查的旧 Node，不继承 NODE_OPTIONS、NODE_PATH 或动态加载器环境。 */
async function inspect(
    file: string,
): Promise<Pick<LegacyNodeRuntimeReceipt, "version" | "platform" | "arch">> {
    const { stdout } = await execute(file, ["--no-addons", "-e", probe], {
        cwd: path.dirname(file),
        env: { PATH: "/usr/bin:/bin" },
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 4096,
    });
    const result = closedServiceObject(JSON.parse(stdout), ["version", "platform", "arch"]);
    if (
        typeof result.version !== "string" ||
        !/^v\d+\.\d+\.\d+$/.test(result.version) ||
        result.platform !== process.platform ||
        result.arch !== process.arch
    )
        throw invalid();
    return { version: result.version, platform: process.platform, arch: process.arch };
}

/** 调用方持服务锁并已记录捕获意图；不修改原Node，也不启动旧网关。 */
export async function captureLegacyNodeRuntime(
    nodePath: string,
    store: string,
    id: string,
): Promise<LegacyNodeRuntimeReceipt> {
    let temporary: string | undefined;
    try {
        if (!path.isAbsolute(nodePath)) throw invalid();
        const source = await realpath(nodePath);
        const before = await hashRuntimeFile(source);
        if (!(before.mode & 0o100)) throw invalid();
        temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), "onebots-retained-node-")));
        await chmod(temporary, 0o700);
        const copied = path.join(temporary, "node");
        await copyFile(source, copied, constants.COPYFILE_EXCL);
        await chmod(copied, before.mode);
        if (
            JSON.stringify(await hashRuntimeFile(source)) !== JSON.stringify(before) ||
            JSON.stringify(await hashRuntimeFile(copied)) !== JSON.stringify(before)
        )
            throw invalid();
        await assertSystemNativeDependencies(copied);
        const identity = await inspect(copied);
        if (JSON.stringify(await hashRuntimeFile(copied)) !== JSON.stringify(before))
            throw invalid();
        const tree = await captureLegacyRuntimeTree(temporary, store, id);
        const receipt: LegacyNodeRuntimeReceipt = { schemaVersion: 1, tree, ...identity };
        await verifyLegacyNodeRuntime(receipt);
        return receipt;
    } catch {
        throw invalid();
    } finally {
        // 只清理本调用的临时输入；已发布或结果未知的工件绝不在此删除。
        if (temporary) {
            try {
                const stat = await lstat(temporary);
                if (
                    stat.isDirectory() &&
                    !stat.isSymbolicLink() &&
                    (await realpath(temporary)) === temporary
                ) {
                    await unlink(path.join(temporary, "node"));
                    await rmdir(temporary);
                }
            } catch {
                // 清理失败保留私有临时输入，不递归删除归属不明的内容。
            }
        }
    }
}

export async function verifyLegacyNodeRuntime(input: LegacyNodeRuntimeReceipt): Promise<void> {
    try {
        const receipt = closedServiceObject(input, [
            "schemaVersion",
            "tree",
            "version",
            "platform",
            "arch",
        ]);
        if (
            receipt.schemaVersion !== 1 ||
            receipt.platform !== process.platform ||
            receipt.arch !== process.arch
        )
            throw invalid();
        const tree = structuredClone(input.tree);
        await verifyLegacyRuntimeTree(tree);
        const executable = path.join(tree.root, "node");
        await assertSystemNativeDependencies(executable);
        const identity = await inspect(executable);
        if (identity.version !== receipt.version) throw invalid();
        await verifyLegacyRuntimeTree(tree);
    } catch {
        throw invalid();
    }
}
