import { describe, expect, test } from "vitest";
import { reactive } from "vue";
import {
    accountIdentifierIssue,
    buildSchemaFields,
    buildConfigGroups,
    deleteValueByPath,
    isSchemaFieldVisible,
    parseStructuredFieldValue,
    resolveStructuredFieldDisplay,
    resolveSchemaFieldInitialValue,
    shouldOmitSchemaFieldValue,
} from "./utils.js";
import type { SchemaBundle, ValidationRule } from "./types.js";

describe("accountIdentifierIssue", () => {
    test.each(["bot-1", "mail@example.com", "中文.主账号"])("接受安全账号标识 %s", value => {
        expect(accountIdentifierIssue(value)).toBeNull();
    });

    test.each(["", " ", "bot name", "bot/name", "bot%2Fchild", "bot?x", "bot#x", ".", ".."])(
        "拒绝歧义账号标识 %#",
        value => {
            expect(accountIdentifierIssue(value)).toEqual(expect.any(String));
        },
    );
});

const endpointRule: ValidationRule = {
    type: "array",
    default: [],
    label: "反向 WebSocket",
    ui: {
        widget: "endpoint-list",
        schemes: ["ws:", "wss:"],
        fields: [{ key: "access_token", label: "Access Token" }],
    },
};

const filterRule: ValidationRule = {
    type: "object",
    default: {},
    label: "事件过滤",
    ui: { widget: "event-filter" },
};

const choiceListRule: ValidationRule = {
    type: "array",
    choices: [
        { label: "消息", value: "message" },
        { label: "反应", value: "reaction" },
    ],
    ui: { widget: "choice-list" },
};

const recordListRule: ValidationRule = {
    type: "array",
    ui: {
        widget: "record-list",
        fields: [
            {
                key: "kind",
                label: "类型",
                choices: [
                    { label: "群组", value: "group" },
                    { label: "用户", value: "user" },
                ],
            },
            {
                key: "id",
                label: "ID",
                visibleWhen: { path: "kind", oneOf: ["group"] },
            },
            { key: "limit", label: "上限", type: "number" },
        ],
    },
};

