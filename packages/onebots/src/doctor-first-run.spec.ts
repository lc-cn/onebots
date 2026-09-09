import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { runDoctor } from "./doctor.js";
import packageMetadata from "../package.json" with { type: "json" };
const temporaryDirectories: string[] = [];
afterEach(() => {
    for (const directory of temporaryDirectories.splice(0))
        fs.rmSync(directory, { recursive: true, force: true });
});
it("only fails a first-run warning when strict mode is enabled", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-strict-"));
    temporaryDirectories.push(directory);
    const configPath = path.join(directory, "config.yaml");
    fs.writeFileSync(configPath, "general: {}\npublic_static_dir: static\n", { mode: 0o600 });
    fs.mkdirSync(path.join(directory, "data"), { mode: 0o700 });
    fs.mkdirSync(path.join(directory, "static"));
    const extensionRoot = createExtensionRuntimeRoot();

    // 首次运行测试必须使用独立空闲端口，不能探测用户正在运行的默认6727服务。
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("缺少测试端口");
    const environmentPort = String(address.port);
    await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
    );
    const normal = await runDoctor({
        configPath,
        environmentPort,
        adapters: [],
        protocols: [],
        scope: "user",
        useInstalledService: false,
        extensionRoot,
    });
    const strict = await runDoctor({
        configPath,
        environmentPort,
        adapters: [],
        protocols: [],
        scope: "user",
        strict: true,
        useInstalledService: false,
        extensionRoot,
    });

    expect(normal, JSON.stringify(normal.checks)).toMatchObject({ ok: true, strict: false });
    expect(strict).toMatchObject({ ok: false, strict: true });
    expect(strict.checks.find(check => check.name === "plugin-selection")).toMatchObject({
        level: "warning",
    });
    expect(normal.checks.find(check => check.name === "extension-root")).toMatchObject({
        level: "ok",
        message: expect.stringContaining(`onebots@${packageMetadata.version}`),
    });
    expect(normal.target.publicStaticDirectory).toBe(
        fs.realpathSync(path.join(directory, "static")),
    );
});
function createExtensionRuntimeRoot(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-extension-root-"));
    temporaryDirectories.push(directory);
    fs.mkdirSync(path.join(directory, "node_modules", "onebots"), { recursive: true });
    fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({ private: true, dependencies: { onebots: packageMetadata.version } }),
    );
    fs.writeFileSync(
        path.join(directory, "node_modules", "onebots", "package.json"),
        JSON.stringify({ name: "onebots", version: packageMetadata.version }),
    );
    return directory;
}
