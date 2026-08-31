import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "./errors.js";
import {
    definePlatformHttpActionRoutes,
    type PlatformHttpActionRoute,
    type PlatformHttpActionValidationIssue,
} from "./platform-http-action-contract.js";

const invalid = (issue: PlatformHttpActionValidationIssue) =>
    new TypeError(`${issue.kind}:${issue.action}`);

describe("definePlatformHttpActionRoutes", () => {
    it("从同一声明编译 GET、POST、默认值与严格字段", async () => {
        const invoke = vi.fn().mockResolvedValue("ok");
        const actions = definePlatformHttpActionRoutes(
            {
                list: {
                    path: "/items",
                    method: "GET",
                    params: { page: { type: "integer", min: 1, default: 1 } },
                },
                create: {
                    path: "/items/create",
                    method: "POST",
                    params: { name: { type: "string", required: true } },
                },
            },
            invoke,
            invalid,
        );

        await actions.list("client", {});
        await actions.create("client", { name: "item" });
        expect(invoke.mock.calls).toEqual([
            ["client", { method: "GET", path: "/items", query: { page: 1 } }],
            ["client", { method: "POST", path: "/items/create", body: { name: "item" } }],
        ]);
        expect(() => actions.create("client", { name: "item", typo: true })).toThrow(
            "unknown:create",
        );
    });

    it("校验 one-of、条件必填、数组类型与空字符串语义", async () => {
        const invoke = vi.fn().mockResolvedValue("ok");
        const actions = definePlatformHttpActionRoutes(
            {
                update: {
                    path: "/activity",
                    method: "POST",
                    params: {
                        kind: { type: "integer", required: true, values: [1, 2] },
                        id: { type: "integer", min: 1 },
                        title: { type: "string", allowEmpty: true },
                        user_ids: { type: "integer_array", minItems: 1 },
                    },
                    atLeastOne: [["id", "title"]],
                    requiredWhen: [{ param: "kind", equals: 2, required: ["user_ids"] }],
                },
            },
            invoke,
            invalid,
        );

        await actions.update("client", { kind: 2, title: "", user_ids: [1, 2] });
        expect(invoke).toHaveBeenCalledWith("client", {
            method: "POST",
            path: "/activity",
            body: { kind: 2, title: "", user_ids: [1, 2] },
        });
        expect(() => actions.update("client", { kind: 1 })).toThrow("required:update");
        expect(() => actions.update("client", { kind: 2, id: 1 })).toThrow("required:update");
    });

    it("在定义阶段拒绝悬空字段和非法默认值", () => {
        const define = (route: PlatformHttpActionRoute) =>
            definePlatformHttpActionRoutes({ action: route }, async () => undefined, invalid);

        expect(() =>
            define({
                path: "/items",
                method: "POST",
                params: { id: { type: "integer" } },
                atLeastOne: [["missing"]],
            }),
        ).toThrow(ValidationError);
        expect(() =>
            define({
                path: "/items",
                method: "GET",
                params: { page: { type: "integer", min: 1, default: 0 } },
            }),
        ).toThrow("默认值不符合契约");
    });

    it("支持 POST query 与闭合对象数组", async () => {
        const invoke = vi.fn().mockResolvedValue("ok");
        const actions = definePlatformHttpActionRoutes(
            {
                permissions: {
                    path: "/permissions",
                    method: "POST",
                    queryParams: { user_id: { type: "string", required: true } },
                    params: {
                        roles: {
                            type: "object_array",
                            required: true,
                            properties: {
                                role_id: { type: "string", required: true },
                                allow: { type: "string" },
                            },
                        },
                    },
                },
            },
            invoke,
            invalid,
        );

        await actions.permissions("client", {
            user_id: "42",
            roles: [{ role_id: "admin", allow: "1" }],
        });
        expect(invoke).toHaveBeenCalledWith("client", {
            method: "POST",
            path: "/permissions",
            query: { user_id: "42" },
            body: { roles: [{ role_id: "admin", allow: "1" }] },
        });
        expect(() =>
            actions.permissions("client", {
                user_id: "42",
                roles: [{ role_id: "admin", typo: true }],
            }),
        ).toThrow("invalid:permissions");
    });
});
