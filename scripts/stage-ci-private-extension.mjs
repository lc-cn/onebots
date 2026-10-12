/** 仅 CI 验收使用：把当前提交的 ICQQ 归档附加到测试容器，官方镜像仍不包含 ICQQ。 */
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { copyFile, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundledRuntimeArtifacts } from "../packages/onebots/lib/installation/bundled-runtime-artifacts.js";
import { resolveGenerationPlan } from "../packages/onebots/lib/installation/generation-resolver.js";
import { getExtensionPackageCatalogEntry } from "../packages/onebots/lib/extension-capability-catalog.js";

export async function stageCIPrivateExtension(manifestFile, archiveDirectory, config) {
    const name = "@onebots/adapter-icqq";
    const files = (await readdir(archiveDirectory)).filter(file => file.endsWith(".tgz"));
    assert.equal(files.length, 1, "CI 必须提供唯一 ICQQ 归档");
    const source = path.join(archiveDirectory, files[0]);
    const sha256 = createHash("sha256")
        .update(await readFile(source))
        .digest("hex");
    const file = `ci-icqq-${sha256}.tgz`;
    const destination = path.join(path.dirname(manifestFile), file);
    const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
    assert.ok(!manifest.extensions.some(entry => entry.name === name), "CI ICQQ 工件已存在");
    await copyFile(source, destination, constants.COPYFILE_EXCL);
    const temporary = `${manifestFile}.${randomUUID()}.tmp`;
    let committed = false;
    try {
        // 复用产品解析器验证归档身份、宿主版本及必需 peer；不接受 latest 回退。
        const { plan } = await resolveGenerationPlan(
            { adapters: ["icqq"], protocols: [], applications: [] },
            {
                ...config,
                artifacts: {
                    ...config.artifacts,
                    [name]: {
                        name,
                        version:
                            config.extensionVersions?.[name] ??
                            getExtensionPackageCatalogEntry(name)?.packageVersion,
                        spec: `file:${destination}`,
                        sha256,
                    },
                },
            },
        );
        manifest.extensions.push({ name, version: plan.extensions[0].version, file, sha256 });
        await writeFile(temporary, JSON.stringify(manifest, null, 2) + "\n", {
            mode: 0o600,
            flag: "wx",
        });
        await rename(temporary, manifestFile);
        committed = true;
    } finally {
        await rm(temporary, { force: true });
        if (!committed) await rm(destination, { force: true });
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    assert.equal(process.env.ONEBOTS_CI_PRIVATE_ARTIFACT, "1", "仅允许显式 CI 工件准备");
    await stageCIPrivateExtension(
        process.env.ONEBOTS_RUNTIME_ARTIFACTS,
        "/tmp/icqq-artifact",
        bundledRuntimeArtifacts(),
    );
    process.stdout.write("[onebots] CI ICQQ 工件已验证，须重启测试容器后使用\n");
}
