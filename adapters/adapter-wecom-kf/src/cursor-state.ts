import { loadKfCursors, persistKfCursors } from "./cursor-store.js";

/**
 * 多客服账号共享的游标状态边界。
 *
 * 所有提交串行合并到最新快照，且持久化成功后才更新内存，避免并发覆盖和
 * 写盘失败后进程内游标提前越过尚未可靠确认的消息。
 */
export class KfCursorState {
    private cursors = new Map<string, string>();
    private commitQueue: Promise<void> = Promise.resolve();

    constructor(private readonly path?: string) {}

    async load(): Promise<void> {
        this.cursors = await loadKfCursors(this.path);
    }

    get(openKfid: string): string {
        return this.cursors.get(openKfid) || "";
    }

    commit(openKfid: string, cursor: string): Promise<void> {
        const persist = async (): Promise<void> => {
            const next = new Map(this.cursors);
            next.set(openKfid, cursor);
            await persistKfCursors(this.path, next);
            this.cursors = next;
        };
        const current = this.commitQueue.then(persist, persist);
        this.commitQueue = current.catch(() => undefined);
        return current;
    }
}
