import type { AttendanceTableRowViewModel } from "../types/view-model";

/** 渲染独立数据管理页中的完整考勤列表 */
export function renderAttendanceTable(containerEl: HTMLElement, rows: AttendanceTableRowViewModel[]): void {
  /** 数据表面板 */
  const panelEl = containerEl.createDiv({ cls: "otv-panel" });

  /** 数据表标题区 */
  const headingEl = panelEl.createDiv({ cls: "otv-panel__heading otv-panel__heading--row" });

  /** 数据表标题文案区 */
  const titleEl = headingEl.createDiv();
  titleEl.createEl("h2", { text: "考勤数据" });
  titleEl.createEl("p", { text: "查看原始值、计算值和待修正异常。" });

  /** 数据表滚动容器 */
  const tableWrapEl = panelEl.createDiv({ cls: "otv-table-wrap" });

  /** 考勤数据表 */
  const tableEl = tableWrapEl.createEl("table", { cls: "otv-table" });

  /** 考勤数据表头 */
  const headEl = tableEl.createEl("thead").createEl("tr");
  ["日期", "类型", "上班", "下班", "在岗时长", "状态"].forEach((label) => {
    headEl.createEl("th", { text: label });
  });

  /** 考勤数据表体 */
  const bodyEl = tableEl.createEl("tbody");

  if (rows.length === 0) {
    /** 当前筛选范围没有数据时的空状态行 */
    const emptyCellEl = bodyEl.createEl("tr").createEl("td", { cls: "otv-table__empty", text: "当前筛选范围暂无考勤记录" });
    emptyCellEl.colSpan = 6;
  }

  rows.forEach((row) => {
    /** 单条考勤数据行 */
    const rowEl = bodyEl.createEl("tr");
    rowEl.createEl("td", { text: `${row.date} ${row.weekday}` });
    rowEl.createEl("td", { text: row.type });
    rowEl.createEl("td", { text: row.start });
    rowEl.createEl("td", { text: row.end });
    rowEl.createEl("td", { text: row.duration });

    /** 单条考勤数据状态单元格 */
    const stateCellEl = rowEl.createEl("td");
    stateCellEl.createSpan({
      cls: `otv-status${row.state === "跨夜" ? " otv-status--danger" : ""}`,
      text: row.state,
    });
  });
}
