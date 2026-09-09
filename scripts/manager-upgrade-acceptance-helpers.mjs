import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function preparePreviousPatchArtifacts({ temporary, artifacts, manifest, execute }) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(manifest.host.version);
    assert.ok(match && Number(match[3]) > 0, "验收目标必须能构造前一个 patch 版本");
    const previousVersion = `${match[1]}.${match[2]}.${Number(match[3]) - 1}`;
    const directory = path.join(temporary, "previous-artifacts");
    const staging = path.join(temporary, "previous-package");
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.mkdirSync(staging, { mode: 0o700 });
    execute("tar", ["-xzf", path.join(artifacts, manifest.host.file), "-C", staging]);
    const packageFile = path.join(staging, "package/package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageFile, "utf8"));
    packageJson.version = previousVersion;
    fs.writeFileSync(packageFile, `${JSON.stringify(packageJson, null, 2)}\n`, { mode: 0o600 });
    const hostFile = `onebots-${previousVersion}.tgz`;
    execute("tar", ["-czf", path.join(directory, hostFile), "-C", staging, "package"]);
    for (const entry of [manifest.core, ...manifest.extensions])
        fs.copyFileSync(path.join(artifacts, entry.file), path.join(directory, entry.file));
    const previousManifest = {
        ...manifest,
        host: {
            ...manifest.host,
            version: previousVersion,
            file: hostFile,
            sha256: createHash("sha256")
                .update(fs.readFileSync(path.join(directory, hostFile)))
                .digest("hex"),
        },
    };
    const manifestFile = path.join(directory, "manifest.json");
    fs.writeFileSync(manifestFile, `${JSON.stringify(previousManifest, null, 2)}\n`, {
        mode: 0o600,
    });
    return {
        previousVersion,
        manifestFile,
        installTarballs: fs
            .readdirSync(artifacts)
            .filter(name => name.endsWith(".tgz"))
            .map(name =>
                name === manifest.host.file
                    ? path.join(directory, hostFile)
                    : path.join(artifacts, name),
            ),
    };
}

export function spawnCli(cli, args, environment, cwd) {
    const child = spawn(cli, args, { cwd, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    const closed = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (status, signal) =>
            resolve({
                status,
                signal,
                stdout: Buffer.concat(stdout).toString("utf8").trim(),
                stderr: Buffer.concat(stderr).toString("utf8").trim(),
            }),
        );
    });
    return { child, closed };
}

export async function obstructControlSocketWhenReleased(workspace, childResult) {
    const socket = path.join(workspace, ".control/control.sock");
    const deadline = Date.now() + 120_000;
    for (;;) {
        try {
            fs.mkdirSync(socket, { mode: 0o700 });
            return socket;
        } catch (error) {
            if (error?.code !== "EEXIST" || Date.now() >= deadline) throw error;
            const exited = await Promise.race([
                childResult.then(result => ({ result })),
                new Promise(resolve => setTimeout(() => resolve(null), 5)),
            ]);
            if (exited) {
                const diagnostic = [exited.result.stdout, exited.result.stderr]
                    .filter(Boolean)
                    .join("\n")
                    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
                    .slice(0, 1024);
                throw new Error(
                    `升级 CLI 在旧控制 socket 释放前退出：${exited.result.status}；${diagnostic || "无输出"}`,
                );
            }
        }
    }
}

export function newUpgradeJournal(stateDirectory, previousNames) {
    const directory = path.join(stateDirectory, "manager-operations");
    if (!fs.existsSync(directory)) return null;
    const names = fs
        .readdirSync(directory)
        .filter(name => name.endsWith(".json") && !previousNames.has(name));
    if (names.length !== 1) return null;
    const file = path.join(directory, names[0]);
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    return record.action === "upgrade" ? { file, record } : null;
}

export function managerUpgradeOperation(output, version) {
    const match = /^管理程序升级操作 ID：([A-Za-z0-9_-]{1,100})$/mu.exec(output);
    assert.ok(match, "公开 update --manager 未返回持久升级操作 ID");
    assert.match(output, new RegExp(`管理程序已切换到 ${version}`, "u"));
    return match[1];
}

export function installedManagerVersion(metadata) {
    assert.equal(metadata?.runtimeKind, "control", "管理服务元数据类型无效");
    assert.equal(typeof metadata.workingDirectory, "string", "管理候选目录无效");
    assert.equal(typeof metadata.binPath, "string", "管理候选入口无效");
    const packageFile = path.resolve(path.dirname(metadata.binPath), "../package.json");
    assert.equal(
        packageFile.startsWith(`${path.resolve(metadata.workingDirectory)}${path.sep}`),
        true,
        "管理候选 package.json 越出不可变目录",
    );
    const manifest = JSON.parse(fs.readFileSync(packageFile, "utf8"));
    assert.equal(manifest.name, "onebots");
    assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u);
    return manifest.version;
}

