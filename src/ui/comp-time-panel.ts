import { App, Modal, Notice, setIcon } from "obsidian";
import { calculateCompTimeReport, getAttendanceCycle } from "../analytics/comp-time";
import { exportJson } from "../export/json-export";
import type { CompTimeStore } from "../repository/comp-time-store";
import type { PluginDataRepository } from "../repository/plugin-data-repository";
import type { CompTimeExportPayload, CompTimeReportRow, CompTimeSourceType } from "../types/comp-time";
import { formatLocalIsoDate } from "../utils/date";
import { formatClockMinute } from "../utils/time";
import { renderDatePicker } from "./date-picker";
import { formatWeekday } from "./month-calendar";

/** 调休来源类型对应的中文展示文案 */
const SOURCE_TYPE_LABELS: Record<CompTimeSourceType, string> = {
  workday: "工作日加班",
  "rest-day": "休息日加班",
  holiday: "法定节假日",
  "special-date": "公司特殊日期",
  manual: "手动新增",
};

/** 展示完整调休计算与提报规则的说明弹窗 */
export class CompTimeRulesModal extends Modal {
  /** 创建规则说明弹窗 */
  constructor(app: App) {
    super(app);
  }

  /** 渲染调休计算与提报规则内容 */
  onOpen(): void {
    this.setTitle("调休统计规则说明");
    /** 有序规则列表 */
    const list = this.contentEl.createEl("ol", { cls: "otv-comp-rules-list" });
    list.createEl("li", { text: "感谢您的辛苦付出。" });
    list.createEl("li", {
      text: "P7（含）以上的专业人员，自加班第二日起可提交加班申请，法定节假日加班或公司公示的特殊日期加班可通过此流程申请，其他日期不适用此流程，特殊工时员工不适用此流程。",
    });
    list.createEl("li", {
      text: "加班时长计算规则：不足0.5小时的不予计算，大于0.5小时小于1小时的按0.5小时计算，其中 12:00-13:00 和 18:00-19:00 为休息吃饭时间，不计入加班时长中。加班调休时长在加班产生的3个月内使用完，无法及时调休的，管理者可以调整使用期限，可以延期一次，一次延3个月（如7月13日加班，需要在9月30日前使用完，如无法使用完，可以延一次，延至12月31日之前使用完）。",
    });
    list.createEl("li", { text: "统计口径：工作日按上下班实际间隔扣除吃饭时间及8小时正常工时；休息日、法定节假日和公司特殊日期仅扣除吃饭时间。净加班时长按0.5小时向下取整。" });
    list.createEl("li", {
      text: "原则上，加班申请需在当前考勤周期关账前（每月21日）提报。系统仅会自动带出当前周期的加班信息，若未提报，将自动清空。请核实加班数据，如需增减，还请您手动操作。跨夜当天最多时长算加4个小时。",
    });
  }
}

/** 渲染简洁版“调休统计”页签的独立 UI 控制器 */
export class CompTimePanel {
  /** 当前统计起始日期（默认当前考勤周期起始日） */
  private startDate: string;

  /** 当前统计结束日期（默认当前考勤周期结束日） */
  private endDate: string;

  /** 当前激活的快捷区间标识 */
  private quickRange: "cycle" | "month" | "custom" = "cycle";

  /** 创建调休统计面板控制器 */
  constructor(
    private readonly app: App,
    private readonly repository: PluginDataRepository,
    private readonly store: CompTimeStore,
    private readonly onRefresh: () => void,
  ) {
    /** 默认以当前本地日期定位当前考勤周期 */
    const cycle = getAttendanceCycle(formatLocalIsoDate(new Date()));
    this.startDate = cycle.startDate;
    this.endDate = cycle.endDate;
  }

  /** 创建带图标的操作按钮 */
  private button(parent: HTMLElement, label: string, action: () => void, icon?: string, cls = ""): HTMLButtonElement {
    /** 按钮节点 */
    const button = parent.createEl("button", { cls, text: label });
    if (icon) {
      /** 按钮前缀图标 */
      const glyph = button.createSpan({ cls: "pv-icon" });
      setIcon(glyph, icon);
      button.prepend(glyph);
    }
    button.onclick = action;
    return button;
  }

  /** 在目标容器内渲染简洁版调休统计页 */
  render(body: HTMLElement): void {
    /** 当前本地日期 */
    const today = formatLocalIsoDate(new Date());
    /** 区间内调休计算结果 */
    const report = calculateCompTimeReport(
      this.repository.list(),
      this.store.getData(),
      this.startDate,
      this.endDate,
    );

    this.renderHeader(body, today);
    this.renderSummaryCard(body, report);
    this.renderTablePanel(body, report.rows);
  }

