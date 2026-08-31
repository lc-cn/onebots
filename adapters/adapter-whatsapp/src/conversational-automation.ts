import type { PlatformActionHandler } from "onebots";
import { defineWhatsAppActionHandlers } from "./action-contract.js";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";

export const WHATSAPP_BUSINESS_BOT_FIELDS = Object.freeze([
    "id",
    "prompts",
    "commands",
    "enable_welcome_message",
] as const);
export type WhatsAppBusinessBotField = (typeof WHATSAPP_BUSINESS_BOT_FIELDS)[number];

export interface WhatsAppBusinessBotCommand {
    command_name: string;
    command_description: string;
}

export interface WhatsAppConversationalAutomationSettings {
    enable_welcome_message?: boolean;
    prompts?: string[];
    commands?: WhatsAppBusinessBotCommand[];
}

export interface WhatsAppConversationalAutomationResponse {
    success: true;
}

export interface WhatsAppBusinessBot {
    id: string;
    prompts?: string[];
    commands?: WhatsAppBusinessBotCommand[];
    enable_welcome_message?: boolean;
}

/** Phone Number 的欢迎消息、引导问题和命令配置，以及独立 WABA Bot 读取入口。 */
export class WhatsAppConversationalAutomation {
    constructor(private readonly client: WhatsAppClient) {}

    async configure(
        settings: WhatsAppConversationalAutomationSettings,
    ): Promise<WhatsAppConversationalAutomationResponse> {
        return successResponse(
            await this.client.call<unknown>({
                method: "POST",
                resource: `${this.client.config.phone_number_id}/conversational_automation`,
                body: settingsRequest(settings),
            }),
        );
    }

    async getBot(
        botId: string,
        fields: readonly WhatsAppBusinessBotField[] = WHATSAPP_BUSINESS_BOT_FIELDS,
    ): Promise<WhatsAppBusinessBot> {
        const selection = fieldSelection(fields);
        return botResponse(
            await this.client.call<unknown>({
                resource: numericId(botId, "bot_id"),
                query: { fields: selection.join(",") },
            }),
            selection,
        );
    }
}

type ConversationalAutomationActionParams = Readonly<Record<string, unknown>>;

const CONVERSATIONAL_AUTOMATION_ACTION_HANDLERS = {
    configure_conversational_automation: (
        client: WhatsAppClient,
        params: ConversationalAutomationActionParams,
    ) => client.automation.configure(settingsRequest(params.settings)),
    get_business_bot: (client: WhatsAppClient, params: ConversationalAutomationActionParams) =>
        client.automation.getBot(
            inputString(params.bot_id, "bot_id"),
            params.fields === undefined
                ? WHATSAPP_BUSINESS_BOT_FIELDS
                : fieldSelection(params.fields),
        ),
} satisfies Readonly<Record<string, PlatformActionHandler<WhatsAppClient>>>;

/** Conversational Automation 动作的执行与参数契约单一来源。 */
export const WHATSAPP_CONVERSATIONAL_AUTOMATION_ACTION_HANDLERS = defineWhatsAppActionHandlers(
    CONVERSATIONAL_AUTOMATION_ACTION_HANDLERS,
    {
        configure_conversational_automation: ["settings"],
        get_business_bot: ["bot_id", "fields"],
    },
);

export type WhatsAppConversationalAutomationAction =
    keyof typeof WHATSAPP_CONVERSATIONAL_AUTOMATION_ACTION_HANDLERS;

export function isWhatsAppConversationalAutomationAction(
    action: string,
): action is WhatsAppConversationalAutomationAction {
    return Object.hasOwn(WHATSAPP_CONVERSATIONAL_AUTOMATION_ACTION_HANDLERS, action);
}

function settingsRequest(value: unknown): WhatsAppConversationalAutomationSettings {
    const source = inputRecord(value, "settings");
    rejectUnknown(source, ["enable_welcome_message", "prompts", "commands"]);
    const result: WhatsAppConversationalAutomationSettings = {};
    if (source.enable_welcome_message !== undefined) {
        if (typeof source.enable_welcome_message !== "boolean") {
            invalidParameter("enable_welcome_message 必须是布尔值");
        }
        result.enable_welcome_message = source.enable_welcome_message;
    }
    if (source.prompts !== undefined) result.prompts = prompts(source.prompts);
    if (source.commands !== undefined)
        result.commands = commands(source.commands, invalidParameter);
    if (!Object.keys(result).length) invalidParameter("settings 至少包含一项自动化设置");
    return result;
}

function prompts(value: unknown): string[] {
    if (!Array.isArray(value) || value.length > 3) {
        invalidParameter("prompts 必须是最多包含 3 项的数组");
    }
    return value.map((prompt, index) => boundedString(prompt, `prompts[${index}]`, 80));
}

