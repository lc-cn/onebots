import {V12} from "@/service/V12";
import SegmentElem = V12.SegmentElem;
import {processMessage} from "@/service/V12/action/utils";


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
        const {element}=await processMessage.apply(this.client,[message])
        if(!element.length) return
        return await this.client.sendGuildMsg(guild_id,channel_id,element)
    }
}
