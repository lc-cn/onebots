import type { manageAudience } from "@line/bot-sdk";
import {
    base64Blob,
    exactParams,
    invalidParams,
    optionalBoolean,
    optionalBoundedString,
    optionalIntegerInRange,
    optionalString,
    requireBoundedString,
    requirePositiveInteger,
    requireRecord,
} from "./platform-action-params.js";
import type { LineActionParams } from "./platform-action-context.js";

const AUDIENCE_STATUSES = new Set<manageAudience.AudienceGroupStatus>([
    "IN_PROGRESS",
    "READY",
    "FAILED",
    "EXPIRED",
    "INACTIVE",
    "ACTIVATING",
]);
export type LineAudienceCreateRoute =
    | manageAudience.AudienceGroupCreateRoute
    | "BUSINESS_MANAGER"
    | "YAHOO_DISPLAY_ADS";

const CREATE_ROUTES = new Set<LineAudienceCreateRoute>([
    "OA_MANAGER",
    "MESSAGING_API",
    "POINT_AD",
    "AD_MANAGER",
    "BUSINESS_MANAGER",
    "YAHOO_DISPLAY_ADS",
]);

export function addAudienceRequest(
    params: LineActionParams,
): manageAudience.AddAudienceToAudienceGroupRequest {
    exactParams(params, ["request"]);
    const request = requireRecord(params, "request");
    exactParams(request, ["audienceGroupId", "uploadDescription", "audiences"]);
    return {
        audienceGroupId: requirePositiveInteger(request, "audienceGroupId"),
        uploadDescription: optionalBoundedString(request, "uploadDescription", 300),
        audiences: audienceIds(request),
    };
}

export function createAudienceRequest(
    params: LineActionParams,
): manageAudience.CreateAudienceGroupRequest {
    exactParams(params, ["request"]);
    const request = requireRecord(params, "request");
    exactParams(request, ["description", "isIfaAudience", "uploadDescription", "audiences"]);
    return {
        description: requireBoundedString(request, "description", 120),
        isIfaAudience: optionalBoolean(request, "isIfaAudience"),
        uploadDescription: optionalBoundedString(request, "uploadDescription", 300),
        audiences: audienceIds(request),
    };
}

export function createClickAudienceRequest(
    params: LineActionParams,
): manageAudience.CreateClickBasedAudienceGroupRequest {
    exactParams(params, ["request"]);
    const request = requireRecord(params, "request");
    exactParams(request, ["description", "requestId", "clickUrl"]);
    return {
        description: requireBoundedString(request, "description", 120),
        requestId: requireBoundedString(request, "requestId", 120),
        clickUrl: optionalBoundedString(request, "clickUrl", 2_000),
    };
}

export function createImpressionAudienceRequest(
    params: LineActionParams,
): manageAudience.CreateImpBasedAudienceGroupRequest {
    exactParams(params, ["request"]);
    const request = requireRecord(params, "request");
    exactParams(request, ["description", "requestId"]);
    return {
        description: requireBoundedString(request, "description", 120),
        requestId: requireBoundedString(request, "requestId", 120),
    };
}

export function audienceFile(params: LineActionParams, mode: "create" | "append"): Blob {
    const fields = ["data_base64", "upload_description"];
    if (mode === "create") fields.push("description", "is_ifa_audience");
    else fields.push("audience_group_id");
    exactParams(params, fields);
    return base64Blob({ data_base64: params.data_base64 }, "text/plain");
}

export function audienceFileDescription(params: LineActionParams): string {
    return requireBoundedString(params, "description", 120);
}

export function audienceUploadDescription(params: LineActionParams): string | undefined {
    return optionalBoundedString(params, "upload_description", 300);
}

export function audienceId(params: LineActionParams): number {
    return requirePositiveInteger(params, "audience_group_id");
}

export function audienceListQuery(
    params: LineActionParams,
    shared: boolean,
): {
    page: number;
    description?: string;
    status?: manageAudience.AudienceGroupStatus;
    size?: number;
    createRoute?: LineAudienceCreateRoute;
    includeExternal?: boolean;
    includeOwned?: boolean;
} {
    exactParams(
        params,
        shared
            ? [
                  "page",
                  "description",
                  "status",
                  "size",
                  "create_route",
                  "includes_owned_audience_groups",
              ]
            : [
                  "page",
                  "description",
                  "status",
                  "size",
                  "create_route",
                  "includes_external_public_groups",
              ],
    );
    return {
        page: requirePositiveInteger(params, "page"),
        description: optionalBoundedString(params, "description", 120),
        status: optionalEnum(params, "status", AUDIENCE_STATUSES),
        size: optionalIntegerInRange(params, "size", 1, 40),
        createRoute: optionalEnum(params, "create_route", CREATE_ROUTES),
        includeExternal: shared
            ? undefined
            : optionalBoolean(params, "includes_external_public_groups"),
        includeOwned: shared
            ? optionalBoolean(params, "includes_owned_audience_groups")
            : undefined,
    };
}

export function updateAudienceDescriptionRequest(
    params: LineActionParams,
): manageAudience.UpdateAudienceGroupDescriptionRequest {
    exactParams(params, ["audience_group_id", "request"]);
    const request = requireRecord(params, "request");
    exactParams(request, ["description"]);
    return { description: requireBoundedString(request, "description", 120) };
}

function audienceIds(params: Readonly<Record<string, unknown>>): manageAudience.Audience[] {
    const value = params.audiences;
    if (!Array.isArray(value) || value.length < 1 || value.length > 10_000) {
        throw invalidParams("LINE 参数 audiences 必须包含 1 到 10000 个对象");
    }
    return value.map((item, index) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            throw invalidParams(`LINE 参数 audiences[${index}] 必须是对象`);
        }
        const record = item as Record<string, unknown>;
        exactParams(record, ["id"]);
        return { id: requireBoundedString(record, "id", 255) };
    });
}

function optionalEnum<T extends string>(
    params: Readonly<Record<string, unknown>>,
    name: string,
    allowed: ReadonlySet<T>,
): T | undefined {
    const value = optionalString(params, name);
    if (value === undefined) return undefined;
    if (!allowed.has(value as T)) throw invalidParams(`LINE 参数 ${name} 的枚举值无效`);
    return value as T;
}
