import { managerBootstrapBindingDirectory } from "./manager-bootstrap-binding.js";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { FileManagerServiceJournal } from "./manager-service-journal.js";
import { ServiceOperationStorage, closedServiceObject } from "./service-operation-storage.js";
import { readServiceMetadata } from "./service-metadata.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import type { ServiceScope } from "./service-definition.js";
const failure = () => new Error("安装周期历史不完整或有待恢复操作，禁止猜测新的安装周期");

/** 服务锁内沿完整生命周期选择；不用时间戳排序，不因文件缺失独自推断已卸载。 */
export function selectManagerBootstrapCycle(scope: ServiceScope, host: ServiceHost): string {
    const files = getServiceFiles(scope, host);
    const directory = path.join(files.stateDir, "manager-operations");
    const journal = new FileManagerServiceJournal(directory);
    const storage = new ServiceOperationStorage(directory);
    const records = storage.list().map(name => journal.read(name.slice(0, -5)));
    const metadata = readServiceMetadata(files.metadata);
    const home = path.join(files.stateDir, "manager-artifacts");
    try {
        const stat = fs.lstatSync(home);
        if (
            !stat.isDirectory() ||
            stat.isSymbolicLink() ||
            fs.realpathSync(home) !== home ||
            (stat.mode & 0o7777) !== 0o700 ||
            (process.getuid && stat.uid !== process.getuid())
        )
            throw failure();
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (journal.health().recoveryRequired) {
        const pending = records.filter(
            record => record.recoveryRequired || !["succeeded", "failed"].includes(record.status),
        );
        if (
            pending.length !== 1 ||
            pending[0].action !== "install" ||
            pending[0].managerSpec.scope !== scope
        )
            throw failure();
        const record = journal.recoverable(pending[0].id);
        const bindingDirectory = managerBootstrapBindingDirectory(home, record.id);
        fs.lstatSync(bindingDirectory); // 缺失时不能通过存储构造器创建替代绑定。
        const binding = new ServiceOperationStorage(bindingDirectory);
        const intent = closedServiceObject(binding.read("intent.json"), [
            "schemaVersion",
            "id",
            "service",
            "planDigest",
        ]);
        const candidate = closedServiceObject(binding.read("candidate.json"), [
            "schemaVersion",
            "id",
            "planDigest",
            "candidateId",
            "candidateDigest",
            "spec",
        ]);
        if (
            intent.id !== record.id ||
            candidate.id !== record.id ||
            intent.schemaVersion !== 1 ||
            candidate.schemaVersion !== 1 ||
            candidate.planDigest !== intent.planDigest ||
            !isDeepStrictEqual(candidate.spec, record.managerSpec)
        )
            throw failure();
        return record.id; // 后续 bootstrap 仅校验并返回原日志，不进入注册事务。
    }
    const initial = path.join(home, "bootstrap");
    let id = "initial-install";
    try {
        fs.lstatSync(initial);
        const intent = closedServiceObject(
            new ServiceOperationStorage(initial).read("intent.json"),
            ["schemaVersion", "id", "service", "planDigest"],
        );
        if (
            intent.schemaVersion !== 1 ||
            typeof intent.id !== "string" ||
            !/^[A-Za-z0-9_-]{1,128}$/.test(intent.id)
        )
            throw failure();
        id = intent.id;
    } catch (error) {
        if (
            (error as NodeJS.ErrnoException).code !== "ENOENT" ||
            records.length ||
            metadata.kind !== "missing"
        )
            throw failure();
        return id;
    }
    const visited = new Set<string>();
    for (;;) {
        if (visited.has(id) || visited.size > records.length + 1) throw failure();
        visited.add(id);
        const installation = records.find(record => record.id === id);
        if (!installation) {
            if (
                metadata.kind !== "missing" ||
                records.some(record => record.action === "install" && !visited.has(record.id))
            )
                throw failure();
            return id;
        }
        if (
            installation.action !== "install" ||
            installation.managerSpec.scope !== scope ||
            installation.status !== "succeeded" ||
            installation.recoveryRequired
        )
            throw failure();
        let spec = installation.managerSpec;
        const upgrades = new Set<string>();
        for (;;) {
            const next = records.filter(
                record =>
                    record.action === "upgrade" &&
                    isDeepStrictEqual(record.upgrade?.previousSpec, spec),
            );
            if (!next.length) break;
            if (next.length !== 1 || upgrades.has(next[0].id) || next[0].status !== "succeeded")
                throw failure();
            upgrades.add(next[0].id);
            spec = next[0].managerSpec;
        }
        const removed = records.filter(
            record => record.action === "uninstall" && isDeepStrictEqual(record.managerSpec, spec),
        );
        if (!removed.length) {
            if (metadata.kind !== "control" || !isDeepStrictEqual(metadata.spec, spec))
                throw failure();
            return id;
        }
        if (
            removed.length !== 1 ||
            removed[0].status !== "succeeded" ||
            (metadata.kind === "control" && isDeepStrictEqual(metadata.spec, spec))
        )
            throw failure();
        id = "install-" + createHash("sha256").update(removed[0].id).digest("hex");
    }
}
