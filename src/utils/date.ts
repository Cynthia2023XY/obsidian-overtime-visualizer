/** 将本地日期格式化为不受 UTC 时差影响的 ISO 日期 */
export function formatLocalIsoDate(date: Date): string {
  /** 本地年份 */
  const year = date.getFullYear();
  /** 本地月份 */
  const month = String(date.getMonth() + 1).padStart(2, "0");
  /** 本地日号 */
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 在 ISO 日期上移动自然日，并返回新的 ISO 日期 */
export function shiftIsoDate(date: string, days: number): string {
  /** 使用 UTC 避免夏令时造成自然日偏移的日期对象 */
  const shiftedDate = new Date(`${date}T00:00:00Z`);
  shiftedDate.setUTCDate(shiftedDate.getUTCDate() + days);
  return shiftedDate.toISOString().slice(0, 10);
}

/** 返回 ISO 日期对应的月日短标签 */
export function formatMonthDay(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}
