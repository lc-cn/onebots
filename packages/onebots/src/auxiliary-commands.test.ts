import { describe, expect, it } from "vitest";
import { packageNamesFor } from "./updater.js";
import { getWebUrl } from "./ui.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("auxiliary commands", () => {
    it("updates OneBots together with selected adapters and protocols", () => {
        expect(packageNamesFor(["qq", "kook"], ["onebot-v11"])).toEqual([
            "onebots",
            "@onebots/adapter-qq",
            "@onebots/adapter-kook",
            "@onebots/protocol-onebot-v11",
        ]);
    });

    it("opens the existing web UI configured by the bridge", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-ui-test-"));
        const config = path.join(directory, "config.yaml");
        fs.writeFileSync(config, "port: 7788\npath: admin\n");
        expect(getWebUrl(config)).toBe("http://127.0.0.1:7788");
        fs.rmSync(directory, { recursive: true, force: true });
    });
});
