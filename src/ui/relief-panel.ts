import type { AttendanceRecord } from "../types/attendance";
import type { ReliefActivityType, ReliefEntry } from "../types/storage";
import type { ReliefActivitySetting } from "../settings";
import { calculateDailyPressureLedger, createReliefActivityDefinitions } from "../analytics/pressure-ledger";

/** 解压快捷面板对外触发的持久化操作 */
export interface ReliefPanelActions {
  onAdd: (type: ReliefActivityType, durationMinutes: number) => Promise<void>;
  onUndo: (id: string) => Promise<void>;
}

/** 格式化用于面板展示的一位小数分数 */
function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

/** 渲染当日解压快捷累计面板 */
export function renderReliefPanel(containerEl: HTMLElement, date: string, record: AttendanceRecord | undefined, entries: ReliefEntry[], settings: ReliefActivitySetting[], actions: ReliefPanelActions): void {
  /** 当日加班压力与解压行为的结算结果 */
  const ledger = calculateDailyPressureLedger(date, record, entries, date, settings);
  /** 当日解压面板根容器 */
  const panelEl = containerEl.createDiv({ cls: "otv-relief-panel" });
  /** 面板标题与当日分数摘要区 */
  const headingEl = panelEl.createDiv({ cls: "otv-relief-panel__heading" });
  /** 面板标题文案容器 */
  const headingCopyEl = headingEl.createDiv();
  headingCopyEl.createEl("h2", { text: "今日解压" });
  headingCopyEl.createEl("p", { text: "解压分只抵扣当天压力，不会跨日结转。" });
  /** 当日已记录的理论解压分 */
  const scoreEl = headingEl.createDiv({ cls: "otv-relief-panel__score" });
  scoreEl.createSpan({ cls: "otv-relief-panel__score-label", text: "今日已累计解压" });
  scoreEl.createEl("strong", { text: `${formatScore(ledger.reliefScore)} 分` });
  scoreEl.createSpan({ text: ledger.status === "pending" ? "最早次日根据下班数据结算" : ledger.status === "settled" ? `当日最终 ${formatScore(ledger.finalScore)} 分` : "当日无有效出勤" });
  /** 四种常用解压行为的快捷按钮网格 */
  const actionsEl = panelEl.createDiv({ cls: "otv-relief-panel__actions" });
  createReliefActivityDefinitions(settings).forEach((definition) => {
    /** 单个解压行为的快捷记录按钮 */
    const buttonEl = actionsEl.createEl("button", { cls: "otv-relief-action" });
    buttonEl.createEl("strong", { text: definition.label });
    buttonEl.createSpan({ text: definition.scoreLabel });
    buttonEl.onclick = () => void actions.onAdd(definition.type, definition.incrementMinutes);
  });
  /** 当日最近一条解压记录 */
  const latestEntry = entries.at(-1);
  if (latestEntry) {
    /** 撤销当日最近一次快捷记录的按钮 */
    const undoButtonEl = panelEl.createEl("button", { cls: "otv-relief-panel__undo", text: "撤销今日上一次记录" });
    undoButtonEl.onclick = () => void actions.onUndo(latestEntry.id);
  }
}
