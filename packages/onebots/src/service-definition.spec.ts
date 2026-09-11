import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    SERVICE_NAME,
    buildServiceArgs,
    renderHistoricalSystemdUnit,
    renderLaunchdPlist,
    renderSystemdUnit,
    renderWindowsCommand,
    renderWindowsScriptOptions,
    renderWindowsTaskXml,
    type ServiceSpec,
} from "./service-definition.js";

const spec: ServiceSpec = {
    scope: "user",
    configPath: "/tmp/one bots/配置.yaml",
    adapters: ["qq", "kook"],
    protocols: ["onebot-v11"],
    nodePath: "/opt/node js/bin/node",
    binPath: "/opt/onebots/bin.js",
    workingDirectory: "/tmp/one bots",
};

describe("legacy service definition evidence", () => {
    it("retains the installed bridge and preflight arguments", () => {
        expect(buildServiceArgs(spec)).toEqual([
            spec.binPath,
            "--service-runtime",
            "run",
            "-c",
            spec.configPath,
            "-r",
            "qq",
            "-r",
            "kook",
            "-p",
            "onebot-v11",
        ]);
        expect(buildServiceArgs(spec, "preflight")[2]).toBe("preflight");
        expect(buildServiceArgs({ ...spec, applications: ["zhin"] })).toEqual([
            ...buildServiceArgs(spec),
            "-t",
            "zhin",
        ]);
    });

    it("keeps legacy platform renderers deterministic for migration comparison", () => {
        const systemd = renderSystemdUnit(spec);
        expect(systemd).toContain("WorkingDirectory=/tmp/one bots/.");
        expect(renderHistoricalSystemdUnit(spec)).toContain('WorkingDirectory="/tmp/one bots"');
        expect(systemd).toContain(
            'ExecStart="/opt/node js/bin/node" "/opt/onebots/bin.js" "--service-runtime"',
        );
        expect(renderLaunchdPlist(spec, "/tmp/out.log", "/tmp/error.log")).toContain(
            "/tmp/one bots/配置.yaml",
        );
        expect(renderWindowsTaskXml("C:\\One Bots\\runner.cmd")).toContain("<RestartOnFailure>");
        const windows = {
            ...spec,
            nodePath: "C:\\Program Files\\nodejs\\node.exe",
            binPath: "C:\\One Bots\\bin.js",
            configPath: "C:\\One Bots\\config.yaml",
        };
        expect(renderWindowsCommand(windows)).toContain("--service-runtime run");
        expect(renderWindowsScriptOptions(windows)).toContain('-c "C:\\One Bots\\config.yaml"');
    });

    it("escapes systemd working-directory specifiers and rejects control characters", () => {
        expect(renderSystemdUnit({ ...spec, workingDirectory: "/tmp/one%bot " })).toContain(
            "WorkingDirectory=/tmp/one%%bot /.",
        );
        expect(() => renderSystemdUnit({ ...spec, workingDirectory: "/tmp/one\nbot" })).toThrow(
            "systemd 工作目录含不可表示的字符",
        );
    });

    const hasSystemdAnalyze =
        process.platform === "linux" &&
        spawnSync("systemd-analyze", ["--version"], { stdio: "ignore" }).status === 0;
    it.skipIf(!hasSystemdAnalyze)("systemd-analyze accepts the legacy migration definition", () => {
        const directory = mkdtempSync(path.join(os.tmpdir(), "onebots-legacy-unit-"));
        try {
            const file = path.join(directory, `${SERVICE_NAME}.service`);
            writeFileSync(
                file,
                renderSystemdUnit({
                    ...spec,
                    nodePath: process.execPath,
                    workingDirectory: directory,
                }),
            );
            execFileSync("systemd-analyze", ["verify", file], {
                env: { ...process.env, SYSTEMD_LOG_LEVEL: "warning" },
            });
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
