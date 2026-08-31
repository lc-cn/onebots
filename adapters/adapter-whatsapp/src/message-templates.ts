import type { PlatformActionHandler } from "onebots";
import { defineWhatsAppActionHandlers } from "./action-contract.js";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";
import { normalizeTemplateComponents, parseTemplateComponents } from "./message-template-json.js";
import {
    WHATSAPP_MESSAGE_TEMPLATE_FIELDS,
    isWhatsAppMessageTemplateCategory,
    isWhatsAppMessageTemplateField,
    isWhatsAppMessageTemplateParameterFormat,
    isWhatsAppMessageTemplateStatus,
    type WhatsAppMessageTemplateCategory,
    type WhatsAppMessageTemplateComponent,
    type WhatsAppMessageTemplate,
    type WhatsAppMessageTemplateCreate,
    type WhatsAppMessageTemplateCreateResponse,
    type WhatsAppMessageTemplateDetails,
    type WhatsAppMessageTemplateField,
    type WhatsAppMessageTemplateFieldSelection,
    type WhatsAppMessageTemplateListQuery,
    type WhatsAppMessageTemplateListFullResponse,
    type WhatsAppMessageTemplateListResponse,
    type WhatsAppMessageTemplateNamespaceResponse,
    type WhatsAppMessageTemplatePaging,
    type WhatsAppMessageTemplateParameterFormat,
    type WhatsAppMessageTemplateStatus,
    type WhatsAppMessageTemplateSuccessResponse,
    type WhatsAppMessageTemplateUpdate,
} from "./message-template-types.js";

/** WABA 级消息模板读写，组件保留 Meta 可扩展的安全 JSON 结构。 */
export class WhatsAppMessageTemplates {
    constructor(private readonly client: WhatsAppClient) {}

    list(): Promise<WhatsAppMessageTemplateListFullResponse>;
    list(query: WhatsAppMessageTemplateListQuery): Promise<WhatsAppMessageTemplateListResponse>;
    async list(
        query: WhatsAppMessageTemplateListQuery = {},
    ): Promise<WhatsAppMessageTemplateListFullResponse | WhatsAppMessageTemplateListResponse> {
        const response = await this.client.call<unknown>({
            resource: `${this.client.config.business_account_id}/message_templates`,
            query: listQuery(query),
        });
        return query.fields === undefined
            ? fullListResponse(response)
            : projectedListResponse(response);
    }

    get(templateId: string): Promise<WhatsAppMessageTemplate>;
    get(
        templateId: string,
        selection: WhatsAppMessageTemplateFieldSelection,
    ): Promise<WhatsAppMessageTemplateDetails>;
    async get(
        templateId: string,
        selection: WhatsAppMessageTemplateFieldSelection = {},
    ): Promise<WhatsAppMessageTemplate | WhatsAppMessageTemplateDetails> {
        const response = await this.client.call<unknown>({
            resource: graphId(templateId, "template_id"),
            query: fieldQuery(selection),
        });
        return selection.fields === undefined
            ? completeTemplate(response)
            : templateDetails(response);
    }

    async getNamespace(): Promise<WhatsAppMessageTemplateNamespaceResponse> {
        const response = await this.client.call<unknown>({
            resource: this.client.config.business_account_id,
            query: { fields: "id,message_template_namespace" },
        });
        return namespaceResponse(response);
    }

    async create(
        template: WhatsAppMessageTemplateCreate,
    ): Promise<WhatsAppMessageTemplateCreateResponse> {
        const response = await this.client.call<unknown>({
            method: "POST",
            resource: `${this.client.config.business_account_id}/message_templates`,
            body: createRequest(template),
        });
        return createResponse(response);
    }

    async update(
        templateId: string,
        template: WhatsAppMessageTemplateUpdate,
    ): Promise<WhatsAppMessageTemplateSuccessResponse> {
        const response = await this.client.call<unknown>({
            method: "POST",
            resource: graphId(templateId, "template_id"),
            body: updateRequest(template),
        });
        return successResponse(response);
    }

    async deleteByName(
        name: string,
        templateId?: string,
    ): Promise<WhatsAppMessageTemplateSuccessResponse> {
        const response = await this.client.call<unknown>({
            method: "DELETE",
            resource: `${this.client.config.business_account_id}/message_templates`,
            query: {
                name: templateName(name),
                ...(templateId === undefined ? {} : { hsm_id: graphId(templateId, "template_id") }),
            },
        });
        return successResponse(response);
    }
}

