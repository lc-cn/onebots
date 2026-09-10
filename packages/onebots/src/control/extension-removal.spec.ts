import { describe, expect, it } from "vitest";
import {
    assertExtensionsNotReferenced,
    ExtensionRemovalConflictError,
    removedExtensions,
} from "./extension-removal.js";

const removal = {
    adapters: ["mock"],
    protocols: ["onebot-v11"],
    applications: ["zhin"],
};

describe("extension removal references", () => {
    it("finds plugin, account, global protocol and account protocol references", () => {
        try {
            assertExtensionsNotReferenced(removal, {
                plugins: {
                    adapters: ["mock"],
                    protocols: ["onebot-v11"],
                    applications: ["zhin"],
                },
                general: { "onebot.v11": {} },
                "mock.account": { "onebot.v11": {} },
            });
            throw new Error("expected conflict");
        } catch (error) {
            expect(error).toBeInstanceOf(ExtensionRemovalConflictError);
            expect((error as ExtensionRemovalConflictError).conflicts).toEqual([
                {
                    type: "adapter",
                    name: "mock",
                    references: ["plugin-selection", "account"],
                },
                {
                    type: "protocol",
                    name: "onebot-v11",
                    references: ["plugin-selection", "general-protocol", "account-protocol"],
                },
                {
                    type: "application",
                    name: "zhin",
                    references: ["plugin-selection"],
                },
            ]);
        }
    });

    it("allows disabled and unreferenced installed extensions without changing the document", () => {
        const document = {
            plugins: { adapters: [], protocols: [], applications: [] },
            "other.account": {},
        };
        const before = structuredClone(document);
        expect(() => assertExtensionsNotReferenced(removal, document)).not.toThrow();
        expect(document).toEqual(before);
        expect(
            removedExtensions(removal, {
                adapters: [],
                protocols: ["other-v1"],
                applications: [],
            }),
        ).toEqual(removal);
    });
});
