import {EventEmitter} from "events";
import {OneBot} from "@/onebot";
import {Dict} from "@zhinjs/shared";
export interface Service<V extends OneBot.Version>{
    filterFn(event:Dict):boolean
}
export abstract class Service<V extends OneBot.Version> extends EventEmitter{

    protected constructor(public config:OneBot.Config<V>) {
        super();
        this.filterFn=Service.createFilterFunction(config.filters||{})
    }
}
export namespace Service{

    type MaybeArray<T = any> = T | T[];
    type AttrFilter = {
        [P in keyof Dict]?: MaybeArray<P> | boolean;
    };
    export type Filters = AttrFilter | WithFilter | UnionFilter | ExcludeFilter;
    export type WithFilter = {
        $and: Filters;
    };
    export type UnionFilter = {
        $or: Filters;
    };
    export type ExcludeFilter = {
        $not: Filters;
    };

    export function createFilterFunction(filters: Filters) {
        const filterFn = (
            event: Dict,
            key: string,
            value: any,
        ) => {
            if(key === "$and" || key === "$or" || key === "$not") {
                if(!value || typeof value!=='object') throw new Error("invalid filter");
                switch (key) {
                    case "$and":
                        return Array.isArray(value)? value.every((item) => filterFn(event, key, item)) :
                            Object.entries(value).every(([key, value]) => filterFn(event, key, value));
                    case "$or":
                        return Array.isArray(value)? value.some((item) => filterFn(event, key, item)) :
                            Object.entries(value).some(([key, value]) => filterFn(event, key, value));
                    case "$not":
                        return !filterFn(event, '$and', value);
                }
            }
            if (typeof value === "boolean" && typeof event[key] !== "boolean") {
                return value;
            }
            if (typeof value !== "object") {
                return value === event[key];
            }
            if(Array.isArray(value)){
                return value.includes(event[key]);
            }
            return createFilterFunction(value)(event);
        };
        return (event:Dict)=>{
            return Object.entries(filters).every(([key, value]) =>
                filterFn(event, key, value),
            );
        }
    }
}