  /** 等待事项保存后导出最新明细，避免刚输入的文本遗漏 */
  private async exportCompTime(): Promise<void> {
    await this.store.flush();
    /** 保存完成后的当前筛选区间及事项 */
    const report = calculateCompTimeReport(this.repository.list(), this.store.getData(), this.startDate, this.endDate);
    /** 与旧版本兼容并携带加班事项的导出载荷 */
    const payload: CompTimeExportPayload = {
      format: "overtime-visualizer-comp-time",
      version: 1,
      exportedAt: new Date().toISOString(),
      startDate: this.startDate,
      endDate: this.endDate,
      totalHours: report.totalHours,
      items: report.rows.map((row) => ({
        date: row.date,
        hours: row.reportableHours,
        sourceType: row.sourceType,
        referenceExpiresAt: row.referenceExpiresAt,
        overtimeNote: row.overtimeNote,
      })),
    };
    await exportJson(this.app, "调休时长明细", payload);
  }

  /** 渲染标题、导入导出操作与独立的日期筛选栏 */
  private renderHeader(
    body: HTMLElement,
    today: string,
  ): void {
    /** 顶部两段式布局容器 */
    const header = body.createDiv({ cls: "otv-comp-header" });

    /** 第一排：标题与导入导出按钮 */
    const titleRow = header.createDiv({ cls: "otv-comp-title-row" });
    /** 标题文案区 */
    const copy = titleRow.createDiv();
    copy.createEl("h1", { text: "调休统计" });
    copy.createEl("p", {
      text: "工作日扣除8小时正常工时 · 扣除 12:00-13:00 / 18:00-19:00 吃饭时间 · 不足0.5h不计 · 跨夜最多4h",
    });

    /** 辅助操作按钮组 */
    const actionGroup = titleRow.createDiv({ cls: "pv-controls otv-comp-action-group" });
    /** 隐藏的调休 JSON 文件选择器 */
    const fileInput = actionGroup.createEl("input", {
      cls: "otv-comp-hidden-input",
      attr: { type: "file", accept: ".json,application/json" },
    });
    fileInput.onchange = () => {
      /** 用户选中的文件 */
      const file = fileInput.files?.[0];
      if (!file) return;
      void file.text()
        .then((content) => this.store.importCompTimePayload(content))
        .then((result) => {
          new Notice(`已导入 ${result.importedCount} 条调休时长记录`);
          this.onRefresh();
        }, (error: unknown) => {
          new Notice(error instanceof Error ? error.message : "导入调休时长失败");
        });
      fileInput.value = "";
    };

    this.button(actionGroup, "导入调休", () => fileInput.click(), "upload");
    this.button(actionGroup, "导出调休", () => {
      void this.exportCompTime().catch((error: unknown) => {
        new Notice(error instanceof Error ? error.message : "导出调休失败");
      });
    }, "download");
    this.button(actionGroup, "规则说明", () => new CompTimeRulesModal(this.app).open(), "book-open");

    /** 第二排：独立的日期筛选栏 */
    const filterRow = header.createDiv({ cls: "pv-controls otv-comp-filter-row" });
    this.button(filterRow, "当前考勤周期", () => {
      /** 当前考勤周期 */
      const cycle = getAttendanceCycle(today);
      this.startDate = cycle.startDate;
      this.endDate = cycle.endDate;
      this.quickRange = "cycle";
      this.onRefresh();
    }, undefined, this.quickRange === "cycle" ? "is-active" : "");

    this.button(filterRow, "本月", () => {
      this.startDate = `${today.slice(0, 7)}-01`;
      this.endDate = today;
      this.quickRange = "month";
      this.onRefresh();
    }, undefined, this.quickRange === "month" ? "is-active" : "");

    /** 筛选区明确显示考勤周期定义及其实际日期范围 */
    const currentCycle = getAttendanceCycle(today);
    header.createEl("p", {
      text: `考勤周期：每月22日至次月21日 · 当前周期 ${currentCycle.startDate} 至 ${currentCycle.endDate}`,
    });

    filterRow.createDiv({ cls: "otv-comp-filter-divider" });

    renderDatePicker(filterRow, "起始日期", this.startDate, (value) => {
      this.startDate = value;
      if (this.startDate > this.endDate) [this.startDate, this.endDate] = [this.endDate, this.startDate];
      this.quickRange = "custom";
      this.onRefresh();
    });

    renderDatePicker(filterRow, "结束日期", this.endDate, (value) => {
      this.endDate = value;
      if (this.startDate > this.endDate) [this.startDate, this.endDate] = [this.endDate, this.startDate];
      this.quickRange = "custom";
      this.onRefresh();
    });
  }

