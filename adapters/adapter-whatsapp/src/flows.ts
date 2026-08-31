import type { PlatformActionHandler } from "onebots";
import { defineWhatsAppActionHandlers } from "./action-contract.js";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";
import {
    WHATSAPP_FLOW_FIELDS,
    isWhatsAppFlowCategory,
    isWhatsAppFlowField,
    isWhatsAppFlowMetricGranularity,
    isWhatsAppFlowMetricName,
    type WhatsAppFlowAssetListResponse,
    type WhatsAppFlowCategory,
    type WhatsAppFlowCreate,
    type WhatsAppFlowCreateResponse,
    type WhatsAppFlowDetails,
    type WhatsAppFlowField,
    type WhatsAppFlowJson,
    type WhatsAppFlowJsonUploadResponse,
    type WhatsAppFlowListResponse,
    type WhatsAppFlowMetricQuery,
    type WhatsAppFlowMetricResponse,
    type WhatsAppFlowMigrationRequest,
    type WhatsAppFlowMigrationResponse,
    type WhatsAppFlowPreview,
    type WhatsAppFlowSuccessResponse,
    type WhatsAppFlowUpdate,
} from "./flow-types.js";
import {
    parseFlowAssets,
    parseFlowCreate,
    parseFlowDetails,
    parseFlowJsonUpload,
    parseFlowList,
    parseFlowMetric,
    parseFlowMigration,
    normalizeFlowJson,
    parseFlowPreviewResponse,
    parseFlowSuccess,
    serializeFlowJson,
} from "./flow-validation.js";

/** WhatsApp Flows 的元数据、JSON 资产、生命周期、迁移、预览与 endpoint metrics。 */
export class WhatsAppFlows {
    constructor(private readonly client: WhatsAppClient) {}

    async list(): Promise<WhatsAppFlowListResponse> {
        return parseFlowList(
            await this.client.call<unknown>({
                resource: `${this.client.config.business_account_id}/flows`,
            }),
        );
    }

    async create(flow: WhatsAppFlowCreate): Promise<WhatsAppFlowCreateResponse> {
        return parseFlowCreate(
            await this.client.call<unknown>({
                method: "POST",
                resource: `${this.client.config.business_account_id}/flows`,
                body: flowMetadataForm(flow, true),
            }),
        );
    }

    async migrate(request: WhatsAppFlowMigrationRequest): Promise<WhatsAppFlowMigrationResponse> {
        const form = new FormData();
        form.set("source_waba_id", graphId(request.source_waba_id, "source_waba_id"));
        if (request.source_flow_names !== undefined) {
            form.set("source_flow_names", JSON.stringify(flowNames(request.source_flow_names)));
        }
        return parseFlowMigration(
            await this.client.call<unknown>({
                method: "POST",
                resource: `${this.client.config.business_account_id}/migrate_flows`,
                body: form,
            }),
        );
    }

    async get(
        flowId: string,
        fields: readonly WhatsAppFlowField[] = WHATSAPP_FLOW_FIELDS,
    ): Promise<WhatsAppFlowDetails> {
        return parseFlowDetails(
            await this.client.call<unknown>({
                resource: graphId(flowId, "flow_id"),
                query: { fields: flowFields(fields).join(",") },
            }),
        );
    }

    async getPreview(
        flowId: string,
        invalidate = false,
    ): Promise<{ id: string; preview: WhatsAppFlowPreview }> {
        return parseFlowPreviewResponse(
            await this.client.call<unknown>({
                resource: graphId(flowId, "flow_id"),
                query: {
                    fields: `preview.invalidate(${String(booleanValue(invalidate, "invalidate"))})`,
                    date_format: "U",
                },
            }),
        );
    }

    async getMetric(
        flowId: string,
        query: WhatsAppFlowMetricQuery,
    ): Promise<WhatsAppFlowMetricResponse> {
        return parseFlowMetric(
            await this.client.call<unknown>({
                resource: graphId(flowId, "flow_id"),
                query: { fields: metricField(query) },
            }),
        );
    }

    async update(flowId: string, update: WhatsAppFlowUpdate): Promise<WhatsAppFlowSuccessResponse> {
        return parseFlowSuccess(
            await this.client.call<unknown>({
                method: "POST",
                resource: graphId(flowId, "flow_id"),
                body: flowMetadataForm(update, false),
            }),
        );
    }

    async updateJson(
        flowId: string,
        document: Blob | WhatsAppFlowJson,
    ): Promise<WhatsAppFlowJsonUploadResponse> {
        const form = new FormData();
        const file = document instanceof Blob ? document : new Blob([serializeFlowJson(document)]);
        form.set("file", file, "flow.json");
        form.set("name", "flow.json");
        form.set("asset_type", "FLOW_JSON");
        return parseFlowJsonUpload(
            await this.client.call<unknown>({
                method: "POST",
                resource: `${graphId(flowId, "flow_id")}/assets`,
                body: form,
            }),
        );
    }

    async listAssets(flowId: string): Promise<WhatsAppFlowAssetListResponse> {
        return parseFlowAssets(
            await this.client.call<unknown>({
                resource: `${graphId(flowId, "flow_id")}/assets`,
            }),
        );
    }

