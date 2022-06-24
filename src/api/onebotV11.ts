import {Service} from "./index";
import {Client} from "oicq";

export interface OneBotV11 extends Service.Base{
}
export class OneBotV11{
    getLoginInfo(this:Client){
        return {
            uin:this.uin
        }
    }
}
export namespace OneBotV11{
}
