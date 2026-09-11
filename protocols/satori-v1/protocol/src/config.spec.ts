import { describe, expect, it, vi } from "vitest";

const { registerProtocolDefaults } = vi.hoisted(() => ({
    registerProtocolDefaults: vi.fn(),
}));

vi.mock("onebots", () => ({
    registerProtocolDefaults,
}));

await import("./config.js");

describe("Satori V1 registered defaults", () => {
    it("does not replace the source adapter platform unless explicitly configured", () => {
        expect(registerProtocolDefaults).toHaveBeenCalledOnce();
        expect(registerProtocolDefaults).toHaveBeenCalledWith("satori.v1", {
            use_http: false,
            use_ws: true,
            webhooks: [],
        });
    });
});
