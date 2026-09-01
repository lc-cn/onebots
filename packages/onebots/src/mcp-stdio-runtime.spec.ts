import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Protocol } from "@onebots/core";
import type { LoadedPluginInfo } from "./plugin-loader.js";
import { loadMcpStdioTransport } from "./mcp-stdio-runtime.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("MCP stdio runtime entry", () => {
    it("imports the exact entry already verified by the runtime plugin loader", async () => {
        const entryPath = createModule(
            "export function startStdioTransport() { return 'runtime-entry'; }\n",
        );
        const moduleUrl = `${pathToFileURL(entryPath).href}?onebots_retry=2`;
        const importer = vi.fn((specifier: string) => import(specifier));

        const start = await loadMcpStdioTransport([mcpPlugin(entryPath, moduleUrl)], importer);

        expect(start({ protocol: {} as Protocol })).toBe("runtime-entry");
        expect(importer).toHaveBeenCalledOnce();
        expect(importer).toHaveBeenCalledWith(moduleUrl);
    });

    it("does not resolve an unrelated copy when the verified MCP plugin is absent", async () => {
        const importer = vi.fn();

        await expect(loadMcpStdioTransport([], importer)).rejects.toThrow(
            "当前进程没有已验证的 @onebots/protocol-mcp-v1 插件入口",
        );
        expect(importer).not.toHaveBeenCalled();
    });

    it("reports the loaded package identity when its stdio export is incompatible", async () => {
        const entryPath = createModule("export const incompatible = true;\n");

        await expect(loadMcpStdioTransport([mcpPlugin(entryPath)])).rejects.toThrow(
            "@onebots/protocol-mcp-v1@0.1.5 未导出 startStdioTransport",
        );
    });

    it("rejects legacy inventory that cannot prove the evaluated module identity", async () => {
        const entryPath = createModule(
            "export function startStdioTransport() { return 'unproven'; }\n",
        );

        await expect(
            loadMcpStdioTransport([{ ...mcpPlugin(entryPath), moduleUrl: undefined }]),
        ).rejects.toThrow("缺少当前进程实际加载的模块身份；请重启 OneBots 后重试");
    });
});

function mcpPlugin(entryPath: string, moduleUrl = pathToFileURL(entryPath).href): LoadedPluginInfo {
    return {
        type: "protocol",
        name: "mcp-v1",
        packageName: "@onebots/protocol-mcp-v1",
        version: "0.1.5",
        entryPath,
        moduleUrl,
    };
}

function createModule(source: string): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-mcp-entry-"));
    temporaryDirectories.push(directory);
    const entryPath = path.join(directory, "index.mjs");
    fs.writeFileSync(entryPath, source);
    return entryPath;
}
