import {Client, MessageElem} from "icqq";
import {V12} from "@/service/V12";
import {remove} from "@/utils";

export async function processMessage(this: V12, message: V12.Sendable,source?:V12.SegmentElem<'reply'>):Promise<{ element: MessageElem[],music?:V12.SegmentElem<'music'>,share?:V12.SegmentElem<'share'>, quote?:V12.SegmentElem<'reply'> }> {
    let segments:V12.SegmentElem[]=[].concat(message).map(m=>{
        if(typeof m==='string') return {type:'text',data:{text:m}}
        return m
    })
    let quote = segments.find(e => e.type === 'reply') as V12.SegmentElem<'reply'>
    if (quote) remove(segments, quote)
    let music= segments.find(e=>e.type==='music') as V12.SegmentElem<'music'>
    if(music) remove(segments,music)
    let share= segments.find(e=>e.type==='share') as V12.SegmentElem<'share'>
    if(share) remove(segments,share)
    segments = segments.filter(n => [
        'face', 'text', 'image',// 基础类
        'rpx', 'dice', 'poke', 'mention', 'mention_all', // 功能类
        'voice', 'file', 'record',// 音视频类
        'forward','node',// 转发类
        'music', 'share', 'xml', 'json', 'location', // 分享类
    ].includes(n.type))
    for (const seg of segments){
        if(['image','video','audio'].includes(seg.type)){
            const {file_id}=seg.data as V12.SegmentElem<'image'|'voice'|'audio'>['data']
            const fileInfo=this.getFile(file_id)
            if(fileInfo) seg.data['file_id']=fileInfo.url||fileInfo.path||`base64://${fileInfo.data}`
            if(seg.data['file_id']?.startsWith('base64://')) seg.data['file_id']=Buffer.from(seg.data['file_id'].slice(9),'base64')
        }else if(['mention','mention_all'].includes(seg.type)){
            seg.data['qq']=seg.data['user_id']
        }else if(seg.type==='node'){
            seg.data['message']=(await processMessage.call(this,seg.data['message'])).element
        }
    }
    const element = V12.fromSegment(segments)
    return {element, quote:quote||source,share,music}
}
