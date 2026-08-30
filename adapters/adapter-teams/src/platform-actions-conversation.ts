import { Activity, ActivityTypes } from "@microsoft/agents-activity";
import type { PlatformActionHandler } from "onebots";
import { compileTeamsActivity } from "./activity.js";
import type { TeamsBot } from "./bot.js";
import {
    activityValue,
    conversationId,
    conversationReferenceValue,
    fileInfoActivity,
    messageValue,
    objectValue,
    optionalNumber,
    optionalString,
    requireHttpsUrl,
    requireNumber,
    requireString,
    teamsCard,
    withConversation,
    type TeamsActionParams,
} from "./platform-action-params.js";

/** ConversationReference、消息、成员、Reaction、会议与文件 consent 动作。 */
export const TEAMS_CONVERSATION_ACTIONS = {
    get_conversation_reference: async (bot: TeamsBot, params: TeamsActionParams) =>
        bot.getConversationReference(requireString(params.conversation_id, "conversation_id")),
    list_conversation_references: async (bot: TeamsBot) => bot.listConversationReferences(),
    register_conversation_reference: registerConversationReference,
    create_personal_conversation: createPersonalConversation,
    send_adaptive_card: sendAdaptiveCard,
    send_targeted_message: sendTargetedMessage,
    reply_to_activity: replyToActivity,
    create_targeted_activity: createTargetedActivity,
    update_targeted_activity: updateTargetedActivity,
    delete_targeted_activity: deleteTargetedActivity,
    send_typing: async (bot: TeamsBot, params: TeamsActionParams) =>
        bot.sendActivity(conversationId(params), new Activity(ActivityTypes.Typing)),
    send_file_consent_card: sendFileConsentCard,
    send_file_info_card: async (bot: TeamsBot, params: TeamsActionParams) =>
        bot.sendActivity(conversationId(params), fileInfoActivity(params)),
    complete_file_consent_upload: completeFileConsentUpload,
    get_team_details: async (bot: TeamsBot, params: TeamsActionParams) =>
        withConversation(bot, params, context =>
            context.client.teams.getById(requireString(params.team_id, "team_id")),
        ),
    list_team_channels: async (bot: TeamsBot, params: TeamsActionParams) =>
        withConversation(bot, params, context =>
            context.client.teams.getConversations(requireString(params.team_id, "team_id")),
        ),
    get_conversation_member: async (bot: TeamsBot, params: TeamsActionParams) =>
        withConversation(bot, params, context =>
            context.client.conversations.getMemberById(
                conversationId(params),
                requireString(params.user_id, "user_id"),
            ),
        ),
    list_conversation_members: async (bot: TeamsBot, params: TeamsActionParams) =>
        withConversation(bot, params, context =>
            context.client.conversations.getMembers(conversationId(params)),
        ),
    list_conversation_members_paged: async (bot: TeamsBot, params: TeamsActionParams) =>
        withConversation(bot, params, context =>
            context.client.conversations.getPagedMembers(
                conversationId(params),
                optionalNumber(params.page_size),
                optionalString(params.continuation_token),
            ),
        ),
    get_activity_members: async (bot: TeamsBot, params: TeamsActionParams) =>
        withConversation(bot, params, context =>
            context.client.conversations.getActivityMembers(
                conversationId(params),
                requireString(params.message_id, "message_id"),
            ),
        ),
    add_message_reaction: (bot: TeamsBot, params: TeamsActionParams) =>
        updateReaction(bot, params, "add"),
    remove_message_reaction: (bot: TeamsBot, params: TeamsActionParams) =>
        updateReaction(bot, params, "remove"),
    get_meeting_info: async (bot: TeamsBot, params: TeamsActionParams) =>
        withConversation(bot, params, context =>
            context.client.meetings.getById(requireString(params.meeting_id, "meeting_id")),
        ),
    get_meeting_participant: async (bot: TeamsBot, params: TeamsActionParams) =>
        withConversation(bot, params, context =>
            context.client.meetings.getParticipant(
                requireString(params.meeting_id, "meeting_id"),
                requireString(params.aad_object_id, "aad_object_id"),
                requireString(params.tenant_id, "tenant_id"),
            ),
        ),
    send_meeting_notification: sendMeetingNotification,
} satisfies Readonly<Record<string, PlatformActionHandler<TeamsBot>>>;

async function registerConversationReference(bot: TeamsBot, params: TeamsActionParams) {
    const reference = conversationReferenceValue(params.reference);
    bot.registerConversationReference(reference);
    return reference;
}

