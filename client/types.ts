export interface BotInfo{
    uin:string
    status:string
    urls:string[]
}
export interface AdapterInfo{
    platform:string
    config:any,
    bots:BotInfo[]
}
