import { describe, expect, it, vi } from "vitest";

const { registerGeneral } = vi.hoisted(() => ({
    registerGeneral: vi.fn(),
}));

vi.mock("onebots", () => ({
    App: { registerGeneral },
}));

await import("./config.js");

describe("Satori V1 registered defaults", () => {
    it("does not replace the source adapter platform unless explicitly configured", () => {
        expect(registerGeneral).toHaveBeenCalledOnce();
        expect(registerGeneral).toHaveBeenCalledWith("satori.v1", {
            use_http: false,
            use_ws: true,
            webhooks: [],
        });
    });
});
