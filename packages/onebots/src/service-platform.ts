export interface ServicePlatformState {
    /** 迁移快照只接受稳定running/stopped；failed不能被当作用户希望停止。 */
    state: "running" | "stopped" | "transitioning" | "failed";
    running: boolean;
    enabled: boolean;
    loaded: boolean;
    definitionPath: string;
    processId: number | null;
    /** 操作系统提供的实例身份；无法识别时拒绝把它当作可控制实例。 */
    identity: string | null;
    quiescent: boolean;
}

/** 同一原位服务身份的OS边界。所有方法须在服务级锁内调用，未知状态抛固定错误。 */
export interface ServicePlatform {
    inspect(): Promise<ServicePlatformState>;
    /** 禁止自动拉起，停止并证明旧进程及子树已退出；不能仅看主PID为0。 */
    quiesce(): Promise<void>;
    /** 定义文件由迁移文件事务写入；重读定义并恢复启用状态，返回双重稳定停态但绝不启动。 */
    reload(enabled: boolean): Promise<ServicePlatformState>;
    /** 启动或对账现有实例，返回PID、实例身份、定义路径及启用状态均稳定的运行态。 */
    start(): Promise<ServicePlatformState>;
}
