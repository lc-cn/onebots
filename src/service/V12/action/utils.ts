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

export async function processMessage(this: Client, message: V12.Sendable, quote_id?: string) {
    let segments:V12.SegmentElem[]=[].concat(message).map(m=>{
        if(typeof m==='string') return {type:'text',data:{text:m}}
        return m
    })
    const forward = segments.find(e => e.type === 'forward') as V12.SegmentElem<'forward'>
    if (forward) remove(segments,forward)
    let quote = segments.find(e => e.type === 'reply') as V12.SegmentElem<'reply'>
    if (quote) remove(segments, quote)
    // 直接发node？不允许，你用forward作为载体吧
    segments=segments.filter(n=>n.type!=='node')
    const element = V12.fromSegment(segments)
    if (forward) element.unshift(
        // 构造抓发消息
        await this.makeForwardMsg(
            await Promise.all(
                // 处理转发消息段
                forward.data.nodes.filter(n=>n.type==='node').map(
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