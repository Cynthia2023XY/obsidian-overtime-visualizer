/**
 * @projectDoc
 * # 项目访问路径
 *
 * ## Obsidian 插件信息
 * - 开发目录：`obsidian-overtime-visualizer`
 * - 笔记库安装路径：`<Vault>/.obsidian/plugins/obsidian-overtime-visualizer/`
 * - 主命令：`打开加班时长仪表盘`
 */
import { normalizePath, Plugin, WorkspaceLeaf } from "obsidian";
import {
  ATTENDANCE_DATA_VIEW_TYPE,
  OVERTIME_DASHBOARD_DISPLAY_NAME,
  OVERTIME_DASHBOARD_VIEW_TYPE,
} from "./constants";
import { AttendanceDashboardView } from "./views/attendance-dashboard-view";
import { SerializedPluginDataRepository } from "./repository/serialized-plugin-data-repository";
import { AttendanceDataView } from "./views/attendance-data-view";
import type { ReliefVisualizerData } from "./types/storage";
import { OvertimeVisualizerSettingTab } from "./ui/plugin-settings-tab";
import { createCombinedBackup } from "./backup/combined-backup";
import { exportJson } from "./export/json-export";
import { parseSyncPayload } from "./sync/attendance-sync";
import { Notice } from "obsidian";

/** 笔记库内自动抓取结果的默认相对路径 */
export const DEFAULT_ATTENDANCE_SYNC_PATH = "加班时长备份/自动同步/attendance.json";

/** 独立于考勤与解压数据的自动同步配置 */
export interface AttendanceSyncSettings {
  enabled: boolean;
  path: string;
  lastCapturedAt?: string;
}

/** 加班时长可视化插件入口，负责生命周期和功能注册 */
export default class OvertimeVisualizerPlugin extends Plugin {
  /** 已通过版本校验的本地考勤仓储 */
  repository: SerializedPluginDataRepository;

  /** 当前笔记库的自动同步开关与来源路径 */
  syncSettings: AttendanceSyncSettings = { enabled: false, path: DEFAULT_ATTENDANCE_SYNC_PATH };

  /** 避免重叠读取和重复写入同一份考勤快照 */
  private syncInProgress = false;

  /** 本次运行中已成功处理的文件内容 */
  private lastSyncedContent = "";

  /** 已提示的最近一次错误，避免后台检查重复打扰 */
  private lastSyncError = "";

  /** 创建插件并将 Obsidian 持久化 API 注入考勤仓储 */
  constructor(app: ConstructorParameters<typeof Plugin>[0], manifest: ConstructorParameters<typeof Plugin>[1]) {
    super(app, manifest);
    this.repository = new SerializedPluginDataRepository(this, {
      loadReliefData: async () => {
        /** 解压记录独立文件在笔记库中的相对路径 */
        const path = this.getReliefDataPath();
        if (!await this.app.vault.adapter.exists(path)) return null;
        return JSON.parse(await this.app.vault.adapter.read(path)) as unknown;
      },
      saveReliefData: async (data: ReliefVisualizerData) => {
        await this.app.vault.adapter.write(this.getReliefDataPath(), JSON.stringify(data, null, 2));
      },
    });
  }

  /** 返回插件目录中独立解压数据文件的路径 */
  private getReliefDataPath(): string {
    /** 当前插件的笔记库内安装目录 */
    const pluginDirectory = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
    return normalizePath(`${pluginDirectory}/relief-data.json`);
  }

  /** 返回与考勤数据分离的同步配置文件位置 */
  private getSyncSettingsPath(): string {
    // 使用插件 ID 定位当前笔记库内的独立配置
    const directory = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
    return normalizePath(`${directory}/attendance-sync-settings.json`);
  }

