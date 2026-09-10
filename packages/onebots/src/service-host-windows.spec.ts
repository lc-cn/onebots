import { afterEach, describe, expect, it, vi } from "vitest";

const child = vi.hoisted(() => ({ execFileSync: vi.fn(), spawn: vi.fn() }));
vi.mock("node:child_process", () => child);

import { createDefaultServiceHost } from "./service-host.js";

const originalPlatform = process.platform;

afterEach(() => {
    child.execFileSync.mockReset();
    Object.defineProperty(process, "platform", { value: originalPlatform });
});

describe("Windows service host identity", () => {
    it("uses one bounded token query and does not invoke net session", () => {
        Object.defineProperty(process, "platform", { value: "win32" });
        child.execFileSync.mockReturnValue(
            JSON.stringify({ sid: "S-1-5-21-1000", elevated: true }),
        );

        const host = createDefaultServiceHost();

        expect(host).toMatchObject({
            platform: "win32",
            windowsSid: "S-1-5-21-1000",
            isElevated: true,
        });
        expect(child.execFileSync).toHaveBeenCalledOnce();
        const [file, args, options] = child.execFileSync.mock.calls[0];
        expect(file).toBe("powershell.exe");
        expect(args).toContain("-EncodedCommand");
        expect(options).toMatchObject({ timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
        expect(JSON.stringify(child.execFileSync.mock.calls)).not.toContain("net.exe");
        const script = Buffer.from(args.at(-1), "base64").toString("utf16le");
        expect(script).toContain("WindowsIdentity]::GetCurrent()");
        expect(script).toContain("WindowsBuiltInRole]::Administrator");
    });

    it("fails closed on timeout or malformed token proof", () => {
        Object.defineProperty(process, "platform", { value: "win32" });
        child.execFileSync.mockImplementationOnce(() => {
            throw new Error("timeout with private detail");
        });
        expect(createDefaultServiceHost()).toMatchObject({
            windowsSid: undefined,
            isElevated: undefined,
        });

        child.execFileSync.mockReturnValueOnce('{"sid":"S-1-5-21-1000","elevated":true,"extra":1}');
        expect(createDefaultServiceHost()).toMatchObject({
            windowsSid: undefined,
            isElevated: undefined,
        });
    });
});
