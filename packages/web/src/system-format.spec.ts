import { describe, expect, it } from "vitest";
import { formatBytes, formatUptime, resourcePercent } from "./system-format.js";

describe("system resource formatting", () => {
    it("distinguishes absent values from zero and uses binary units", () => {
        expect(formatBytes()).toBe("—");
        expect(formatBytes(NaN)).toBe("—");
        expect(formatBytes(0)).toBe("0 B");
        expect(formatBytes(1024 ** 3)).toBe("1 GiB");
    });
    it("formats uptime and clamps meter values", () => {
        expect(formatUptime(30)).toBe("不足 1 分钟");
        expect(formatUptime(90060)).toBe("1 天 1 小时 1 分钟");
        expect(resourcePercent(200, 100)).toBe(100);
        expect(resourcePercent(1, 0)).toBe(0);
    });
});