type MessageTemplateActionParams = Readonly<Record<string, unknown>>;

const MESSAGE_TEMPLATE_ACTION_HANDLERS = {
    list_message_templates: (client: WhatsAppClient, params: MessageTemplateActionParams) =>
        client.messageTemplates.list(actionListQuery(params)),
    get_message_template: (client: WhatsAppClient, params: MessageTemplateActionParams) =>
        client.messageTemplates.get(
            graphId(params.template_id, "template_id"),
            actionSelection(params),
        ),
    get_message_template_namespace: (client: WhatsAppClient) =>
        client.messageTemplates.getNamespace(),
    create_message_template: (client: WhatsAppClient, params: MessageTemplateActionParams) =>
        client.messageTemplates.create(createRequest(params.template)),
    update_message_template: (client: WhatsAppClient, params: MessageTemplateActionParams) =>
        client.messageTemplates.update(
            graphId(params.template_id, "template_id"),
            updateRequest(params.template),
        ),
    delete_message_template: (client: WhatsAppClient, params: MessageTemplateActionParams) =>
        client.messageTemplates.deleteByName(templateName(params.name)),
    delete_message_template_by_id: (client: WhatsAppClient, params: MessageTemplateActionParams) =>
        client.messageTemplates.deleteByName(
            templateName(params.name),
            graphId(params.template_id, "template_id"),
        ),
} satisfies Readonly<Record<string, PlatformActionHandler<WhatsAppClient>>>;

/** Message Template 动作的执行与参数契约单一来源。 */
export const WHATSAPP_MESSAGE_TEMPLATE_ACTION_HANDLERS = defineWhatsAppActionHandlers(
    MESSAGE_TEMPLATE_ACTION_HANDLERS,
    {
        list_message_templates: ["name", "fields", "limit", "after"],
        get_message_template: ["template_id", "fields"],
        get_message_template_namespace: [],
        create_message_template: ["template"],
        update_message_template: ["template_id", "template"],
        delete_message_template: ["name"],
        delete_message_template_by_id: ["name", "template_id"],
    },
);

export type WhatsAppMessageTemplateAction = keyof typeof WHATSAPP_MESSAGE_TEMPLATE_ACTION_HANDLERS;

export function isWhatsAppMessageTemplateAction(
    action: string,
): action is WhatsAppMessageTemplateAction {
    return Object.hasOwn(WHATSAPP_MESSAGE_TEMPLATE_ACTION_HANDLERS, action);
}

function actionListQuery(
    params: Readonly<Record<string, unknown>>,
): WhatsAppMessageTemplateListQuery {
    return {
        ...actionSelection(params),
        ...(params.name === undefined ? {} : { name: templateName(params.name) }),
        ...(params.limit === undefined ? {} : { limit: pageLimit(params.limit) }),
        ...(params.after === undefined ? {} : { after: nonemptyString(params.after, "after") }),
    };
}

function actionSelection(
    params: Readonly<Record<string, unknown>>,
): WhatsAppMessageTemplateFieldSelection {
    return params.fields === undefined ? {} : { fields: templateFields(params.fields) };
}

function listQuery(value: unknown): Record<string, string | number> {
    if (!isRecord(value)) invalidParameter("模板查询必须是对象");
    rejectUnknown(value, ["name", "fields", "limit", "after"]);
    return {
        ...fieldQuery(value, ["name", "limit", "after"]),
        ...(value.name === undefined ? {} : { name: templateName(value.name) }),
        ...(value.limit === undefined ? {} : { limit: pageLimit(value.limit) }),
        ...(value.after === undefined ? {} : { after: nonemptyString(value.after, "after") }),
    };
}

function fieldQuery(value: unknown, additional: readonly string[] = []): Record<string, string> {
    if (!isRecord(value)) invalidParameter("模板字段选择必须是对象");
    rejectUnknown(value, ["fields", ...additional]);
    const selected =
        value.fields === undefined
            ? [...WHATSAPP_MESSAGE_TEMPLATE_FIELDS]
            : templateFields(value.fields);
    return { fields: selected.join(",") };
}

