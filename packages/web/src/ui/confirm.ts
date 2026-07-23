import { reactive } from "vue";

export interface ConfirmOptions {
    title: string;
    message?: string;
    /** 默认「确认」 */
    confirmText?: string;
    /** 默认「取消」 */
    cancelText?: string;
    /** 危险操作，确认按钮使用 danger 样式 */
    danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
    visible: boolean;
}

/** 模块级确认框状态，由 ConfirmHost.vue 渲染 */
export const confirmState = reactive<ConfirmState>({
    visible: false,
    title: "",
});

let pendingResolve: ((value: boolean) => void) | null = null;

export function resolveConfirm(value: boolean) {
    confirmState.visible = false;
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve?.(value);
}

export function useConfirm() {
    function confirm(options: ConfirmOptions): Promise<boolean> {
        // 已有待确认项时先按取消处理，避免 Promise 悬挂
        if (pendingResolve) {
            resolveConfirm(false);
        }
        return new Promise<boolean>(resolve => {
            pendingResolve = resolve;
            confirmState.title = options.title;
            confirmState.message = options.message;
            confirmState.confirmText = options.confirmText ?? "确认";
            confirmState.cancelText = options.cancelText ?? "取消";
            confirmState.danger = options.danger ?? false;
            confirmState.visible = true;
        });
    }

    return { confirm };
}
