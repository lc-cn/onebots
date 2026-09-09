import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { captureLegacyRuntimeForest } from "./service-migration-runtime-forest.js";
import { verifyLegacyRuntimeTree } from "./service-migration-runtime-tree.js";

describe.skipIf(process.platform === "win32")("多根运行目录保留", () => {
    it("删除全局主包和工作区源目录后，跨根插件仍共享同一个核心实例", async () => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "legacy-forest-")));
        try {
            const host = path.join(root, "global", "node_modules", "onebots");
            const workspace = path.join(root, "workspace");
            const core = path.join(host, "node_modules", "@onebots", "core");
            const write = (file: string, content: string) => {
                fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
                fs.writeFileSync(file, content, { mode: 0o600 });
            };
            write(path.join(host, "package.json"), '{"type":"module","name":"onebots"}');
            write(
                path.join(core, "package.json"),
                '{"type":"module","name":"@onebots/core","exports":"./index.js"}',
            );
            write(path.join(core, "index.js"), "export const registry = {};\n");
            write(
                path.join(workspace, "node_modules", "adapter", "package.json"),
                '{"type":"module"}',
            );
            write(
                path.join(workspace, "node_modules", "adapter", "index.js"),
                "export { registry } from '@onebots/core';\n",
            );
            fs.mkdirSync(path.join(workspace, "node_modules", "@onebots"), { mode: 0o700 });
            fs.symlinkSync(core, path.join(workspace, "node_modules", "@onebots", "core"));
            write(
                path.join(host, "bin.js"),
                `
import { registry } from '@onebots/core';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const plugin = await import(pathToFileURL(path.join(process.cwd(), 'node_modules/adapter/index.js')).href);
if (plugin.registry !== registry) throw new Error('split registry');
process.stdout.write('shared-registry');
`,
            );
            write(path.join(workspace, "config.yaml"), "secret-config");
            write(path.join(root, "global", "unrelated"), "must-not-copy");
            const receipt = await captureLegacyRuntimeForest(
                [
                    { source: host, excludedPaths: [] },
                    { source: workspace, excludedPaths: ["config.yaml"] },
                ],
                path.join(root, "store"),
                randomUUID(),
            );
            const mapped = (file: string) => path.join(receipt.root, "fs", file.slice(1));
            expect(fs.existsSync(mapped(path.join(root, "global", "unrelated")))).toBe(false);
            expect(fs.existsSync(mapped(path.join(workspace, "config.yaml")))).toBe(false);
            const alias = mapped(path.join(workspace, "node_modules", "@onebots", "core"));
            expect(path.isAbsolute(fs.readlinkSync(alias))).toBe(false);
            expect(fs.realpathSync(alias)).toBe(mapped(core));
            fs.rmSync(host, { recursive: true });
            fs.rmSync(workspace, { recursive: true });
            await verifyLegacyRuntimeTree(receipt);
            expect(
                execFileSync(process.execPath, [mapped(path.join(host, "bin.js"))], {
                    cwd: mapped(workspace),
                    encoding: "utf8",
                    env: { PATH: "/usr/bin:/bin" },
                }),
            ).toBe("shared-registry");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