function commands(value: unknown, fail: (message: string) => never): WhatsAppBusinessBotCommand[] {
    if (!Array.isArray(value) || value.length > 30) fail("commands 必须是最多包含 30 项的数组");
    const result = value.map((item, index) => {
        const source = record(item, `commands[${index}]`, fail);
        const unknown = Object.keys(source).find(
            key => key !== "command_name" && key !== "command_description",
        );
        if (unknown) fail(`commands[${index}] 包含未知字段: ${unknown}`);
        const name = boundedStringWith(
            source.command_name,
            `commands[${index}].command_name`,
            30,
            fail,
        );
        if (!/^[A-Za-z\d_]+$/u.test(name)) fail(`commands[${index}].command_name 格式无效`);
        return {
            command_name: name,
            command_description: boundedStringWith(
                source.command_description,
                `commands[${index}].command_description`,
                256,
                fail,
            ),
        };
    });
    if (new Set(result.map(command => command.command_name)).size !== result.length) {
        fail("command_name 必须唯一");
    }
    return result;
}

function fieldSelection(value: unknown): WhatsAppBusinessBotField[] {
    if (!Array.isArray(value) || !value.length) invalidParameter("fields 必须是非空数组");
    const result = value.map(field => {
        if (
            typeof field !== "string" ||
            !(WHATSAPP_BUSINESS_BOT_FIELDS as readonly string[]).includes(field)
        ) {
            invalidParameter(`不支持 Business Bot 字段: ${String(field)}`);
        }
        return field as WhatsAppBusinessBotField;
    });
    return [...new Set(result)];
}

function botResponse(
    value: unknown,
    fields: readonly WhatsAppBusinessBotField[],
): WhatsAppBusinessBot {
    const source = responseRecord(value, value);
    const result: WhatsAppBusinessBot = { id: responseNumericId(source.id, value) };
    if (fields.includes("prompts")) {
        if (!Array.isArray(source.prompts) || source.prompts.length > 3) invalidResponse(value);
        result.prompts = source.prompts.map(prompt => {
            const text = responseString(prompt, value);
            if (!text.trim() || [...text].length > 80) invalidResponse(value);
            return text;
        });
    }
    if (fields.includes("commands")) {
        result.commands = commands(source.commands, () => invalidResponse(value));
    }
    if (fields.includes("enable_welcome_message")) {
        if (typeof source.enable_welcome_message !== "boolean") invalidResponse(value);
        result.enable_welcome_message = source.enable_welcome_message;
    }
    return result;
}

function successResponse(value: unknown): WhatsAppConversationalAutomationResponse {
    const source = responseRecord(value, value);
    if (source.success !== true) invalidResponse(value);
    return { success: true };
}

function numericId(value: unknown, name: string): string {
    const id = inputString(value, name);
    if (!/^\d+$/u.test(id)) invalidParameter(`${name} 必须是数字 ID`);
    return id;
}

function responseNumericId(value: unknown, root: unknown): string {
    if (typeof value !== "string" || !/^\d+$/u.test(value)) invalidResponse(root);
    return value;
}

function boundedString(value: unknown, name: string, max: number): string {
    return boundedStringWith(value, name, max, invalidParameter);
}

function boundedStringWith(
    value: unknown,
    name: string,
    max: number,
    fail: (message: string) => never,
): string {
    if (typeof value !== "string" || !value.trim() || [...value].length > max) {
        fail(`${name} 必须是 1–${max} 字符的非空字符串`);
    }
    return value;
}

function inputString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) invalidParameter(`${name} 必须是非空字符串`);
    return value;
}

function responseString(value: unknown, root: unknown): string {
    if (typeof value !== "string") invalidResponse(root);
    return value;
}

function inputRecord(value: unknown, name: string): Record<string, unknown> {
    return record(value, name, invalidParameter);
}

function responseRecord(value: unknown, root: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse(root);
    return value as Record<string, unknown>;
}

function record(
    value: unknown,
    name: string,
    fail: (message: string) => never,
): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} 必须是对象`);
    return value as Record<string, unknown>;
}

function rejectUnknown(
    source: Readonly<Record<string, unknown>>,
    allowed: readonly string[],
): void {
    const unknown = Object.keys(source).find(key => !allowed.includes(key));
    if (unknown) invalidParameter(`Conversational Automation 参数包含未知字段: ${unknown}`);
}

function invalidResponse(details: unknown): never {
    throw new WhatsAppApiError("WhatsApp Conversational Automation 响应不符合官方结构", {
        code: "WHATSAPP_INVALID_RESPONSE",
        details,
    });
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
