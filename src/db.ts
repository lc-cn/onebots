import {writeFileSync,readFileSync,existsSync} from "fs";
import { writeFile } from 'fs/promises';
import {EventEmitter} from "events";
export class Db extends EventEmitter{
    private data:Record<string, any>={}
    private raw_data:string='{}'
    constructor(private readonly path:string, force_create:boolean=true) {
        super();
        if(!this.path.toLowerCase().endsWith('.json'))this.path=this.path+'.json'
        if(!existsSync(this.path) && force_create) {
            writeFileSync(this.path,this.raw_data)
        }
        try {
            const raw_data = readFileSync(this.path, 'utf8');
            this.raw_data = raw_data || this.raw_data;
            this.data=JSON.parse(this.raw_data) as Record<string|symbol, any>
        } catch (error) {
            const { message } = error as Error;
            if (!message.includes('ENOENT: no such file or directory')) {
                throw error;
            }
        }
    }
    get(key:string,escape: boolean = true){
        const func=new Function(`return this.data.${key}`)
        const _this=this
        let result
        try{
            result=escape?func.apply(this):this.data[key]
        }catch {
            throw new Error('不可达的位置:'+key.toString())
        }
        return result&& typeof result==='object'?new Proxy(result,{
            get(target: any, p: string | symbol): any {
                return target[p]
            },
            set(target: any, p: string | symbol, value: any, receiver: any): boolean {
                const result=target[p]=value
                _this.write()
                return result
            }
        }):result
    }
    set(key:string,value:any,escape: boolean = true){
        const func=new Function('value',`return this.data.${key}=value`)
        const _this=this
        let result
        result=escape?func.apply(this,[value]):this.data[key]=value
        this.raw_data=JSON.stringify(this.data,null,2)
        this.write()
        return result&& typeof result==='object'?new Proxy(result,{
            get(target: any, p: string | symbol): any {
                return target[p]
            },
            set(target: any, p: string | symbol, value: any, receiver: any): boolean {
                const result=target[p]=value
                _this.write()
                return result
            }
        }):result
    }
    has(key:string,escape:boolean=true):boolean{
        return escape?new Function(`return !!this.data.${key}`).apply(this):!!this.data[key]
    }
    delete(key:string,escape:boolean=true):boolean{
        const result:boolean=escape?new Function(`return delete this.data.${key}`).apply(this):delete this.data[key]
        this.write()
        return result
    }
    async write():Promise<void>{
        try {
            const raw_data = JSON.stringify(this.data, null, 2);
            if (raw_data !== this.raw_data) {
                await writeFile(this.path, raw_data);
                this.raw_data = raw_data;
            }
        } catch (error) {
            this.data = JSON.parse(this.raw_data);
            throw error;
        }
    }
}
export namespace Db{
    export interface Config{
        path:string
        force?:boolean
    }
}
