import { ConfigValidator } from "onebots";
import { describe, expect, test } from "vitest";
import { onebotV12Schema } from "../index.js";

describe("OneBot V12 config", () => {
    test("applies millisecond defaults and normalizes legacy numeric strings", () => {
        expect(ConfigValidator.validate({}, onebotV12Schema)).toMatchObject({
            request_timeout: 15000,
            heartbeat_interval: 15000,
        });
        expect(
            ConfigValidator.validate(
                { request_timeout: "3000", heartbeat_interval: "5000" },
                onebotV12Schema,
            ),
        ).toMatchObject({ request_timeout: 3000, heartbeat_interval: 5000 });
    });
});
