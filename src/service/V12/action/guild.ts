import {V12} from "@/service/V12";
import SegmentElem = V12.SegmentElem;
import {remove} from "@/utils";


export class GuildAction{

    getGuildList(this:V12){
        return this.client.getGuildList()
    }
    getChannelList(this:V12,guild_id:string){
        return this.client.getChannelList(guild_id)
    }
    getGuildMemberList(this:V12,guild_id:string){
        return this.client.getGuildMemberList(guild_id)
    }
    async sendGuildMsg(this:V12,guild_id:string,channel_id:string,message:SegmentElem[]){
        const forward =message.find(e=>e.type==='node') as V12.SegmentElem<'node'>
        if(forward) remove(message,forward)
        let quote=message.find(e=>e.type==='reply') as V12.SegmentElem<'reply'>
        if(quote)  remove(message,quote)
        const element=V12.fromSegment(message)
        // if(forward) element.unshift(await this.client.makeForwardMsg(forward.data.message.map(segment=>{
        //     return {
        //         message:V12.fromSegment([segment]),
        //         user_id:forward.data.user_id,
        //         nickname:forward.data.user_name,
        //         time:forward.data.time
        //     }
        // })))
        // if(quote && !message_id) message_id=quote.data.message_id
        return await this.client.sendGuildMsg(guild_id,channel_id,element)
    }
}
