import {readFileSync, writeFileSync, existsSync} from "fs";
import {deleteValue, getValue, Keys, setValue, Value} from "@zhinjs/shared";

export class Database<T extends object = object> {
    private data: T = {} as any

    constructor(private readonly path: string) {
        if (!this.path.toLowerCase().endsWith('.json')) this.path = this.path + '.json'
        if (!existsSync(this.path)) {
            writeFileSync(this.path, "", "utf-8")
        }
    }

    sync(defaultValue: T) {
        try {
            this.data = JSON.parse(readFileSync(this.path, 'utf-8'))
        } catch {
            this.data = defaultValue
            writeFileSync(this.path, JSON.stringify(defaultValue, null, 2), "utf-8")
        }
    }

    get<K extends Keys<T>>(key: K): Value<T, K> {
        const value = getValue(this.data, key)
        if (typeof value !== 'object') return value as Value<T, K>
        const saveValue = () => {
            this.set(key, value as Value<T, K>)
        }
        return new Proxy(value, {
            set(target, k, v) {
                const res = Reflect.set(target, k, v)
                saveValue()
                return res
            },
            deleteProperty(target, p) {
                const res = Reflect.deleteProperty(target, p)
                saveValue()
                return res
            },
            defineProperty(target, p, r) {
                const res = Reflect.defineProperty(target, p, r)
                saveValue()
                return res
            }
        }) as Value<T, K>
    }

    delete<K extends Keys<T>>(key: K) {
        return deleteValue(this.data,key)
    }

    set<K extends Keys<T>>(key: K, value: Value<T, K>) {
        setValue(this.data, key, value)
        return writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf-8')
    }
}

export namespace Database {
    export interface Config {
        path: string
        force?: boolean
    }
}
