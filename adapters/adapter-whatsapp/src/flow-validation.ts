import { WhatsAppApiError } from "./errors.js";
import {
    isWhatsAppFlowCategory,
    isWhatsAppFlowMetricGranularity,
    isWhatsAppFlowMetricName,
    isWhatsAppFlowStatus,
    type WhatsAppFlowAssetListResponse,
    type WhatsAppFlowCategory,
    type WhatsAppFlowCreateResponse,
    type WhatsAppFlowDetails,
    type WhatsAppFlowJson,
    type WhatsAppFlowJsonUploadResponse,
    type WhatsAppFlowListResponse,
    type WhatsAppFlowMetricResponse,
    type WhatsAppFlowMigrationResponse,
    type WhatsAppFlowPaging,
    type WhatsAppFlowPreview,
    type WhatsAppFlowSuccessResponse,
    type WhatsAppFlowSummary,
    type WhatsAppFlowValidationError,
} from "./flow-types.js";

export function parseFlowList(value: unknown): WhatsAppFlowListResponse {
    const root = recordResponse(value);
    if (!Array.isArray(root.data)) invalidResponse(value);
    return {
        data: root.data.map(parseFlowSummary),
        ...(root.paging === undefined ? {} : { paging: parsePaging(root.paging, value) }),
    };
}

export function parseFlowDetails(value: unknown): WhatsAppFlowDetails {
    const source = recordResponse(value);
    const details: WhatsAppFlowDetails = {};
    if (source.id !== undefined) details.id = responseString(source.id, value);
    if (source.name !== undefined) details.name = responseString(source.name, value);
    if (source.categories !== undefined)
        details.categories = responseCategories(source.categories, value);
    if (source.status !== undefined) details.status = responseStatus(source.status, value);
    if (source.validation_errors !== undefined)
        details.validation_errors = responseValidationErrors(source.validation_errors, value);
    if (source.json_version !== undefined)
        details.json_version = responseString(source.json_version, value);
    if (source.data_api_version !== undefined)
        details.data_api_version = responseString(source.data_api_version, value);
    if (source.data_channel_uri !== undefined)
        details.data_channel_uri = responseUrl(source.data_channel_uri, value);
    if (source.preview !== undefined) details.preview = parsePreview(source.preview, value);
    if (source.health_status !== undefined)
        details.health_status = parseHealthStatus(source.health_status, value);
    if (source.whatsapp_business_account !== undefined)
        details.whatsapp_business_account = graphNode(source.whatsapp_business_account, value);
    if (source.application !== undefined)
        details.application = graphNode(source.application, value);
    if (!Object.keys(details).length) invalidResponse(value);
    return details;
}

export function parseFlowPreviewResponse(value: unknown): {
    id: string;
    preview: WhatsAppFlowPreview;
} {
    const source = recordResponse(value);
    return {
        id: responseString(source.id, value),
        preview: parsePreview(source.preview, value),
    };
}

export function parseFlowCreate(value: unknown): WhatsAppFlowCreateResponse {
    return { id: responseString(recordResponse(value).id, value) };
}

export function parseFlowSuccess(value: unknown): WhatsAppFlowSuccessResponse {
    if (recordResponse(value).success !== true) invalidResponse(value);
    return { success: true };
}

export function parseFlowMigration(value: unknown): WhatsAppFlowMigrationResponse {
    const source = recordResponse(value);
    if (!Array.isArray(source.migrated_flows) || !Array.isArray(source.failed_flows)) {
        invalidResponse(value);
    }
    return {
        migrated_flows: source.migrated_flows.map(item => {
            const entry = recordResponse(item, value);
            return {
                source_id: responseString(entry.source_id, value),
                source_name: responseString(entry.source_name, value),
                migrated_id: responseString(entry.migrated_id, value),
            };
        }),
        failed_flows: source.failed_flows.map(item => {
            const entry = recordResponse(item, value);
            return {
                source_name: responseString(entry.source_name, value),
                error_code: responseString(entry.error_code, value),
                error_message: responseString(entry.error_message, value),
            };
        }),
    };
}

