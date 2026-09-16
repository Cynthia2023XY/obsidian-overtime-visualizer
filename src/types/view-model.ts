/** 指标卡的展示数据 */
export interface SummaryCardViewModel {
  label: string;
  value: string;
  detail: string;
  tone: "neutral" | "positive" | "warning" | "danger";
}

/** 日级时间轴的单个图表数据点 */
export interface TimelinePointViewModel {
  date: string;
  weekday: string;
  startMinute: number;
  endMinute: number;
  presenceMinutes: number;
  startLabel: string;
  endLabel: string;
  modifier?: "release" | "overnight";
}

/** 下班时间折线图的单日数据点 */
export interface DepartureTrendPointViewModel {
  date: string;
  dateLabel: string;
  weekday: string;
  endMinute: number | null;
  endLabel: string;
  tone: "normal" | "nine-to-nine-thirty" | "nine-thirty-to-ten" | "ten-to-eleven" | "eleven-to-eleven-thirty" | "eleven-thirty-to-midnight" | "overnight" | "missing";
  isWeekend: boolean;
}

/** 指标卡映射前的数值统计结果 */
export interface AttendanceSummary {
  validAttendanceDays: number;
  excludedDays: number;
  averagePresenceMinutes: number | null;
  averageEndMinute: number | null;
  afterBenchmarkDays: number;
  overnightDays: number;
  ambiguousDays: number;
  releaseDays: number;
}

/** 数据管理表格的静态行数据 */
export interface AttendanceTableRowViewModel {
  date: string;
  weekday: string;
  type: string;
  start: string;
  end: string;
  duration: string;
  state: string;
}

/** 月度日历热力图的单日展示数据 */
export interface CalendarCellViewModel {
  date: string;
  day: number;
  intensity: 0 | 1 | 2 | 3 | 4 | 5;
  label: string;
  modifier?: "release" | "overnight" | "leave" | "weekend-work";
}

/** 滚动 30 天下班热力图的单日展示数据 */
export interface RollingHeatmapCellViewModel {
  date: string;
  dateLabel: string;
  weekdayLabel: string;
  endLabel: string;
  tone: "before-nine" | "nine-to-nine-thirty" | "nine-thirty-to-ten" | "ten-to-eleven" | "eleven-to-eleven-thirty" | "eleven-thirty-to-midnight" | "overnight" | "missing";
  isWeekend: boolean;
  label: string;
}

/** 月度在岗与下班趋势的聚合数据 */
export interface PeriodMetricViewModel {
  period: string;
  label: string;
  averagePresenceMinutes: number | null;
  averageEndMinute: number | null;
  sampleCount: number;
  excludedCount: number;
}

/** 星期维度下班时间分布的聚合数据 */
export interface WeekdayMetricViewModel {
  weekday: number;
  label: string;
  averageEndMinute: number | null;
  medianEndMinute: number | null;
  sampleCount: number;
}
