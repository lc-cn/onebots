import { ConfigValidator } from "onebots";
import { describe, expect, test } from "vitest";
import { onebotV11Schema } from "../index.js";

describe("OneBot V11 config", () => {
    test("applies millisecond defaults and normalizes legacy numeric strings", () => {
        expect(ConfigValidator.validate({}, onebotV11Schema)).toMatchObject({
            heartbeat_interval: 15000,
        });
        expect(
            ConfigValidator.validate({ heartbeat_interval: "5000" }, onebotV11Schema),
        ).toMatchObject({ heartbeat_interval: 5000 });
    });
});
