import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { resolveLocalRelease } from "./release-resolver.js";

it.skipIf(process.platform === "win32")("本地管理发布保留 Web 归档且不读取 registry", async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "onebots-web-release-")));
    const fetcher = vi.fn(() => {
        throw new Error("不允许访问 registry");
    });
    vi.stubGlobal("fetch", fetcher);
    try {
        const entries: Record<string, unknown> = {};
        for (const [key, name, version] of [
            ["host", "onebots", "1.2.17"],
            ["core", "@onebots/core", "1.2.12"],
            ["web", "@onebots/web", "1.0.21"],
        ]) {
            const directory = path.join(root, key);
            fs.mkdirSync(path.join(directory, "package/lib/gateway"), { recursive: true });
            fs.writeFileSync(
                path.join(directory, "package/package.json"),
                JSON.stringify({
                    name,
                    version,
                    ...(key === "host"
                        ? {
                              dependencies: {
                                  "@onebots/core": "1.2.12",
                                  "@onebots/web": "1.0.21",
                              },
                          }
                        : {}),
                }),
            );
            fs.writeFileSync(
                path.join(directory, "package/lib/gateway/entry.js"),
                "throw new Error('不可执行');",
            );
            fs.writeFileSync(
                path.join(directory, "package/lib/extension-capability-catalog.json"),
                JSON.stringify({
                    schemaVersion: 2,
                    packages: { "@onebots/adapter-mock": { version: "1.0.0" } },
                }),
            );
            const file = `${key}.tgz`;
            execFileSync(process.platform === "darwin" ? "/usr/bin/tar" : "/bin/tar", [
                "--format=ustar",
                "-czf",
                path.join(root, file),
                "-C",
                directory,
                "package",
            ]);
            entries[key] = {
                name,
                version,
                file,
                sha256: createHash("sha256")
                    .update(fs.readFileSync(path.join(root, file)))
                    .digest("hex"),
            };
        }
        const manifest = path.join(root, "manifest.json");
        fs.writeFileSync(
            manifest,
            JSON.stringify({ schemaVersion: 1, ...entries, extensions: [] }),
        );
        const release = await resolveLocalRelease(manifest, "1.2.17");
        expect(release).toMatchObject({
            web: {
                name: "@onebots/web",
                version: "1.0.21",
                spec: `file:${path.join(root, "web.tgz")}`,
            },
            archives: { web: { bytes: fs.readFileSync(path.join(root, "web.tgz")) } },
        });
        expect(fetcher).not.toHaveBeenCalled();
        fs.appendFileSync(path.join(root, "web.tgz"), "tampered");
        await expect(resolveLocalRelease(manifest, "1.2.17")).rejects.toThrow(
            "本地管理程序运行工件无法验证",
        );
    } finally {
        vi.unstubAllGlobals();
        fs.rmSync(root, { recursive: true, force: true });
    }
});