    delete(flowId: string): Promise<WhatsAppFlowSuccessResponse> {
        return this.transition(flowId, "delete");
    }

    publish(flowId: string): Promise<WhatsAppFlowSuccessResponse> {
        return this.transition(flowId, "publish");
    }

    deprecate(flowId: string): Promise<WhatsAppFlowSuccessResponse> {
        return this.transition(flowId, "deprecate");
    }

    private async transition(
        flowId: string,
        action: "delete" | "publish" | "deprecate",
    ): Promise<WhatsAppFlowSuccessResponse> {
        const id = graphId(flowId, "flow_id");
        return parseFlowSuccess(
            await this.client.call<unknown>({
                method: action === "delete" ? "DELETE" : "POST",
                resource: action === "delete" ? id : `${id}/${action}`,
            }),
        );
    }
}

type FlowActionParams = Readonly<Record<string, unknown>>;

const FLOW_ACTION_HANDLERS = {
    list_flows: (client: WhatsAppClient) => client.flows.list(),
    create_flow: (client: WhatsAppClient, params: FlowActionParams) =>
        client.flows.create(createInput(params.flow)),
    migrate_flows: (client: WhatsAppClient, params: FlowActionParams) =>
        client.flows.migrate(migrationInput(params)),
    get_flow: (client: WhatsAppClient, params: FlowActionParams) =>
        client.flows.get(graphId(params.flow_id, "flow_id"), actionFields(params.fields)),
    get_flow_preview: (client: WhatsAppClient, params: FlowActionParams) =>
        client.flows.getPreview(
            graphId(params.flow_id, "flow_id"),
            params.invalidate === undefined ? false : booleanValue(params.invalidate, "invalidate"),
        ),
    get_flow_metric: (client: WhatsAppClient, params: FlowActionParams) =>
        client.flows.getMetric(graphId(params.flow_id, "flow_id"), metricInput(params.metric)),
    update_flow: (client: WhatsAppClient, params: FlowActionParams) =>
        client.flows.update(graphId(params.flow_id, "flow_id"), updateInput(params.flow)),
    update_flow_json: (client: WhatsAppClient, params: FlowActionParams) =>
        client.flows.updateJson(
            graphId(params.flow_id, "flow_id"),
            flowJsonInput(params.flow_json),
        ),
    list_flow_assets: (client: WhatsAppClient, params: FlowActionParams) =>
        client.flows.listAssets(graphId(params.flow_id, "flow_id")),
    delete_flow: (client: WhatsAppClient, params: FlowActionParams) =>
        client.flows.delete(graphId(params.flow_id, "flow_id")),
    publish_flow: (client: WhatsAppClient, params: FlowActionParams) =>
        client.flows.publish(graphId(params.flow_id, "flow_id")),
    deprecate_flow: (client: WhatsAppClient, params: FlowActionParams) =>
        client.flows.deprecate(graphId(params.flow_id, "flow_id")),
} satisfies Readonly<Record<string, PlatformActionHandler<WhatsAppClient>>>;

/** Flow 动作的执行与参数契约单一来源。 */
export const WHATSAPP_FLOW_ACTION_HANDLERS = defineWhatsAppActionHandlers(FLOW_ACTION_HANDLERS, {
    list_flows: [],
    create_flow: ["flow"],
    migrate_flows: ["source_waba_id", "source_flow_names"],
    get_flow: ["flow_id", "fields"],
    get_flow_preview: ["flow_id", "invalidate"],
    get_flow_metric: ["flow_id", "metric"],
    update_flow: ["flow_id", "flow"],
    update_flow_json: ["flow_id", "flow_json"],
    list_flow_assets: ["flow_id"],
    delete_flow: ["flow_id"],
    publish_flow: ["flow_id"],
    deprecate_flow: ["flow_id"],
});

export type WhatsAppFlowAction = keyof typeof WHATSAPP_FLOW_ACTION_HANDLERS;

export function isWhatsAppFlowAction(action: string): action is WhatsAppFlowAction {
    return Object.hasOwn(WHATSAPP_FLOW_ACTION_HANDLERS, action);
}

function flowMetadataForm(
    value: WhatsAppFlowCreate | WhatsAppFlowUpdate,
    create: boolean,
): FormData {
    const source = create ? createInput(value) : updateInput(value);
    const form = new FormData();
    if (source.name !== undefined) form.set("name", source.name);
    if (source.categories !== undefined) form.set("categories", JSON.stringify(source.categories));
    if (source.endpoint_uri !== undefined) form.set("endpoint_uri", source.endpoint_uri);
    if ("clone_flow_id" in source && typeof source.clone_flow_id === "string")
        form.set("clone_flow_id", source.clone_flow_id);
    return form;
}

function createInput(value: unknown): WhatsAppFlowCreate {
    const source = inputRecord(value, "flow");
    rejectUnknown(source, ["name", "categories", "clone_flow_id", "endpoint_uri"]);
    return {
        name: nonemptyString(source.name, "flow.name"),
        categories: categories(source.categories),
        ...(source.clone_flow_id === undefined
            ? {}
            : { clone_flow_id: graphId(source.clone_flow_id, "clone_flow_id") }),
        ...(source.endpoint_uri === undefined
            ? {}
            : { endpoint_uri: httpsUrl(source.endpoint_uri, "endpoint_uri") }),
    };
}

