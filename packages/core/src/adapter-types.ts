import type { CommonTypes } from "./types.js";

declare module "./adapter.js" {
    /**
     * 通用适配器 API 的参数与返回值契约。
     *
     * 该命名空间只承载静态类型；运行时能力由 AdapterCapabilityManifest 描述，
     * 避免“类型中存在方法”被误解为“平台原生支持该方法”。
     */
    namespace Adapter {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Registry interface augmented by each adapter; `any` required to allow dynamic config property access
        export interface Configs extends Record<string, any> {}

        export type VerificationBlock =
            | { type: "image"; base64: string; alt?: string }
            | { type: "image_url"; url: string; alt?: string }
            | { type: "qrcode"; content: string; alt?: string }
            | { type: "link"; url: string; label?: string }
            | { type: "text"; content: string }
            | {
                  type: "input";
                  key: string;
                  placeholder?: string;
                  maxLength?: number;
                  secret?: boolean;
              };

        export interface VerificationRequestOptions {
            blocks?: VerificationBlock[];
        }

        /** 验证面板快捷操作按钮（如「重新登录」） */
        export interface VerificationAction {
            id: string;
            label: string;
            /** 默认 secondary；primary 使用主按钮样式 */
            variant?: "primary" | "secondary";
        }

        export interface VerificationRequest {
            platform: string;
            account_id: string;
            type: string;
            hint: string;
            options?: VerificationRequestOptions;
            requestSmsAvailable?: boolean;
            /** 为 true 时前端显示「确认」按钮（无需输入的验证，如扫码/身份验证后继续登录） */
            confirmable?: boolean;
            /** 「确认」按钮文案，默认「已完成，继续登录」 */
            confirmLabel?: string;
            /** 额外快捷操作；点击后经 submitVerification 提交 data.action = id */
            actions?: VerificationAction[];
            data?: Record<string, unknown>;
            request_id?: string;
        }

        /** 清除待处理验证（登录成功 / 重新登录前），type 省略则清除该账号全部 */
        export interface VerificationClear {
            platform: string;
            account_id: string;
            type?: string;
        }

        // --- 消息 (7个方法) ---
        export interface SendMessageParams {
            scene_type: CommonTypes.Scene;
            scene_id: CommonTypes.Id;
            message: CommonTypes.Segment[];
        }
        export interface SendMessageResult {
            message_id: CommonTypes.Id;
        }
        export interface DeleteMessageParams {
            message_id: CommonTypes.Id;
            scene_type?: CommonTypes.Scene;
            scene_id?: CommonTypes.Id;
        }
        export interface GetMessageParams {
            message_id: CommonTypes.Id;
            scene_type?: CommonTypes.Scene;
            scene_id?: CommonTypes.Id;
        }
        export interface GetMessageHistoryParams {
            scene_type: CommonTypes.Scene;
            scene_id: CommonTypes.Id;
            limit?: number;
            offset?: number;
        }
        export interface UpdateMessageParams {
            message_id: CommonTypes.Id;
            message: CommonTypes.Segment[];
        }
        export interface GetForwardMessageParams {
            message_id?: CommonTypes.Id;
            resource_id?: string;
        }
        export interface MarkMessageAsReadParams {
            scene_type: CommonTypes.Scene;
            scene_id: CommonTypes.Id;
            message_id?: CommonTypes.Id;
        }
        export interface MessageSender {
            scene_type: CommonTypes.Scene;
            sender_id: CommonTypes.Id;
            scene_id: CommonTypes.Id;
            sender_name: string;
            scene_name: string;
        }
        export interface MessageInfo {
            message_id: CommonTypes.Id;
            time: number;
            sender: MessageSender;
            message: CommonTypes.Segment[];
        }

        // --- 用户与账号资料 ---
        export interface GetUserInfoParams {
            user_id: CommonTypes.Id;
            no_cache?: boolean;
        }
        export interface CreateUserChannelParams {
            user_id: CommonTypes.Id;
            guild_id?: CommonTypes.Id;
        }
        export interface SetAvatarParams {
            source: string;
        }
        export interface SetNicknameParams {
            nickname: string;
        }
        export interface SetBioParams {
            bio: string;
        }
        export interface UserInfo {
            user_id: CommonTypes.Id;
            user_name: string;
            user_displayname?: string;
            avatar?: string;
        }