export async function verifyManagerPatchUpgrade(options) {
    const {
        cli,
        cliEnvironment,
        runtime,
        dataDirectory,
        stateDirectory,
        metadataFile,
        manifest,
        artifacts,
        previousVersion,
        installedMetadata,
        before,
        invokeCli,
        cliJson,
        eventually,
        strongOsIdentity,
        setEffectUnknown,
    } = options;
    const preserved = new Map(
        ["config.yaml", ".control/gateway.json", ".control/auth.json"].map(file => [
            file,
            fs.existsSync(path.join(dataDirectory, file))
                ? fs.readFileSync(path.join(dataDirectory, file))
                : null,
        ]),
    );
    const operations = path.join(stateDirectory, "manager-operations");
    const previousNames = new Set(fs.readdirSync(operations));
    const failed = spawnCli(
        cli,
        [
            "update",
            "--manager",
            "--yes",
            "--version",
            manifest.host.version,
            "--artifacts",
            path.join(artifacts, "manifest.json"),
        ],
        cliEnvironment,
        runtime,
    );
    setEffectUnknown(true);
    const obstacle = await obstructControlSocketWhenReleased(dataDirectory, failed.closed);
    const failedResult = await failed.closed;
    setEffectUnknown(false);
    assert.equal(failedResult.status, 1, "控制 socket 障碍必须让候选启动失败");
    assert.equal(failedResult.signal, null);
    assert.equal(failedResult.stdout.includes("管理程序已切换"), false);
    const interrupted = await eventually(
        () => newUpgradeJournal(stateDirectory, previousNames),
        value =>
            ["starting", "verifying"].includes(value?.record.phase) &&
            value.record.status === "interrupted" &&
            value.record.recoveryRequired === true,
        "真实候选启动失败未保留可回退的启动或验证阶段",
    );
    assertPreserved(dataDirectory, preserved);
    fs.rmdirSync(obstacle);

    setEffectUnknown(true);
    const rollbackOutput = invokeCli([
        "recover",
        "--operation",
        interrupted.record.id,
        "--rollback-upgrade",
    ]).stdout;
    setEffectUnknown(false);
    assert.match(rollbackOutput, new RegExp(`操作 ${interrupted.record.id}：已恢复升级前`, "u"));
    const rolledBack = await eventually(
        () => ({
            os: cliJson(["status", "--json"]),
            control: cliJson(["control", "status", "--data-dir", dataDirectory]),
            metadata: JSON.parse(fs.readFileSync(metadataFile, "utf8")),
        }),
        value =>
            value.os.manager.state === "running" &&
            installedManagerVersion(value.metadata) === previousVersion &&
            value.os.manager.enabled === true &&
            value.os.manager.ipc === "available" &&
            value.control.gateway.desired === "running" &&
            value.control.gateway.actual === "running" &&
            value.metadata.workingDirectory === installedMetadata.workingDirectory,
        "公开升级回退未恢复旧管理候选及网关意图",
    );
    assert.notEqual(rolledBack.os.manager.pid, before.os.manager.pid);
    assert.notEqual(rolledBack.control.manager.id, before.control.manager.id);
    for (const key of ["generationId", "configRevision"])
        assert.equal(
            rolledBack.control.gateway.instance?.[key],
            before.control.gateway.instance?.[key],
        );
    const journalBytes = fs.readFileSync(interrupted.file);
    assert.deepEqual(JSON.parse(journalBytes), {
        ...JSON.parse(journalBytes),
        phase: "completed",
        status: "failed",
        recoveryRequired: false,
    });
    const identity = strongOsIdentity();
    assert.match(
        invokeCli(["recover", "--operation", interrupted.record.id, "--rollback-upgrade"]).stdout,
        new RegExp(`操作 ${interrupted.record.id}：已恢复升级前`, "u"),
    );
    assert.deepEqual(fs.readFileSync(interrupted.file), journalBytes);
    assert.deepEqual(strongOsIdentity(), identity, "重复升级回退不得再次加载或启动旧服务");

    setEffectUnknown(true);
    const output = invokeCli([
        "update",
        "--manager",
        "--yes",
        "--version",
        manifest.host.version,
        "--artifacts",
        path.join(artifacts, "manifest.json"),
    ]).stdout;
    setEffectUnknown(false);
    const upgradeId = managerUpgradeOperation(output, manifest.host.version);
    const upgraded = await eventually(
        () => ({
            os: cliJson(["status", "--json"]),
            control: cliJson(["control", "status", "--data-dir", dataDirectory]),
            metadata: JSON.parse(fs.readFileSync(metadataFile, "utf8")),
        }),
        value =>
            value.os.manager.state === "running" &&
            value.os.manager.ipc === "available" &&
            installedManagerVersion(value.metadata) === manifest.host.version &&
            value.os.manager.enabled === true &&
            value.control.gateway.actual === "running" &&
            value.control.gateway.desired === "running" &&
            value.metadata.workingDirectory !== installedMetadata.workingDirectory,
        "公开管理程序升级未切换到新不可变候选",
    );
    assert.notEqual(upgraded.control.manager.id, rolledBack.control.manager.id);
    assert.notEqual(upgraded.control.gateway.instance?.id, rolledBack.control.gateway.instance?.id);
    for (const key of ["generationId", "configRevision"])
        assert.equal(
            upgraded.control.gateway.instance?.[key],
            before.control.gateway.instance?.[key],
        );
    assertPreserved(dataDirectory, preserved);
    return { operationIds: [interrupted.record.id, upgradeId], upgraded };
}

function assertPreserved(dataDirectory, preserved) {
    for (const [file, bytes] of preserved) {
        const filename = path.join(dataDirectory, file);
        if (bytes === null) assert.equal(fs.existsSync(filename), false, `${file} 不得被创建`);
        else assert.deepEqual(fs.readFileSync(filename), bytes);
    }
}
