import { afterEach, describe, expect, it } from "vitest";
import { AdapterRegistry, type Adapter } from "@onebots/core";
import { getAdapterInfo } from "./adapter-info.js";

const factory = (() => undefined) as unknown as Adapter.Factory;

afterEach(() => AdapterRegistry.clear());

describe("adapter management info", () => {
    it("merges registered display metadata into runtime adapter information", () => {
        AdapterRegistry.register("mock", factory, {
            displayName: "模拟平台",
            description: "用于本地验证",
        });
        const adapter = {
            platform: "mock",
            info: { platform: "mock", icon: "mock.svg", capabilities: {}, accounts: [] },
        } as unknown as Pick<Adapter, "info" | "platform">;

        expect(getAdapterInfo(adapter)).toMatchObject({
            platform: "mock",
            displayName: "模拟平台",
            description: "用于本地验证",
        });
    });

    it("falls back to the platform identifier when metadata is unavailable", () => {
        const adapter = {
            platform: "custom",
            info: { platform: "custom", icon: "", capabilities: {}, accounts: [] },
        } as unknown as Pick<Adapter, "info" | "platform">;

        expect(getAdapterInfo(adapter)).toMatchObject({
            displayName: "custom",
            description: "",
        });
    });
});
