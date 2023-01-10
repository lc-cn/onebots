export namespace Config{
    export interface AuthInfo{
        access_token?:string
    }
    export interface EventBufferConfig{
        event_enabled?:boolean
        event_buffer_size?:number
    }
}
