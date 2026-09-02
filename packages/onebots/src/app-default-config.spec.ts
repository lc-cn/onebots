import { describe, expect, it } from "vitest";
import { mergeAppConfigDefaults } from "./app.js";

describe("app defaults", () => {
    it("merges registered protocol defaults with account-independent overrides", () => {
        expect(
            mergeAppConfigDefaults(
                {
                    port: 7000,
                    general: { "onebot.v12": { use_ws: true } },
                },
                {
                    port: 6727,
                    timeout: 30,
                    general: {
                        "onebot.v12": {
                            use_http: true,
                            use_ws: false,
                            heartbeat_interval: 15000,
                        },
                    },
                },
            ),
        ).toMatchObject({
            port: 7000,
            timeout: 30,
            general: {
                "onebot.v12": {
                    use_http: true,
                    use_ws: true,
                    heartbeat_interval: 15000,
                },
            },
        });
    });
});