export function parseFlowAssets(value: unknown): WhatsAppFlowAssetListResponse {
    const source = recordResponse(value);
    if (!Array.isArray(source.data)) invalidResponse(value);
    return {
        data: source.data.map(item => {
            const asset = recordResponse(item, value);
            if (asset.asset_type !== "FLOW_JSON") invalidResponse(value);
            return {
                name: responseString(asset.name, value),
                asset_type: "FLOW_JSON",
                download_url: responseUrl(asset.download_url, value),
            };
        }),
        ...(source.paging === undefined ? {} : { paging: parsePaging(source.paging, value) }),
    };
}

export function parseFlowJsonUpload(value: unknown): WhatsAppFlowJsonUploadResponse {
    const source = recordResponse(value);
    if (source.success !== true) invalidResponse(value);
    return {
        success: true,
        validation_errors: responseValidationErrors(source.validation_errors, value),
    };
}

export function parseFlowMetric(value: unknown): WhatsAppFlowMetricResponse {
    const source = recordResponse(value);
    const metric = recordResponse(source.metric, value);
    if (
        !isWhatsAppFlowMetricName(metric.name) ||
        !isWhatsAppFlowMetricGranularity(metric.granularity)
    ) {
        invalidResponse(value);
    }
    const expectedGranularity = metric.name === "ENDPOINT_REQUEST_ERROR_RATE" ? "LIFETIME" : "DAY";
    if (metric.granularity !== expectedGranularity) invalidResponse(value);
    if (!Array.isArray(metric.data_points)) invalidResponse(value);
    return {
        id: responseString(source.id, value),
        metric: {
            name: metric.name,
            granularity: metric.granularity,
            data_points: metric.data_points.map(point => {
                const entry = recordResponse(point, value);
                if (!Array.isArray(entry.data)) invalidResponse(value);
                return {
                    timestamp: responseString(entry.timestamp, value),
                    data: entry.data.map(datum => {
                        const item = recordResponse(datum, value);
                        if (typeof item.value !== "number" || !Number.isFinite(item.value)) {
                            invalidResponse(value);
                        }
                        return { key: responseString(item.key, value), value: item.value };
                    }),
                };
            }),
        },
    };
}

export function serializeFlowJson(value: unknown): string {
    return JSON.stringify(normalizeFlowJson(value));
}

export function normalizeFlowJson(value: unknown): WhatsAppFlowJson {
    if (typeof value === "string") {
        try {
            return normalizeJson(JSON.parse(value), new Set());
        } catch (error) {
            if (error instanceof WhatsAppApiError) throw error;
            invalidParameter("flow_json 必须是合法 JSON");
        }
    }
    return normalizeJson(value, new Set());
}

function parseFlowSummary(value: unknown): WhatsAppFlowSummary {
    const source = recordResponse(value);
    return {
        id: responseString(source.id, value),
        name: responseString(source.name, value),
        categories: responseCategories(source.categories, value),
        status: responseStatus(source.status, value),
        validation_errors: responseValidationErrors(source.validation_errors, value),
    };
}

function responseValidationErrors(value: unknown, root: unknown): WhatsAppFlowValidationError[] {
    if (!Array.isArray(value)) invalidResponse(root);
    return value.map(item => {
        const error = recordResponse(item, root);
        return {
            error: responseString(error.error, root),
            error_type: responseString(error.error_type, root),
            message: responseString(error.message, root),
            line_start: responseInteger(error.line_start, root),
            line_end: responseInteger(error.line_end, root),
            column_start: responseInteger(error.column_start, root),
            column_end: responseInteger(error.column_end, root),
        };
    });
}

function parsePreview(value: unknown, root: unknown): WhatsAppFlowPreview {
    const preview = recordResponse(value, root);
    const expires = preview.expires_at;
    if (
        (typeof expires !== "string" || !expires) &&
        (typeof expires !== "number" || !Number.isFinite(expires))
    ) {
        invalidResponse(root);
    }
    return {
        preview_url: responseUrl(preview.preview_url, root),
        expires_at: expires,
    };
}

