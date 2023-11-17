import type {QQAdapter} from "@/adapters/qq";
import {AxiosInstance} from "axios";
import {WebSocket} from "ws";
import {SessionManager} from "@/adapters/qq/sessionManager";
import {OneBot} from "@/onebot";
import { QQBot } from "@/adapters/qq/qqBot";

export class Bot extends QQBot{
    request:AxiosInstance
    self_id:string
    nickname:string
    status:number
    ws:WebSocket
    sessionManager:SessionManager
    constructor(public oneBot:OneBot, public appId:string, config:QQAdapter.Config['protocol']) {
        super({
            appid: appId,
            ...config
        })
    }


    async init() {
        await this.sessionManager.start()
    }
    stop() {

    }
}
export namespace Bot{
    export interface Config extends QQBot.Config{
        data_dir?: string
    }
}
