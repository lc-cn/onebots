import * as crypto from "crypto";
import seedRandom from 'seed-random'
const packageJson = require('../package.json')
export const version = packageJson.version

// 合并对象/数组
export function deepMerge(base, ...from) {
    if (base === null || base === undefined) base = from.shift()
    if (from.length === 0) {
        return base;
    }
    if (typeof base !== 'object') {
        return base;
    }
    if (Array.isArray(base)) {
        return Array.from(new Set(base.concat(...from)));
    }
    for (const item of from) {
        for (const key in item) {
            if (base.hasOwnProperty(key)) {
                if (typeof base[key] === 'object') {
                    base[key] = deepMerge(base[key], item[key]);
                } else {
                    base[key] = item[key];
                }
            } else {
                base[key] = item[key];
            }
        }
    }
    return base;
}

export function transformObj(obj, callback) {
    if (!obj) return obj
    if (Array.isArray(obj)) return obj.map(item => transformObj(item, callback))
    if (typeof obj !== 'object') return obj
    return Object.fromEntries(Object.keys(obj).map(key => {
        return [key, callback(key, obj[key])]
    }))
}

// 深拷贝
export function deepClone<T extends any>(obj: T): T {
    if (typeof obj !== 'object') return obj
    if (!obj) return obj
    //判断拷贝的obj是对象还是数组
    if (Array.isArray(obj)) return obj.map((item) => deepClone(item)) as T
    const objClone = {} as T
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            if (obj[key] && typeof obj[key] === "object") {
                objClone[key] = deepClone(obj[key]);
            } else {
                objClone[key] = obj[key];
            }
        }
    }
    return objClone;
}

export function pick<T extends object, K extends keyof T>(source: T, keys?: Iterable<K>, forced?: boolean) {
    if (!keys) return {...source}
    const result = {} as Pick<T, K>
    for (const key of keys) {
        if (forced || key in source) result[key] = source[key]
    }
    return result
}

export function omit<T, K extends keyof T>(source: T, keys?: Iterable<K>) {
    if (!keys) return {...source}
    const result = {...source} as Omit<T, K>
    for (const key of keys) {
        Reflect.deleteProperty(result, key)
    }
    return result
}
export function randomId(seed:string):number
export function randomId(seed:string,length:number):number
export function randomId(seed:string,min:number,max:number):number
export function randomId(seed:string,...args:number[]){
    let [min=0,max=1]=args
    let formatter=(n:number)=>n
    if(args.length===1){
        const len=Math.min(Number.MAX_SAFE_INTEGER.toString().length,args[0])
        min=10**(len-1)
        max=Math.min(Number.MAX_SAFE_INTEGER,10**len-1)
        formatter=(n:number)=>Math.floor(n)
    }
    const rand=seedRandom(seed)
    return formatter(rand()*(max-min)+min)
}
/**
 * 将驼峰命名替换为下划线分割命名
 * @param name
 * @returns
 * @todo 是否应该改名 ToUnderLine()？
 */
export function toLine<T extends string>(name: T) {
    return name.replace(/([A-Z])/g, "_$1").toLowerCase()
}
export interface Class<T=any> {
    new(...args: any[]): T
}

export function Mixin(base: Class, ...classes: Class[]) {
    classes.forEach(ctr => {
        Object.getOwnPropertyNames(ctr.prototype).forEach(name => {
            if (name === 'constructor') return
            base.prototype[name] = ctr.prototype[name];
        });
    });
    return base
}

export function toHump(action: string) {
    return action.replace(/_[\w]/g, (s) => {
        return s[1].toUpperCase()
    })
}

export function remove<T>(list: T[], item: T) {
    const idx = list.indexOf(item)
    if (idx !== -1) list.splice(idx, 1)
}

export function toBool(v: any) {
    if (v === "0" || v === "false")
        v = false
    return Boolean(v)
}

export function uuid() {
    let hex = crypto.randomBytes(16).toString("hex")
    return hex.substr(0, 8) + "-" + hex.substr(8, 4) + "-" + hex.substr(12, 4) + "-" + hex.substr(16, 4) + "-" + hex.substr(20)
}

export function protectedFields<T>(source: T, ...keys: (keyof T)[]): T {
    const protocolValue=(value)=>{
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, value]) => {
            return [key, protocolValue(value)]
        }))
        return `${value}`.split('').map(()=>'*').join('')
    }
    if (!source || typeof source !== 'object') throw new Error('source must is object')
    return Object.fromEntries(Object.entries(source).map(([key, value]) => {
        return [key, keys.includes(key as keyof T) ? protocolValue(value) : value]
    })) as T
}

export function getProperties(obj) {
    if (obj.__proto__ === null) { //说明该对象已经是最顶层的对象
        return [];
    }
    return Object.getOwnPropertyNames(obj).concat(getProperties(obj.__proto__));
}
