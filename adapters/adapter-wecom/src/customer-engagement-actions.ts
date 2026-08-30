import { postRecordAction, staticCall } from "./platform-action-params.js";

/** 企业微信客户经营能力：标签、群发、朋友圈、入群方式与统计。 */
export const WECOM_CUSTOMER_ENGAGEMENT_ACTIONS = {
    list_external_contact_tags: postRecordAction(
        "/cgi-bin/externalcontact/get_corp_tag_list",
        "request",
    ),
    add_external_contact_tags: postRecordAction("/cgi-bin/externalcontact/add_corp_tag", "request"),
    update_external_contact_tags: postRecordAction(
        "/cgi-bin/externalcontact/edit_corp_tag",
        "request",
    ),
    delete_external_contact_tags: postRecordAction(
        "/cgi-bin/externalcontact/del_corp_tag",
        "request",
    ),
    mark_external_contact_tags: postRecordAction("/cgi-bin/externalcontact/mark_tag", "request"),
    create_external_contact_mass_message: postRecordAction(
        "/cgi-bin/externalcontact/add_msg_template",
        "message",
    ),
    list_external_contact_mass_messages: postRecordAction(
        "/cgi-bin/externalcontact/get_groupmsg_list_v2",
        "request",
    ),
    get_external_contact_mass_message_tasks: postRecordAction(
        "/cgi-bin/externalcontact/get_groupmsg_task",
        "request",
    ),
    get_external_contact_mass_message_result: postRecordAction(
        "/cgi-bin/externalcontact/get_groupmsg_send_result",
        "request",
    ),
    cancel_external_contact_mass_message: postRecordAction(
        "/cgi-bin/externalcontact/cancel_groupmsg_send",
        "request",
    ),
    remind_external_contact_mass_message: postRecordAction(
        "/cgi-bin/externalcontact/remind_groupmsg_send",
        "request",
    ),
    create_external_contact_moment: postRecordAction(
        "/cgi-bin/externalcontact/add_moment_task",
        "moment",
    ),
    get_external_contact_moment_task: postRecordAction(
        "/cgi-bin/externalcontact/get_moment_task",
        "request",
    ),
    list_external_contact_moments: postRecordAction(
        "/cgi-bin/externalcontact/get_moment_list",
        "request",
    ),
    get_external_contact_moment_task_result: postRecordAction(
        "/cgi-bin/externalcontact/get_moment_task_result",
        "request",
    ),
    get_external_contact_moment_send_result: postRecordAction(
        "/cgi-bin/externalcontact/get_moment_send_result",
        "request",
    ),
    add_external_contact_group_join_way: postRecordAction(
        "/cgi-bin/externalcontact/groupchat/add_join_way",
        "join_way",
    ),
    get_external_contact_group_join_way: postRecordAction(
        "/cgi-bin/externalcontact/groupchat/get_join_way",
        "request",
    ),
    update_external_contact_group_join_way: postRecordAction(
        "/cgi-bin/externalcontact/groupchat/update_join_way",
        "join_way",
    ),
    delete_external_contact_group_join_way: postRecordAction(
        "/cgi-bin/externalcontact/groupchat/del_join_way",
        "request",
    ),
    get_external_contact_behavior_data: postRecordAction(
        "/cgi-bin/externalcontact/get_user_behavior_data",
        "request",
    ),
    get_external_contact_group_statistics: postRecordAction(
        "/cgi-bin/externalcontact/groupchat/statistic",
        "request",
    ),
    get_external_contact_group_daily_statistics: postRecordAction(
        "/cgi-bin/externalcontact/groupchat/statistic_group_by_day",
        "request",
    ),
    get_external_contact_operable_ranges: staticCall("/cgi-bin/externalcontact/get_range"),
} as const;
