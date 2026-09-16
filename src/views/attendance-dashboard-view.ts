import { ItemView, WorkspaceLeaf } from "obsidian";
import { calculateMonthlyPressureTrend, evaluateRollingThirtyDays } from "../analytics/workload-evaluation";
import {
  ATTENDANCE_DATA_VIEW_TYPE,
  OVERTIME_DASHBOARD_DISPLAY_NAME,
  OVERTIME_DASHBOARD_VIEW_TYPE,
} from "../constants";
import { mapDepartureTrendPoints, mapRollingHeatmapCells, mapWorkloadSummaryCards } from "../mappers/workload-mapper";
import type { PluginDataRepository } from "../repository/plugin-data-repository";
import type { AttendanceQuery } from "../types/storage";
import type { DashboardChartController } from "../ui/chart-controller";
import { renderWorkloadCharts } from "../ui/chart-panels";
import { renderDashboardToolbar, type DashboardFilters } from "../ui/dashboard-toolbar";
import { ImportPreviewModal } from "../ui/import-preview-modal";
import { renderSummaryCards } from "../ui/summary-cards";
import { renderWorkloadEvaluation } from "../ui/workload-evaluation-panel";
import { formatLocalIsoDate, shiftIsoDate } from "../utils/date";

/** 仪表盘日期输入允许的 ISO 日期格式 */
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** 判断字符串是否为真实存在的 ISO 自然日期 */
function isValidIsoDate(date: string): boolean {
  if (!DATE_PATTERN.test(date)) {
    return false;
  }
  /** 按 UTC 解析后用于排除 2 月 31 日等无效日期的标准值 */
  const normalizedDate = new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10);
  return normalizedDate === date;
}

/** 生成含今天在内的近 30 个自然日默认筛选条件 */
function createInitialFilters(): DashboardFilters {
  /** 默认统计区间的当天结束日期 */
  const endDate = formatLocalIsoDate(new Date());
  return {
    startDate: shiftIsoDate(endDate, -29),
    endDate,
  };
}

/** 补齐空日期并将反向区间调整为从早到晚 */
function normalizeFilters(filters: DashboardFilters): DashboardFilters {
  /** 输入均无效时使用的近 30 天默认区间 */
  const defaultFilters = createInitialFilters();
  /** 格式与日期均合法的起始日期 */
  const validStartDate = isValidIsoDate(filters.startDate) ? filters.startDate : undefined;
  /** 格式与日期均合法的结束日期 */
  const validEndDate = isValidIsoDate(filters.endDate) ? filters.endDate : undefined;
  /** 补齐后的起始日期 */
  const startDate = validStartDate ?? validEndDate ?? defaultFilters.startDate;
  /** 补齐后的结束日期 */
  const endDate = validEndDate ?? validStartDate ?? defaultFilters.endDate;
  return startDate <= endDate ? { startDate, endDate } : { startDate: endDate, endDate: startDate };
}

/** 将界面日期条件转换为仓储日期查询 */
function createAttendanceQuery(filters: DashboardFilters): AttendanceQuery {
  return { startDate: filters.startDate, endDate: filters.endDate };
}

/** 聚焦晚下班、跨夜和周末加班的 Obsidian 压力看板 */
export class AttendanceDashboardView extends ItemView {
  /** 当前仪表盘中需要随重绘或关闭清理的图表控制器 */
  private chartController: DashboardChartController | null = null;

  /** 用户当前选择的日期区间 */
  private filters: DashboardFilters;

  /** 创建仪表盘视图并注入已初始化的本地仓储 */
  constructor(
    leaf: WorkspaceLeaf,
    private readonly repository: PluginDataRepository,
  ) {
    super(leaf);
    this.filters = normalizeFilters(createInitialFilters());
  }

  /** 返回 Obsidian 用于识别仪表盘的类型 */
  getViewType(): string {
    return OVERTIME_DASHBOARD_VIEW_TYPE;
  }

  /** 返回仪表盘标签页名称 */
  getDisplayText(): string {
    return OVERTIME_DASHBOARD_DISPLAY_NAME;
  }

  /** 返回仪表盘在左侧栏和标签页使用的图标 */
  getIcon(): string {
    return "activity";
  }

  /** 打开视图时使用本地真实记录渲染压力看板 */
  async onOpen(): Promise<void> {
    this.renderDashboard();
  }

