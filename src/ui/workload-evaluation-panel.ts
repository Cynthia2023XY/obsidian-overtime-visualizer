import type { RollingWorkloadEvaluation, WorkloadLevel } from "../analytics/workload-evaluation";
import { formatClockMinute } from "../utils/time";

/** 压力等级对应的样式名称 */
const LEVEL_CLASS_NAMES: Record<WorkloadLevel, string> = {
  relaxed: "relaxed",
  moderate: "moderate",
  tired: "tired",
  painful: "painful",
  insufficient: "insufficient",
};

/** 将前后 30 天下班中位数比较转换成一句话 */
function formatComparison(evaluation: RollingWorkloadEvaluation): string {
  /** 当前与前一窗口的下班对比 */
  const comparison = evaluation.comparison;
  if (comparison.direction === "insufficient" || comparison.differenceMinute === null) return "与前 30 天相比：数据不足";
  if (comparison.direction === "stable") return `与前 30 天基本持平（${formatClockMinute(comparison.currentMedianMinute)}）`;
  /** 下班变化分钟数的绝对值 */
  const difference = Math.abs(comparison.differenceMinute);
  return `较前 30 天${comparison.direction === "later" ? "晚" : "早"} ${difference} 分钟`;
}

/** 渲染固定近 30 天压力评价与解释维度 */
export function renderWorkloadEvaluation(containerEl: HTMLElement, evaluation: RollingWorkloadEvaluation): void {
  /** 近 30 天评价面板 */
  const panelEl = containerEl.createDiv({ cls: "otv-evaluation" });
  /** 综合评价主信息 */
  const overviewEl = panelEl.createDiv({ cls: "otv-evaluation__overview" });
  overviewEl.createDiv({ cls: "otv-evaluation__eyebrow", text: `${evaluation.rangeStart} 至 ${evaluation.rangeEnd}` });
  overviewEl.createEl("h2", { text: "近 30 天下班压力" });
  overviewEl.createDiv({
    cls: `otv-evaluation__level otv-evaluation__level--${LEVEL_CLASS_NAMES[evaluation.overallLevel]}`,
    text: evaluation.overallLabel,
  });
  overviewEl.createEl("p", { text: formatComparison(evaluation) });

  /** 评价依据明细 */
  const detailsEl = panelEl.createDiv({ cls: "otv-evaluation__details" });
  /** 九点后下班评价明细 */
  const afterNineEl = detailsEl.createDiv({ cls: "otv-evaluation-detail" });
  afterNineEl.createSpan({ text: "21:00 后" });
  afterNineEl.createEl("strong", { text: `${evaluation.metrics.afterNineDays} 天 · ${evaluation.afterNine.label}` });
  afterNineEl.createEl("small", { text: evaluation.afterNine.description });
  /** 十点后下班评价明细 */
  const afterTenEl = detailsEl.createDiv({ cls: "otv-evaluation-detail" });
  afterTenEl.createSpan({ text: "22:00 后" });
  afterTenEl.createEl("strong", { text: `${evaluation.metrics.afterTenDays} 天 · ${evaluation.afterTen.label}` });
  afterTenEl.createEl("small", { text: evaluation.afterTen.description });
  /** 跨夜加班提示明细 */
  const overnightEl = detailsEl.createDiv({ cls: "otv-evaluation-detail" });
  overnightEl.createSpan({ text: "跨夜加班" });
  overnightEl.createEl("strong", { text: `${evaluation.metrics.overnightDays} 天` });
  overnightEl.createEl("small", { text: evaluation.metrics.overnightDays > 0 ? "本周期出现跨夜工作，需要额外关注恢复" : "本周期没有跨夜记录" });
  /** 周末加班提示明细 */
  const weekendEl = detailsEl.createDiv({ cls: "otv-evaluation-detail" });
  weekendEl.createSpan({ text: "周末加班" });
  weekendEl.createEl("strong", { text: `${evaluation.metrics.weekendWorkDays} 天` });
  weekendEl.createEl("small", { text: "只统计周六、周日的有效考勤" });
}
