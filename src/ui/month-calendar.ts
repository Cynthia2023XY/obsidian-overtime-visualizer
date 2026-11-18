/** 按周一到周日排列的日期标签 */
const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** 将日期字符串显示为对应的中文星期，按日期本身计算以避免时区偏移 */
export function formatWeekday(date: string): string {
    return WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7] ?? "";
}

/** 渲染月历网格，由调用方为每个自然日提供业务内容 */
export function renderMonthDays(parent: HTMLElement, month: string, renderDay: (cells: HTMLElement, date: string, day: number) => void): void {
    // 月历的七列与星期标题
    const cells = parent.createDiv({ cls: "pv-calendar-grid" });
    WEEKDAYS.forEach((day) => cells.createSpan({ text: day, cls: "pv-weekday" }));
    // 月初日期用于计算第一周的前置空位
    const monthBoundary = new Date(`${month}-01T00:00:00Z`);
    // 周一开头时月份首日前的空白列数
    const leadingDays = (monthBoundary.getUTCDay() + 6) % 7;
    // 为空白列占位，让月初日期对齐对应星期
    for (let index = 0; index < leadingDays; index++)
        cells.createSpan();
    monthBoundary.setUTCMonth(monthBoundary.getUTCMonth() + 1, 0);
    // 遍历当月所有自然日，包含闰年二月的最后一天
    for (let day = 1; day <= monthBoundary.getUTCDate(); day++)
        renderDay(cells, `${month}-${String(day).padStart(2, "0")}`, day);
}
