interface HostLifecycleState {
    controller?: AbortController;
    starting?: Promise<void>;
    stopping?: Promise<void>;
}

const states = new WeakMap<object, HostLifecycleState>();

/** 启停任务由宿主实例持有；停止后不回收状态，禁止复用已释放的实例。 */
export function getHostLifecycleState(host: object): HostLifecycleState {
    let state = states.get(host);
    if (!state) {
        state = {};
        states.set(host, state);
    }
    return state;
}
