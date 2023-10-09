

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "mark" | "off"
export type Dispose = () => any
export type MayBeArray<T extends any> = T | T[]


/**
* 异步锁---
*/
export class AsyncLock{
    private _lock:boolean = false;
    private _waitList:Array<Function> = [];

    public async lock(){
        if(this._lock){
            await new Promise((resolve) => {
                this._waitList.push(resolve);
            });
        }
        this._lock = true;
    }

    public unlock(){
        this._lock = false;
        if(this._waitList.length > 0){
            let resolve = this._waitList.shift();
            resolve && resolve();
        }
    }
}


 