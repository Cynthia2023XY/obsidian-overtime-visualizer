import { App, Modal, Notice } from "obsidian";
import { parseAttendanceJson } from "../import/extract-payload";
import { prepareAttendanceImport } from "../import/import-service";
import type { PluginDataRepository } from "../repository/plugin-data-repository";
import type { ImportItemAction, ImportPreview } from "../types/import";

/** 导入完成后通知仪表盘刷新数据的回调 */
export type ImportCompletedCallback = () => void | Promise<void>;

/** 导入动作对应的中文展示文案 */
const ACTION_LABELS: Record<ImportItemAction, string> = {
  create: "新增",
  update: "更新",
  skip: "跳过",
  error: "错误",
};

/** 支持 JSON 文件、Markdown 文件和粘贴文本的考勤导入预览弹窗 */
export class ImportPreviewModal extends Modal {
  /** 当前待解析的文件或粘贴文本 */
  private sourceText = "";

  /** 最近一次解析得到的无副作用导入预览 */
  private preview: ImportPreview | null = null;

  /** 标记是否正在执行持久化，避免重复点击 */
  private isCommitting = false;

  /** 预览结果和错误信息的动态展示容器 */
  private previewEl: HTMLElement | null = null;

  /** 确认写入按钮，只有存在可写记录时启用 */
  private commitButtonEl: HTMLButtonElement | null = null;

  /** 创建导入弹窗并注入本地仓储与刷新回调 */
  constructor(
    app: App,
    private readonly repository: PluginDataRepository,
    private readonly onImported: ImportCompletedCallback,
  ) {
    super(app);
  }

  /** 渲染文件选择、文本粘贴、预览和确认写入界面 */
  onOpen(): void {
    this.setTitle("导入考勤数据");
    this.contentEl.addClass("otv-import-modal");

    this.contentEl.createEl("p", {
      cls: "otv-import-modal__description",
      text: "支持 JSON，或包含多个 JSON 代码块的 Markdown。只保留日期、起止时间、日类型和请假原因；姓名、工号与打卡位置不会入库。",
    });

    /** 文件选择区域 */
    const fileFieldEl = this.contentEl.createDiv({ cls: "otv-import-field" });
    fileFieldEl.createEl("label", { text: "选择 JSON 或 Markdown 文件" });
    /** 本地源文件选择控件 */
    const fileInputEl = fileFieldEl.createEl("input", {
      cls: "otv-import-file",
      attr: { type: "file", accept: ".json,.md,application/json,text/markdown,text/plain" },
    });

    /** 文本粘贴区域 */
    const pasteFieldEl = this.contentEl.createDiv({ cls: "otv-import-field" });
    pasteFieldEl.createEl("label", { text: "或粘贴 JSON / Markdown" });
    /** 允许直接粘贴原始数据的文本区域 */
    const textareaEl = pasteFieldEl.createEl("textarea", {
      cls: "otv-import-textarea",
      attr: { rows: "7", placeholder: "粘贴完整的考勤接口响应、考勤列表、记录数组，或包含 JSON 代码块的 Markdown……" },
    });

    /** 选择文件后读取本地文本并自动生成预览 */
    fileInputEl.onchange = () => {
      /** 用户刚刚选择的第一个本地文件 */
      const file = fileInputEl.files?.[0];
      if (!file) return;
      void this.loadFile(file, textareaEl);
    };

    /** 粘贴内容变化后使旧预览失效，避免误写入 */
    textareaEl.oninput = () => {
      this.sourceText = textareaEl.value;
      this.preview = null;
      this.renderPreviewMessage("内容已变化，请重新解析预览。", "neutral");
    };

    /** 解析操作区 */
    const parseActionsEl = this.contentEl.createDiv({ cls: "otv-import-parse-actions" });
    /** 手动触发导入预览的按钮 */
    const parseButtonEl = parseActionsEl.createEl("button", { text: "解析预览" });
    parseButtonEl.onclick = () => this.parsePreview();

    this.previewEl = this.contentEl.createDiv({ cls: "otv-import-preview" });
    this.renderPreviewMessage("数据不会在预览阶段写入本地。", "neutral");

    /** 导入弹窗底部操作区 */
    const actionsEl = this.contentEl.createDiv({ cls: "otv-import-modal__actions" });
    /** 关闭导入弹窗的按钮 */
    const cancelButtonEl = actionsEl.createEl("button", { text: "取消" });
    cancelButtonEl.onclick = () => this.close();
    this.commitButtonEl = actionsEl.createEl("button", { cls: "mod-cta", text: "确认写入" });
    this.commitButtonEl.disabled = true;
    this.commitButtonEl.onclick = () => void this.commitImport();
  }

