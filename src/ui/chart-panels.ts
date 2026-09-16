import { LineChart } from "echarts/charts";
import { GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import { init, use, type ECharts, type EChartsCoreOption } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import type { MonthlyPressureTrendPoint } from "../analytics/workload-evaluation";
import type { DepartureTrendPointViewModel, RollingHeatmapCellViewModel } from "../types/view-model";
import { formatClockMinute } from "../utils/time";
import { createDashboardChartController, type DashboardChartController } from "./chart-controller";

/** 下班折线图需要的 ECharts 按需模块 */
const DEPARTURE_ECHARTS_MODULES = [LineChart, GridComponent, MarkLineComponent, TooltipComponent, SVGRenderer];
use(DEPARTURE_ECHARTS_MODULES);

/** ECharts tooltip 中需要使用的最小数据结构 */
interface DepartureTooltipParam {
  dataIndex: number;
}

/** 月度压力折线图 tooltip 需要的最小数据结构 */
interface MonthlyPressureTooltipParam {
  dataIndex: number;
}

/** 图表从 Obsidian 主题读取的颜色集合 */
interface ChartColors {
  text: string;
  muted: string;
  border: string;
  accent: string;
  nine: string;
  nineThirty: string;
  ten: string;
  eleven: string;
  elevenThirty: string;
  overnight: string;
  weekend: string;
}

/** 读取 Obsidian 当前主题中可供图表使用的颜色 */
function readChartColors(containerEl: HTMLElement): ChartColors {
  /** 当前图表容器的最终样式 */
  const styles = window.getComputedStyle(containerEl);
  /** 读取 CSS 变量并在主题未定义时使用后备色 */
  const readVariable = (name: string, fallback: string): string => styles.getPropertyValue(name).trim() || fallback;
  return {
    text: readVariable("--text-normal", "#d7d7d7"),
    muted: readVariable("--text-muted", "#999999"),
    border: readVariable("--background-modifier-border", "#3d3d3d"),
    accent: readVariable("--interactive-accent", "#7c6ff0"),
    nine: "#c89b24",
    nineThirty: "#d98218",
    ten: "#e66a2c",
    eleven: "#e0523f",
    elevenThirty: "#dc3f53",
    overnight: "#b52a47",
    weekend: "#2f9e72",
  };
}

/** 返回单个下班趋势点的风险颜色 */
function getPointColor(point: DepartureTrendPointViewModel, colors: ChartColors): string {
  if (point.tone === "overnight") return colors.overnight;
  if (point.tone === "eleven-thirty-to-midnight") return colors.elevenThirty;
  if (point.tone === "eleven-to-eleven-thirty") return colors.eleven;
  if (point.tone === "ten-to-eleven") return colors.ten;
  if (point.tone === "nine-thirty-to-ten") return colors.nineThirty;
  if (point.tone === "nine-to-nine-thirty") return colors.nine;
  if (point.isWeekend) return colors.weekend;
  return colors.accent;
}

/** 格式化下班折线图 tooltip */
function formatDepartureTooltip(rawParams: DepartureTooltipParam | DepartureTooltipParam[], points: DepartureTrendPointViewModel[]): string {
  /** tooltip 事件中第一个系列参数 */
  const param = Array.isArray(rawParams) ? rawParams[0] : rawParams;
  /** tooltip 当前指向的日级下班数据 */
  const point = param ? points[param.dataIndex] : undefined;
  if (!point) return "";
  return `<strong>${point.date} ${point.weekday}</strong><br>下班 ${point.endLabel}${point.isWeekend ? "<br>周末加班" : ""}`;
}

/** 初始化只展示下班时间的 ECharts 折线图 */
function renderDepartureChart(containerEl: HTMLElement, points: DepartureTrendPointViewModel[]): ECharts {
  /** 下班折线图的主题颜色 */
  const colors = readChartColors(containerEl);
  /** 下班折线图实例 */
  const chart = init(containerEl, undefined, { renderer: "svg" });
  /** 所有非空下班时间 */
  const endMinutes = points.flatMap((point) => point.endMinute === null ? [] : [point.endMinute]);
  /** 根据最早下班记录动态调整的纵轴下限 */
  const axisMinimum = Math.min(18 * 60, ...endMinutes.map((minute) => Math.floor(minute / 60) * 60));
  /** 保证六个参考节点可见并根据跨夜记录动态扩展的纵轴上限 */
  const axisMaximum = Math.max(24 * 60, ...endMinutes.map((minute) => Math.ceil((minute + 30) / 60) * 60));
  /** 下班折线图完整配置 */
  const option: EChartsCoreOption = {
    animationDuration: 320,
    grid: { left: 62, right: 76, top: 30, bottom: 54 },
    tooltip: {
      trigger: "axis",
      formatter: (params: unknown) => formatDepartureTooltip(params as DepartureTooltipParam[], points),
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: points.map((point) => point.dateLabel),
      axisLabel: { color: colors.muted, hideOverlap: true },
      axisLine: { lineStyle: { color: colors.border } },
    },
    yAxis: {
      type: "value",
      min: axisMinimum,
      max: axisMaximum,
      interval: 60,
      axisLabel: { color: colors.muted, formatter: (value: number) => formatClockMinute(value) },
      splitLine: { lineStyle: { color: colors.border, type: "dashed" } },
    },
    series: [{
      name: "下班时间",
      type: "line",
      connectNulls: false,
      smooth: 0.18,
      symbolSize: 8,
      lineStyle: { color: colors.accent, width: 2 },
      data: points.map((point) => point.endMinute === null ? null : {
        value: point.endMinute,
        symbol: point.isWeekend ? "diamond" : "circle",
        itemStyle: { color: getPointColor(point, colors) },
      }),
      markLine: {
        symbol: "none",
        silent: true,
        data: [
          { yAxis: 21 * 60, name: "21:00", lineStyle: { color: colors.nine, type: "dashed" }, label: { color: colors.nine, formatter: "21:00", position: "insideEndTop", fontSize: 11, backgroundColor: "rgba(24, 26, 32, 0.82)", padding: [2, 4], borderRadius: 3 } },
          { yAxis: 21 * 60 + 30, name: "21:30", lineStyle: { color: colors.nineThirty, type: "dashed" }, label: { color: colors.nineThirty, formatter: "21:30", position: "insideEndTop", fontSize: 11, backgroundColor: "rgba(24, 26, 32, 0.82)", padding: [2, 4], borderRadius: 3 } },
          { yAxis: 22 * 60, name: "22:00", lineStyle: { color: colors.ten, type: "dashed" }, label: { color: colors.ten, formatter: "22:00", position: "insideEndTop", fontSize: 11, backgroundColor: "rgba(24, 26, 32, 0.82)", padding: [2, 4], borderRadius: 3 } },
          { yAxis: 23 * 60, name: "23:00", lineStyle: { color: colors.eleven, type: "dashed" }, label: { color: colors.eleven, formatter: "23:00", position: "insideEndTop", fontSize: 11, backgroundColor: "rgba(24, 26, 32, 0.82)", padding: [2, 4], borderRadius: 3 } },
          { yAxis: 23 * 60 + 30, name: "23:30", lineStyle: { color: colors.elevenThirty, type: "dashed" }, label: { color: colors.elevenThirty, formatter: "23:30", position: "insideEndTop", fontSize: 11, backgroundColor: "rgba(24, 26, 32, 0.82)", padding: [2, 4], borderRadius: 3 } },
          { yAxis: 24 * 60, name: "00:00+", lineStyle: { color: colors.overnight, type: "dashed" }, label: { color: colors.overnight, formatter: "00:00+", position: "insideEndTop", fontSize: 11, backgroundColor: "rgba(24, 26, 32, 0.82)", padding: [2, 4], borderRadius: 3 } },
        ],
      },
    }],
  };
  chart.setOption(option);
  return chart;
}

/** 格式化月度压力指数 tooltip */
function formatMonthlyPressureTooltip(rawParams: MonthlyPressureTooltipParam | MonthlyPressureTooltipParam[], points: MonthlyPressureTrendPoint[]): string {
  /** tooltip 事件中的首个系列参数 */
  const param = Array.isArray(rawParams) ? rawParams[0] : rawParams;
  /** tooltip 当前指向的月度压力数据 */
  const point = param ? points[param.dataIndex] : undefined;
  if (!point) return "";
  return `<strong>${point.month}</strong><br>压力指数 ${point.score} 分<br>有效出勤 ${point.validAttendanceDays} 天`;
}

/** 初始化全部自然月的压力指数折线图 */
function renderMonthlyPressureChart(containerEl: HTMLElement, points: MonthlyPressureTrendPoint[]): ECharts {
  /** 月度压力图使用的主题颜色 */
  const colors = readChartColors(containerEl);
  /** 月度压力指数图表实例 */
  const chart = init(containerEl, undefined, { renderer: "svg" });
  /** 月度压力折线图完整配置 */
  const option: EChartsCoreOption = {
    animationDuration: 320,
    grid: { left: 54, right: 30, top: 34, bottom: 48 },
    tooltip: {
      trigger: "axis",
      formatter: (params: unknown) => formatMonthlyPressureTooltip(params as MonthlyPressureTooltipParam[], points),
    },
    xAxis: {
      type: "category",
      boundaryGap: true,
      data: points.map((point) => point.label),
      axisLabel: { color: colors.muted, hideOverlap: true },
      axisLine: { lineStyle: { color: colors.border } },
    },
    yAxis: {
      type: "value",
      min: 0,
      axisLabel: { color: colors.muted, formatter: "{value} 分" },
      splitLine: { lineStyle: { color: colors.border, type: "dashed" } },
    },
    series: [{
      name: "压力指数",
      type: "line",
      smooth: 0.2,
      symbol: "circle",
      symbolSize: 8,
      lineStyle: { color: colors.accent, width: 3 },
      itemStyle: { color: colors.accent },
      areaStyle: { color: colors.accent, opacity: 0.08 },
      data: points.map((point) => point.score),
    }],
  };
  chart.setOption(option);
  return chart;
}

/** 渲染连续 30 天下班时间热力图 */
function renderRollingHeatmap(containerEl: HTMLElement, cells: RollingHeatmapCellViewModel[]): void {
  /** 热力图根容器 */
  const heatmapEl = containerEl.createDiv({ cls: "otv-rolling-heatmap" });
  if (cells.length === 0) {
    heatmapEl.createDiv({ cls: "otv-rolling-heatmap__empty", text: "近 30 天暂无打卡数据" });
    return;
  }
  cells.forEach((cell) => {
    /** 单日下班时间热力单元格 */
    const cellEl = heatmapEl.createDiv({ cls: `otv-rolling-heatmap__cell otv-rolling-heatmap__cell--${cell.tone}${cell.isWeekend ? " otv-rolling-heatmap__cell--weekend" : ""}` });
    cellEl.createSpan({ text: cell.dateLabel });
    cellEl.createEl("strong", { text: cell.endLabel });
    cellEl.createEl("small", { text: cell.weekdayLabel });
    cellEl.setAttr("aria-label", cell.label);
  });
}

/** 创建带标题和说明的图表面板 */
function createChartPanel(containerEl: HTMLElement, title: string, description: string): HTMLElement {
  /** 图表面板根容器 */
  const panelEl = containerEl.createDiv({ cls: "otv-panel" });
  /** 图表面板标题区 */
  const headingEl = panelEl.createDiv({ cls: "otv-panel__heading" });
  headingEl.createEl("h2", { text: title });
  headingEl.createEl("p", { text: description });
  return panelEl.createDiv({ cls: "otv-panel__content" });
}

/** 渲染下班趋势和近 30 天热力图并返回生命周期句柄 */
export function renderWorkloadCharts(
  containerEl: HTMLElement,
  departurePoints: DepartureTrendPointViewModel[],
  heatmapCells: RollingHeatmapCellViewModel[],
  monthlyPressurePoints: MonthlyPressureTrendPoint[],
): DashboardChartController {
  /** 全部自然月压力指数走势面板内容 */
  const monthlyPressureContentEl = createChartPanel(containerEl, "月度压力指数走势", "按自然月统计，并统一折算为 20 个有效出勤日的压力分。当前月数据会随考勤更新。 ");
  monthlyPressureContentEl.addClass("otv-echarts-monthly-pressure");
  /** 全部月份压力指数初始化得到的折线图 */
  const monthlyPressureChart = renderMonthlyPressureChart(monthlyPressureContentEl, monthlyPressurePoints);

  /** 下班时间趋势图面板内容 */
  const departureContentEl = createChartPanel(containerEl, "每天下班时间", "折线断点表示无有效下班时间；虚线依次标记 21:00、21:30、22:00、23:00、23:30 和跨夜。");
  departureContentEl.addClass("otv-echarts-departure");
  /** 由所选时间范围 ViewModel 初始化的下班折线图 */
  const departureChart = renderDepartureChart(departureContentEl, departurePoints);
  /** 负责跟踪图表容器尺寸变化的观察器 */
  const resizeObserver = new ResizeObserver(() => {
    monthlyPressureChart.resize();
    departureChart.resize();
  });
  resizeObserver.observe(monthlyPressureContentEl);
  resizeObserver.observe(departureContentEl);

  /** 近 30 天下班热力图面板内容 */
  const heatmapContentEl = createChartPanel(containerEl, "近 30 天下班热力", "颜色由浅至深表示 21:00 后的六档下班压力，绿色边框为周末。");
  renderRollingHeatmap(heatmapContentEl, heatmapCells);
  return createDashboardChartController([monthlyPressureChart, departureChart], resizeObserver);
}
