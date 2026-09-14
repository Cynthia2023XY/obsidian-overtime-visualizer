/** 仪表盘工具栏当前筛选条件 */
export interface DashboardFilters {
  startMonth: string;
  endMonth: string;
}

/** 仪表盘工具栏向视图暴露的交互回调 */
export interface DashboardToolbarCallbacks {
  onImport: () => void;
  onOpenData: () => void;
  onFiltersChange: (filters: DashboardFilters) => void;
}

/** 渲染仪表盘顶部筛选和导入工具栏 */
export function renderDashboardToolbar(
  containerEl: HTMLElement,
  filters: DashboardFilters,
  callbacks: DashboardToolbarCallbacks,
): void {
  /** 工具栏根容器 */
  const toolbarEl = containerEl.createDiv({ cls: "otv-toolbar" });

  /** 时间筛选分组 */
  const periodGroupEl = toolbarEl.createDiv({ cls: "otv-toolbar__group" });
  periodGroupEl.createSpan({ cls: "otv-toolbar__label", text: "统计区间" });

  /** 可交互的起始月份输入 */
  const startInputEl = periodGroupEl.createEl("input", {
    cls: "otv-input",
    attr: { type: "month", value: filters.startMonth, "aria-label": "起始月份" },
  });

  periodGroupEl.createSpan({ cls: "otv-toolbar__separator", text: "至" });

  /** 可交互的结束月份输入 */
  const endInputEl = periodGroupEl.createEl("input", {
    cls: "otv-input",
    attr: { type: "month", value: filters.endMonth, "aria-label": "结束月份" },
  });

  /** 将输入控件中的最新值同步给仪表盘视图 */
  const notifyFiltersChange = (): void => {
    callbacks.onFiltersChange({
      startMonth: startInputEl.value,
      endMonth: endInputEl.value,
    });
  };
  startInputEl.onchange = notifyFiltersChange;
  endInputEl.onchange = notifyFiltersChange;

  /** 打开独立考勤数据管理视图的按钮 */
  const dataButtonEl = toolbarEl.createEl("button", { cls: "otv-data-button", text: "考勤数据" });
  dataButtonEl.onclick = callbacks.onOpenData;

  /** JSON 数据导入按钮 */
  const importButtonEl = toolbarEl.createEl("button", {
    cls: "mod-cta otv-import-button",
    text: "导入数据",
  });
  importButtonEl.onclick = callbacks.onImport;
}
