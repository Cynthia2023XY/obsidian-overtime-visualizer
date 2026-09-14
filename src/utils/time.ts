/** 一天包含的分钟数 */
const MINUTES_PER_DAY = 1_440;

/** 将整数分钟时长格式化为中文小时分钟 */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return "—";

  /** 时长中的完整小时数 */
  const hours = Math.floor(minutes / 60);
  /** 时长中除小时外的分钟数 */
  const remainingMinutes = minutes % 60;
  return `${hours}小时${String(remainingMinutes).padStart(2, "0")}分`;
}

/** 将可跨天的分钟时刻格式化为当日或次日时间 */
export function formatClockMinute(minutes: number | null): string {
  if (minutes === null) return "—";

  /** 该时刻跨过的自然日数 */
  const dayOffset = Math.floor(minutes / MINUTES_PER_DAY);
  /** 归一化到当日范围的分钟数 */
  const normalizedMinutes = minutes % MINUTES_PER_DAY;
  /** 归一化后的小时数 */
  const hours = Math.floor(normalizedMinutes / 60);
  /** 归一化后的分钟数 */
  const remainingMinutes = normalizedMinutes % 60;
  /** 按 24 小时制生成的时间文案 */
  const clock = `${String(hours).padStart(2, "0")}:${String(remainingMinutes).padStart(2, "0")}`;
  return dayOffset > 0 ? `次日 ${clock}` : clock;
}

/** 将相对基准时刻的分钟偏差格式化为可读文案 */
export function formatMinuteDeviation(minutes: number | null): string {
  if (minutes === null) return "无有效样本";
  if (minutes === 0) return "与基准时间一致";
  return `相比 21:00 ${minutes > 0 ? "+" : ""}${minutes} 分钟`;
}
