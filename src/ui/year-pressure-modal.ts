import { App, Modal } from "obsidian";
import type { AttendanceRecord } from "../types/attendance";
import type { ReliefEntry } from "../types/storage";
import type { ReliefActivitySetting } from "../settings";
import { calculateWorkloadMetrics } from "../analytics/workload-evaluation";
import { calculateReliefScore, createReliefActivityDefinitions, summarizePressureLedger } from "../analytics/pressure-ledger";

/** 将分数格式化为紧凑的展示文本 */
function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

/** 展示当年压力与解压统计的截图友好弹窗 */
export class YearPressureModal extends Modal {
  /** 创建年度分享弹窗并注入本地数据 */
  constructor(app: App, private readonly records: AttendanceRecord[], private readonly reliefEntries: ReliefEntry[], private readonly today: string, private readonly reliefSettings: ReliefActivitySetting[]) {
    super(app);
  }

  /** 打开时生成可直接截图的年度统计卡 */
  onOpen(): void {
    this.modalEl.addClass("otv-year-modal");
    this.contentEl.empty();
    /** 当年的四位年份 */
    const year = this.today.slice(0, 4);
    /** 当年范围内的考勤记录 */
    const yearRecords = this.records.filter((record) => record.date >= `${year}-01-01` && record.date <= this.today);
    /** 当年范围内的解压行为 */
    const yearEntries = this.reliefEntries.filter((entry) => entry.date >= `${year}-01-01` && entry.date <= this.today);
    /** 当年加班压力的分档统计 */
    const metrics = calculateWorkloadMetrics(yearRecords);
    /** 当年按日封顶抵扣后的压力账本 */
    const ledger = summarizePressureLedger(yearRecords, yearEntries, this.today, this.reliefSettings);
    /** 弹窗中适合截图的内容卡 */
    const cardEl = this.contentEl.createDiv({ cls: "otv-year-share" });
    cardEl.createDiv({ cls: "otv-year-share__eyebrow", text: `${year}-01-01 至 ${this.today}` });
    cardEl.createEl("h1", { text: `${year} 年工作压力总结` });
    cardEl.createEl("p", { cls: "otv-year-share__subtitle", text: `基于 ${metrics.validAttendanceDays} 个有效出勤日 · 数据仅保存在本地` });
    /** 年度三项压力指标卡网格 */
    const summaryEl = cardEl.createDiv({ cls: "otv-year-share__summary" });
    [["加班压力", ledger.overtimeScore], ["解压指数", ledger.reliefScore], ["最终工作压力", ledger.finalScore]].forEach(([label, score]) => {
      /** 年度单项压力摘要卡 */
      const itemEl = summaryEl.createDiv({ cls: "otv-year-share__metric" });
      itemEl.createSpan({ text: String(label) });
      itemEl.createEl("strong", { text: `${formatScore(Number(score))} 分` });
    });
    cardEl.createEl("h2", { text: "各时段晚归" });
    /** 年度晚归时段列表 */
    const bandsEl = cardEl.createDiv({ cls: "otv-year-share__bands" });
    metrics.departureBands.forEach((band) => {
      /** 单个互斥晚归档位的年度数据行 */
      const rowEl = bandsEl.createDiv({ cls: "otv-year-share__row" });
      rowEl.createSpan({ text: band.label });
      rowEl.createEl("strong", { text: `${band.count} 天` });
      rowEl.createSpan({ text: `${band.ratio ?? 0}%` });
    });
    /** 年度解压行为分类统计列表 */
    const reliefEl = cardEl.createDiv({ cls: "otv-year-share__relief" });
    reliefEl.createEl("h2", { text: "解压方式" });
    createReliefActivityDefinitions(this.reliefSettings).forEach((definition) => {
      /** 当年单个解压类型的全部记录 */
      const activityEntries = yearEntries.filter((entry) => entry.type === definition.type);
      /** 单个解压类型的展示行 */
      const rowEl = reliefEl.createDiv({ cls: "otv-year-share__row" });
      rowEl.createSpan({ text: definition.label });
      rowEl.createEl("strong", { text: `${activityEntries.reduce((total, entry) => total + entry.durationMinutes, 0)} 分钟` });
      rowEl.createSpan({ text: `${formatScore(calculateReliefScore(activityEntries, this.reliefSettings))} 分` });
    });
    cardEl.createDiv({ cls: "otv-year-share__footer", text: "解压分仅在行为当日抵扣，每日最终压力最低为 0 分。" });
  }

  /** 关闭弹窗时释放已渲染的年度卡内容 */
  onClose(): void {
    this.contentEl.empty();
  }
}
