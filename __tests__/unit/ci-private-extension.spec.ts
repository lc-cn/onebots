import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { stageCIPrivateExtension } from "../../scripts/stage-ci-private-extension.mjs";
import { ciCommandDiagnostic } from "../../scripts/ci-command-diagnostic.mjs";
import { waitForCLIStatus } from "../../scripts/ci-cli-readiness.mjs";
import { resolveGenerationPlan } from "../../packages/onebots/lib/installation/generation-resolver.js";
import { loadRuntimeArtifacts } from "../../packages/onebots/lib/installation/runtime-artifacts.js";
import { getExtensionPackageCatalogEntry } from "../../packages/onebots/lib/extension-capability-catalog.js";

const name = "@onebots/adapter-icqq";
const version = getExtensionPackageCatalogEntry(name)!.packageVersion;
const roots: string[] = [];
afterEach(() => {
    roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
    vi.unstubAllGlobals();
});

function fixture(archiveVersion = version, hostPeer = "99.0.1") {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-ci-private-"));
    roots.push(root);
    const archiveDirectory = path.join(root, "input");
    const artifacts = path.join(root, "artifacts");
    fs.mkdirSync(archiveDirectory);
    fs.mkdirSync(artifacts);
    const source = {
        name,
        version: archiveVersion,
        peerDependencies: { onebots: hostPeer, "@icqqjs/icqq": "^1.10.18" },
        peerDependenciesMeta: { "@icqqjs/icqq": { optional: true } },
    };
    const content = Buffer.from(JSON.stringify(source));
    const header = Buffer.alloc(512);
    header.write("package/package.json");
    header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124);
    header.fill(32, 148, 156);
    header.write("0", 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    header.write(
        `${header
            .reduce((sum, byte) => sum + byte, 0)
            .toString(8)
            .padStart(6, "0")}\0 `,
        148,
    );
    fs.writeFileSync(
        path.join(archiveDirectory, "icqq.tgz"),
        gzipSync(
            Buffer.concat([
                header,
                content,
                Buffer.alloc((512 - (content.length % 512)) % 512),
                Buffer.alloc(1024),
            ]),
        ),
    );
    const host = { name: "onebots", version: "99.0.1", spec: "99.0.1" };
    const core = { name: "@onebots/core", version: "1.0.0", spec: "1.0.0" };
    const record = (artifact: typeof host) => {
        const file = `${artifact.name === "onebots" ? "host" : "core"}.tgz`;
        const bytes = Buffer.from("existing artifact");
        fs.writeFileSync(path.join(artifacts, file), bytes);
        return {
            name: artifact.name,
            version: artifact.version,
            file,
            sha256: createHash("sha256").update(bytes).digest("hex"),
        };
    };
    const manifestFile = path.join(artifacts, "manifest.json");
    fs.writeFileSync(
        manifestFile,
        JSON.stringify({
            schemaVersion: 1,
            host: record(host),
            core: record(core),
            extensions: [],
        }),
    );
    const config = loadRuntimeArtifacts(manifestFile, { host, core });
    return { manifestFile, archiveDirectory, config, artifacts };
}

it("npm 尚无本次版本时，暂存当前提交归档后离线计划仍包含真实私有 peer", async () => {
    const test = fixture();
    const fetcher = vi.fn(() => {
        throw new Error("npm version not published");
    });
    vi.stubGlobal("fetch", fetcher);
    const selection = { adapters: ["icqq"], protocols: [], applications: [] };
    await expect(resolveGenerationPlan(selection, test.config)).rejects.toThrow("元数据不可用");
    fetcher.mockClear();
    const previous = JSON.parse(fs.readFileSync(test.manifestFile, "utf8"));
    await stageCIPrivateExtension(test.manifestFile, test.archiveDirectory, test.config);
    const config = loadRuntimeArtifacts(test.manifestFile, test.config);
    const { plan } = await resolveGenerationPlan(selection, config);
    expect(fetcher).not.toHaveBeenCalled();
    expect(plan.peerRequirements).toContainEqual({
        requestedBy: name,
        packageName: "@icqqjs/icqq",
        range: "^1.10.18",
    });
    expect(plan.extensions[0].spec).toMatch(/^file:/);
    const current = JSON.parse(fs.readFileSync(test.manifestFile, "utf8"));
    expect(current.host).toEqual(previous.host);
    expect(current.core).toEqual(previous.core);
    const copied = fs.readFileSync(path.join(test.artifacts, current.extensions[0].file));
    expect(createHash("sha256").update(copied).digest("hex")).toBe(current.extensions[0].sha256);
});

it.each([
    ["0.0.0", "99.0.1"],
    [version, "0.0.0"],
])(
    "错误归档版本或宿主 peer 拒绝后保留原清单并清理工件 (%s, %s)",
    async (archiveVersion, hostPeer) => {
        const test = fixture(archiveVersion, hostPeer);
        const before = fs.readFileSync(test.manifestFile, "utf8");
        await expect(
            stageCIPrivateExtension(test.manifestFile, test.archiveDirectory, test.config),
        ).rejects.toThrow();
        expect(fs.readFileSync(test.manifestFile, "utf8")).toBe(before);
        expect(fs.readdirSync(test.artifacts).sort()).toEqual([
            "core.tgz",
            "host.tgz",
            "manifest.json",
        ]);
    },
);

it("CI 诊断保留退出原因，脱敏在截断之前完成", () => {
    const secret = "github_pat_synthetic_secret";
    const output = ciCommandDiagnostic(
        { stdout: "元数据不可用", stderr: `authorization=${secret}` },
        [secret],
    );
    expect(output).toContain("元数据不可用");
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain(secret);
    const colored = secret.replace("synthetic", "\x1b[31msynthetic\x1b[0m");
    const normalized = ciCommandDiagnostic({ stderr: colored }, [secret]);
    expect(normalized).toBe("[REDACTED]");
    const boundary = ciCommandDiagnostic({ stdout: `${"x".repeat(2040)}${secret}` }, [secret]);
    expect(boundary).not.toContain("github");
    expect(boundary.length).toBeLessThanOrEqual(2048);
});

it("CLI 只使用剩余时间，超过期限不会再调用，保留最后错误", async () => {
    let time = 0;
    const error = new Error("CLI connection unavailable");
    const read = vi.fn((budget: number) => {
        time += budget;
        throw error;
    });
    await expect(
        waitForCLIStatus(read, {
            timeout: 1_150,
            now: () => time,
            sleep: async (delay: number) => {
                time += delay;
            },
        }),
    ).rejects.toBe(error);
    expect(read.mock.calls).toEqual([[1_000], [50]]);
    expect(time).toBe(1_150);
});

it("空状态不空转或突破总期限，重试成功返回真实状态", async () => {
    let time = 0;
    const options = {
        timeout: 250,
        now: () => time,
        sleep: async (delay: number) => {
            time += delay;
        },
    };
    const empty = vi.fn(() => null);
    await expect(waitForCLIStatus(empty, options)).rejects.toThrow("无效状态");
    expect(time).toBe(250);
    expect(empty).toHaveBeenCalledTimes(3);
    time = 0;
    const status = { manager: { id: "test" }, gateway: { actual: "stopped" } };
    const read = vi
        .fn()
        .mockImplementationOnce(() => {
            throw new Error("not ready");
        })
        .mockReturnValue(status);
    await expect(waitForCLIStatus(read, options)).resolves.toBe(status);
    expect(time).toBe(100);
});