  /** 读取已保存的同步配置，缺失时保持关闭 */
  private async loadSyncSettings(): Promise<void> {
    try {
      // 尚未配置时保持默认关闭，不影响既有用户
      if (!await this.app.vault.adapter.exists(this.getSyncSettingsPath())) return;
      // 仅接受有效字段，避免旧配置损坏影响插件启动
      const data = JSON.parse(await this.app.vault.adapter.read(this.getSyncSettingsPath())) as Partial<AttendanceSyncSettings>;
      this.syncSettings = { enabled: data.enabled === true, path: typeof data.path === "string" && data.path.trim() ? normalizePath(data.path) : DEFAULT_ATTENDANCE_SYNC_PATH, lastCapturedAt: typeof data.lastCapturedAt === "string" ? data.lastCapturedAt : undefined };
    } catch {
      new Notice("考勤自动同步设置读取失败，已保持关闭");
    }
  }

  /** 保存同步配置，成功后才更新运行状态 */
  async saveSyncSettings(settings: AttendanceSyncSettings): Promise<void> {
    // 仅允许笔记库内部相对路径，避免误读系统文件
    const path = settings.path.trim();
    if (!path || path.startsWith("/") || path.startsWith("\\") || /^[a-z]:/i.test(path) || path.split(/[\\/]/).includes("..")) throw new Error("请输入笔记库内的相对文件路径");
    // 路径变化后需要重新处理新来源
    const next = { enabled: settings.enabled, path: normalizePath(path), lastCapturedAt: normalizePath(path) === this.syncSettings.path ? this.syncSettings.lastCapturedAt : undefined };
    await this.app.vault.adapter.write(this.getSyncSettingsPath(), JSON.stringify(next, null, 2));
    this.syncSettings = next;
    this.lastSyncedContent = "";
    this.lastSyncError = "";
    if (next.enabled) void this.syncAttendanceFile(false);
  }

  /** 从笔记库读取完整快照并复用既有考勤合并逻辑 */
  async syncAttendanceFile(manual = true): Promise<void> {
    if (this.syncInProgress) return;
    if (!manual && !this.syncSettings.enabled) return;
    this.syncInProgress = true;
    try {
      // 本轮使用同一个文件路径，设置变动时交给下一轮处理
      const sourcePath = this.syncSettings.path;
      // 不存在文件时等待 Codex 首次抓取，手动操作才提示
      if (!await this.app.vault.adapter.exists(sourcePath)) {
        if (manual) new Notice("尚未找到考勤同步文件，请先运行抓取任务");
        return;
      }
      // 文件由抓取任务原子替换，完整性仍由导入层校验
      const content = await this.app.vault.adapter.read(sourcePath);
      if (sourcePath !== this.syncSettings.path || (!manual && !this.syncSettings.enabled)) return;
      if (!manual && content === this.lastSyncedContent) return;
      // 已处理或较旧的快照不能覆盖较新的同步结果
      const capturedAt = parseSyncPayload(content).capturedAt;
      if (this.syncSettings.lastCapturedAt && Date.parse(capturedAt) <= Date.parse(this.syncSettings.lastCapturedAt)) {
        if (manual) new Notice("该考勤快照已处理或早于最近一次同步");
        this.lastSyncedContent = content;
        return;
      }
      // 只有全部记录通过校验才生成写入批次
      const result = await this.repository.importAttendanceSync(content);
      if (sourcePath !== this.syncSettings.path) return;
      // 仅成功处理后记录采集时间；写入失败时可安全重试
      const next = { ...this.syncSettings, lastCapturedAt: capturedAt };
      await this.app.vault.adapter.write(this.getSyncSettingsPath(), JSON.stringify(next, null, 2));
      this.syncSettings = next;
      this.lastSyncedContent = content;
      this.lastSyncError = "";
      if (result.create || result.update) {
        this.refreshDashboard();
        new Notice(`考勤同步完成：新增 ${result.create}，更新 ${result.update}，跳过 ${result.skip}`);
      } else if (manual) new Notice(`考勤已是最新：跳过 ${result.skip} 条`);
    } catch (error) {
      // 相同错误只提示一次，修复后下一轮仍会重试
      const reason = error instanceof Error ? error.message : "未知错误";
      if (manual || reason !== this.lastSyncError) new Notice(`考勤自动同步失败：${reason}`);
      this.lastSyncError = reason;
    } finally {
      this.syncInProgress = false;
    }
  }

