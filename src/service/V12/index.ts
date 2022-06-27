import {Client} from "oicq";
import {OneBot} from "@/onebot";
import {App} from "@/server/app";

export class V12 implements OneBot.Base{
    public version='V12'
    constructor(public app:App,public client:Client,public config:V12.Config) {
    }

    start(path?:string) {
        throw new Error("Method not implemented.");
    }
    stop() {
        throw new Error("Method not implemented.");
    }
    dispatch(...args: any[]) {
        throw new Error("Method not implemented.");
    }
    apply(...args:any[]){
        throw new Error("Method not implemented.");
    }
}
export namespace V12{
    export interface Config{

    }
    export interface Result<T extends any>{

    }
    export const defaultConfig:Config={

    }
}
