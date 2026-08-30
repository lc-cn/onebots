import { postRecordAction } from "./platform-action-params.js";

/** 企业微信协作办公域：日历、日程与审批。请求体保持官方结构。 */
export const WECOM_COLLABORATION_ACTIONS = {
    create_calendar: postRecordAction("/cgi-bin/oa/calendar/add", "request"),
    update_calendar: postRecordAction("/cgi-bin/oa/calendar/update", "request"),
    get_calendars: postRecordAction("/cgi-bin/oa/calendar/get", "request"),
    delete_calendar: postRecordAction("/cgi-bin/oa/calendar/del", "request"),
    create_schedule: postRecordAction("/cgi-bin/oa/schedule/add", "request"),
    update_schedule: postRecordAction("/cgi-bin/oa/schedule/update", "request"),
    add_schedule_attendees: postRecordAction("/cgi-bin/oa/schedule/add_attendees", "request"),
    delete_schedule_attendees: postRecordAction("/cgi-bin/oa/schedule/del_attendees", "request"),
    list_calendar_schedules: postRecordAction("/cgi-bin/oa/schedule/get_by_calendar", "request"),
    get_schedules: postRecordAction("/cgi-bin/oa/schedule/get", "request"),
    cancel_schedule: postRecordAction("/cgi-bin/oa/schedule/del", "request"),
    get_approval_template: postRecordAction("/cgi-bin/oa/gettemplatedetail", "request"),
    submit_approval: postRecordAction("/cgi-bin/oa/applyevent", "request"),
    list_approval_numbers: postRecordAction("/cgi-bin/oa/getapprovalinfo", "request"),
    get_approval_detail: postRecordAction("/cgi-bin/oa/getapprovaldetail", "request"),
} as const;