  /** 插件启用时注册仪表盘视图、命令和侧边栏入口 */
  async onload(): Promise<void> {
    await this.repository.initialize();
    await this.loadSyncSettings();
    this.addSettingTab(new OvertimeVisualizerSettingTab(this));
    if (this.syncSettings.enabled) void this.syncAttendanceFile(false);
    this.registerInterval(window.setInterval(() => void this.syncAttendanceFile(false), 4 * 60 * 60 * 1000));

    this.registerView(
      OVERTIME_DASHBOARD_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new AttendanceDashboardView(leaf, this.repository),
    );
    this.registerView(
      ATTENDANCE_DATA_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new AttendanceDataView(leaf, this.repository),
    );

    this.addRibbonIcon(
      "clock-3",
      OVERTIME_DASHBOARD_DISPLAY_NAME,
      () => void this.activateDashboard(),
    );

    this.addCommand({
      id: "open-overtime-dashboard",
      name: "打开加班时长仪表盘",
      callback: () => void this.activateDashboard(),
    });

    this.addCommand({
      id: "export-combined-backup",
      name: "导出考勤与解压合并备份",
      callback: () => void exportJson(this.app, "考勤与解压备份", createCombinedBackup(this.repository)),
    });

    this.addCommand({
      id: "export-sanitized-attendance-backup",
      name: "导出脱敏考勤备份",
      callback: () => void this.exportSanitizedBackup(),
    });

    this.addCommand({
      id: "open-attendance-data",
      name: "打开考勤数据管理",
      callback: () => void this.activateAttendanceData(),
    });
    this.addCommand({ id: "sync-attendance-file", name: "从本地文件同步考勤", callback: () => void this.syncAttendanceFile() });
  }

  /** 当设置改变时刷新已打开的仪表盘 */
  refreshDashboard(): void {
    this.app.workspace.getLeavesOfType(ATTENDANCE_DATA_VIEW_TYPE).forEach((leaf) => { if (leaf.view instanceof AttendanceDataView) void leaf.view.refresh(); });
    this.app.workspace.getLeavesOfType(OVERTIME_DASHBOARD_VIEW_TYPE).forEach((leaf) => {
      /** 当前工作区叶子中的仪表盘视图 */
      const view = leaf.view;
      if (view instanceof AttendanceDashboardView) void view.refresh();
    });
  }

  /** 打开或聚焦唯一的加班时长仪表盘 */
  private async activateDashboard(): Promise<void> {
    /** 当前已打开的仪表盘视图 */
    const existingLeaves = this.app.workspace.getLeavesOfType(
      OVERTIME_DASHBOARD_VIEW_TYPE,
    );

    /** 需要打开或聚焦的工作区叶子 */
    const leaf = existingLeaves[0] ?? this.app.workspace.getLeaf("tab");

    if (existingLeaves.length === 0) {
      await leaf.setViewState({
        type: OVERTIME_DASHBOARD_VIEW_TYPE,
        active: true,
      });
    }

    await this.app.workspace.revealLeaf(leaf);
  }

  /** 打开或聚焦唯一的考勤数据管理视图 */
  private async activateAttendanceData(): Promise<void> {
    /** 当前已打开的数据管理视图 */
    const existingLeaves = this.app.workspace.getLeavesOfType(ATTENDANCE_DATA_VIEW_TYPE);
    /** 需要打开或聚焦的工作区叶子 */
    const leaf = existingLeaves[0] ?? this.app.workspace.getLeaf("tab");
    if (existingLeaves.length === 0) {
      await leaf.setViewState({ type: ATTENDANCE_DATA_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  /** 将可重新导入的白名单考勤字段导出到默认下载目录 */
  private async exportSanitizedBackup(): Promise<void> {
    // 导出时间同时保存在备份正文，便于确认数据版本
    const exportedAt = new Date().toISOString();
    await exportJson(this.app, "考勤脱敏备份", {
      exportedAt,
      body: { list: this.repository.list().reverse().map((record) => record.source) },
    });
  }
}
