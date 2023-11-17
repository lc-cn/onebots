import {Contactable} from "@/entries/contactable";
import {Bot} from "@";

export namespace User{
    export interface Info{
        id:string
        username:string
        avatar:string
        bot:boolean
        public_flag:number
    }
}
