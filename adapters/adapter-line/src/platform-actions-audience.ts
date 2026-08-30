import type { manageAudience } from "@line/bot-sdk";
import {
    addAudienceRequest,
    audienceFile,
    audienceFileDescription,
    audienceId,
    audienceListQuery,
    audienceUploadDescription,
    createAudienceRequest,
    createClickAudienceRequest,
    createImpressionAudienceRequest,
    updateAudienceDescriptionRequest,
} from "./audience-params.js";
import { exactParams, optionalBoolean, requirePositiveInteger } from "./platform-action-params.js";
import type {
    LineActionContext,
    LineActionHandler,
    LineActionParams,
} from "./platform-action-context.js";

/** Audience 创建、扩充、共享查询与生命周期动作。 */
export const LINE_AUDIENCE_ACTIONS = {
    add_audience: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.addAudienceToAudienceGroup(addAudienceRequest(params)),
    create_audience: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.createAudienceGroup(createAudienceRequest(params)),
    create_click_audience: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.createClickBasedAudienceGroup(createClickAudienceRequest(params)),
    create_impression_audience: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.createImpBasedAudienceGroup(createImpressionAudienceRequest(params)),
    create_upload_audience: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.createAudienceForUploadingUserIds(
            audienceFile(params, "create"),
            audienceFileDescription(params),
            optionalBoolean(params, "is_ifa_audience"),
            audienceUploadDescription(params),
        ),
    add_user_ids_to_audience: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.addUserIdsToAudience(
            audienceFile(params, "append"),
            audienceId(params),
            audienceUploadDescription(params),
        ),
    get_audience: async ({ client }: LineActionContext, params: LineActionParams) => {
        exactParams(params, ["audience_group_id"]);
        return client.getAudienceData(audienceId(params));
    },
    list_audiences: listAudiences,
    get_shared_audience: async ({ client }: LineActionContext, params: LineActionParams) => {
        exactParams(params, ["audience_group_id"]);
        return client.getSharedAudienceData(audienceId(params));
    },
    list_shared_audiences: listSharedAudiences,
    update_audience_description: async ({ client }: LineActionContext, params: LineActionParams) =>
        client.updateAudienceGroupDescription(
            audienceId(params),
            updateAudienceDescriptionRequest(params),
        ),
    delete_audience: async ({ client }: LineActionContext, params: LineActionParams) => {
        exactParams(params, ["audience_group_id"]);
        return client.deleteAudienceGroup(requirePositiveInteger(params, "audience_group_id"));
    },
} satisfies Readonly<Record<string, LineActionHandler>>;

async function listAudiences(
    { client }: LineActionContext,
    params: LineActionParams,
): Promise<unknown> {
    const query = audienceListQuery(params, false);
    return client.getAudienceGroups(
        query.page,
        query.description,
        query.status,
        query.size,
        query.includeExternal,
        sdkCreateRoute(query.createRoute),
    );
}

async function listSharedAudiences(
    { client }: LineActionContext,
    params: LineActionParams,
): Promise<unknown> {
    const query = audienceListQuery(params, true);
    return client.getSharedAudienceGroups(
        query.page,
        query.description,
        query.status,
        query.size,
        sdkCreateRoute(query.createRoute),
        query.includeOwned,
    );
}

/** 官方 API 已新增来源枚举，但 SDK 11.2.0 的生成联合类型尚未同步。 */
function sdkCreateRoute(
    value: string | undefined,
): manageAudience.AudienceGroupCreateRoute | undefined {
    return value as manageAudience.AudienceGroupCreateRoute | undefined;
}