  /** 按当前筛选条件重建评价、指标与图表 */
  private renderDashboard(): void {
    this.chartController?.destroy();
    this.chartController = null;

    /** Obsidian 视图的业务内容容器 */
    const contentEl = this.containerEl.children[1] as HTMLElement;
    contentEl.empty();
    contentEl.addClass("otv-view");

    try {
      /** 当前筛选条件命中的真实考勤记录 */
      const records = this.repository.list(createAttendanceQuery(this.filters));
      /** 本地仓储中不受筛选影响的全部记录 */
      const allRecords = this.repository.list();
      /** 本地仓储中不受筛选影响的总记录数 */
      const totalRecordCount = allRecords.length;

      /** 仪表盘页头区 */
      const heroEl = contentEl.createDiv({ cls: "otv-hero" });
      /** 仪表盘页头文案 */
      const heroCopyEl = heroEl.createDiv();
      heroCopyEl.createEl("h1", { text: "下班压力看板" });
      heroCopyEl.createEl("p", { text: "聚焦晚下班、跨夜和周末加班，数据仅保存在本地。" });

      /** 真实数据加载状态标签 */
      const statusEl = heroEl.createDiv({ cls: "otv-hero__status" });
      statusEl.createSpan({ cls: `otv-hero__status-dot${totalRecordCount > 0 ? " otv-hero__status-dot--ready" : ""}` });
      statusEl.createSpan({ text: totalRecordCount > 0 ? `本地 ${totalRecordCount} 条 · 当前 ${records.length} 条` : "等待导入" });

      renderDashboardToolbar(contentEl, this.filters, {
        onImport: () => {
          new ImportPreviewModal(this.app, this.repository, () => {
            this.filters = normalizeFilters(createInitialFilters());
            this.renderDashboard();
          }).open();
        },
        onOpenData: () => {
          void this.openAttendanceData();
        },
        onFiltersChange: (filters) => {
          this.filters = normalizeFilters(filters);
          this.renderDashboard();
        },
      });

      /** 不受所选区间影响的固定近 30 天压力评价 */
      const rollingEvaluation = evaluateRollingThirtyDays(allRecords);
      /** 当前筛选记录映射得到的六档晚下班指标卡 */
      const summaryCards = mapWorkloadSummaryCards(records);
      /** 当前筛选记录映射得到的下班时间折线点 */
      const departurePoints = mapDepartureTrendPoints(records);
      /** 固定近 30 天评价区间对应的下班热力数据 */
      const heatmapCells = mapRollingHeatmapCells(allRecords, rollingEvaluation.rangeEnd);
      /** 本地全部历史记录按自然月聚合得到的压力指数走势 */
      const monthlyPressurePoints = calculateMonthlyPressureTrend(allRecords);

      renderWorkloadEvaluation(contentEl, rollingEvaluation);
      renderSummaryCards(contentEl, summaryCards);
      this.chartController = renderWorkloadCharts(contentEl, departurePoints, heatmapCells, monthlyPressurePoints);

      contentEl.createEl("p", {
        cls: "otv-disclaimer",
        text: totalRecordCount > 0 ? "比例分母为所选范围内拥有完整、可信下班时间的有效出勤日。" : "尚无考勤数据，请点击“导入数据”选择 JSON 或 Markdown 文件。",
      });
    } catch (error) {
      /** 仪表盘重绘时可供用户理解的错误信息 */
      const message = error instanceof Error ? error.message : "未知错误";
      /** 仪表盘错误状态容器 */
      const errorEl = contentEl.createDiv({ cls: "otv-view-error" });
      errorEl.createEl("h2", { text: "仪表盘加载失败" });
      errorEl.createEl("p", { text: message });
      /** 重新尝试渲染仪表盘的按钮 */
      const retryButtonEl = errorEl.createEl("button", { cls: "mod-cta", text: "重试" });
      retryButtonEl.onclick = () => this.renderDashboard();
    }
  }

  /** 从压力看板打开或聚焦考勤数据管理视图 */
  private async openAttendanceData(): Promise<void> {
    /** 当前已打开的数据管理视图 */
    const existingLeaves = this.app.workspace.getLeavesOfType(ATTENDANCE_DATA_VIEW_TYPE);
    /** 需要打开或聚焦的工作区叶子 */
    const leaf = existingLeaves[0] ?? this.app.workspace.getLeaf("tab");
    if (existingLeaves.length === 0) {
      await leaf.setViewState({ type: ATTENDANCE_DATA_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  /** 关闭视图时销毁图表并清空业务节点 */
  async onClose(): Promise<void> {
    this.chartController?.destroy();
    this.chartController = null;
    /** Obsidian 视图的业务内容容器 */
    const contentEl = this.containerEl.children[1] as HTMLElement;
    contentEl.empty();
  }
}
