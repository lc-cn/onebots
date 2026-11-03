import { execFileSync } from "node:child_process";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
    readWindowsWorkspaceIdentity,
    acquireWindowsWorkspaceIdentity,
} from "./windows-workspace-identity.js";
import { inspectWindowsPrivateFile, replaceWindowsPrivateFile } from "./windows-private-file.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("./windows-host-control-client.js", () => ({
    windowsNativeHostExecutable: () => "fixture-native.exe",
}));
beforeEach(() => vi.mocked(execFileSync).mockReset());
afterEach(() => vi.unstubAllEnvs());

describe("Windows 离线私有存储桥", () => {
    it("helper 不继承部署码，父进程仍可正常消费配对环境", () => {
        vi.stubEnv("ONEBOTS_BOOTSTRAP_CODE", "synthetic-bootstrap");
        vi.stubEnv("ONEBOTS_RECOVERY_CODE", "synthetic-recovery");
        vi.mocked(execFileSync).mockReturnValue(
            JSON.stringify({ version: 1, volumeSerial: "f".repeat(16), fileId: "a".repeat(32) }),
        );
        readWindowsWorkspaceIdentity("C:\\Data\\.control");
        const env = (vi.mocked(execFileSync).mock.calls[0][2] as { env: NodeJS.ProcessEnv }).env;
        expect(env.ONEBOTS_BOOTSTRAP_CODE).toBeUndefined();
        expect(env.ONEBOTS_RECOVERY_CODE).toBeUndefined();
        expect(process.env.ONEBOTS_BOOTSTRAP_CODE).toBe("synthetic-bootstrap");
    });
    it("opaque anchor 只释放一次，关闭结果未知不重放数值 HANDLE", () => {
        vi.mocked(execFileSync).mockReturnValueOnce(
            JSON.stringify({
                version: 1,
                volumeSerial: "f".repeat(16),
                fileId: "a".repeat(32),
                handles: ["0000000000000042"],
            }),
        );
        const lease = acquireWindowsWorkspaceIdentity("C:\\Data\\.control");
        vi.mocked(execFileSync).mockImplementationOnce(() => {
            throw new Error("unknown close outcome");
        });
        expect(() => lease.close()).toThrow("unknown close outcome");
        lease.close();
        expect(execFileSync).toHaveBeenCalledTimes(2);
    });
    it("无损接收 64 位卷标识/128 位文件 ID，不依赖 SCM 管道", () => {
        vi.mocked(execFileSync).mockReturnValue(
            JSON.stringify({
                version: 1,
                volumeSerial: "ffffffffffffffff",
                fileId: "a".repeat(32),
            }),
        );
        expect(readWindowsWorkspaceIdentity("C:\\Data\\.control")).toEqual({
            volumeSerial: "ffffffffffffffff",
            fileId: "a".repeat(32),
        });
        expect(vi.mocked(execFileSync).mock.calls[0].slice(0, 2)).toEqual([
            "fixture-native.exe",
            ["workspace-identity", "--directory", "C:\\Data\\.control"],
        ]);
        vi.mocked(execFileSync).mockReturnValue(
            JSON.stringify({ version: 1, volumeSerial: 1, fileId: "a".repeat(32) }),
        );
        expect(() => readWindowsWorkspaceIdentity("C:\\Data\\.control")).toThrow();
    });
    it("认证字节只走 stdin，预期摘要明确，错误或不完整屏障证明不能当成功", () => {
        vi.mocked(execFileSync).mockReturnValue(JSON.stringify({ version: 1, verified: true }));
        replaceWindowsPrivateFile({
            directory: "C:\\Data\\.control",
            fileName: "auth.json",
            expectedDigest: null,
            bytes: Buffer.from("synthetic-private"),
        });
        const call = vi.mocked(execFileSync).mock.calls[0];
        expect(call[1]).toEqual(["private-file-replace"]);
        expect(call[1]).not.toContain("synthetic-private");
        expect(JSON.parse((call[2] as { input: string }).input)).toMatchObject({
            expectedDigest: null,
            fileName: "auth.json",
        });
        vi.mocked(execFileSync).mockReturnValue(JSON.stringify({ version: 1, verified: false }));
        expect(() => inspectWindowsPrivateFile("C:\\Data\\.control\\auth.json")).toThrow();
    });
});
