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
    it("uses one bounded native token query and does not start PowerShell", () => {
        Object.defineProperty(process, "platform", { value: "win32" });
        child.execFileSync.mockReturnValue(
            JSON.stringify({ version: 1, sid: "S-1-5-21-1000", elevated: true }),
        );

        const host = createDefaultServiceHost();

        expect(host).toMatchObject({
            platform: "win32",
            windowsSid: "S-1-5-21-1000",
            isElevated: true,
        });
        expect(child.execFileSync).toHaveBeenCalledOnce();
        const [file, args, options] = child.execFileSync.mock.calls[0];
        expect(file).toMatch(
            new RegExp(`native[/\\\\]win32-${process.arch}[/\\\\]onebots-windows-host\\.exe$`),
        );
        expect(args).toEqual(["identity"]);
        expect(options).toMatchObject({ timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
        expect(JSON.stringify(child.execFileSync.mock.calls)).not.toContain("powershell.exe");
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

        child.execFileSync.mockReturnValueOnce(
            '{"version":1,"sid":"S-1-5-21-1000","elevated":true,"extra":1}',
        );
        expect(createDefaultServiceHost()).toMatchObject({
            windowsSid: undefined,
            isElevated: undefined,
        });
    });
});
