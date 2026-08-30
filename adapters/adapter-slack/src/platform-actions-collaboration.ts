import { createSlackMethodHandlers } from "./platform-action-methods.js";
import { SLACK_STREAM_ACTIONS } from "./stream-actions.js";

const SLACK_COLLABORATION_METHOD_ACTIONS = createSlackMethodHandlers({
    post_ephemeral: "chat.postEphemeral",
    get_message_permalink: "chat.getPermalink",
    unfurl_message: "chat.unfurl",
    validate_blocks: "blocks.validate",
    create_canvas: "canvases.create",
    edit_canvas: "canvases.edit",
    delete_canvas: "canvases.delete",
    lookup_canvas_sections: "canvases.sections.lookup",
    set_canvas_access: "canvases.access.set",
    delete_canvas_access: "canvases.access.delete",
    create_channel_canvas: "conversations.canvases.create",
    get_conversation_history: "conversations.history",
    mark_conversation: "conversations.mark",
    open_view: "views.open",
    update_view: "views.update",
    push_view: "views.push",
    publish_app_home: "views.publish",
    get_reactions: "reactions.get",
    list_pins: "pins.list",
    list_files: "files.list",
    list_user_groups: "usergroups.list",
    create_user_group: "usergroups.create",
    update_user_group: "usergroups.update",
    enable_user_group: "usergroups.enable",
    disable_user_group: "usergroups.disable",
    list_user_group_users: "usergroups.users.list",
    update_user_group_users: "usergroups.users.update",
});

/** 消息增强、流式消息、Canvas、Modal/App Home、文件与用户组协作能力。 */
export const SLACK_COLLABORATION_ACTIONS = {
    ...SLACK_COLLABORATION_METHOD_ACTIONS,
    ...SLACK_STREAM_ACTIONS,
};