  /** 读取用户选择的文本文件，并在读取完成后自动生成预览 */
  private async loadFile(file: File, textareaEl: HTMLTextAreaElement): Promise<void> {
    try {
      this.sourceText = await file.text();
      textareaEl.value = this.sourceText;
      this.parsePreview();
    } catch {
      this.preview = null;
      this.renderPreviewMessage("文件读取失败，请确认文件仍可访问。", "error");
    }
  }

  /** 解析、清洗并与本地已有数据比较，生成无副作用导入预览 */
  private parsePreview(): void {
    if (!this.sourceText.trim()) {
      this.preview = null;
      this.renderPreviewMessage("请先选择文件或粘贴数据。", "error");
      return;
    }

    try {
      /** 从 JSON 或 Markdown 中提取的原始考勤列表 */
      const rawItems = parseAttendanceJson(this.sourceText);
      this.preview = prepareAttendanceImport(rawItems, this.repository.list(), this.repository.getSettings());
      this.renderPreview(this.preview);
    } catch (error) {
      this.preview = null;
      /** 对用户可读的导入解析错误 */
      const message = error instanceof Error ? error.message : "无法解析导入内容";
      this.renderPreviewMessage(message, "error");
    }
  }

  /** 渲染导入计数与逐条决策，供用户确认冲突和错误 */
  private renderPreview(preview: ImportPreview): void {
    if (!this.previewEl || !this.commitButtonEl) return;
    this.previewEl.empty();

    /** 新增、更新、跳过和错误的汇总计数 */
    const counts = [
      ["create", "新增", preview.createCount],
      ["update", "更新", preview.updateCount],
      ["skip", "跳过", preview.skipCount],
      ["error", "错误", preview.errorCount],
    ] as const;
    /** 预览计数卡片容器 */
    const countsEl = this.previewEl.createDiv({ cls: "otv-import-counts" });
    counts.forEach(([action, label, count]) => {
      /** 单类处理结果的计数卡片 */
      const countEl = countsEl.createDiv({ cls: `otv-import-count otv-import-count--${action}` });
      countEl.createSpan({ text: label });
      countEl.createEl("strong", { text: String(count) });
    });

    /** 预览详情滚动容器 */
    const detailsEl = this.previewEl.createDiv({ cls: "otv-import-details" });
    /** 最多展示的预览详情，避免大文件阻塞弹窗 */
    const visibleItems = preview.items.slice(0, 100);
    visibleItems.forEach((item) => {
      /** 单条预览决策 */
      const itemEl = detailsEl.createDiv({ cls: "otv-import-preview-item" });
      itemEl.createSpan({ cls: `otv-import-action otv-import-action--${item.action}`, text: ACTION_LABELS[item.action] });
      itemEl.createSpan({ cls: "otv-import-preview-item__date", text: item.date ?? `第 ${item.index + 1} 条` });
      itemEl.createSpan({ cls: "otv-import-preview-item__message", text: item.message });
    });
    if (preview.items.length > visibleItems.length) {
      detailsEl.createDiv({ cls: "otv-import-preview-more", text: `另有 ${preview.items.length - visibleItems.length} 条未展开显示` });
    }

    this.commitButtonEl.disabled = preview.recordsToWrite.length === 0;
    this.commitButtonEl.textContent = preview.recordsToWrite.length > 0 ? `确认写入 ${preview.recordsToWrite.length} 条` : "没有可写入记录";
  }

  /** 渲染解析前提示或解析错误，并同步禁用确认按钮 */
  private renderPreviewMessage(message: string, tone: "neutral" | "error"): void {
    if (!this.previewEl) return;
    this.previewEl.empty();
    this.previewEl.createDiv({ cls: `otv-import-message otv-import-message--${tone}`, text: message });
    if (this.commitButtonEl) {
      this.commitButtonEl.disabled = true;
      this.commitButtonEl.textContent = "确认写入";
    }
  }

  /** 将预览中的新增与更新记录作为一个可回滚批次写入本地 */
  private async commitImport(): Promise<void> {
    if (!this.preview || this.preview.recordsToWrite.length === 0 || this.isCommitting) return;
    this.isCommitting = true;
    if (this.commitButtonEl) {
      this.commitButtonEl.disabled = true;
      this.commitButtonEl.textContent = "正在写入…";
    }

    try {
      /** 本次确认写入的记录数量 */
      const writeCount = this.preview.recordsToWrite.length;
      await this.repository.importBatch(this.preview.recordsToWrite);
      await this.onImported();
      new Notice(`已导入 ${writeCount} 条考勤记录`);
      this.close();
    } catch {
      this.isCommitting = false;
      this.renderPreview(this.preview);
      new Notice("写入失败，本地原数据未被替换，请重试");
    }
  }

  /** 关闭弹窗时释放状态和内容节点 */
  onClose(): void {
    this.sourceText = "";
    this.preview = null;
    this.previewEl = null;
    this.commitButtonEl = null;
    this.contentEl.empty();
  }
}
