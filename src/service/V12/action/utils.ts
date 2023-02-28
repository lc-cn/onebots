import {Client, MessageElem} from "icqq";
import {V12} from "@/service/V12";
import {remove} from "@/utils";

export async function processMusic(this: Client, target_type: 'group' | 'friend', target_id: number, element:any[]) {
    const musicList = element.filter(e => e.type === 'music')
    element = element.filter(e => !musicList.includes(e))
    const target = target_type === 'group' ? this.pickGroup(target_id) : this.pickFriend(target_id)
    if (musicList.length) await Promise.all(musicList.map(async (music) => {
        return await target.shareMusic(music.platform, music.id)
    }))
    return element
}

export async function processMessage(this: Client, message: V12.Sendable,source?:V12.SegmentElem<'reply'>):Promise<{ element: MessageElem[],music?:V12.SegmentElem<'music'>,share?:V12.SegmentElem<'share'>, quote?:V12.SegmentElem<'reply'> }> {
    let segments:V12.SegmentElem[]=[].concat(message).map(m=>{
        if(typeof m==='string') return {type:'text',data:{text:m}}
        return m
    })
    const music = segments.find(e => e.type === 'music') as V12.SegmentElem<'music'>
    if(music) remove(segments,music)
    if(segments.find(e => e.type === 'music')) throw new Error('一次只能发送一个音乐元素')
    if(segments.length && music) throw new Error('音乐元素只能单独发送')
    const share = segments.find(e => e.type === 'share') as V12.SegmentElem<'share'>
    if(share) remove(segments,share)
    if(segments.find(e => e.type === 'share')) throw new Error('一次只能发送一个分享元素')
    if(segments.length && share) throw new Error('分享元素只能单独发送')
    const forwardNodes = segments.filter(e => e.type === 'node') as V12.SegmentElem<'node'>[]
    segments=segments.filter(s=>!forwardNodes.includes(s as any))
    if(forwardNodes.length && segments.length) throw new Error('只能单独发送转发节点')
    let quote = segments.find(e => e.type === 'reply') as V12.SegmentElem<'reply'>
    if (quote) remove(segments, quote)
    segments = segments.filter(n => [
        'face', 'text', 'image',// 基础类
        'rpx', 'dice', 'poke', 'mention', 'mention_all', // 功能类
        'voice', 'file', 'record',// 音视频类
        'forward','node',// 转发类
        'music', 'share', 'xml', 'json', 'location', // 分享类
    ].includes(n.type))
    const element = V12.fromSegment(segments)
    if (forwardNodes.length) element.unshift(
        // 构造抓发消息
        await this.makeForwardMsg(
            await Promise.all(
                // 处理转发消息段
                forwardNodes.map(
                    async (forwardNode) => {
                        return {
                            // 转发套转发处理
                            message: (await processMessage.apply(this, [forwardNode.data.message])).element,
                            user_id: Number(forwardNode.data.user_id),
                            nickname: forwardNode.data.user_name,
                            time: forwardNode.data.time
                        }
                    }
                )
            )
        )
    )
    return {element, quote:quote||source,music,share}
}