function parseHealthStatus(value: unknown, root: unknown): WhatsAppFlowDetails["health_status"] {
    const health = recordResponse(value, root);
    if (!Array.isArray(health.entities)) invalidResponse(root);
    return {
        can_send_message: responseString(health.can_send_message, root),
        entities: health.entities.map(item => {
            const entity = recordResponse(item, root);
            return {
                entity_type: responseString(entity.entity_type, root),
                id: responseString(entity.id, root),
                can_send_message: responseString(entity.can_send_message, root),
                ...(entity.errors === undefined
                    ? {}
                    : {
                          errors: responseHealthErrors(entity.errors, root),
                      }),
            };
        }),
    };
}

function responseHealthErrors(value: unknown, root: unknown) {
    if (!Array.isArray(value)) invalidResponse(root);
    return value.map(item => {
        const error = recordResponse(item, root);
        return {
            error_code: responseInteger(error.error_code, root),
            error_description: responseString(error.error_description, root),
            possible_solution: responseString(error.possible_solution, root),
        };
    });
}

function graphNode(value: unknown, root: unknown) {
    const source = recordResponse(value, root);
    return { ...source, id: responseString(source.id, root) };
}

function parsePaging(value: unknown, root: unknown): WhatsAppFlowPaging {
    const source = recordResponse(value, root);
    const result: WhatsAppFlowPaging = {};
    if (source.cursors !== undefined) {
        const cursors = recordResponse(source.cursors, root);
        result.cursors = {
            ...(cursors.before === undefined
                ? {}
                : { before: responseString(cursors.before, root) }),
            ...(cursors.after === undefined ? {} : { after: responseString(cursors.after, root) }),
        };
    }
    if (source.previous !== undefined) result.previous = responseUrl(source.previous, root);
    if (source.next !== undefined) result.next = responseUrl(source.next, root);
    return result;
}

function responseCategories(value: unknown, root: unknown): WhatsAppFlowCategory[] {
    if (!Array.isArray(value) || !value.length || !value.every(isWhatsAppFlowCategory)) {
        invalidResponse(root);
    }
    return [...new Set(value)];
}

function responseStatus(value: unknown, root: unknown) {
    if (!isWhatsAppFlowStatus(value)) invalidResponse(root);
    return value;
}

function normalizeJson(value: unknown, stack: Set<object>): WhatsAppFlowJson {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object") invalidParameter("flow_json 只能包含 JSON 值");
    if (stack.has(value)) invalidParameter("flow_json 不能包含循环引用");
    stack.add(value);
    if (Array.isArray(value)) {
        const result = value.map(item => normalizeJson(item, stack));
        stack.delete(value);
        return result;
    }
    if (!isRecord(value)) invalidParameter("flow_json 对象必须使用普通原型");
    const source = value;
    const prototype = Object.getPrototypeOf(source);
    if (prototype !== Object.prototype && prototype !== null)
        invalidParameter("flow_json 对象必须使用普通原型");
    const result: Record<string, WhatsAppFlowJson> = {};
    for (const [key, item] of Object.entries(source)) {
        if (["__proto__", "constructor", "prototype"].includes(key))
            invalidParameter(`flow_json 包含不安全字段: ${key}`);
        result[key] = normalizeJson(item, stack);
    }
    stack.delete(value);
    return result;
}

function recordResponse(value: unknown, root: unknown = value): Record<string, unknown> {
    if (!isRecord(value)) invalidResponse(root);
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseString(value: unknown, root: unknown): string {
    if (typeof value !== "string" || !value) invalidResponse(root);
    return value;
}

function responseInteger(value: unknown, root: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
        invalidResponse(root);
    return value;
}

function responseUrl(value: unknown, root: unknown): string {
    const url = responseString(value, root);
    if (!URL.canParse(url) || !["https:", "http:"].includes(new URL(url).protocol))
        invalidResponse(root);
    return url;
}

function invalidResponse(details: unknown): never {
    throw new WhatsAppApiError("WhatsApp Flow 响应不符合官方结构", {
        code: "WHATSAPP_INVALID_RESPONSE",
        details,
    });
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
