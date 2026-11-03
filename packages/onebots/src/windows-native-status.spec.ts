import { describe, expect, it } from "vitest";
import { parseWindowsNativeStatus } from "./windows-native-status.js";

const now = Date.parse("2026-11-03T00:00:00Z");
function status(version: 2 | 3, rejected = false) {
    return {
        version,
        requestId: "status:1",
        ok: true,
        state: {
            service: "running",
            manager: { state: "running", pid: 42 },
            startedAt: new Date(now).toISOString(),
            control: {
                revision: 1,
                publishedAt: new Date(now).toISOString(),
                manager: {
                    id: "123e4567-e89b-42d3-a456-426614174000",
                    version: "1.2.12",
                    pid: 42,
                },
                ...(version === 3
                    ? { admission: { state: rejected ? "rejected" : "verified" } }
                    : {}),
                gateway: rejected ? null : { desired: "running", actual: "stopped" },
            },
        },
    };
}

describe("Windows native 来源协议", () => {
    it("历史 v2 可只读检查，新 v3 明确表达拒绝而无 gateway", () => {
        expect(parseWindowsNativeStatus(JSON.stringify(status(2)), now).version).toBe(2);
        expect(
            parseWindowsNativeStatus(JSON.stringify(status(3)), now).state.control?.admission
                ?.state,
        ).toBe("verified");
        const rejected = parseWindowsNativeStatus(JSON.stringify(status(3, true)), now);
        expect(rejected.state.control?.admission?.state).toBe("rejected");
        expect(rejected.state.control?.gateway).toBeNull();
    });
    it("拒绝缺准入版本、伪造 gateway 或旧解析器静默忽略新字段", () => {
        const missing = status(3);
        Reflect.deleteProperty(missing.state.control, "admission");
        expect(() => parseWindowsNativeStatus(JSON.stringify(missing), now)).toThrow();
        const rejected = status(3, true);
        rejected.state.control.gateway = { desired: "stopped", actual: "stopped" };
        expect(() => parseWindowsNativeStatus(JSON.stringify(rejected), now)).toThrow();
        const verified = status(3);
        verified.state.control.gateway = null;
        expect(() => parseWindowsNativeStatus(JSON.stringify(verified), now)).toThrow();
        expect(() =>
            parseWindowsNativeStatus(JSON.stringify({ ...status(3), version: 2 }), now),
        ).toThrow();
    });
});
