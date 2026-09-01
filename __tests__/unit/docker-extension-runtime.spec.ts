import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareDockerExtensionRuntime } from "../../scripts/docker-extension-runtime.mjs";

describe("Docker persistent extension runtime", () => {
    const temporaryDirectories: string[] = [];

    afterEach(() => {
        for (const directory of temporaryDirectories.splice(0)) {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it("preserves user dependencies while refreshing image-managed extension links", () => {
        const fixture = createImageFixture();
        const runtimeRoot = temporaryDirectory("onebots-docker-runtime-");
        fs.writeFileSync(
            path.join(runtimeRoot, "package.json"),
            JSON.stringify({
                name: "previous-runtime",
                dependencies: {
                    "custom-extension": "1.2.3",
                    "@onebots/adapter-old": "link:/app/adapters/adapter-old",
                },
                onebotsDockerManagedDependencies: ["@onebots/adapter-old"],
            }),
        );
        fs.mkdirSync(path.join(runtimeRoot, "node_modules", "@onebots", "adapter-old"), {
            recursive: true,
        });

        const result = prepareDockerExtensionRuntime({
            runtimeRoot,
            bundledRoot: fixture.bundledRoot,
            imageRoot: fixture.imageRoot,
        });
        const manifest = JSON.parse(
            fs.readFileSync(path.join(runtimeRoot, "package.json"), "utf8"),
        ) as {
            name: string;
            private: boolean;
            packageManager: string;
            dependencies: Record<string, string>;
            onebotsDockerManagedDependencies: string[];
        };

        expect(result).toEqual({
            root: runtimeRoot,
            managedDependencies: ["onebots", "@onebots/adapter-qq", "@onebots/protocol-onebot-v11"],
        });
        expect(manifest).toMatchObject({
            name: "onebots-docker-runtime",
            private: true,
            packageManager: "pnpm@9.15.9",
            dependencies: {
                "custom-extension": "1.2.3",
                onebots: `link:${fixture.targets.onebots}`,
                "@onebots/adapter-qq": `link:${fixture.targets.adapter}`,
                "@onebots/protocol-onebot-v11": `link:${fixture.targets.protocol}`,
            },
            onebotsDockerManagedDependencies: [
                "onebots",
                "@onebots/adapter-qq",
                "@onebots/protocol-onebot-v11",
            ],
        });
        expect(manifest.dependencies).not.toHaveProperty("@onebots/adapter-old");
        expect(manifest.dependencies).not.toHaveProperty("js-yaml");
        expect(
            fs.existsSync(path.join(runtimeRoot, "node_modules", "@onebots", "adapter-old")),
        ).toBe(false);
        expect(fs.realpathSync(path.join(runtimeRoot, "node_modules", "onebots"))).toBe(
            fixture.targets.onebots,
        );
        expect(
            fs.realpathSync(path.join(runtimeRoot, "node_modules", "@onebots", "adapter-qq")),
        ).toBe(fixture.targets.adapter);

        expect(() =>
            prepareDockerExtensionRuntime({
                runtimeRoot,
                bundledRoot: fixture.bundledRoot,
                imageRoot: fixture.imageRoot,
            }),
        ).not.toThrow();
    });

    it("rejects a symlinked runtime root before writing persistent state", () => {
        const fixture = createImageFixture();
        const target = temporaryDirectory("onebots-docker-target-");
        const parent = temporaryDirectory("onebots-docker-parent-");
        const runtimeRoot = path.join(parent, "extensions");
        fs.symlinkSync(target, runtimeRoot, "dir");

        expect(() =>
            prepareDockerExtensionRuntime({
                runtimeRoot,
                bundledRoot: fixture.bundledRoot,
                imageRoot: fixture.imageRoot,
            }),
        ).toThrow(`扩展运行路径不是常规目录: ${runtimeRoot}`);
        expect(fs.readdirSync(target)).toEqual([]);
    });

    it("rejects bundled package links that escape the immutable image root", () => {
        const fixture = createImageFixture();
        const outside = temporaryDirectory("onebots-docker-outside-");
        const packageLink = path.join(fixture.bundledRoot, "node_modules", "onebots");
        fs.rmSync(packageLink, { recursive: true, force: true });
        fs.symlinkSync(outside, packageLink, "dir");

        expect(() =>
            prepareDockerExtensionRuntime({
                runtimeRoot: temporaryDirectory("onebots-docker-runtime-"),
                bundledRoot: fixture.bundledRoot,
                imageRoot: fixture.imageRoot,
            }),
        ).toThrow("镜像内置扩展 onebots 解析到了 /app 之外");
    });

    it("does not replace a malformed persisted dependency manifest", () => {
        const fixture = createImageFixture();
        const runtimeRoot = temporaryDirectory("onebots-docker-runtime-");
        const manifestPath = path.join(runtimeRoot, "package.json");
        const source = JSON.stringify({ dependencies: ["unexpected"] });
        fs.writeFileSync(manifestPath, source);

        expect(() =>
            prepareDockerExtensionRuntime({
                runtimeRoot,
                bundledRoot: fixture.bundledRoot,
                imageRoot: fixture.imageRoot,
            }),
        ).toThrow(`扩展运行清单 dependencies 不是对象: ${manifestPath}`);
        expect(fs.readFileSync(manifestPath, "utf8")).toBe(source);
        expect(fs.existsSync(path.join(runtimeRoot, "node_modules"))).toBe(false);
    });

    function createImageFixture() {
        const imageRoot = temporaryDirectory("onebots-docker-image-");
        const bundledRoot = path.join(imageRoot, "development");
        const targetPaths = {
            onebots: path.join(imageRoot, "packages", "onebots"),
            adapter: path.join(imageRoot, "adapters", "adapter-qq"),
            protocol: path.join(imageRoot, "protocols", "onebot-v11", "protocol"),
        };
        for (const target of Object.values(targetPaths)) fs.mkdirSync(target, { recursive: true });
        const targets = {
            onebots: fs.realpathSync(targetPaths.onebots),
            adapter: fs.realpathSync(targetPaths.adapter),
            protocol: fs.realpathSync(targetPaths.protocol),
        };
        fs.mkdirSync(path.join(bundledRoot, "node_modules", "@onebots"), { recursive: true });
        fs.writeFileSync(
            path.join(bundledRoot, "package.json"),
            JSON.stringify({
                dependencies: {
                    onebots: "workspace:*",
                    "@onebots/adapter-qq": "workspace:*",
                    "@onebots/protocol-onebot-v11": "workspace:*",
                    "js-yaml": "latest",
                },
            }),
        );
        fs.symlinkSync(targets.onebots, path.join(bundledRoot, "node_modules", "onebots"), "dir");
        fs.symlinkSync(
            targets.adapter,
            path.join(bundledRoot, "node_modules", "@onebots", "adapter-qq"),
            "dir",
        );
        fs.symlinkSync(
            targets.protocol,
            path.join(bundledRoot, "node_modules", "@onebots", "protocol-onebot-v11"),
            "dir",
        );
        return { imageRoot, bundledRoot, targets };
    }

    function temporaryDirectory(prefix: string): string {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
        temporaryDirectories.push(directory);
        return directory;
    }
});
