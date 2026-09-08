import { describe, expect, it } from "vitest";
import { packageNamesFor } from "./updater.js";

describe("auxiliary commands", () => {
    it("updates OneBots together with selected adapters and protocols", () => {
        expect(packageNamesFor(["qq", "kook"], ["onebot-v11"])).toEqual([
            "onebots",
            "@onebots/adapter-qq",
            "@onebots/adapter-kook",
            "@onebots/protocol-onebot-v11",
        ]);
    });
});
