import { reactive } from "vue";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastItem {
    id: number;
    type: ToastType;
    message: string;
}

const MAX_TOASTS = 5;
const DEFAULT_DURATION = 3000;
const ERROR_DURATION = 5000;

/** 模块级 toast 状态，由 ToastHost.vue 渲染 */
export const toasts = reactive<ToastItem[]>([]);

let nextId = 1;

function push(type: ToastType, message: string, duration?: number) {
    const item: ToastItem = { id: nextId++, type, message };
    toasts.push(item);
    while (toasts.length > MAX_TOASTS) {
        toasts.shift();
    }
    const ms = duration ?? (type === "error" ? ERROR_DURATION : DEFAULT_DURATION);
    if (ms > 0) {
        setTimeout(() => remove(item.id), ms);
    }
}

function remove(id: number) {
    const index = toasts.findIndex(t => t.id === id);
    if (index !== -1) {
        toasts.splice(index, 1);
    }
}

export function useToast() {
    return {
        success: (message: string, duration?: number) => push("success", message, duration),
        error: (message: string, duration?: number) => push("error", message, duration),
        warning: (message: string, duration?: number) => push("warning", message, duration),
        info: (message: string, duration?: number) => push("info", message, duration),
        remove,
    };
}