function templateFields(value: unknown): WhatsAppMessageTemplateField[] {
    if (!Array.isArray(value)) invalidParameter("fields 必须是可增减的字段数组");
    if (!value.length) invalidParameter("模板 fields 不能为空");
    return [...new Set(value.map(templateField))];
}

function templateField(value: unknown): WhatsAppMessageTemplateField {
    if (!isWhatsAppMessageTemplateField(value)) invalidParameter(`未知模板字段: ${String(value)}`);
    return value;
}

function createRequest(value: unknown): WhatsAppMessageTemplateCreate {
    if (!isRecord(value)) invalidParameter("template 必须是对象");
    rejectUnknown(value, [
        "name",
        "language",
        "category",
        "components",
        "allow_category_change",
        "parameter_format",
    ]);
    return {
        name: templateName(value.name),
        language: templateLanguage(value.language),
        category: templateCategory(value.category),
        components: normalizeTemplateComponents(value.components),
        ...(value.allow_category_change === undefined
            ? {}
            : {
                  allow_category_change: booleanValue(
                      value.allow_category_change,
                      "allow_category_change",
                  ),
              }),
        ...(value.parameter_format === undefined
            ? {}
            : { parameter_format: parameterFormat(value.parameter_format) }),
    };
}

function updateRequest(value: unknown): WhatsAppMessageTemplateUpdate {
    if (!isRecord(value)) invalidParameter("template 必须是对象");
    rejectUnknown(value, ["name", "language", "category", "components"]);
    if (!Object.keys(value).length) invalidParameter("模板更新至少需要一个字段");
    return {
        ...(value.name === undefined ? {} : { name: templateName(value.name) }),
        ...(value.language === undefined ? {} : { language: templateLanguage(value.language) }),
        ...(value.category === undefined ? {} : { category: templateCategory(value.category) }),
        ...(value.components === undefined
            ? {}
            : { components: normalizeTemplateComponents(value.components) }),
    };
}

function projectedListResponse(value: unknown): WhatsAppMessageTemplateListResponse {
    if (!isRecord(value) || !Array.isArray(value.data)) invalidResponse(value);
    return {
        data: value.data.map(templateDetails),
        ...(value.paging === undefined ? {} : { paging: paging(value.paging, value) }),
    };
}

function fullListResponse(value: unknown): WhatsAppMessageTemplateListFullResponse {
    if (!isRecord(value) || !Array.isArray(value.data)) invalidResponse(value);
    return {
        data: value.data.map(completeTemplate),
        ...(value.paging === undefined ? {} : { paging: paging(value.paging, value) }),
    };
}

function templateDetails(value: unknown): WhatsAppMessageTemplateDetails {
    if (!isRecord(value)) invalidResponse(value);
    const known = [
        "id",
        "name",
        "status",
        "category",
        "language",
        "components",
        "previous_category",
    ];
    if (!known.some(name => value[name] !== undefined)) invalidResponse(value);
    return {
        ...(value.id === undefined ? {} : { id: responseString(value.id, value) }),
        ...(value.name === undefined ? {} : { name: responseTemplateName(value.name, value) }),
        ...(value.status === undefined ? {} : { status: responseStatus(value.status, value) }),
        ...(value.category === undefined
            ? {}
            : { category: responseCategory(value.category, value) }),
        ...(value.language === undefined
            ? {}
            : { language: responseLanguage(value.language, value) }),
        ...(value.components === undefined
            ? {}
            : { components: responseComponents(value.components, value) }),
        ...(value.previous_category === undefined
            ? {}
            : { previous_category: responseString(value.previous_category, value) }),
    };
}

function completeTemplate(value: unknown): WhatsAppMessageTemplate {
    const template = templateDetails(value);
    if (
        !template.id ||
        !template.name ||
        !template.status ||
        !template.category ||
        !template.language ||
        !template.components
    ) {
        invalidResponse(value);
    }
    return {
        ...template,
        id: template.id,
        name: template.name,
        status: template.status,
        category: template.category,
        language: template.language,
        components: template.components,
    };
}

function createResponse(value: unknown): WhatsAppMessageTemplateCreateResponse {
    if (!isRecord(value)) invalidResponse(value);
    return {
        id: responseString(value.id, value),
        status: responseStatus(value.status, value),
        category: responseCategory(value.category, value),
    };
}

function namespaceResponse(value: unknown): WhatsAppMessageTemplateNamespaceResponse {
    if (!isRecord(value)) invalidResponse(value);
    return {
        id: responseString(value.id, value),
        message_template_namespace: responseString(value.message_template_namespace, value),
    };
}