describe("config form generation", () => {
    test("splits protocol defaults and does not repeat account fields", () => {
        const bundle: SchemaBundle = {
            base: { port: { type: "number", label: "端口" } },
            general: {
                "onebot.v11": { use_http: { type: "boolean" } },
                "milky.v1": { ws_reverse: endpointRule },
            },
            protocols: {
                "onebot.v11": { use_http: { type: "boolean" } },
                "milky.v1": { ws_reverse: endpointRule },
            },
            adapters: { mock: { token: { type: "string" } } },
        };

        const groups = buildConfigGroups(bundle);

        expect(groups.map(group => group.key)).toEqual([
            "base",
            "general:onebot.v11",
            "general:milky.v1",
        ]);
        expect(groups.some(group => group.key.startsWith("account:"))).toBe(false);
    });

    test("keeps endpoint arrays structured for the dynamic editor", () => {
        const value = [{ url: "wss://events.example", access_token: "secret" }];

        expect(resolveStructuredFieldDisplay(value, endpointRule)).toEqual(value);
        expect(parseStructuredFieldValue(value, endpointRule, "反向 WebSocket")).toEqual({
            ok: true,
            value,
        });
    });

    test("copies reactive endpoint arrays without cloning Vue proxies", () => {
        const value = reactive([{ url: "wss://events.example", access_token: "secret" }]);

        expect(resolveStructuredFieldDisplay(value, endpointRule)).toEqual([
            { url: "wss://events.example", access_token: "secret" },
        ]);
    });

    test("keeps event filters structured and accepts advanced JSON", () => {
        const value = reactive({ $and: [{ type: "message" }] });

        expect(resolveStructuredFieldDisplay(value, filterRule)).toEqual(value);
        expect(parseStructuredFieldValue(value, filterRule, "事件过滤")).toEqual({
            ok: true,
            value: { $and: [{ type: "message" }] },
        });
        expect(parseStructuredFieldValue('{"type":"request"}', filterRule, "事件过滤")).toEqual({
            ok: true,
            value: { type: "request" },
        });
    });

    test("keeps dynamic choice lists structured, unique and constrained", () => {
        const value = reactive(["message", "reaction"]);

        expect(resolveStructuredFieldDisplay(value, choiceListRule)).toEqual(value);
        expect(
            parseStructuredFieldValue(["message", "message", "reaction"], choiceListRule, "事件"),
        ).toEqual({ ok: true, value: ["message", "reaction"] });
        expect(parseStructuredFieldValue(["unknown"], choiceListRule, "事件")).toEqual({
            ok: false,
            message: "字段 事件 中存在未声明的选项：unknown",
        });
    });

    test("accepts normalized extension names when a choice list explicitly stays open", () => {
        const rule: ValidationRule = {
            ...choiceListRule,
            allowCustomValues: true,
        };

        expect(
            parseStructuredFieldValue(
                ["message", " third-party-plugin ", "third-party-plugin", ""],
                rule,
                "插件",
            ),
        ).toEqual({ ok: true, value: ["message", "third-party-plugin"] });
    });

    test("keeps generic record lists structured and preserves extension fields", () => {
        const value = reactive([{ kind: "group", id: "group-1", limit: 10, members: [1, 2] }]);

        expect(resolveStructuredFieldDisplay(value, recordListRule)).toEqual(value);
        expect(parseStructuredFieldValue(value, recordListRule, "群组")).toEqual({
            ok: true,
            value: [{ kind: "group", id: "group-1", limit: 10, members: [1, 2] }],
        });
        expect(
            parseStructuredFieldValue(
                [{ kind: "group", id: "group-1", limit: "10" }],
                recordListRule,
                "群组",
            ),
        ).toEqual({ ok: false, message: "字段 群组.limit 必须是number" });
        expect(
            parseStructuredFieldValue(
                [{ kind: "user", id: "stale", limit: 10 }],
                recordListRule,
                "群组",
            ),
        ).toEqual({ ok: true, value: [{ kind: "user", limit: 10 }] });
        expect(parseStructuredFieldValue([{ kind: "unknown" }], recordListRule, "群组")).toEqual({
            ok: false,
            message: "字段 群组.kind 包含未声明的选项",
        });
    });

    test("removes blank rows and rejects the wrong URL scheme", () => {
        expect(
            parseStructuredFieldValue(["", "wss://events.example"], endpointRule, "连接"),
        ).toEqual({ ok: true, value: ["wss://events.example"] });
        expect(parseStructuredFieldValue(["https://events.example"], endpointRule, "连接")).toEqual(
            {
                ok: false,
                message: "字段 连接 仅支持 ws / wss",
            },
        );
    });

    test("resolves conditional fields against the same schema root", () => {
        const fields = buildSchemaFields(
            {
                receive_mode: { type: "string", default: "polling" },
                webhook: {
                    url: {
                        type: "string",
                        ui: {
                            visibleWhen: { path: "receive_mode", oneOf: ["webhook"] },
                        },
                    },
                },
            },
            ["telegram"],
        );
        const webhookUrl = fields.find(field => field.path.join(".") === "telegram.webhook.url");
        if (!webhookUrl) throw new Error("missing webhook field");

        expect(webhookUrl.visibility?.dependencyKey).toBe("telegram::receive_mode");
        expect(isSchemaFieldVisible(webhookUrl, { "telegram::receive_mode": "polling" })).toBe(
            false,
        );
        expect(isSchemaFieldVisible(webhookUrl, { "telegram::receive_mode": "webhook" })).toBe(
            true,
        );
    });

    test("infers a missing selector from existing sibling configuration", () => {
        const fields = buildSchemaFields(
            {
                auth: {
                    method: {
                        type: "string",
                        default: "password",
                        ui: {
                            inferValueFromPresence: [
                                { path: "auth.access_token", value: "oauth2" },
                            ],
                        },
                    },
                    access_token: { type: "string" },
                },
            },
            ["email"],
        );
        const method = fields.find(field => field.path.join(".") === "email.auth.method");
        if (!method) throw new Error("missing auth method field");

        expect(
            resolveSchemaFieldInitialValue(
                { email: { auth: { access_token: "existing-token" } } },
                method,
            ),
        ).toBe("oauth2");
        expect(resolveSchemaFieldInitialValue({ email: { auth: {} } }, method)).toBe("password");
        expect(
            resolveSchemaFieldInitialValue({ email: { auth: { method: "password" } } }, method),
        ).toBe("password");
    });

    test("normalizes legacy scalar values before binding schema fields", () => {
        const fields = buildSchemaFields({
            heartbeat_interval: { type: "number", default: 15000 },
            request_timeout: { type: "number" },
            sign_api_addr: { type: "string" },
        });
        const byPath = (path: string) => {
            const field = fields.find(item => item.path.join(".") === path);
            if (!field) throw new Error(`missing ${path}`);
            return field;
        };

        expect(
            resolveSchemaFieldInitialValue(
                { heartbeat_interval: "5000" },
                byPath("heartbeat_interval"),
            ),
        ).toBe(5000);
        expect(
            resolveSchemaFieldInitialValue({ request_timeout: "" }, byPath("request_timeout")),
        ).toBeUndefined();
        expect(
            resolveSchemaFieldInitialValue({ sign_api_addr: "" }, byPath("sign_api_addr")),
        ).toBeUndefined();
        expect(resolveSchemaFieldInitialValue({}, byPath("heartbeat_interval"))).toBe(15000);
        expect(shouldOmitSchemaFieldValue("", { type: "string" })).toBe(true);
        expect(shouldOmitSchemaFieldValue("", { type: "string", required: true })).toBe(false);
        expect(shouldOmitSchemaFieldValue(0, { type: "number" })).toBe(false);
    });

    test("removes hidden values and empty parent objects", () => {
        const config = { telegram: { receive_mode: "polling", webhook: { url: "https://old" } } };

        deleteValueByPath(config, ["telegram", "webhook", "url"]);

        expect(config).toEqual({ telegram: { receive_mode: "polling" } });
    });
});
