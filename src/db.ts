import {writeFileSync, readFileSync, existsSync} from "fs";

export class Db {
    private data: Record<string, any> = {}
    private raw_data: string = '{}'

    constructor(private readonly path: string, force_create: boolean = true) {
        if (!this.path.toLowerCase().endsWith('.json')) this.path = this.path + '.json'
        if (!existsSync(this.path) && force_create) {
            writeFileSync(this.path, this.raw_data)
        }
        try {
            const raw_data = readFileSync(this.path, 'utf8');
            this.raw_data = raw_data || this.raw_data;
            this.data = JSON.parse(this.raw_data) as Record<string | symbol, any>
        } catch (error) {
            const {message} = error as Error;
            if (!message.includes('ENOENT: no such file or directory')) {
                throw error;
            }
        }
    }

    get(key: string, escape: boolean = true) {
        const func = new Function(`return this.data.${key}`)
        const _this = this
        let result
        try {
            result = escape ? func.apply(this) : this.data[key]
        } catch {
            throw new Error('不可达的位置:' + key.toString())
        }
        return result && typeof result === 'object' ? new Proxy(result, {
            get(target: any, p: string | symbol, receiver: any): any {
                return Reflect.get(target, p, receiver)
            },
            set(target: any, p: string | symbol, value: any, receiver: any): boolean {
                const res = Reflect.set(target, p, value, receiver)
                _this.set(key, result)
                return res
            }
        }) : result
    }

    set(key: string, value: any, escape: boolean = true) {
        const func = new Function('value', `return this.data.${key}=value`)
        let result = escape ? func.apply(this, [value]) : this.data[key] = value
        this.write()
        return result
    }

    has(key: string, escape: boolean = true): boolean {
        return escape ? new Function(`return !!this.data.${key}`).apply(this) : !!this.data[key]
    }

    delete(key: string, escape: boolean = true): boolean {
        const result: boolean = escape ? new Function(`return delete this.data.${key}`).apply(this) : delete this.data[key]
        this.write()
        return result
    }

    write() {
        try {
            const raw_data = JSON.stringify(this.data);
            if (raw_data !== this.raw_data) {
                writeFileSync(this.path, raw_data);
                this.raw_data = raw_data;
            }
        } catch (error) {
            this.data = JSON.parse(this.raw_data);
            throw error;
        }
    }
}

export namespace Db {
    export interface Config {
        path: string
        force?: boolean
    }
}
