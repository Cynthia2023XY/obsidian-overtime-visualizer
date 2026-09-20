import { ItemView, normalizePath, Notice, WorkspaceLeaf } from "obsidian";
import { ATTENDANCE_DATA_DISPLAY_NAME, ATTENDANCE_DATA_VIEW_TYPE, OVERTIME_DASHBOARD_VIEW_TYPE } from "../constants";
import { mapAttendanceTableRows } from "../mappers/secondary-view-mapper";
import type { PluginDataRepository } from "../repository/plugin-data-repository";
import { renderAttendanceTable } from "../ui/attendance-table";
import { ImportPreviewModal } from "../ui/import-preview-modal";
import { AttendanceEditModal, importReliefFile, ReliefEditModal } from "../ui/data-management-modals";
import { createReliefActivityDefinitions } from "../analytics/pressure-ledger";

/** 独立展示完整考勤记录的数据管理视图 */
export class AttendanceDataView extends ItemView {
  /** 创建数据管理视图并注入已初始化的本地仓储 */
  constructor(
    leaf: WorkspaceLeaf,
    private readonly repository: PluginDataRepository,
  ) {
    super(leaf);
  }

  /** 返回 Obsidian 用于识别数据管理页的类型 */
  getViewType(): string {
    return ATTENDANCE_DATA_VIEW_TYPE;
  }

  /** 返回数据管理页标签名称 */
  getDisplayText(): string {
    return ATTENDANCE_DATA_DISPLAY_NAME;
  }

  /** 返回数据管理页使用的图标 */
  getIcon(): string {
    return "table-2";
  }

  /** 打开视图时展示所有本地考勤记录 */
  async onOpen(): Promise<void> {
    this.renderDataView();
  }

  /** 重建数据管理页头和完整考勤表 */
  private renderDataView(): void {
    /** Obsidian 视图的业务内容容器 */
    const contentEl = this.containerEl.children[1] as HTMLElement;
    contentEl.empty();
    contentEl.addClass("otv-view");

    /** 当前本地仓储的全部考勤记录 */
    const records = this.repository.list();
    /** 数据管理页头 */
    const heroEl = contentEl.createDiv({ cls: "otv-hero otv-data-hero" });
    /** 数据管理页头文案 */
    const copyEl = heroEl.createDiv();
    copyEl.createEl("h1", { text: "明细数据管理" });
    copyEl.createEl("p", { text: `共 ${records.length} 条考勤记录、${this.repository.listReliefEntries().length} 条解压记录。` });
    /** 数据管理页操作区 */
    const actionsEl = heroEl.createDiv({ cls: "otv-data-hero__actions" });
    /** 返回压力看板的按钮 */
    const dashboardButtonEl = actionsEl.createEl("button", { text: "返回压力看板" });
    dashboardButtonEl.onclick = () => void this.openDashboard();
    /** 从数据管理页继续导入考勤的按钮 */
    const importButtonEl = actionsEl.createEl("button", { cls: "mod-cta", text: "导入考勤" });
    importButtonEl.onclick = () => {
      new ImportPreviewModal(this.app, this.repository, () => this.renderDataView()).open();
    };

    /** 导出所有考勤明细的按钮 */
    const exportAttendanceButtonEl = actionsEl.createEl("button", { text: "导出考勤" });
    exportAttendanceButtonEl.onclick = () => void this.exportData("考勤明细", { body: { list: records.map((record) => record.source) } });

    renderAttendanceTable(contentEl, mapAttendanceTableRows(records), {
      onEdit: (date) => {
        /** 按日期定位的待编辑考勤记录 */
        const record = this.repository.get(date);
        if (record) new AttendanceEditModal(this.app, this.repository, record, () => this.renderDataView()).open();
      },
    });
    this.renderReliefManagement(contentEl);
  }

