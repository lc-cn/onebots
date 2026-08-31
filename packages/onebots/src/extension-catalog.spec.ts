import { describe, expect, it } from "vitest";
import { EXTENSION_CATALOG } from "./extension-catalog.js";

describe("extension configuration targets", () => {
    it("routes adapters to their own account platform", () => {
        const adapters = EXTENSION_CATALOG.filter(entry => entry.type === "adapter");

        expect(adapters.length).toBeGreaterThan(0);
        for (const entry of adapters) {
            expect(entry.configurationTarget).toEqual({
                kind: "account",
                platform: entry.name,
            });
        }
    });

    it("publishes explicit protocol schema keys instead of deriving them from package names", () => {
        const protocols = EXTENSION_CATALOG.filter(entry => entry.type === "protocol");

        expect(
            Object.fromEntries(
                protocols.map(entry => [
                    entry.name,
                    entry.configurationTarget.kind === "protocol"
                        ? entry.configurationTarget.protocolKey
                        : null,
                ]),
            ),
        ).toEqual({
            "onebot-v11": "onebot.v11",
            "onebot-v12": "onebot.v12",
            "satori-v1": "satori.v1",
            "milky-v1": "milky.v1",
            "mcp-v1": "mcp.v1",
        });
    });
});
