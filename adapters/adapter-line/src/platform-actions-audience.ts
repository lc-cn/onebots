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
import { optionalBoolean } from "./platform-action-params.js";
import {
    lineAction,
    type LineActionContext,
    type LineActionHandler,
} from "./platform-action-context.js";

/** Audience 创建、扩充、共享查询与生命周期动作。 */
export const LINE_AUDIENCE_ACTIONS = {
    add_audience: lineAction(["request"], async ({ client }, params) =>
        client.addAudienceToAudienceGroup(addAudienceRequest(params)),
    ),
    create_audience: lineAction(["request"], async ({ client }, params) =>
        client.createAudienceGroup(createAudienceRequest(params)),
    ),
    create_click_audience: lineAction(["request"], async ({ client }, params) =>
        client.createClickBasedAudienceGroup(createClickAudienceRequest(params)),
    ),
    create_impression_audience: lineAction(["request"], async ({ client }, params) =>
        client.createImpBasedAudienceGroup(createImpressionAudienceRequest(params)),
    ),
    create_upload_audience: lineAction(
        ["data_base64", "description", "is_ifa_audience", "upload_description"],
        async ({ client }, params) =>
            client.createAudienceForUploadingUserIds(
                audienceFile(params, "create"),
                audienceFileDescription(params),
                optionalBoolean(params, "is_ifa_audience"),
                audienceUploadDescription(params),
            ),
    ),
    add_user_ids_to_audience: lineAction(
        ["data_base64", "audience_group_id", "upload_description"],
        async ({ client }, params) =>
            client.addUserIdsToAudience(
                audienceFile(params, "append"),
                audienceId(params),
                audienceUploadDescription(params),
            ),
    ),
    get_audience: lineAction(["audience_group_id"], async ({ client }, params) =>
        client.getAudienceData(audienceId(params)),
    ),
    list_audiences: lineAction(
        [
            "page",
            "description",
            "status",
            "size",
            "create_route",
            "includes_external_public_groups",
        ],
        listAudiences,
    ),
    get_shared_audience: lineAction(["audience_group_id"], async ({ client }, params) =>
        client.getSharedAudienceData(audienceId(params)),
    ),
    list_shared_audiences: lineAction(
        ["page", "description", "status", "size", "create_route", "includes_owned_audience_groups"],
        listSharedAudiences,
    ),
    update_audience_description: lineAction(
        ["audience_group_id", "request"],
        async ({ client }, params) =>
            client.updateAudienceGroupDescription(
                audienceId(params),
                updateAudienceDescriptionRequest(params),
            ),
    ),
    delete_audience: lineAction(["audience_group_id"], async ({ client }, params) =>
        client.deleteAudienceGroup(audienceId(params)),
    ),
} satisfies Readonly<Record<string, LineActionHandler>>;

async function listAudiences(
    { client }: LineActionContext,
    params: Readonly<Record<string, unknown>>,
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
    params: Readonly<Record<string, unknown>>,
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
