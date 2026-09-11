import { describe, expect, it } from "vitest";
import type { ConfigurationFormGroup } from "./control-configuration-form.js";
import {
    configurationGroupIdentity,
    configurationGroupLayout,
    configurationFieldTier,
    configurationNextAction,
    configurationWorkspaceForPath,
    configuredProtocolNames,
} from "./control-configuration-layout.js";

const group = (path: string[], title = path.join(" / ")): ConfigurationFormGroup => ({
    key: JSON.stringify(path),
    title,
    fields: [],
    lists: [],
    notices: [],
});

describe("control configuration layout", () => {
    it("promotes explicitly advanced required fields into the visible primary section", () => {
        expect(
            configurationFieldTier({
                key: "oauth-secret",
                path: ["oauth", "client_secret"],
                label: "Client secret",
                placeholder: "",
                rule: { type: "string", required: true, ui: { section: "advanced" } },
            }),
        ).toBe("primary");
        expect(
            configurationFieldTier({
                key: "token",
                path: ["token"],
                label: "Token",
                placeholder: "",
                rule: { type: "string", required: true },
            }),
        ).toBe("primary");
    });

    it("separates runtime, account and protocol configuration", () => {
        const groups = [
            group([], "基础设置"),
            group(["mock.bot"]),
            group(["general", "onebot.v11"]),
            group(["mock.bot", "satori.v1"]),
        ];
        const layout = configurationGroupLayout(groups);
        expect(layout.runtime.map(item => item.title)).toEqual(["基础设置"]);
        expect(layout.accounts.map(item => item.title)).toEqual(["mock.bot"]);
        expect(layout.protocols).toHaveLength(2);
        expect(configurationGroupIdentity(groups[2])).toEqual({
            kind: "protocol",
            protocol: "onebot.v11",
            scope: "default",
        });
        expect(configuredProtocolNames(groups)).toEqual(["onebot.v11"]);
        expect(configuredProtocolNames(groups, "mock.bot")).toEqual(["satori.v1"]);
    });

    it("points to the only meaningful lifecycle action", () => {
        expect(
            configurationNextAction({
                dirty: true,
                validation: "missing",
                operation: "none",
            }).label,
        ).toBe("保存本地修改");
        expect(
            configurationNextAction({
                dirty: false,
                validation: "valid",
                operation: "none",
            }).label,
        ).toBe("应用配置");
        expect(
            configurationNextAction({
                dirty: false,
                validation: "valid",
                operation: "pending",
            }).label,
        ).toBe("确认应用结果");
        expect(
            configurationNextAction({
                dirty: false,
                validation: "invalid",
                operation: "none",
                issueCount: 2,
                issueWorkspace: "protocols",
            }),
        ).toMatchObject({ action: "fix", workspace: "protocols", label: "修正 2 个问题" });
        expect(
            configurationNextAction({
                dirty: false,
                validation: "valid",
                operation: "resolved",
            }).action,
        ).toBe("new-draft");
    });

    it("routes validation paths back to their configuration module", () => {
        expect(configurationWorkspaceForPath(["general", "onebot.v11", "port"])).toBe("protocols");
        expect(
            configurationWorkspaceForPath(["mock.bot", "onebot.v11", "token"], ["onebot.v11"]),
        ).toBe("protocols");
        expect(configurationWorkspaceForPath(["mock.bot", "token"], ["onebot.v11"])).toBe(
            "accounts",
        );
        expect(configurationWorkspaceForPath(["mock.bot"])).toBe("accounts");
        expect(configurationWorkspaceForPath(["database"])).toBe("runtime");
    });
});
