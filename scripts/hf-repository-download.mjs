import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

export const HF_RESTORE_DOWNLOAD_TIMEOUT_MS = 60_000;
export const HF_RESTORE_ARTIFACTS = Object.freeze({
    "data_backup.tar.gz": Object.freeze({
        targetPath: "/tmp/data_backup.tar.gz",
        maxBytes: 15 * 1024 * 1024,
    }),
    "config_backup.yaml": Object.freeze({
        targetPath: "/data/config.yaml",
        maxBytes: 1024 * 1024,
    }),
    "extensions_backup.json": Object.freeze({
        targetPath: "/data/extensions/hf-restore.json",
        maxBytes: 1024 * 1024,
    }),
});

export async function downloadHfRepositoryArtifact({
    repoId,
    token = "",
    artifact,
    targetPath,
    maxBytes,
    timeoutMs = HF_RESTORE_DOWNLOAD_TIMEOUT_MS,
    fetcher = fetch,
    createSignal = duration => AbortSignal.timeout(duration),
}) {
    assertRepositoryId(repoId);
    assertArtifactName(artifact);
    assertPositiveInteger(maxBytes, "HF 恢复制品大小上限");
    assertPositiveInteger(timeoutMs, "HF 恢复下载超时");
    assertSafeTarget(targetPath);

    const response = await fetcher(
        `https://huggingface.co/spaces/${repoId}/resolve/main/${artifact}`,
        {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            cache: "no-store",
            redirect: "follow",
            signal: createSignal(timeoutMs),
        },
    );
    if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HF 恢复制品 ${artifact} 返回 HTTP ${response.status}`);
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
        await response.body?.cancel();
        throw new Error(`HF 恢复制品 ${artifact} 超过 ${formatBytes(maxBytes)} 上限`);
    }
    if (!response.body) throw new Error(`HF 恢复制品 ${artifact} 正文为空`);

    const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
    const handle = fs.openSync(temporaryPath, "wx", 0o600);
    const reader = response.body.getReader();
    let totalBytes = 0;
    let completed = false;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            totalBytes += chunk.value.byteLength;
            if (totalBytes > maxBytes) {
                await reader.cancel();
                throw new Error(`HF 恢复制品 ${artifact} 超过 ${formatBytes(maxBytes)} 上限`);
            }
            writeAll(handle, chunk.value);
        }
        if (totalBytes === 0) throw new Error(`HF 恢复制品 ${artifact} 正文为空`);
        fs.fsyncSync(handle);
        fs.closeSync(handle);
        fs.chmodSync(temporaryPath, 0o600);
        fs.renameSync(temporaryPath, targetPath);
        completed = true;
        return { artifact, targetPath, bytes: totalBytes };
    } finally {
        if (!completed) {
            try {
                await reader.cancel();
            } catch {
                // 超时或传输错误可能已让流进入不可取消状态。
            }
        }
        reader.releaseLock();
        if (!completed) {
            try {
                fs.closeSync(handle);
            } catch {
                // 成功分支已关闭，或底层写入失败时句柄可能已失效。
            }
            fs.rmSync(temporaryPath, { force: true });
        }
    }
}

function assertRepositoryId(value) {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/u.test(value)) {
        throw new Error("HF_REPO_ID 格式无效，应为 用户名/Space名");
    }
}

function assertArtifactName(value) {
    if (!Object.hasOwn(HF_RESTORE_ARTIFACTS, value)) {
        throw new Error(`不支持的 HF 恢复制品: ${String(value)}`);
    }
}

function assertPositiveInteger(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}必须是正整数`);
}

function assertSafeTarget(targetPath) {
    if (typeof targetPath !== "string" || !path.isAbsolute(targetPath)) {
        throw new Error("HF 恢复目标必须是绝对路径");
    }
    const parent = path.dirname(targetPath);
    const parentStat = fs.lstatSync(parent);
    if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
        throw new Error(`HF 恢复目标父目录不是常规目录: ${parent}`);
    }
    if (!fs.existsSync(targetPath)) return;
    const targetStat = fs.lstatSync(targetPath);
    if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
        throw new Error(`HF 恢复目标不是常规文件: ${targetPath}`);
    }
}

function formatBytes(bytes) {
    if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)} MiB`;
    if (bytes % 1024 === 0) return `${bytes / 1024} KiB`;
    return `${bytes} 字节`;
}

function writeAll(handle, chunk) {
    let offset = 0;
    while (offset < chunk.byteLength) {
        const written = fs.writeSync(handle, chunk, offset, chunk.byteLength - offset);
        if (written <= 0) throw new Error("HF 恢复制品写入未取得进展");
        offset += written;
    }
}

export function hfRepositoryDownloadErrorMessage(error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
        return `下载超过 ${HF_RESTORE_DOWNLOAD_TIMEOUT_MS / 1000} 秒，已取消`;
    }
    return error instanceof Error ? error.message : String(error);
}

const isMain = process.argv[1]
    ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    : false;

if (isMain) {
    const artifact = process.argv[2];
    const contract = HF_RESTORE_ARTIFACTS[artifact];
    if (!contract) {
        console.error(`[onebots-hf-restore] 不支持的 HF 恢复制品: ${String(artifact)}`);
        process.exitCode = 1;
    } else {
        downloadHfRepositoryArtifact({
            repoId: process.env.HF_REPO_ID,
            token: process.env.HF_TOKEN,
            artifact,
            ...contract,
        }).catch(error => {
            console.error(`[onebots-hf-restore] ${hfRepositoryDownloadErrorMessage(error)}`);
            process.exitCode = 1;
        });
    }
}
