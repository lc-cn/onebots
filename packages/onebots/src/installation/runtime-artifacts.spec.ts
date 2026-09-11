import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadRuntimeArtifacts } from "./runtime-artifacts.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
const expected = {
    host: { name: "onebots", version: "1.2.12", spec: "1.2.12" },
    core: { name: "@onebots/core", version: "1.2.9", spec: "1.2.9" },
};
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-image-artifacts-"));
    roots.push(root);
    const file = path.join(root, "manifest.json");
    fs.writeFileSync(path.join(root, "host.tgz"), "host");
    fs.writeFileSync(path.join(root, "core.tgz"), "core");
    const manifest = {
        schemaVersion: 1,
        extensions: [] as Array<{
            name: string;
            version: string;
            file: string;
            sha256: string;
        }>,
        host: {
            name: expected.host.name,
            version: expected.host.version,
            file: "host.tgz",
            sha256: "a".repeat(64),
        },
        core: {
            name: expected.core.name,
            version: expected.core.version,
            file: "core.tgz",
            sha256: "b".repeat(64),
        },
    };
    const save = () => fs.writeFileSync(file, JSON.stringify(manifest));
    save();
    return { root: fs.realpathSync(root), file, manifest, save };
}

it("镜像迁移目录后以manifest相对文件构造候选，保留hash供冻结时核验", () => {
    const test = fixture();
    const result = loadRuntimeArtifacts(test.file, expected);
    expect(result.host.spec).toBe(`file:${test.root}/host.tgz`);
    expect(result.core.sha256).toBe("b".repeat(64));
});

it("为可信宿主附带的扩展提供同版本本地工件", () => {
    const test = fixture();
    fs.writeFileSync(path.join(test.root, "adapter-mock.tgz"), "mock");
    test.manifest.extensions = [
        {
            name: "@onebots/adapter-mock",
            version: "1.0.21",
            file: "adapter-mock.tgz",
            sha256: "c".repeat(64),
        },
    ];
    test.save();
    const result = loadRuntimeArtifacts(test.file, expected);
    expect(result.artifacts["@onebots/adapter-mock"]).toEqual({
        name: "@onebots/adapter-mock",
        version: "1.0.21",
        spec: `file:${test.root}/adapter-mock.tgz`,
        sha256: "c".repeat(64),
    });
});

it("拒绝重复、宿主覆盖或目录外的附带扩展", () => {
    const test = fixture();
    fs.writeFileSync(path.join(test.root, "extension.tgz"), "extension");
    const entry = {
        name: "@onebots/adapter-mock",
        version: "1.0.21",
        file: "extension.tgz",
        sha256: "c".repeat(64),
    };
    for (const extensions of [[entry, entry], [{ ...entry, name: "onebots" }]]) {
        test.manifest.extensions = extensions;
        test.save();
        expect(() => loadRuntimeArtifacts(test.file, expected)).toThrow(
            /^随产品提供的运行工件无效/,
        );
    }
});

it("拒绝混用另一版本宿主、目录越界和软链接，错误不泄漏文件内容", () => {
    const test = fixture();
    test.manifest.host.version = "1.2.13";
    test.save();
    expect(() => loadRuntimeArtifacts(test.file, expected)).toThrow(/^随产品提供的运行工件无效/);
    test.manifest.host.version = "1.2.12";
    test.manifest.host.file = "../private.tgz";
    test.save();
    expect(() => loadRuntimeArtifacts(test.file, expected)).toThrow();
    test.manifest.host.file = "linked.tgz";
    fs.symlinkSync(path.join(test.root, "host.tgz"), path.join(test.root, "linked.tgz"));
    test.save();
    expect(() => loadRuntimeArtifacts(test.file, expected)).toThrow();
    fs.writeFileSync(test.file, "SYNTHETIC_SECRET_broken_json");
    expect(() => loadRuntimeArtifacts(test.file, expected)).toThrow(
        /^随产品提供的运行工件无效，请检查镜像或重新安装管理服务$/,
    );
});
