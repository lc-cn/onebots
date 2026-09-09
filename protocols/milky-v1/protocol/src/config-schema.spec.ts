import { ProtocolRegistry } from "onebots";
import { describe, expect, it } from "vitest";
import "./index.js";

describe("Milky 配置 Schema", () => {
    it.each([
        ["http_reverse", ["http:", "https:"]],
        ["ws_reverse", ["ws:", "wss:"]],
    ])("允许受管配置写入 %s 端点 URL", (name, schemes) => {
        const schema = ProtocolRegistry.getSchema("milky.v1");
        const endpoint = schema?.[name];
        const fields = (endpoint as { ui?: { fields?: { key: string }[] } } | undefined)?.ui
            ?.fields;

        expect(endpoint).toMatchObject({
            type: "array",
            ui: {
                widget: "endpoint-list",
                schemes,
            },
        });
        expect(fields?.find(field => field.key === "url")).toMatchObject({
            key: "url",
            type: "string",
        });
    });
});
