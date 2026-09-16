import type { RollingWorkloadEvaluation, WorkloadLevel } from "../analytics/workload-evaluation";

/** 压力等级对应的样式名称 */
const LEVEL_CLASS_NAMES: Record<WorkloadLevel, string> = {
  relaxed: "relaxed",
  moderate: "moderate",
  tired: "tired",
  painful: "painful",
  insufficient: "insufficient",
};

/** 将前后 30 天标准化压力分比较转换成一句话 */
function formatComparison(evaluation: RollingWorkloadEvaluation): string {
  /** 当前与前一窗口的下班对比 */
  const comparison = evaluation.comparison;
  if (comparison.direction === "insufficient" || comparison.differenceScore === null) return "与前 30 天相比：数据不足";
  if (comparison.direction === "stable") return `较前 30 天压力基本持平（${comparison.currentScore ?? 0} 分）`;
  /** 压力分变化值的绝对值 */
  const difference = Math.abs(comparison.differenceScore);
  /** 可以稳定展示的压力变化百分比 */
  const percentage = comparison.changePercent === null ? "" : `（${Math.abs(comparison.changePercent)}%）`;
  return `较前 30 天压力${comparison.direction === "worsened" ? "上升" : "下降"} ${difference} 分${percentage}`;
}

/** 格式化晚下班档位占有效出勤日的比例 */
function formatBandRatio(ratio: number | null): string {
  return ratio === null ? "有效下班数据不足" : `占有效出勤日 ${ratio}%`;
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
    text: evaluation.scoreEvaluation.score === null ? evaluation.overallLabel : `${evaluation.overallLabel} · ${evaluation.scoreEvaluation.score} 分`,
  });
  overviewEl.createEl("p", { text: evaluation.scoreEvaluation.description });
  overviewEl.createEl("p", { text: formatComparison(evaluation) });

  /** 评价依据明细 */
  const detailsEl = panelEl.createDiv({ cls: "otv-evaluation__details" });
  evaluation.metrics.departureBands.forEach((band) => {
    /** 当前互斥时间档位的评价明细 */
    const bandEl = detailsEl.createDiv({ cls: "otv-evaluation-detail" });
    bandEl.createSpan({ text: band.label });
    bandEl.createEl("strong", { text: `${band.count} 天 · ${band.description}` });
    bandEl.createEl("small", { text: `${formatBandRatio(band.ratio)} · ${band.score} 分/天` });
  });
  /** 压力红线提示明细 */
  const redLineEl = detailsEl.createDiv({ cls: "otv-evaluation-detail otv-evaluation-detail--wide" });
  redLineEl.createSpan({ text: "压力红线" });
  redLineEl.createEl("strong", { text: evaluation.redLineReasons.length > 0 ? `触发 ${evaluation.redLineReasons.length} 项` : "未触发" });
  redLineEl.createEl("small", { text: evaluation.redLineReasons.length > 0 ? evaluation.redLineReasons.join("；") : evaluation.metrics.overnightDays === 1 ? "出现 1 天跨夜，综合等级至少为疲惫" : "本周期没有触发强制升级条件" });
  /** 上线日归因明细 */
  const releaseEl = detailsEl.createDiv({ cls: "otv-evaluation-detail otv-evaluation-detail--wide" });
  releaseEl.createSpan({ text: "上线日归因" });
  releaseEl.createEl("strong", { text: evaluation.releaseAttribution.afterTenDays > 0 ? `${evaluation.releaseAttribution.releaseAfterTenDays}/${evaluation.releaseAttribution.afterTenDays} 天 22:00 后发生在上线日` : "暂无高强度晚归" });
  releaseEl.createEl("small", { text: evaluation.releaseAttribution.description });
  /** 周末加班提示明细 */
  const weekendEl = detailsEl.createDiv({ cls: "otv-evaluation-detail otv-evaluation-detail--wide" });
  weekendEl.createSpan({ text: "周末加班" });
  weekendEl.createEl("strong", { text: `${evaluation.metrics.weekendWorkDays} 天` });
  weekendEl.createEl("small", { text: "只统计周六、周日的有效考勤" });
}
