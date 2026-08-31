import { ResourceError, UnsupportedCapabilityError, ValidationError } from "onebots";
import { describe, expect, it } from "vitest";
import { MilkyActionNotFoundError, toMilkyFailure } from "./api-errors.js";

describe("Milky API 错误投影", () => {
    it("区分参数、不支持能力与未知 action", () => {
        expect(toMilkyFailure(new TypeError("bad input"))).toMatchObject({ retcode: -400 });
        expect(toMilkyFailure(new ValidationError("invalid input"))).toMatchObject({
            retcode: -400,
        });
        expect(toMilkyFailure(new ResourceError("missing group"))).toMatchObject({
            retcode: -404,
        });
        expect(
            toMilkyFailure(
                new UnsupportedCapabilityError({ platform: "icqq", capability: "set_peer_pin" }),
            ),
        ).toMatchObject({ retcode: -404 });
        expect(toMilkyFailure(new MilkyActionNotFoundError("missing"))).toMatchObject({
            retcode: -404,
        });
        expect(toMilkyFailure(new Error("boom"))).toMatchObject({ retcode: -500 });
    });
});
