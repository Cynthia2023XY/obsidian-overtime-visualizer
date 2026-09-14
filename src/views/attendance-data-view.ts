import { ItemView, WorkspaceLeaf } from "obsidian";
import { ATTENDANCE_DATA_DISPLAY_NAME, ATTENDANCE_DATA_VIEW_TYPE, OVERTIME_DASHBOARD_VIEW_TYPE } from "../constants";
import { mapAttendanceTableRows } from "../mappers/secondary-view-mapper";
import type { PluginDataRepository } from "../repository/plugin-data-repository";
import { renderAttendanceTable } from "../ui/attendance-table";
import { ImportPreviewModal } from "../ui/import-preview-modal";

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
    copyEl.createEl("h1", { text: "考勤数据管理" });
    copyEl.createEl("p", { text: `共 ${records.length} 条本地记录，仅在需要核对数据时查看。` });
    /** 数据管理页操作区 */
    const actionsEl = heroEl.createDiv({ cls: "otv-data-hero__actions" });
    /** 返回压力看板的按钮 */
    const dashboardButtonEl = actionsEl.createEl("button", { text: "返回压力看板" });
    dashboardButtonEl.onclick = () => void this.openDashboard();
    /** 从数据管理页继续导入考勤的按钮 */
    const importButtonEl = actionsEl.createEl("button", { cls: "mod-cta", text: "导入数据" });
    importButtonEl.onclick = () => {
      new ImportPreviewModal(this.app, this.repository, () => this.renderDataView()).open();
    };

    renderAttendanceTable(contentEl, mapAttendanceTableRows(records));
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
