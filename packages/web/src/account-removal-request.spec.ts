import { describe, expect, it } from "vitest";
import { buildAccountRemovalRequest } from "./account-removal-request.js";
import {
    MANAGEMENT_EXPECTED_CONFIG_REVISION_HEADER,
    MANAGEMENT_EXPECTED_INSTANCE_HEADER,
} from "./management-evidence-identity.js";

describe("account removal request", () => {
    it("使用 POST JSON 并绑定实例与配置修订号", () => {
        expect(
            buildAccountRemovalRequest("mock", "demo", "instance-a", "sha256:revision-a"),
        ).toEqual({
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                [MANAGEMENT_EXPECTED_INSTANCE_HEADER]: "instance-a",
                [MANAGEMENT_EXPECTED_CONFIG_REVISION_HEADER]: "sha256:revision-a",
            },
            body: JSON.stringify({ platform: "mock", uin: "demo" }),
        });
    });
});
