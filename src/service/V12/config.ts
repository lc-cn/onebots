export namespace Config{
    export interface AuthInfo{
        access_token?:string
    }
    export interface EventBufferConfig{
        event_enabled?:boolean
        event_buffer_size?:number
    }
    export type WebhookConfig= string| ({url:string,timeout?:number} & AuthInfo)
    export type WsReverseConfig= string|({url:string,reconnect_interval?:number} & AuthInfo)
}
