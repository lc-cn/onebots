import { describe, expect, it, vi } from "vitest";
import { assertServiceAbsent } from "./service-platform-presence.js";
import { LAUNCHD_LABEL, SERVICE_NAME } from "./service-definition.js";
import type { ServiceHost } from "./service-host.js";
const absent =
    "LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\nControlPID=0\nControlGroup=\nFragmentPath=\n";
function host(platform: "linux" | "darwin", execute: () => string): ServiceHost {
    return {
        platform,
        uid: 501,
        homedir: "/unused",
        env: {},
        exec: vi.fn(execute),
        spawn: vi.fn(async () => {
            throw new Error("never spawn");
        }),
    };
}
function missing(domain: string) {
    return {
        status: 113,
        stderr: `Bad request.\nCould not find service "${LAUNCHD_LABEL}" in domain for ${domain}\n`,
    };
}
describe("首次安装 OS 身份缺失证明", () => {
    it.each(["user", "system"] as const)("Linux %s仅接受全套精确inactive/not-found状态", scope => {
        const h = host("linux", () => absent);
        expect(() => assertServiceAbsent(scope, h)).not.toThrow();
        expect(h.exec).toHaveBeenCalledExactlyOnceWith(
            "systemctl",
            [
                "--no-pager",
                "--no-ask-password",
                ...(scope === "user" ? ["--user"] : []),
                "show",
                "--property=LoadState,ActiveState,SubState,MainPID,ControlPID,ControlGroup,FragmentPath",
                "--",
                `${SERVICE_NAME}.service`,
            ],
            { timeoutMs: 5000 },
        );
        expect(h.spawn).not.toHaveBeenCalled();
    });
    it.each([
        absent.replace("not-found", "loaded"),
        absent.replace("inactive", "failed"),
        absent.replace("SubState=dead", "SubState=running"),
        absent.replace("MainPID=0", "MainPID=7"),
        absent.replace("ControlPID=0", "ControlPID=9"),
        absent.replace("ControlGroup=", "ControlGroup=/old"),
        absent.replace("FragmentPath=", "FragmentPath=/old.service"),
        absent.replace("MainPID=0\n", ""),
        absent + "MainPID=0\n",
        absent + "Unknown=0\n",
        absent + "\n",
    ])("Linux存在、缺字段、重复或含糊状态均拒绝 %#", output => {
        expect(() =>
            assertServiceAbsent(
                "user",
                host("linux", () => output),
            ),
        ).toThrow("无法证明");
    });
    it("Linux命令失败即使stdout看似not-found也拒绝", () => {
        expect(() =>
            assertServiceAbsent(
                "user",
                host("linux", () => {
                    throw { status: 4, stdout: absent };
                }),
            ),
        ).toThrow("无法证明");
    });
    it.each(["user", "system"] as const)("Darwin %s精确域、label及结构化错误证明缺失", scope => {
        const h = host("darwin", () => {
            const error = missing(scope === "user" ? "user gui: 501" : "system");
            throw { ...error, stderr: Buffer.from(error.stderr) };
        });
        expect(() => assertServiceAbsent(scope, h)).not.toThrow();
        expect(h.exec).toHaveBeenCalledExactlyOnceWith(
            "/bin/launchctl",
            ["print", `${scope === "user" ? "gui/501" : "system"}/${LAUNCHD_LABEL}`],
            { timeoutMs: 5000 },
        );
    });
    it.each([
        { status: 113, stderr: "not found" },
        { ...missing("user gui: 501"), status: 5 },
        missing("user gui: 502"),
        { status: 113, stderr: missing("user gui: 501").stderr + "extra" },
        { status: 113, stderr: missing("user gui: 501").stderr.replace(LAUNCHD_LABEL, "other") },
        new Error("launchctl timed out synthetic-secret"),
    ])("Darwin错误域、label、状态码和额外输出不当缺失 %#", error => {
        expect(() =>
            assertServiceAbsent(
                "user",
                host("darwin", () => {
                    throw error;
                }),
            ),
        ).toThrow(/^无法证明系统服务不存在，禁止首次安装覆盖$/);
    });
    it("成功print即使服务停止或空输出仍拒绝", () => {
        for (const text of ["", "state = not running"])
            expect(() =>
                assertServiceAbsent(
                    "user",
                    host("darwin", () => text),
                ),
            ).toThrow("无法证明");
    });
    it("Windows仅接受管理员system范围的精确absent结果", () => {
        const h = host("linux", () => "absent\r\n");
        h.platform = "win32";
        h.isElevated = true;
        expect(() => assertServiceAbsent("system", h)).not.toThrow();
        expect(h.exec).toHaveBeenCalledWith(
            "powershell.exe",
            expect.arrayContaining(["-NonInteractive", "-Command"]),
            { timeoutMs: 5000 },
        );
        for (const output of ["present\r\n", "absent", "absent\r\nextra"])
            expect(() => {
                const candidate = host("linux", () => output);
                candidate.platform = "win32";
                candidate.isElevated = true;
                assertServiceAbsent("system", candidate);
            }).toThrow("无法证明");
    });
    it("无效user域和未实现平台不运行命令", () => {
        for (const uid of [undefined, -1, 1.5, 0xffffffff]) {
            const h = host("darwin", () => "");
            h.uid = uid;
            expect(() => assertServiceAbsent("user", h)).toThrow();
            expect(h.exec).not.toHaveBeenCalled();
        }
        const h = host("linux", () => absent);
        h.platform = "win32";
        expect(() => assertServiceAbsent("system", h)).toThrow();
        expect(h.exec).not.toHaveBeenCalled();
    });
});