function updateInput(value: unknown): WhatsAppFlowUpdate {
    const source = inputRecord(value, "flow");
    rejectUnknown(source, ["name", "categories", "endpoint_uri"]);
    if (!Object.keys(source).length) invalidParameter("Flow 更新至少需要一个字段");
    return {
        ...(source.name === undefined ? {} : { name: nonemptyString(source.name, "flow.name") }),
        ...(source.categories === undefined ? {} : { categories: categories(source.categories) }),
        ...(source.endpoint_uri === undefined
            ? {}
            : { endpoint_uri: httpsUrl(source.endpoint_uri, "endpoint_uri") }),
    };
}

function migrationInput(source: Readonly<Record<string, unknown>>): WhatsAppFlowMigrationRequest {
    return {
        source_waba_id: graphId(source.source_waba_id, "source_waba_id"),
        ...(source.source_flow_names === undefined
            ? {}
            : { source_flow_names: flowNames(source.source_flow_names) }),
    };
}

function metricInput(value: unknown): WhatsAppFlowMetricQuery {
    const source = inputRecord(value, "metric");
    rejectUnknown(source, ["name", "granularity", "since", "until"]);
    if (!isWhatsAppFlowMetricName(source.name)) invalidParameter("metric.name 非法");
    if (!isWhatsAppFlowMetricGranularity(source.granularity))
        invalidParameter("metric.granularity 非法");
    const expectedGranularity = source.name === "ENDPOINT_REQUEST_ERROR_RATE" ? "LIFETIME" : "DAY";
    if (source.granularity !== expectedGranularity) {
        invalidParameter(`${source.name} 只支持 ${expectedGranularity} granularity`);
    }
    const result: WhatsAppFlowMetricQuery = { name: source.name, granularity: source.granularity };
    if (source.since !== undefined) result.since = isoDate(source.since, "since");
    if (source.until !== undefined) result.until = isoDate(source.until, "until");
    if (result.since !== undefined && result.until !== undefined && result.since > result.until) {
        invalidParameter("metric.since 不能晚于 metric.until");
    }
    return result;
}

function metricField(query: WhatsAppFlowMetricQuery): string {
    const normalized = metricInput(query);
    return `metric.name(${normalized.name}).granularity(${normalized.granularity})${
        normalized.since === undefined ? "" : `.since(${normalized.since})`
    }${normalized.until === undefined ? "" : `.until(${normalized.until})`}`;
}

function flowJsonInput(value: unknown): WhatsAppFlowJson {
    return normalizeFlowJson(value);
}

function actionFields(value: unknown): WhatsAppFlowField[] {
    return value === undefined ? [...WHATSAPP_FLOW_FIELDS] : flowFields(value);
}

function flowFields(value: unknown): WhatsAppFlowField[] {
    if (!Array.isArray(value) || !value.length || !value.every(isWhatsAppFlowField))
        invalidParameter("fields 必须是非空官方 Flow 字段数组");
    return [...new Set(value)];
}

function categories(value: unknown): WhatsAppFlowCategory[] {
    if (!Array.isArray(value) || !value.length || !value.every(isWhatsAppFlowCategory))
        invalidParameter("categories 必须是非空官方 Flow 分类数组");
    return [...new Set(value)];
}

function flowNames(value: unknown): string[] {
    if (!Array.isArray(value) || !value.length)
        invalidParameter("source_flow_names 必须是非空数组");
    return [...new Set(value.map(name => nonemptyString(name, "source_flow_names")))];
}

function graphId(value: unknown, name: string): string {
    const id = nonemptyString(value, name);
    if (!/^[A-Za-z\d._:-]+$/u.test(id)) invalidParameter(`${name} 必须是单段 Graph 资源 ID`);
    return id;
}

function httpsUrl(value: unknown, name: string): string {
    const text = nonemptyString(value, name);
    if (!URL.canParse(text) || new URL(text).protocol !== "https:")
        invalidParameter(`${name} 必须是 HTTPS URL`);
    return text;
}

function isoDate(value: unknown, name: string): string {
    const text = nonemptyString(value, name);
    const date = new Date(`${text}T00:00:00Z`);
    if (
        !/^\d{4}-\d{2}-\d{2}$/u.test(text) ||
        Number.isNaN(date.valueOf()) ||
        date.toISOString().slice(0, 10) !== text
    )
        invalidParameter(`${name} 必须是 YYYY-MM-DD 日期`);
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

function inputRecord(value: unknown, name: string): Record<string, unknown> {
    if (!isRecord(value)) invalidParameter(`${name} 必须是对象`);
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknown(
    source: Readonly<Record<string, unknown>>,
    allowed: readonly string[],
): void {
    const unknown = Object.keys(source).find(key => !allowed.includes(key));
    if (unknown) invalidParameter(`Flow 参数包含未知字段: ${unknown}`);
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
