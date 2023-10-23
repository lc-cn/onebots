import {Client, MessageElem, ShareElem} from "icqq";
import {remove} from "@/utils";
import {fromCqcode, fromSegment,SegmentElem} from "icqq-cq-enable/lib/utils";
import {MusicElem, QuoteElem} from "icqq/lib/message";

export async function processMessage(this: Client, message: string|SegmentElem|SegmentElem[],source?:QuoteElem):Promise<{ element: MessageElem[],music?:MessageElem,share?:ShareElem, quote?:QuoteElem }> {
    const elements:MessageElem[] = typeof message === 'string' ? fromCqcode(message) : fromSegment(message)
    let quote = elements.find(e => e.type === 'reply') as QuoteElem
    if (quote) remove(elements, quote)
    let music= elements.find(e=>e.type==='music') as MusicElem
    if(music) {
        remove(elements,music)
        if(String(music.platform) === 'custom') {
            music.platform = music['subtype'] // gocq 的平台数据存储在 subtype 内，兼容 icqq 时要求前端必须发送 id 字段
        }
    }
    let share= elements.find(e=>e.type==='share') as ShareElem
    if(share) remove(elements,share)
    for(const element of elements){
        if(['image','video','audio'].includes(element.type)){
            if(element['file_id']?.startsWith('base64://')) element['file_id']=Buffer.from(element['file_id'].slice(9),'base64')
            if(element['file']?.startsWith('base64://')) element['file']=Buffer.from(element['file'].slice(9),'base64')
        }
    }
    return {element:elements, quote:quote||source,share,music}
}
