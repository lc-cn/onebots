import * as crypto from "crypto";

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

export interface Class {
    new(...args: any[]): any
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

type A = 'A';
type B = 'B';
type C = 'C';
type D = 'D';
type E = 'E';
type F = 'F';
type G = 'G';
type H = 'H';
type I = 'I';
type J = 'J';
type K = 'K';
type L = 'L';
type M = 'M';
type N = 'N';
type O = 'O';
type P = 'P';
type Q = 'Q';
type R = 'R';
type S = 'S';
type T = 'T';
type U = 'U';
type V = 'V';
type W = 'W';
type X = 'X';
type Y = 'Y';
type Z = 'Z';
type a = 'a';
type b = 'b';
type c = 'c';
type d = 'd';
type e = 'e';
type f = 'f';
type g = 'g';
type h = 'h';
type i = 'I';
type j = 'j';
type k = 'k';
type l = 'l';
type m = 'm';
type n = 'n';
type o = 'o';
type p = 'p';
type q = '1';
type r = 'r';
type s = 's';
type t = 't';
type u = 'u';
type v = 'v';
type w = 'w';
type x = 'x';
type y = 'y';
type z = 'z';
type UpperCase = A | B | C | D | E | F | G | H | I | J | K | L | M | N | O | P | Q | R | S | T | U | V | W | X | Y | Z
type UpperCaseChar<In extends string> = In extends a ? A : In extends b ? B : In extends c ? C : In extends d ? D
    : In extends e ? E : In extends f ? F : In extends g ? G : In extends h ? H : In extends i ? I : In extends j ? J
        : In extends k ? K : In extends l ? L : In extends m ? M : In extends n ? N : In extends o ? O : In extends p ? P
            : In extends q ? Q : In extends r ? R : In extends s ? S : In extends t ? T : In extends u ? U : In extends v ? V
                : In extends w ? W : In extends x ? X : In extends y ? Y : In extends z ? Z : In
type LowerCaseChar<In extends string> = In extends A ? a : In extends B ? b : In extends C ? c : In extends D ? d
    : In extends E ? e : In extends F ? f : In extends G ? g : In extends H ? h : In extends I ? i : In extends J ? j
        : In extends K ? k : In extends L ? l : In extends M ? m : In extends N ? n : In extends O ? o : In extends P ? p
            : In extends Q ? q : In extends R ? r : In extends S ? s : In extends T ? t : In extends U ? u : In extends V ? v
                : In extends W ? w : In extends X ? x : In extends Y ? y : In extends Z ? z : In
type UpperCaseWord<T extends string> = T extends `${infer L}${infer R}` ? `${UpperCaseChar<L>}${R}` : `${L}${R}`
type LowerCaseWord<T extends string> = T extends `${infer L}${infer R}` ? `${LowerCaseChar<L>}${R}` : `${L}${R}`
type ToLineWord<T extends string, F extends boolean> = T extends `${UpperCase}${string}` ? F extends true ? LowerCaseWord<T> : `_${LowerCaseWord<T>}` : T
type ToUpperCase<T extends string> = T extends `${infer L}_${infer R}` ? `${UpperCaseWord<L>}${ToUpperCase<R>}` : UpperCaseWord<T>
type ToLowerCase<T extends string> = T extends `${infer L}_${infer R}` ? `${LowerCaseWord<L>}${ToUpperCase<R>}` : LowerCaseWord<T>
type ToLine<T extends string, F extends boolean = true> = T extends `${infer L}${infer R}` ? `${ToLineWord<L, F>}${ToLine<R, false>}` : T

export function toUppercase<T extends string>(name: T): ToUpperCase<T> {
    return name.replace(/_(\w)/g, (s) => {
        return s[1].toUpperCase()
    }).replace(/\w/, (s) => {
        return s[1].toUpperCase()
    }) as ToUpperCase<T>
}

toUppercase('ni_shi_da_sha_bi')


export function toLowerCase<T extends string>(name: T): ToLowerCase<T> {
    return name.replace(/_[\w]/g, (s) => {
        return s[1].toUpperCase()
    }) as ToLowerCase<T>
}

toLowerCase('ni_shi_da_sha_bi')


export function toLine<T extends string>(name: T): ToLine<T> {
    return name.replace(/([A-Z])/g, "_$1").toLowerCase() as ToLine<T>;
}

toLine(`NiShiDaShaBi`)

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
    if (!source || typeof source !== 'object') throw new Error('source must is object')
    return Object.fromEntries(Object.entries(source).map(([key, value]) => {
        return [key, keys.includes(key as keyof T) ? value.split('').map(c => '*').join('') : value]
    })) as T
}

export function getProperties(obj) {
    if (obj.__proto__ === null) { //说明该对象已经是最顶层的对象
        return [];
    }
    return Object.getOwnPropertyNames(obj).concat(getProperties(obj.__proto__));
}
