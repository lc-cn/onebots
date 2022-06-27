export namespace Config{
    export interface AuthInfo{
        access_token?:string
    }
    export interface HttpReverseConfig{
        secret?:string
        url:string
        access_token?:string
    }
}
