import { describe, expect, it } from "vitest";
import type { ValidationRule } from "onebots";
import { discordSchema } from "./index.js";
import { DISCORD_GATEWAY_INTENTS } from "./types.js";

describe("Discord 配置 Schema", () => {
    it("将 Gateway Intents 作为可动态增减的受限选项列表", () => {
        const intents = discordSchema.intents as ValidationRule;

        expect(intents.ui).toMatchObject({ widget: "choice-list", section: "filter" });
        expect(intents.choices?.map(choice => choice.value)).toEqual(DISCORD_GATEWAY_INTENTS);
    });

    it("标记凭据并为全部字段提供语义分区", () => {
        expect(discordSchema.token).toMatchObject({
            sensitive: true,
            ui: { section: "credentials" },
        });
        expect(JSON.stringify(discordSchema)).not.toContain('"ui":{}');
    });

    it("按接收模式展示 Gateway 或 Interactions 配置，并结构化编辑活动", () => {
        const applicationId = discordSchema.application_id as ValidationRule;
        const intents = discordSchema.intents as ValidationRule;
        const presence = discordSchema.presence as Record<string, ValidationRule>;

        expect(applicationId.ui?.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["interactions"],
        });
        expect(intents.ui?.visibleWhen).toEqual({ path: "receive_mode", oneOf: ["gateway"] });
        expect(presence.activities.ui).toMatchObject({
            widget: "record-list",
            section: "delivery",
            addLabel: "添加活动",
        });
    });
});
