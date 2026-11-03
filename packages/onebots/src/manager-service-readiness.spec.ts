import { describe, expect, it, vi } from "vitest";
import { createLocalControlTransport } from "./client/local-control.js";
import { inspectManagerReadiness } from "./manager-service-readiness.js";
vi.mock("./client/local-control.js", () => ({ createLocalControlTransport: vi.fn() }));
function fixture() {
    return {
        schemaVersion: 1,
        manager: { id: "123e4567-e89b-42d3-a456-426614174000", version: "1.2.13", pid: 42 },
        admission: { schemaVersion: 1, state: "unbound", reason: "EXPLICIT_REGISTRATION_REQUIRED" },
        gateway: null,
    };
}
describe("最小本机 manager readiness", () => {
    it("只读显式身份和来源拒绝，缺失网关保持 null", async () => {
        const request = vi.fn(async () => fixture());
        vi.mocked(createLocalControlTransport).mockReturnValue({ request } as never);
        expect((await inspectManagerReadiness("workspace")).gateway).toBeNull();
        expect(request).toHaveBeenCalledWith("GET", "/api/control/manager-readiness");
    });
    it.each(["pid", "admission", "gateway"])("拒绝无效 %s 证据", async field => {
        const value = fixture();
        if (field === "pid") value.manager.pid = 0;
        if (field === "admission") value.admission.state = "missing";
        if (field === "gateway") value.gateway = {};
        vi.mocked(createLocalControlTransport).mockReturnValue({
            request: async () => value,
        } as never);
        await expect(inspectManagerReadiness("workspace")).rejects.toThrow("就绪证明无效");
    });
});
