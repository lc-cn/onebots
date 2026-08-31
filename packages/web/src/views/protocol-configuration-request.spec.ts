import { describe, expect, it } from "vitest";
import { parseProtocolConfigurationRequest } from "./protocol-configuration-request.js";

describe("protocol configuration request", () => {
    const availableProtocols = ["onebot.v11", "satori.v1"];

    it("accepts an explicitly loaded protocol schema key", () => {
        expect(parseProtocolConfigurationRequest("onebot.v11", availableProtocols)).toBe(
            "onebot.v11",
        );
    });

    it("rejects package suffixes, unloaded protocols, repeated and missing values", () => {
        expect(parseProtocolConfigurationRequest("onebot-v11", availableProtocols)).toBeNull();
        expect(parseProtocolConfigurationRequest("milky.v1", availableProtocols)).toBeNull();
        expect(parseProtocolConfigurationRequest(["onebot.v11"], availableProtocols)).toBeNull();
        expect(parseProtocolConfigurationRequest(undefined, availableProtocols)).toBeNull();
    });
});
