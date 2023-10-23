import {V12} from "../index";
import {processMessage} from "@/service/V12/utils";

export class GroupAction {
    /**
     * 发送群聊消息
     * @param group_id {number} 群id
     * @param message {import('icqq/lib/service').Sendable} 消息
     * @param source {import('onebots/lib/service/v12').SegmentElem<'reply'>} 引用内容
     */
    async sendGroupMsg(this: V12, group_id: number, message: V12.Sendable,source?:V12.SegmentElem<'reply'>) {
        throw new Error('不支持的API')
    }

    /**
     * 群组踢人
     * @param group_id {number} 群id
     * @param user_id {number} 成员id
     * @param reject_add_request {boolean} 是否禁止此人加群请求
     */
    setGroupKick(this: V12, group_id: number, user_id: number, reject_add_request?: boolean) {
        throw new Error('不支持的API')
    }

    /**
     * 设置群精华
     * @param message_id
     */
    setEssenceMessage(this: V12, message_id: string) {
        throw new Error('不支持的API')
    }

    /**
     * 移除群精华
     * @param message_id
     */
    deleteEssenceMessage(this: V12, message_id: string) {
        throw new Error('不支持的API')
    }
    /**
     * 群打卡
     * @param group_id 群id
     */
    sendGroupSign(this: V12, group_id: number) {
        throw new Error('不支持的API')
    }

    /**
     * 群禁言指定人
     * @param group_id {number} 群id
     * @param user_id {number} 成员id
     * @param duration {number} 禁言时长(单位：秒)
     */
    setGroupBan(this: V12, group_id: number, user_id: number, duration: number = 1800) {
        throw new Error('不支持的API')
    }

    /**
     * 群禁言匿名者
     * @param group_id {number} 群id
     * @param flag {string} 匿名者flag
     * @param duration {number} 禁言时长(单位：秒)
     */
    setGroupAnonymousBan(this: V12, group_id: number, flag: string, duration: number = 1800) {
        throw new Error('不支持的API')
    }

    /**
     * 群全体禁言
     * @param group_id {number} 群id
     * @param enable {boolean} 是否禁言
     */
    setGroupWholeBan(this: V12, group_id: number, enable?: boolean) {
        throw new Error('不支持的API')
    }

    /**
     * 群匿名聊天
     * @param group_id {number} 群id
     * @param enable {boolean} 是否开启
     */
    setGroupAnonymous(this: V12, group_id: number, enable?: boolean) {
        throw new Error('不支持的API')
    }

    /**
     * 设置群管
     * @param group_id {number} 群id
     * @param user_id {number} 成员id
     * @param enable {boolean} true 设为管理，false 取消管理
     */
    setGroupAdmin(this: V12, group_id: number, user_id: number, enable?: boolean) {
        throw new Error('不支持的API')
    }

    /**
     * 设置群成员名片(成员备注)
     * @param group_id {number} 群id
     * @param user_id {number} 成员id
     * @param card {string} 名片信息，不传或传空串则为 删除名片
     */
    setGroupCard(this: V12, group_id: number, user_id: number, card?: string) {
        throw new Error('不支持的API')
    }

    /**
     * 设置群名
     * @param group_id {number} 群id
     * @param name {string} 新群名
     */
    setGroupName(this: V12, group_id: number, name: string) {
        throw new Error('不支持的API')
    }

    /**
     * 退出指定群聊
     * @param group_id {number} 群id
     */
    leaveGroup(this: V12, group_id: number) {
        throw new Error('不支持的API')
    }

    /**
     * 设置群成员头衔
     * @param group_id {number} 群id
     * @param user_id {number} 成员id
     * @param special_title {string} 头衔
     * @param duration {number} 持有时长 不传则永久
     */
    setGroupSpecialTitle(this: V12, group_id: number, user_id: number, special_title: string, duration: number = -1) {
        throw new Error('不支持的API')
    }

    /**
     * 处理加群请求
     * @param flag {string} 加群flag
     * @param approve {boolean} 是否同意(默认：true)
     * @param reason {string} 拒绝理由，approve为false时有效(默认为空)
     * @param block {boolean} 拒绝时是否加入黑名单，(默认：false)
     */
    setGroupAddRequest(this: V12, flag: string, approve: boolean = true, reason: string = '', block: boolean = false) {
        throw new Error('不支持的API')
    }

    /**
     * 获取群列表
     */
    async getGroupList(this: V12) {
        throw new Error('不支持的API')
    }

    /**
     * 获取指定群信息
     * @param group_id
     */
    getGroupInfo(this: V12, group_id: number) {
        throw new Error('不支持的API')
    }

    /**
     * 获取群成员列表
     * @param group_id
     */
    async getGroupMemberList(this: V12, group_id: number) {
        throw new Error('不支持的API')
    }

    /**
     * 获取指定群成员信息
     * @param group_id
     * @param user_id
     */
    getGroupMemberInfo(this: V12, group_id: number, user_id: number) {
        throw new Error('不支持的API')
    }
}
