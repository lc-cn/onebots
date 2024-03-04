export function formatNum(num: number, toLen: number) {
    let result = "";
    const numStr = String(num);
    for (let i = 0; i < toLen; i++) {
        result = `${numStr[toLen - i] || "0"}${result}`;
    }
    return result;
}
export function formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const days = Math.floor(seconds / (24 * 60 * 60));
    const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((seconds % (60 * 60)) / 60);
    const remainingSeconds = seconds % 60;

    let result = "";
    if (days > 0) {
        result += `${days}天`;
    }
    if (hours > 0) {
        result += `${hours}小时`;
    }
    if (minutes > 0) {
        result += `${minutes}分钟`;
    }
    if (remainingSeconds) {
        result += `${remainingSeconds}秒`;
    }

    return result;
}
export function formatDate(datestamp: number, template?: string): string;
export function formatDate(dateStr: string, template?: string): string;
export function formatDate(date: Date, template?: string): string;
export function formatDate(date: number | string | Date, template: string = "YYYY-MM-DD hh:mm:ss") {
    if (!(date instanceof Date)) date = new Date(date);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours();
    const minute = date.getMinutes();
    const second = date.getSeconds();
    return template
        .replace(/Y+/, str => formatNum(year, str.length))
        .replace("/M+/", str => formatNum(month, str.length))
        .replace("/D+/", str => formatNum(day, str.length))
        .replace("/h+/", str => formatNum(hour, str.length))
        .replace("/m+/", str => formatNum(minute, str.length))
        .replace("/s+/", str => formatNum(second, str.length));
}
export function formatSize(bytes: number) {
    const operators = ["B", "KB", "MB", "GB", "TB"];
    while (bytes > 1024 && operators.length > 1) {
        bytes = bytes / 1024;
        operators.shift();
    }
    return (+bytes.toFixed(0) === bytes ? bytes : bytes.toFixed(2)) + operators[0];
}
