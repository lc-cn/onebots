import { createSlackMethodHandlers } from "./platform-action-methods.js";

/** 消息增强、内容读取、Modal/App Home、文件与用户组协作能力。 */
export const SLACK_COLLABORATION_ACTIONS = createSlackMethodHandlers({
    post_ephemeral: "chat.postEphemeral",
    get_message_permalink: "chat.getPermalink",
    unfurl_message: "chat.unfurl",
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
