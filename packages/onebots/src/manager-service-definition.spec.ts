import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LAUNCHD_LABEL, SERVICE_NAME } from "./service-definition.js";
import { buildManagerServiceArgs, type ManagerServiceSpec } from "./manager-service-spec.js";
import {
    renderManagerSystemdUnit,
    renderManagerLaunchdPlist,
    MANAGER_SERVICE_STOP_TIMEOUT_SECONDS,
} from "./manager-service-definition.js";

function spec(): ManagerServiceSpec {
    return {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "user",
        workspace: '/tmp/用户 "quote" \\ %n ${HOME} & <data> ',
        nodePath: "/usr/local/node runtime %n $HOME/node",
        binPath: "/opt/bin \\ %i $HOME/onebots.js",
        workingDirectory: '/tmp/work "space" %h ${HOME} \\',
        host: "127.0.0.1",
        port: 7821,
    };
}

describe("独立管理服务定义", () => {
    it("ExecStart禁用环境展开且逐参数保护引号、反斜杠和specifier", () => {
        const unit = renderManagerSystemdUnit(spec());
        expect(unit.split("\n").find(line => line.startsWith("ExecStart="))).toBe(
            'ExecStart=":/usr/local/node runtime %%n $HOME/node" ' +
                '"/opt/bin \\\\ %%i $HOME/onebots.js" "serve" "--data-dir" ' +
                '"/tmp/用户 \\"quote\\" \\\\ %%n ${HOME} & <data> " ' +
                '"--host" "127.0.0.1" "--port" "7821"',
        );
        for (const legacy of ["--service-runtime", '"run"', '"-r"', '"-p"', '"-t"', '"-c"'])
            expect(unit).not.toContain(legacy);
    });

    it("WorkingDirectory独立保留文字字符，不套用argv引号且不会产生续行", () => {
        expect(renderManagerSystemdUnit(spec())).toContain(
            'WorkingDirectory=/tmp/work "space" %%h ${HOME} \\/.\n',
        );
        expect(renderManagerSystemdUnit({ ...spec(), workingDirectory: "/tmp/end " })).toContain(
            "WorkingDirectory=/tmp/end /.\n",
        );
    });

    it("服务身份原位保留，先给manager TERM，超时清理进程组", () => {
        const unit = renderManagerSystemdUnit(spec());
        expect(SERVICE_NAME).toBe("onebots-gateway");
        for (const setting of [
            "KillMode=mixed",
            "KillSignal=SIGTERM",
            "SendSIGKILL=yes",
            "Restart=on-failure",
            "RestartSec=5",
            `TimeoutStopSec=${MANAGER_SERVICE_STOP_TIMEOUT_SECONDS}`,
            "WantedBy=default.target",
        ])
            expect(unit).toContain(setting + "\n");
        expect(renderManagerSystemdUnit({ ...spec(), scope: "system" })).toContain(
            "WantedBy=multi-user.target\n",
        );
        const plist = renderManagerLaunchdPlist(spec(), "/tmp/out", "/tmp/error");
        expect(plist).toContain(`<string>${LAUNCHD_LABEL}</string>`);
        expect(plist).toContain("<dict><key>SuccessfulExit</key><false/></dict>");
        expect(plist).toContain(`<integer>${MANAGER_SERVICE_STOP_TIMEOUT_SECONDS}</integer>`);
        expect(plist).toContain("&quot;quote&quot;");
        expect(plist).toContain("&amp; &lt;data&gt;");
    });

    it("拒绝契约外参数、控制字符、无效XML及相对日志路径", () => {
        for (const character of ['"', "'", "\\", "*", "?", "[", "]"])
            expect(() =>
                renderManagerSystemdUnit({ ...spec(), nodePath: `/opt/${character}/node` }),
            ).toThrow("systemd 不支持");
        expect(() =>
            renderManagerSystemdUnit({ ...spec(), adapters: [] } as ManagerServiceSpec),
        ).toThrow();
        for (const suffix of ["\nRestart=no", "\u0000", "\t", "\ud800", "\ufffe"])
            for (const render of [
                (value: ManagerServiceSpec) => renderManagerSystemdUnit(value),
                (value: ManagerServiceSpec) =>
                    renderManagerLaunchdPlist(value, "/tmp/out", "/tmp/err"),
            ])
                expect(() => render({ ...spec(), workspace: "/tmp/" + suffix })).toThrow();
        expect(() => renderManagerLaunchdPlist(spec(), "relative", "/tmp/err")).toThrow();
        expect(() => renderManagerLaunchdPlist(spec(), "/tmp/out\n", "/tmp/err")).toThrow();
    });

    it.skipIf(process.platform !== "darwin")("plutil原生解析后的argv和路径逐字节保留", () => {
        const directory = mkdtempSync(path.join(os.tmpdir(), "onebots-manager-plist-"));
        try {
            const file = path.join(directory, `${LAUNCHD_LABEL}.plist`);
            const output = '/tmp/logs & "引用" \\ %n $HOME.log';
            writeFileSync(file, renderManagerLaunchdPlist(spec(), output, output));
            execFileSync("/usr/bin/plutil", ["-lint", file]);
            const parsed = JSON.parse(
                execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", file], {
                    encoding: "utf8",
                }),
            );
            expect(parsed.ProgramArguments).toEqual([
                spec().nodePath,
                ...buildManagerServiceArgs(spec()),
            ]);
            expect(parsed.WorkingDirectory).toBe(spec().workingDirectory);
            expect(parsed.StandardOutPath).toBe(output);
            expect(parsed.StandardErrorPath).toBe(output);
            expect(parsed.Label).toBe(LAUNCHD_LABEL);
            expect(parsed.KeepAlive).toEqual({ SuccessfulExit: false });
            expect(parsed.ExitTimeOut).toBe(MANAGER_SERVICE_STOP_TIMEOUT_SECONDS);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    const hasSystemdAnalyze =
        process.platform === "linux" &&
        spawnSync("systemd-analyze", ["--version"], { stdio: "ignore" }).status === 0;
    it.skipIf(!hasSystemdAnalyze)("systemd-analyze只校验定义，不启动或安装服务", () => {
        const directory = mkdtempSync(path.join(os.tmpdir(), "onebots-manager-unit-"));
        try {
            const file = path.join(directory, `${SERVICE_NAME}.service`);
            writeFileSync(
                file,
                renderManagerSystemdUnit({ ...spec(), nodePath: process.execPath }),
            );
            execFileSync("systemd-analyze", ["verify", file], {
                env: { ...process.env, SYSTEMD_LOG_LEVEL: "warning" },
            });
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
