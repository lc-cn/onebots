import {Client, Forwardable, MessageElem} from "icqq";
import {V12} from "@/service/V12";
import {remove} from "@/utils";
export async function processMusic(this:Client,target_type:'group'|'friend',target_id:number,element){
    const musicList=element.filter(e=>e.type==='music')
    element=element.filter(e=>!musicList.includes(e))
    const target=target_type==='group'?this.pickGroup(target_id):this.pickFriend(target_id)
    if(musicList.length) await Promise.all(musicList.map(async (music)=>{
        return await target.shareMusic(music.platform,music.id)
    }))
    return element
}
export async function processMessage(this: Client, message: V12.SegmentElem[], quote_id?: string) {
    const forward = message.find(e => e.type === 'node') as V12.SegmentElem<'node'>
    if (forward) remove(message, forward)
    let quote = message.find(e => e.type === 'reply') as V12.SegmentElem<'reply'>
    if (quote) remove(message, quote)
    const element = V12.fromSegment(message)
    if (forward) element.unshift(
        // 构造抓发消息
        await this.makeForwardMsg(
            await Promise.all(
                // 处理转发消息段
                forward.data.message.map(
                    async (segment) => {
                        return {
                            // 转发套转发处理
                            message: (await processMessage.apply(this, [V12.fromSegment([segment])])).element,
                            user_id: forward.data.user_id,
                            nickname: forward.data.user_name,
                            time: forward.data.time
                        } as Forwardable
                    }
                )
            )
        )
    )
    if (quote && !quote_id) quote_id = quote.data.message_id
    return {element, quote_id} as {element:MessageElem[],quote_id?:string}
}