  /** 渲染可查看、编辑、删除、导入和导出的解压明细区 */
  private renderReliefManagement(containerEl: HTMLElement): void {
    /** 本地保存的全部解压明细 */
    const entries = this.repository.listReliefEntries().reverse();
    /** 解压配置与稳定类型合并得到的展示定义 */
    const definitions = createReliefActivityDefinitions(this.repository.getSettings().reliefActivities);
    /** 解压明细面板 */
    const panelEl = containerEl.createDiv({ cls: "otv-panel" });
    /** 解压明细标题和操作区 */
    const headingEl = panelEl.createDiv({ cls: "otv-panel__heading otv-panel__heading--row" });
    /** 解压明细标题文案 */
    const titleEl = headingEl.createDiv();
    titleEl.createEl("h2", { text: "解压明细" });
    titleEl.createEl("p", { text: "按日期查看并管理每一次解压记录。" });
    /** 解压导入导出操作容器 */
    const actionsEl = headingEl.createDiv({ cls: "otv-data-hero__actions" });
    /** 用于选择解压 JSON 文件的隐藏控件 */
    const inputEl = actionsEl.createEl("input", { attr: { type: "file", accept: ".json,application/json" } });
    inputEl.addClass("otv-hidden-input");
    inputEl.onchange = () => { const file = inputEl.files?.[0]; if (file) void this.importRelief(file); };
    /** 打开解压文件选择器的按钮 */
    const importButtonEl = actionsEl.createEl("button", { text: "导入解压" });
    importButtonEl.onclick = () => inputEl.click();
    /** 导出所有解压明细的按钮 */
    const exportButtonEl = actionsEl.createEl("button", { text: "导出解压" });
    exportButtonEl.onclick = () => void this.exportData("解压明细", { entries });
    /** 解压明细表格外层滚动容器 */
    const tableWrapEl = panelEl.createDiv({ cls: "otv-table-wrap" });
    /** 解压明细表格 */
    const tableEl = tableWrapEl.createEl("table", { cls: "otv-table" });
    /** 解压明细表头 */
    const headEl = tableEl.createEl("thead").createEl("tr");
    ["日期", "解压事项", "时长", "分数", "操作"].forEach((label) => headEl.createEl("th", { text: label }));
    /** 解压明细表体 */
    const bodyEl = tableEl.createEl("tbody");
    entries.forEach((entry) => {
      /** 当前解压记录对应的事项定义 */
      const definition = definitions.find((item) => item.type === entry.type);
      /** 当前解压记录的单次分数 */
      const score = this.repository.getSettings().reliefActivities.find((item) => item.type === entry.type)?.score ?? 0;
      /** 单条解压明细行 */
      const rowEl = bodyEl.createEl("tr");
      rowEl.createEl("td", { text: entry.date }); rowEl.createEl("td", { text: definition?.label ?? entry.type }); rowEl.createEl("td", { text: `${entry.durationMinutes} 分钟` }); rowEl.createEl("td", { text: `${entry.durationMinutes / (definition?.incrementMinutes ?? entry.durationMinutes) * score} 分` });
      /** 单条解压明细操作区 */
      const actionEl = rowEl.createEl("td", { cls: "otv-table__actions" });
      /** 打开解压编辑弹窗的按钮 */
      const editButtonEl = actionEl.createEl("button", { text: "编辑" });
      editButtonEl.onclick = () => new ReliefEditModal(this.app, this.repository, entry, () => this.renderDataView()).open();
    });
  }

  /** 将指定数据导出为笔记库中的 JSON 文件 */
  private async exportData(name: string, data: unknown): Promise<void> {
    /** 用于集中保存导出文件的笔记库目录 */
    const directory = normalizePath("加班时长备份");
    if (!this.app.vault.getAbstractFileByPath(directory)) await this.app.vault.createFolder(directory);
    /** 避免文件名冲突的时间戳 */
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    await this.app.vault.create(normalizePath(`${directory}/${name}-${timestamp}.json`), JSON.stringify(data, null, 2));
    new Notice(`已导出${name}`);
  }

  /** 导入并刷新解压明细 */
  private async importRelief(file: File): Promise<void> {
    try { const count = await importReliefFile(file, this.repository); new Notice(`已导入 ${count} 条解压明细`); this.renderDataView(); } catch (error) { new Notice(error instanceof Error ? error.message : "解压明细导入失败"); }
  }


  /** 从数据管理页打开或聚焦压力看板 */
  private async openDashboard(): Promise<void> {
    /** 当前已打开的压力看板视图 */
    const existingLeaves = this.app.workspace.getLeavesOfType(OVERTIME_DASHBOARD_VIEW_TYPE);
    /** 需要打开或聚焦的工作区叶子 */
    const leaf = existingLeaves[0] ?? this.app.workspace.getLeaf("tab");
    if (existingLeaves.length === 0) {
      await leaf.setViewState({ type: OVERTIME_DASHBOARD_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  /** 关闭数据管理视图时清空业务节点 */
  async onClose(): Promise<void> {
    /** Obsidian 视图的业务内容容器 */
    const contentEl = this.containerEl.children[1] as HTMLElement;
    contentEl.empty();
  }
}