  /** 渲染可提报调休时长及统计天数卡片 */
  private renderSummaryCard(
    body: HTMLElement,
    report: { rows: CompTimeReportRow[]; totalHours: number },
  ): void {
    /** 统计卡片网格 */
    const metrics = body.createDiv({ cls: "otv-comp-metrics" });
    /** 可提报总时长卡片 */
    const hoursCard = metrics.createDiv({ cls: "pv-metric pv-blue" });
    /** 时长卡片图标 */
    const hoursGlyph = hoursCard.createDiv({ cls: "pv-metric-icon" });
    setIcon(hoursGlyph, "clock");
    /** 时长卡片文案 */
    const hoursCopy = hoursCard.createDiv();
    hoursCopy.createDiv({ text: "可提报调休时长" });
    hoursCopy.createEl("strong", { text: `${report.totalHours} 小时` });
    hoursCopy.createEl("small", { text: `${this.startDate} 至 ${this.endDate}` });

    /** 有效调休天数卡片 */
    const daysCard = metrics.createDiv({ cls: "pv-metric pv-green" });
    /** 天数卡片图标 */
    const daysGlyph = daysCard.createDiv({ cls: "pv-metric-icon" });
    setIcon(daysGlyph, "calendar-check");
    /** 天数卡片文案 */
    const daysCopy = daysCard.createDiv();
    daysCopy.createDiv({ text: "计入调休天数" });
    daysCopy.createEl("strong", { text: `${report.rows.length} 天` });
    daysCopy.createEl("small", { text: "所选区间内有效加班日" });
  }

  /** 渲染简洁的每日可提报明细表格 */
  private renderTablePanel(body: HTMLElement, rows: CompTimeReportRow[]): void {
    /** 表格卡片 */
    const panel = body.createDiv({ cls: "pv-panel" });
    panel.createEl("h2", { text: "可调休明细" });

    if (!rows.length) {
      panel.createEl("p", { text: "所选日期范围内暂无可调休时长记录。" });
      return;
    }

    /** 横向滚动容器 */
    const scroll = panel.createDiv({ cls: "pv-daily-table-scroll" });
    /** 明细表格 */
    const table = scroll.createEl("table", { cls: "pv-table" });
    /** 表头 */
    const header = table.createEl("thead").createEl("tr");
    ["日期", "类型", "打卡时段", "可调休时长", "参考有效期至", "加班事项"].forEach((label) => header.createEl("th", { text: label }));
    /** 表体 */
    const tbody = table.createEl("tbody");

    rows.forEach((row) => {
      /** 明细行 */
      const tr = tbody.createEl("tr");
      /** 日期单元格 */
      const dateCell = tr.createEl("td", { text: row.date });
      dateCell.createEl("small", { cls: "otv-daily-weekday", text: formatWeekday(row.date) });

      /** 类型单元格 */
      const typeCell = tr.createEl("td");
      /** 徽章颜色 */
      const cls = row.sourceType === "holiday"
        ? "pv-purple"
        : row.sourceType === "rest-day" || row.sourceType === "special-date"
          ? "pv-orange"
          : "otv-comp-badge-muted";
      typeCell.createSpan({ cls: `pv-badge ${cls}`, text: SOURCE_TYPE_LABELS[row.sourceType] });

      /** 打卡时段单元格 */
      const punchCell = tr.createEl("td");
      punchCell.createEl("strong", {
        text: `${row.startMinute == null ? "—" : formatClockMinute(row.startMinute)} – ${row.endMinute == null ? "—" : formatClockMinute(row.endMinute)}`,
      });
      if (row.assumedStart) punchCell.createEl("small", { text: "跨夜次日，默认09:00起算" });
      if (row.isOvernight) punchCell.createEl("small", { text: "跨夜（最多4小时）" });

      /** 时长单元格 */
      const hoursCell = tr.createEl("td");
      hoursCell.createEl("strong", { text: `${row.reportableHours} 小时` });
      if (row.fromImport) hoursCell.createEl("small", { text: "已导入校准" });

      tr.createEl("td", { text: row.referenceExpiresAt });
      /** 明细最右侧可直接填写的加班事项 */
      const noteCell = tr.createEl("td");
      /** 每个日期独立命名，便于键盘及辅助技术定位 */
      const input = noteCell.createEl("input", {
        cls: "otv-comp-note-input",
        attr: { type: "text", placeholder: "填写当日加班事项", "aria-label": `${row.date} 加班事项` },
      });
      input.value = row.overtimeNote;
      input.oninput = () => {
        void this.store.setOvertimeNote(row.date, input.value).catch((error: unknown) => {
          new Notice(`${row.date} 加班事项保存失败：${error instanceof Error ? error.message : "请重试"}`);
        });
      };
    });
  }
}
