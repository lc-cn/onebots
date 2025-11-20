import { Dict } from "@zhinjs/shared";

/**
 * OneBot filter utilities
 * Used by both V11 and V12 to filter events
 */
export namespace OneBotFilters {
    type MaybeArray<T = any> = T | T[];
    
    type AttrFilter = {
        [P in keyof Dict]?: MaybeArray | boolean;
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
        const isLogicKey = (key: string) => {
            return [
                "$and",
                "$or",
                "$not",
                "$nor",
                "$regexp",
                "$like",
                "$gt",
                "$gte",
                "$lt",
                "$lte",
                "$between",
            ].includes(key);
        };
        
        const filterFn = (event: Dict, key: string, value: any) => {
            // If key is $and, $or, $not, $nor, recursively call
            if (key === "$and" || key === "$or" || key === "$not" || key === "$nor") {
                if (!value || typeof value !== "object") throw new Error("invalid filter");
                switch (key) {
                    case "$and":
                        return Array.isArray(value)
                            ? value.every(item => filterFn(event, key, item))
                            : Object.entries(value).every(([key, value]) =>
                                  filterFn(event, key, value),
                              );
                    case "$or":
                        return Array.isArray(value)
                            ? value.some(item => filterFn(event, key, item))
                            : Object.entries(value).some(([key, value]) =>
                                  filterFn(event, key, value),
                              );
                    case "$nor":
                        return !filterFn(event, "$or", value);
                    case "$not":
                        return !filterFn(event, "$and", value);
                }
            }
            
            if (typeof value === "boolean" && typeof event[key] !== "boolean") {
                return value;
            }
            
            if (typeof value !== "object") {
                if (key === "$regex" && typeof value === "string")
                    return new RegExp(value).test(String(event));
                if (key === "$like" && typeof value === "string")
                    return String(event).includes(value);
                if (key === "$gt" && typeof value === "number") return Number(event) > value;
                if (key === "$gte" && typeof value === "number") return Number(event) >= value;
                if (key === "$lt" && typeof value === "number") return Number(event) < value;
                if (key === "$lte" && typeof value === "number") return Number(event) <= value;
                return value === event[key];
            }
            
            if (
                key === "$between" &&
                Array.isArray(value) &&
                value.length === 2 &&
                value.every(item => typeof item === "number")
            ) {
                const [start, end] = value as [number, number];
                return Number(event) >= start && Number(event) <= end;
            }
            
            if (Array.isArray(value)) {
                return value.includes(event[key]);
            }
            
            return createFilterFunction(value)(isLogicKey(key) ? event : event[key]);
        };
        
        return (event: Dict) => {
            return Object.entries(filters).every(([key, value]) => filterFn(event, key, value));
        };
    }
}
