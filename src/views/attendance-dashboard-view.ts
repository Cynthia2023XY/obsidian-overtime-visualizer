import { ItemView, WorkspaceLeaf } from "obsidian";
import { OVERTIME_DASHBOARD_DISPLAY_NAME, OVERTIME_DASHBOARD_VIEW_TYPE } from "../constants";
import type { PluginDataRepository } from "../repository/plugin-data-repository";
import { PrototypeBoard } from "../ui/prototype-board";

/** 按原型呈现三页统一工作压力看板 */
export class AttendanceDashboardView extends ItemView {
  /** 当前页面及图表生命周期 */
  private board: PrototypeBoard | null = null;
  /** 创建并注入本地仓储 */
  constructor(leaf: WorkspaceLeaf, private readonly repository: PluginDataRepository) { super(leaf); }
  /** 返回工作区视图类型 */
  getViewType(): string { return OVERTIME_DASHBOARD_VIEW_TYPE; }
  /** 返回标签页名称 */
  getDisplayText(): string { return OVERTIME_DASHBOARD_DISPLAY_NAME; }
  /** 返回看板图标 */
  getIcon(): string { return "activity"; }
  /** 打开时初始化统一看板 */
  async onOpen(): Promise<void> { this.board = new PrototypeBoard(this.app, this.repository, this.containerEl.children[1] as HTMLElement); this.board.render(); }
  /** 设置更新后刷新真实数据 */
  async refresh(): Promise<void> { this.board?.render(); }
  /** 关闭时释放图表资源 */
  async onClose(): Promise<void> { this.board?.destroy(); }
}
