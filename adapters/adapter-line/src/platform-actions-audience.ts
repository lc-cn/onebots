import type { manageAudience } from "@line/bot-sdk";
import {
    base64Blob,
    optionalBoolean,
    optionalNumber,
    optionalString,
    requireInteger,
    requireRecord,
} from "./platform-action-params.js";
import type {
    LineActionContext,
    LineActionHandler,
    LineActionParams,
} from "./platform-action-context.js";

/** Audience 创建、扩充、共享查询与生命周期动作。 */
export const LINE_AUDIENCE_ACTIONS = {
    add_audience: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.addAudienceToAudienceGroup(
            requireRecord(params, "request") as manageAudience.AddAudienceToAudienceGroupRequest,
        ),
    create_audience: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.createAudienceGroup(
            requireRecord(params, "request") as manageAudience.CreateAudienceGroupRequest,
        ),
    create_click_audience: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.createClickBasedAudienceGroup(
            requireRecord(params, "request") as manageAudience.CreateClickBasedAudienceGroupRequest,
        ),
    create_impression_audience: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.createImpBasedAudienceGroup(
            requireRecord(params, "request") as manageAudience.CreateImpBasedAudienceGroupRequest,
        ),
    create_upload_audience: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.createAudienceForUploadingUserIds(
            base64Blob(params, "text/plain"),
            optionalString(params, "description"),
            optionalBoolean(params, "is_ifa_audience"),
            optionalString(params, "upload_description"),
        ),
    add_user_ids_to_audience: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.addUserIdsToAudience(
            base64Blob(params, "text/plain"),
            optionalInteger(params, "audience_group_id"),
            optionalString(params, "upload_description"),
        ),
    get_audience: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getAudienceData(requireInteger(params, "audience_group_id")),
    list_audiences: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getAudienceGroups(
            requireInteger(params, "page"),
            optionalString(params, "description"),
            optionalString(params, "status") as manageAudience.AudienceGroupStatus | undefined,
            optionalNumber(params, "size"),
            optionalBoolean(params, "includes_external_public_groups"),
            optionalString(params, "create_route") as
                | manageAudience.AudienceGroupCreateRoute
                | undefined,
        ),
    get_shared_audience: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getSharedAudienceData(requireInteger(params, "audience_group_id")),
    list_shared_audiences: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.getSharedAudienceGroups(
            requireInteger(params, "page"),
            optionalString(params, "description"),
            optionalString(params, "status") as manageAudience.AudienceGroupStatus | undefined,
            optionalNumber(params, "size"),
            optionalString(params, "create_route") as
                | manageAudience.AudienceGroupCreateRoute
                | undefined,
            optionalBoolean(params, "includes_owned_audience_groups"),
        ),
    update_audience_description: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.updateAudienceGroupDescription(
            requireInteger(params, "audience_group_id"),
            requireRecord(
                params,
                "request",
            ) as manageAudience.UpdateAudienceGroupDescriptionRequest,
        ),
    delete_audience: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.deleteAudienceGroup(requireInteger(params, "audience_group_id")),
} satisfies Readonly<Record<string, LineActionHandler>>;

function optionalInteger(params: LineActionParams, name: string): number | undefined {
    return params[name] === undefined ? undefined : requireInteger(params, name);
}