async function createPersonalConversation(bot: TeamsBot, params: TeamsActionParams) {
    const activity = compileTeamsActivity(messageValue(params.message), { resolveUserId: String });
    return bot.createPersonalConversation({
        service_url: requireHttpsUrl(params.service_url, "service_url"),
        tenant_id: requireString(params.tenant_id, "tenant_id"),
        aad_object_id: requireString(params.aad_object_id, "aad_object_id"),
        activity,
    });
}

async function sendAdaptiveCard(bot: TeamsBot, params: TeamsActionParams) {
    const activity = compileTeamsActivity(
        [{ type: "adaptive_card", data: { content: objectValue(params.card, "card") } }],
        { resolveUserId: String },
    );
    return bot.sendActivity(conversationId(params), activity);
}

async function sendTargetedMessage(bot: TeamsBot, params: TeamsActionParams) {
    const activity = compileTeamsActivity(messageValue(params.message), { resolveUserId: String });
    activity.entities = [
        ...(activity.entities || []),
        { type: "activityTreatment", treatment: "targeted" },
    ];
    const userId = optionalString(params.user_id);
    if (userId) activity.recipient = { id: userId };
    return bot.sendActivity(conversationId(params), activity);
}

async function replyToActivity(bot: TeamsBot, params: TeamsActionParams) {
    return withConversation(bot, params, context => {
        const reply = context.client.conversations.replyToActivity.bind(
            context.client.conversations,
        );
        return reply(
            conversationId(params),
            requireString(params.activity_id, "activity_id"),
            activityValue(params.activity) as unknown as Parameters<typeof reply>[2],
        );
    });
}

async function createTargetedActivity(bot: TeamsBot, params: TeamsActionParams) {
    return withConversation(bot, params, context => {
        const create = context.client.conversations.createTargetedActivity.bind(
            context.client.conversations,
        );
        return create(
            conversationId(params),
            activityValue(params.activity) as unknown as Parameters<typeof create>[1],
        );
    });
}

async function updateTargetedActivity(bot: TeamsBot, params: TeamsActionParams) {
    return withConversation(bot, params, context => {
        const update = context.client.conversations.updateTargetedActivity.bind(
            context.client.conversations,
        );
        return update(
            conversationId(params),
            requireString(params.activity_id, "activity_id"),
            activityValue(params.activity) as unknown as Parameters<typeof update>[2],
        );
    });
}

async function deleteTargetedActivity(bot: TeamsBot, params: TeamsActionParams) {
    return withConversation(bot, params, context =>
        context.client.conversations.deleteTargetedActivity(
            conversationId(params),
            requireString(params.activity_id, "activity_id"),
        ),
    );
}

async function sendFileConsentCard(bot: TeamsBot, params: TeamsActionParams) {
    return bot.sendActivity(
        conversationId(params),
        teamsCard(
            "application/vnd.microsoft.teams.card.file.consent",
            {
                description: optionalString(params.description) || "",
                sizeInBytes: requireNumber(params.size_in_bytes, "size_in_bytes"),
                acceptContext: params.accept_context,
                declineContext: params.decline_context,
            },
            requireString(params.file_name, "file_name"),
        ),
    );
}

async function completeFileConsentUpload(bot: TeamsBot, params: TeamsActionParams) {
    const upload = await bot.uploadFileConsentContent(
        requireHttpsUrl(params.upload_url, "upload_url"),
        {
            source: requireString(params.source, "source"),
            filename: optionalString(params.file_name),
            contentType: optionalString(params.content_type),
        },
    );
    const message = await bot.sendActivity(conversationId(params), fileInfoActivity(params));
    return { upload, message };
}

async function updateReaction(bot: TeamsBot, params: TeamsActionParams, mode: "add" | "remove") {
    return withConversation(bot, params, async context => {
        const operation =
            mode === "add"
                ? context.client.conversations.addReaction.bind(context.client.conversations)
                : context.client.conversations.deleteReaction.bind(context.client.conversations);
        const reaction = requireString(params.reaction, "reaction") as Parameters<
            typeof operation
        >[2];
        await operation(
            conversationId(params),
            requireString(params.message_id, "message_id"),
            reaction,
        );
        return undefined;
    });
}

async function sendMeetingNotification(bot: TeamsBot, params: TeamsActionParams) {
    return withConversation(bot, params, context => {
        const send = context.client.meetings.sendNotification.bind(context.client.meetings);
        return send(
            requireString(params.meeting_id, "meeting_id"),
            objectValue(params.notification, "notification") as Parameters<typeof send>[1],
        );
    });
}
