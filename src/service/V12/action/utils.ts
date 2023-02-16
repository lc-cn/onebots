import {Client, MessageElem} from "icqq";
import {V12} from "@/service/V12";
import {remove} from "@/utils";

export async function processMusic(this: Client, target_type: 'group' | 'friend', target_id: number, element) {
    const musicList = element.filter(e => e.type === 'music')
    element = element.filter(e => !musicList.includes(e))
    const target = target_type === 'group' ? this.pickGroup(target_id) : this.pickFriend(target_id)
    if (musicList.length) await Promise.all(musicList.map(async (music) => {
        return await target.shareMusic(music.platform, music.id)
    }))
    return element
}

export async function processMessage(this: Client, message: V12.SegmentElem[], quote_id?: string) {
    const forwardNodes = message.filter(e => e.type === 'node') as V12.SegmentElem<'node'>[]
    if (forwardNodes.length) message = message.filter((segment: any) => !forwardNodes.includes(segment))
    let quote = message.find(e => e.type === 'reply') as V12.SegmentElem<'reply'>
    if (quote) remove(message, quote)
    const element = V12.fromSegment(message)
    if (forwardNodes) element.unshift(
        // 构造抓发消息
        await this.makeForwardMsg(
            await Promise.all(
                // 处理转发消息段
                forwardNodes.map(
                    async (forwardNode) => {
                        return {
                            // 转发套转发处理
                            message: (await processMessage.apply(this, [V12.fromSegment(forwardNode.data.message)])).element,
                            user_id: Number(forwardNode.data.user_id),
                            nickname: forwardNode.data.user_name,
                            time: forwardNode.data.time
                        }
                    }
                )
            )
        )
    )
    if (quote && !quote_id) quote_id = quote.data.message_id
    return {element, quote_id} as { element: MessageElem[], quote_id?: string }
}