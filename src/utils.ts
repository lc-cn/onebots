import * as crypto from "crypto";
import { Dict } from "@zhinjs/shared";
import * as fs from "fs";
import * as readline from "readline";
import packageJson from "../package.json" with { type: "json" };
export const version = packageJson.version;
export function readLine(maxLen: number, ...params: Parameters<typeof fs.createReadStream>) {
    return new Promise<string>((resolve, reject) => {
        const result: string[] = [];
        const rl = readline.createInterface({
            input: fs.createReadStream(...params),
            crlfDelay: Infinity,
        });
        rl.on("line", line => {
            result.push(line);
            if (result.length > maxLen) result.shift();
        });
        rl.on("close", () => {
            resolve(result.join("\n"));
        });
        rl.on("error", reject);
    });
}
// 合并对象/数组
export function deepMerge(base, ...from) {
    if (base === null || base === undefined) base = from.shift();
    if (from.length === 0) {
        return base;
    }
    if (typeof base !== "object") {
        return base;
    }
    if (Array.isArray(base)) {
        return Array.from(new Set(base.concat(...from)));
    }
    for (const item of from) {
        for (const key in item) {
            if (base.hasOwnProperty(key)) {
                if (typeof base[key] === "object") {
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
    if (!obj) return obj;
    if (Array.isArray(obj)) return obj.map(item => transformObj(item, callback));
    if (typeof obj !== "object") return obj;
    return Object.fromEntries(
        Object.keys(obj).map(key => {
            return [key, callback(key, obj[key])];
        }),
    );
}

// 深拷贝
export function deepClone<T extends any>(obj: T): T {
    if (typeof obj !== "object") return obj;
    if (!obj) return obj;
    //判断拷贝的obj是对象还是数组
    if (Array.isArray(obj)) return obj.map(item => deepClone(item)) as T;
    const objClone = {} as T;
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

export function pick<T extends object, K extends keyof T>(
    source: T,
    keys?: Iterable<K>,
    forced?: boolean,
) {
    if (!keys) return { ...source };
    const result = {} as Pick<T, K>;
    for (const key of keys) {
        if (forced || key in source) result[key] = source[key];
    }
    return result;
}

export function omit<T, K extends keyof T>(source: T, keys?: Iterable<K>) {
    if (!keys) return { ...source };
    const result = { ...source } as Omit<T, K>;
    for (const key of keys) {
        Reflect.deleteProperty(result, key);
    }
    return result;
}
/**
 * 将驼峰命名替换为下划线分割命名
 * @param name
 * @returns
 * @todo 是否应该改名 ToUnderLine()？
 */
export function toLine<T extends string>(name: T) {
    return name.replace(/([A-Z])/g, "_$1").toLowerCase();
}
export interface Class<T = any> {
    new (...args: any[]): T;
}

export function Mixin(base: Class, ...classes: Class[]) {
    classes.forEach(ctr => {
        Object.getOwnPropertyNames(ctr.prototype).forEach(name => {
            if (name === "constructor") return;
            base.prototype[name] = ctr.prototype[name];
        });
    });
    return base;
}

export function toHump(action: string) {
    return action.replace(/_[\w]/g, s => {
        return s[1].toUpperCase();
    });
}

export function remove<T>(list: T[], item: T) {
    const idx = list.indexOf(item);
    if (idx !== -1) list.splice(idx, 1);
}

export function toBool(v: any) {
    if (v === "0" || v === "false") v = false;
    return Boolean(v);
}

export function uuid() {
    let hex = crypto.randomBytes(16).toString("hex");
    return (
        hex.substr(0, 8) +
        "-" +
        hex.substr(8, 4) +
        "-" +
        hex.substr(12, 4) +
        "-" +
        hex.substr(16, 4) +
        "-" +
        hex.substr(20)
    );
}
export function randomInt(max: number): number;
export function randomInt(min: number, max: number): number;
export function randomInt(...args: number[]) {
    let min = args[0] || 0,
        max = args[1];
    if (args.length === 1) (max = min), (min = 0);
    return Math.floor(Math.random() * (max - min) + min);
}
export function protectedFields<T>(source: T, ...keys: (keyof T | string)[]): T {
    const protocolValue = value => {
        if (value && typeof value === "object")
            return Object.fromEntries(
                Object.entries(value).map(([key, value]) => {
                    return [key, protocolValue(value)];
                }),
            );
        return `${value}`
            .split("")
            .map(() => "*")
            .join("");
    };
    if (!source || typeof source !== "object") throw new Error("source must is object");
    return Object.fromEntries(
        Object.entries(source).map(([key, value]) => {
            return [key, keys.includes(key as keyof T) ? protocolValue(value) : value];
        }),
    ) as T;
}

export function getProperties(obj) {
    if (obj.__proto__ === null) {
        //说明该对象已经是最顶层的对象
        return [];
    }
    return Object.getOwnPropertyNames(obj).concat(getProperties(obj.__proto__));
}

export function setValueToObj(obj: Dict, keys: string[], value: any): boolean;
export function setValueToObj(obj: Dict, key: string, value: any): boolean;
export function setValueToObj(obj: Dict, key: string | string[], value: any) {
    const keys = Array.isArray(key) ? key : key.split(".").filter(Boolean);
    const lastKey = keys.pop();
    if (!lastKey) throw new SyntaxError(`key is empty`);
    while (keys.length) {
        const k = keys.shift() as string;
        obj = Reflect.get(obj, k);
        if (!obj) throw new SyntaxError(`can't set ${lastKey} to undefined`);
    }
    return Reflect.set(obj, lastKey, value);
}
export function getValueOfObj<T = any>(obj: Dict, key: string[]): T;
export function getValueOfObj<T = any>(obj: Dict, key: string): T;
export function getValueOfObj(obj: Dict, key: string | string[]) {
    const keys = Array.isArray(key) ? key : key.split(".").filter(Boolean);
    const lastKey = keys.pop();
    if (!lastKey) throw new SyntaxError(`key is empty`);
    while (keys.length) {
        const k = keys.shift() as string;
        obj = Reflect.get(obj, k);
        if (!obj) throw new SyntaxError(`can't set ${lastKey} to undefined`);
    }
    return Reflect.get(obj, lastKey);
}
export function getDataKeyOfObj(data: any, obj: Dict) {
    const _get = (data: any, obj: Dict, prefix: string[]): string | undefined => {
        for (const [key, value] of Object.entries(obj)) {
            if (value === data) return [...prefix, key].join(".");
            if (!value || typeof value !== "object") continue;
            const result = _get(data, value, prefix);
            if (result) return result;
        }
    };
    return _get(data, obj, []);
}
export function parseObjFromStr(str: string) {
    const result = JSON.parse(str);
    const format = (data: any, keys: string[]): any => {
        if (!data) return;
        if (typeof data !== "object" && typeof data !== "string") return;
        if (typeof data === "object")
            return Object.entries(data).map(([k, v]) => format(v, [...keys, k]));
        if (/\[Function:.+]/.test(data))
            return setValueToObj(
                result,
                [...keys],
                new Function(`return (${data.slice(10, -1)})`)(),
            );
        if (/\[Circular:.+]/.test(data))
            setValueToObj(result, [...keys], getValueOfObj(result, data.slice(10, -1)));
    };
    format(result, []);
    return result;
}
export function stringifyObj(value: any): string {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return `[${value.map(stringifyObj).join()}]`;
    let result: Dict = { ...value },
        cache: WeakMap<object, any> = new WeakMap<object, any>();
    const _stringify = (obj: object, prefix: string[]) => {
        for (const key of Reflect.ownKeys(obj)) {
            if (typeof key === "symbol") continue;
            const val = Reflect.get(obj, key);
            if (!val || typeof val !== "object") {
                if (typeof val === "function") {
                    setValueToObj(
                        result,
                        [...prefix, String(key)],
                        `[Function:${(val + "").replace(/\n/g, "")}]`,
                    );
                    continue;
                }
                setValueToObj(result, [...prefix, String(key)], val);
                continue;
            }
            if (cache.has(val)) {
                setValueToObj(
                    result,
                    [...prefix, String(key)],
                    `[Circular:${getDataKeyOfObj(val, value)}]`,
                );
                continue;
            }
            cache.set(val, getValueOfObj(value, [...prefix, String(key)]));
            _stringify(val, [...prefix, String(key)]);
        }
    };
    _stringify(value, []);
    return JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}
