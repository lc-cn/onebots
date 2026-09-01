import { ValidationError } from "@onebots/core";
import { describe, expect, it } from "vitest";
import {
    assertManagementInstancePrecondition,
    ManagementInstanceMismatchError,
} from "./management-instance-precondition.js";

describe("management instance precondition", () => {
    const source = { info: { instance_id: "instance-current" } };

    it("接受同一实例并兼容未声明前置条件的旧客户端", () => {
        expect(() =>
            assertManagementInstancePrecondition(
                source,
                { get: () => "instance-current" },
                "配置保存",
            ),
        ).not.toThrow();
        expect(() => assertManagementInstancePrecondition(source, {}, "配置保存")).not.toThrow();
    });

    it("区分畸形前置条件和已经切换的实例", () => {
        expect(() =>
            assertManagementInstancePrecondition(source, { get: () => "   " }, "配置保存"),
        ).toThrow(ValidationError);
        expect(() =>
            assertManagementInstancePrecondition(
                source,
                { get: () => "instance-before-restart" },
                "配置保存",
            ),
        ).toThrow(ManagementInstanceMismatchError);
    });
});
