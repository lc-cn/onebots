import { describe, expect, it } from "vitest";
import { createCli } from "./cli.js";

describe("OneBots CLI v2", () => {
    it("exposes a flat command surface", () => {
        const names = createCli().commands.map(command => command.name());
        expect(names).toEqual(expect.arrayContaining([
            "run", "install", "start", "stop", "restart", "status", "logs", "uninstall",
            "setup", "ui", "doctor", "update", "config", "send",
        ]));
        expect(names).not.toContain("gateway");
        expect(names).not.toContain("service");
        expect(names).not.toContain("daemon");
    });
});
