import {Client, MessageElem, ShareElem} from "icqq";
import {remove} from "@/utils";
import {fromCqcode, fromSegment,SegmentElem} from "icqq-cq-enable/lib/utils";
import {MusicElem, QuoteElem} from "icqq/lib/message";

export async function processMessage(this: Client, message: string|SegmentElem|SegmentElem[],source?:QuoteElem):Promise<{ element: MessageElem[],music?:MessageElem,share?:ShareElem, quote?:QuoteElem }> {
    const element:MessageElem[] = typeof message === 'string' ? fromCqcode(message) : fromSegment(message)
    let quote = element.find(e => e.type === 'reply') as QuoteElem
    if (quote) remove(element, quote)
    let music= element.find(e=>e.type==='music') as MusicElem
    if(music) remove(element,music)
    let share= element.find(e=>e.type==='share') as ShareElem
    if(share) remove(element,share)
    return {element, quote:quote||source,share,music}
}