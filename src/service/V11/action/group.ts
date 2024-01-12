import { V11 } from "@/service/V11";

export class GroupAction {
    /**
     * 发送群聊消息
     * @param group_id {number} 群id
     * @param message {V11.Sendable[]} 消息
     * @param message_id {number} 引用的消息ID
     */
    async sendGroupMsg(
        this: V11,
        group_id: number,
        message: V11.Sendable,
        message_id?: number,
    ): Promise<V11.MessageRet> {
        const msg_id = message_id ? this.getStrByInt("message_id", message_id) : undefined;
        const gid = this.getStrByInt("group_id", group_id);
        return this.adapter.call(this.oneBot.uin, "V11", "sendGroupMessage", [
            gid,
            message,
            msg_id,
        ]);
    }

    /**
     * 群组踢人
     * @param group_id {number} 群id
     * @param user_id {number} 成员id
     * @param reject_add_request {boolean} 是否禁止此人加群请求
     */
    setGroupKick(this: V11, group_id: number, user_id: number, reject_add_request?: boolean) {
        return this.adapter.call(this.oneBot.uin, "V11", "setGroupKick", [
            group_id,
            user_id,
            reject_add_request,
        ]);
    }

    /**
     * 群禁言指定人
     * @param group_id {number} 群id
     * @param user_id {number} 成员id
     * @param duration {number} 禁言时长(单位：秒)
     */
    setGroupBan(this: V11, group_id: number, user_id: number, duration: number = 1800) {
        return this.adapter.call(this.oneBot.uin, "V11", "setGroupBan", [
            group_id,
            user_id,
            duration,
        ]);
    }

    /**
     * 群禁言匿名者
     * @param group_id {number} 群id
     * @param flag {string} 匿名者flag
     * @param duration {number} 禁言时长(单位：秒)
     */
    setGroupAnonymousBan(this: V11, group_id: number, flag: string, duration: number = 1800) {
        return this.adapter.call(this.oneBot.uin, "V11", "setGroupAnonymousBan", [
            group_id,
            flag,
            duration,
        ]);
    }

    /**
     * 群全体禁言
     * @param group_id {number} 群id
     * @param enable {boolean} 是否禁言
     */
    setGroupWholeBan(this: V11, group_id: number, enable?: boolean) {
        return this.adapter.call(this.oneBot.uin, "V11", "setGroupWholeBan", [group_id, enable]);
    }

    /**
     * 群匿名聊天
     * @param group_id {number} 群id
     * @param enable {boolean} 是否开启
     */
    setGroupAnonymous(this: V11, group_id: number, enable?: boolean) {
        return this.adapter.call(this.oneBot.uin, "V11", "setGroupAnonymous", [group_id, enable]);
    }

    /**
     * 设置群管
     * @param group_id {number} 群id
     * @param user_id {number} 成员id
     * @param enable {boolean} true 设为管理，false 取消管理
     */
    setGroupAdmin(this: V11, group_id: number, user_id: number, enable?: boolean) {
        return this.adapter.call(this.oneBot.uin, "V11", "setGroupAdmin", [
            group_id,
            user_id,
            enable,
        ]);
    }

    /**
     * 设置群成员名片(成员备注)
     * @param group_id {number} 群id
     * @param user_id {number} 成员id
     * @param card {string} 名片信息，不传或传空串则为 删除名片
     */
    setGroupCard(this: V11, group_id: number, user_id: number, card?: string) {
        return this.adapter.call(this.oneBot.uin, "V11", "setGroupCard", [group_id, user_id, card]);
    }

    /**
     * 设置群精华
     * @param message_id 消息id
     */
    setEssenceMessage(this: V11, message_id: string) {
        return this.adapter.call(this.oneBot.uin, "V11", "setEssenceMessage", [message_id]);
    }
    /**
     * 群打卡
     * @param group_id 群id
     */
    sendGroupSign(this: V11, group_id: number) {
        return this.adapter.call(this.oneBot.uin, "V11", "sendGroupSign", [group_id]);
    }

    /**
     * 移除群精华
     * @param message_id
     */
    deleteEssenceMessage(this: V11, message_id: string) {
        return this.adapter.call(this.oneBot.uin, "V11", "removeEssenceMessage", [message_id]);
    }
    /**
     * 设置群名
     * @param group_id {number} 群id
     * @param name {string} 新群名
     */
    setGroupName(this: V11, group_id: number, name: string) {
        return this.adapter.call(this.oneBot.uin, "V11", "setGroupName", [group_id, name]);
    }

    /**
     * 退出指定群聊
     * @param group_id {number} 群id
     */
    setGroupLeave(this: V11, group_id: number) {
        return this.adapter.call(this.oneBot.uin, "V11", "setGroupLeave", [group_id]);
    }

    /**
     * 设置群成员头衔
     * @param group_id {number} 群id
     * @param user_id {number} 成员id
     * @param special_title {string} 头衔
     * @param duration {number} 持有时长 不传则永久
     */
    setGroupSpecialTitle(
        this: V11,
        group_id: number,
        user_id: number,
        special_title: string,
        duration: number = -1,
    ) {
        return this.adapter.call(this.oneBot.uin, "V11", "setGroupSpecialTitle", [
            group_id,
            user_id,
            special_title,
            duration,
        ]);
    }

    /**
     * 处理加群请求
     * @param flag {string} 加群flag
     * @param approve {boolean} 是否同意(默认：true)
     * @param reason {string} 拒绝理由，approve为false时有效(默认为空)
     * @param block {boolean} 拒绝时是否加入黑名单，(默认：false)
     */
    setGroupAddRequest(
        this: V11,
        flag: string,
        approve: boolean = true,
        reason: string = "",
        block: boolean = false,
    ) {
        return this.adapter.call(this.oneBot.uin, "V11", "setGroupAddRequest", [
            flag,
            approve,
            reason,
            block,
        ]);
    }

    /**
     * 获取群列表
     */
    async getGroupList(this: V11) {
        return this.adapter.call(this.oneBot.uin, "V11", "getGroupList");
    }

    /**
     * 获取指定群信息
     * @param group_id
     */
    getGroupInfo(this: V11, group_id: number) {
        return this.adapter.call(this.oneBot.uin, "V11", "getGroupInfo", [group_id]);
    }

    /**
     * 获取群成员列表
     * @param group_id
     */
    async getGroupMemberList(this: V11, group_id: number) {
        return this.adapter.call(this.oneBot.uin, "V11", "getGroupMemberList", [group_id]);
    }

    /**
     * 获取指定群成员信息
     * @param group_id
     * @param user_id
     */
    getGroupMemberInfo(this: V11, group_id: number, user_id: number) {
        return this.adapter.call(this.oneBot.uin, "V11", "getGroupMemberInfo", [group_id, user_id]);
    }
}