        // --- 好友 (7个方法) ---
        export interface GetFriendListParams {
            no_cache?: boolean;
        }
        export interface GetFriendInfoParams {
            user_id: CommonTypes.Id;
            no_cache?: boolean;
        }
        export interface DeleteFriendParams {
            user_id: CommonTypes.Id;
        }
        export interface SendFriendNudgeParams {
            user_id: CommonTypes.Id;
            is_self?: boolean;
        }
        export interface SendLikeParams {
            user_id: CommonTypes.Id;
            times?: number;
            count?: number;
        }
        export interface GetFriendRequestsParams {
            limit?: number;
            is_filtered?: boolean;
        }
        export interface HandleFriendRequestParams {
            request_id?: CommonTypes.Id;
            flag?: string;
            approve: boolean;
            remark?: string;
        }
        export interface FriendInfo {
            user_id: CommonTypes.Id;
            user_name: string;
            remark?: string;
        }
        export interface FriendRequest {
            request_id: CommonTypes.Id;
            user_id: CommonTypes.Id;
            user_name: string;
            message?: string;
            time: number;
        }

        // --- 群组 (18个方法) ---
        export interface GetGroupListParams {
            no_cache?: boolean;
        }
        export interface GetGroupInfoParams {
            group_id: CommonTypes.Id;
            no_cache?: boolean;
        }
        export interface SetGroupNameParams {
            group_id: CommonTypes.Id;
            group_name: string;
        }
        export interface LeaveGroupParams {
            group_id: CommonTypes.Id;
            is_dismiss?: boolean;
        }
        export interface GetGroupMemberListParams {
            group_id: CommonTypes.Id;
            no_cache?: boolean;
        }
        export interface GetGroupMemberInfoParams {
            group_id: CommonTypes.Id;
            user_id: CommonTypes.Id;
            no_cache?: boolean;
        }
        export interface KickGroupMemberParams {
            group_id: CommonTypes.Id;
            user_id: CommonTypes.Id;
            reject_add_request?: boolean;
        }
        export interface InviteGroupMemberParams {
            group_id: CommonTypes.Id;
            user_id: CommonTypes.Id;
        }
        export interface MuteGroupMemberParams {
            group_id: CommonTypes.Id;
            user_id: CommonTypes.Id;
            duration: number;
        }
        export interface MuteGroupAllParams {
            group_id: CommonTypes.Id;
            enable: boolean;
        }
        export interface MuteGroupAnonymousParams {
            group_id: CommonTypes.Id;
            flag: string;
            duration: number;
        }
        export interface SetGroupAnonymousParams {
            group_id: CommonTypes.Id;
            enable: boolean;
        }
        export interface SetGroupAdminParams {
            group_id: CommonTypes.Id;
            user_id: CommonTypes.Id;
            enable: boolean;
        }
        export interface SetGroupCardParams {
            group_id: CommonTypes.Id;
            user_id: CommonTypes.Id;
            card: string;
        }
        export interface SetGroupSpecialTitleParams {
            group_id: CommonTypes.Id;
            user_id: CommonTypes.Id;
            special_title: string;
            duration?: number;
        }
        export interface GetGroupHonorInfoParams {
            group_id: CommonTypes.Id;
            type: "talkative" | "performer" | "legend" | "strong_newbie" | "emotion" | "all";
        }
        export interface SendGroupNudgeParams {
            group_id: CommonTypes.Id;
            user_id: CommonTypes.Id;
        }
        export interface HandleGroupRequestParams {
            request_id?: CommonTypes.Id;
            flag?: string;
            sub_type?: "add" | "invite";
            type: "request" | "invitation";
            approve: boolean;
            reason?: string;
        }
        export interface GetGroupNotificationsParams {
            is_filtered?: boolean;
            limit?: number;
        }
        export interface SetGroupAvatarParams {
            group_id: CommonTypes.Id;
            file: string;
        }
        export interface SendGroupMessageReactionParams {
            group_id: CommonTypes.Id;
            message_id: CommonTypes.Id;
            reaction: string;
            reaction_type: "face" | "emoji";
            is_add: boolean;
        }
        export interface GroupInfo {
            group_id: CommonTypes.Id;
            group_name: string;
            member_count?: number;
            max_member_count?: number;
        }
        export interface GroupMemberInfo {
            group_id: CommonTypes.Id;
            user_id: CommonTypes.Id;
            user_name: string;
            card?: string;
            role?: "owner" | "admin" | "member";
        }
        export interface HonorMember {
            user_id: CommonTypes.Id;
            user_name: string;
            avatar?: string;
            description?: string;
        }
        export interface GroupHonorInfo {
            group_id: CommonTypes.Id;
            current_talkative?: HonorMember;
            talkative_list?: HonorMember[];
            performer_list?: HonorMember[];
            legend_list?: HonorMember[];
            strong_newbie_list?: HonorMember[];
            emotion_list?: HonorMember[];
        }
        export interface GroupNotification {
            notification_id: CommonTypes.Id;
            group_id: CommonTypes.Id;
            user_id: CommonTypes.Id;
            type: string;
            time: number;
        }
    }
}

export {};
