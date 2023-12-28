export interface MsgEntry{
    id:number,
    base64_id:string
    seq:number
    user_id:string
    nickname:string
    group_id:number
    group_name:string
    content:string
    recalled?:boolean
    create_time?:number
    recall_time?:number
}
