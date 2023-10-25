import {Adapter} from "@/adapter";
import {App} from "@/server/app";
import {OneBot, OneBotStatus} from "@/onebot";

export default class QQAdapter extends Adapter<'qq'>{
    constructor(app:App,config:QQAdapter.Config) {
        super(app,'qq',config);
    }
    getSelfInfo<V extends OneBot.Version>(uin: string, version: V): OneBot.SelfInfo<V> {
        return {
            nickname: 'qq',
            status: OneBotStatus.Online,
        } as OneBot.SelfInfo<V>;
    }
}
declare module '@/adapter'{
    export namespace Adapter{
        export interface Configs{
            qq: QQAdapter.Config
        }
    }
}
export namespace QQAdapter{
    export interface Config extends Adapter.Config<'qq'>{
        appId:string
        secret:string
        sandbox?:boolean
        indents?:number[]
    }
}
