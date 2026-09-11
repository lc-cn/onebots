export function formatBytes(value?: number): string {
    if (value === undefined || !Number.isFinite(value) || value < 0) return "—";
    const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
    const index =
        value === 0 ? 0 : Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const unit = Math.max(0, index);
    return `${(value / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`;
}

export function formatUptime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "—";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 1) return "不足 1 分钟";
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor(minutes / 60) % 24;
    return `${days ? `${days} 天 ` : ""}${hours ? `${hours} 小时 ` : ""}${minutes % 60} 分钟`;
}

export function resourcePercent(used?: number, total?: number): number {
    if (used === undefined || !total || !Number.isFinite(used) || !Number.isFinite(total)) return 0;
    return Math.max(0, Math.min(100, (used / total) * 100));
}