function successResponse(value: unknown): WhatsAppMessageTemplateSuccessResponse {
    if (!isRecord(value) || value.success !== true) invalidResponse(value);
    return { success: true };
}

function paging(value: unknown, root: unknown): WhatsAppMessageTemplatePaging {
    if (!isRecord(value)) invalidResponse(root);
    return {
        ...(value.cursors === undefined ? {} : { cursors: cursors(value.cursors, root) }),
        ...(value.previous === undefined ? {} : { previous: responseUrl(value.previous, root) }),
        ...(value.next === undefined ? {} : { next: responseUrl(value.next, root) }),
    };
}

function cursors(value: unknown, root: unknown): WhatsAppMessageTemplatePaging["cursors"] {
    if (!isRecord(value)) invalidResponse(root);
    return {
        ...(value.before === undefined ? {} : { before: responseString(value.before, root) }),
        ...(value.after === undefined ? {} : { after: responseString(value.after, root) }),
    };
}

function responseComponents(value: unknown, root: unknown): WhatsAppMessageTemplateComponent[] {
    return parseTemplateComponents(value, root);
}

function templateName(value: unknown): string {
    const name = nonemptyString(value, "name");
    if (name.length > 512 || !/^[a-z\d_]+$/u.test(name)) {
        invalidParameter("name 只能包含小写字母、数字和下划线，且不能超过 512 字符");
    }
    return name;
}

function templateLanguage(value: unknown): string {
    const language = nonemptyString(value, "language");
    if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/u.test(language))
        invalidParameter("language 必须是 Meta locale");
    return language;
}

function graphId(value: unknown, name: string): string {
    const id = nonemptyString(value, name);
    if (!/^[A-Za-z\d._:-]+$/u.test(id)) invalidParameter(`${name} 必须是单段 Graph 资源 ID`);
    return id;
}

function pageLimit(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
        invalidParameter("limit 必须是正整数");
    }
    return value;
}

function templateCategory(value: unknown): WhatsAppMessageTemplateCategory {
    if (!isWhatsAppMessageTemplateCategory(value))
        invalidParameter(`未知模板 category: ${String(value)}`);
    return value;
}

function parameterFormat(value: unknown): WhatsAppMessageTemplateParameterFormat {
    if (!isWhatsAppMessageTemplateParameterFormat(value)) {
        invalidParameter(`未知 parameter_format: ${String(value)}`);
    }
    return value;
}

function responseTemplateName(value: unknown, root: unknown): string {
    if (typeof value !== "string" || !value || value.length > 512 || !/^[a-z\d_]+$/u.test(value)) {
        invalidResponse(root);
    }
    return value;
}

function responseLanguage(value: unknown, root: unknown): string {
    if (typeof value !== "string" || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/u.test(value))
        invalidResponse(root);
    return value;
}

function responseStatus(value: unknown, root: unknown): WhatsAppMessageTemplateStatus {
    if (!isWhatsAppMessageTemplateStatus(value)) invalidResponse(root);
    return value;
}

function responseCategory(value: unknown, root: unknown): WhatsAppMessageTemplateCategory {
    if (!isWhatsAppMessageTemplateCategory(value)) invalidResponse(root);
    return value;
}

function responseString(value: unknown, root: unknown): string {
    if (typeof value !== "string" || !value) invalidResponse(root);
    return value;
}

function responseUrl(value: unknown, root: unknown): string {
    const text = responseString(value, root);
    if (!URL.canParse(text)) invalidResponse(root);
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") invalidResponse(root);
    return text;
}

function booleanValue(value: unknown, name: string): boolean {
    if (typeof value !== "boolean") invalidParameter(`${name} 必须是布尔值`);
    return value;
}

function nonemptyString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) invalidParameter(`${name} 必须是非空字符串`);
    return value;
}

function rejectUnknown(source: Record<string, unknown>, allowed: readonly string[]): void {
    const unknown = Object.keys(source).find(name => !allowed.includes(name));
    if (unknown) invalidParameter(`模板参数包含未知字段: ${unknown}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(details: unknown): never {
    throw new WhatsAppApiError("WhatsApp 消息模板响应不符合官方结构", {
        code: "WHATSAPP_INVALID_RESPONSE",
        details,
    });
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
