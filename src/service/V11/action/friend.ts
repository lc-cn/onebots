import { OneBot } from "@/onebot"
import { V11 } from "@/service/V11"
import { processMessage } from "@/service/V11/utils"
import { shareMusic } from "@/service/shareMusicCustom"
import { MessageElem, MusicElem } from "icqq/lib/message"

export class FriendAction {
  /**
   * 发送私聊消息
   * @param user_id {number} 用户id
   * @param message {MessageElem[]} 发送的消息
   * @param message_id {string} 引用的消息ID
   */
  async sendPrivateMsg(this: V11, user_id: number, message: MessageElem[], message_id?: string) {
    const msg = message_id ? await this.client.getMsg(message_id) : undefined
    const { element, music, share } = await processMessage.apply(this.client, [message])
    if (music) return await shareMusic.call(this.client.pickFriend(user_id), music as MusicElem)
    if (share) return await this.client.pickFriend(user_id).shareUrl(music.data)
    if (!element.length) throw new Error("Empty message")
    return await this.client.sendPrivateMsg(user_id, element, msg)
  }

  /**
   * 获取好友列表
   */
  async getFriendList(this: OneBot<"V11">) {
    return [...(await this.client.getFriendList()).values()]
  }

  /**
   * 处理好友添加请求
   * @param flag {string} 请求flag
   * @param approve {boolean} 是否同意
   * @param remark {string} 添加后的备注
   */
  async setFriendAddRequest(this: OneBot<"V11">, flag: string, approve: boolean = true, remark: string = "") {
    return await this.client.setFriendAddRequest(flag, approve, remark)
  }

  /**
   * 获取陌生人信息
   * @param user_id {number} 用户id
   */
  async getStrangerInfo(this: OneBot<"V11">, user_id: number) {
    return await this.client.getStrangerInfo(user_id)
  }

  /**
   * 为指定用户点赞
   * @param user_id {number} 用户id
   * @param times 点赞次数
   */
  async sendUserLike(this: OneBot<"V11">, user_id: number, times?: number) {
    return this.client.sendLike(user_id, times)
  }
}
