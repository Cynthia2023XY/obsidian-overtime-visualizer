import { afterEach, describe, expect, it, vi } from "vitest";
import type { ButtonComponent, Setting, ToggleComponent } from "obsidian";
import { OvertimeVisualizerSettingTab } from "../src/ui/plugin-settings-tab";
import type OvertimeVisualizerPlugin from "../src/main";
import { DEFAULT_SETTINGS } from "../src/settings";

/** 仅模拟宿主控件，实际表单、草稿合并和保存回调均由插件实现 */
vi.mock("obsidian", () => ({
  Notice: vi.fn(),
  PluginSettingTab: class {
    /** 当前测试独立的设置容器 */
    containerEl = createDiv();
  },
  Setting: class {
    /** 与真实宿主相同的设置行边界 */
    settingEl: HTMLElement;
    /** 为表单创建可真实操作的设置行 */
    constructor(parent: HTMLElement) { this.settingEl = parent.createDiv(); }
    /** 设置行标题不会影响测试控件 */
    setName() { return this; }
    /** 保存状态说明不影响持久化回调 */
    setDesc() { return this; }
    /** 兼容旧版标题渲染 */
    setHeading() { return this; }
    /** 使用真实按钮触发插件保存逻辑 */
    addButton(callback: (button: ButtonComponent) => unknown) {
      // 模拟宿主创建的按钮节点
      const element = this.settingEl.createEl("button");
      // 只实现插件使用的宿主控件方法
      const control = {
        buttonEl: element,
        setButtonText(text: string) { element.textContent = text; return control; },
        setCta() { return control; },
        setDisabled(disabled: boolean) { element.disabled = disabled; return control; },
        onClick(handler: () => unknown) { element.onclick = () => { void handler(); }; return control; },
      };
      callback(control as unknown as ButtonComponent);
      return this;
    }
    /** 使用真实复选框触发即时保存 */
    addToggle(callback: (toggle: ToggleComponent) => unknown) {
      // 测试宿主的开关输入节点
      const element = this.settingEl.createEl("input", { type: "checkbox" });
      // 对齐插件使用的开关控件能力
      const control = {
        toggleEl: element,
        setValue(value: boolean) { element.checked = value; return control; },
        setDisabled(disabled: boolean) { element.disabled = disabled; return control; },
        onChange(handler: (value: boolean) => unknown) { element.onchange = () => { void handler(element.checked); }; return control; },
      };
      callback(control as unknown as ToggleComponent);
      return this;
    }
  },
}));

/** 每项测试销毁独立表单，避免草稿串入下一用例 */
afterEach(() => { document.body.replaceChildren(); });

/** 仓储返回配置副本，模拟真实的草稿与已保存配置隔离 */
function setupSettings(declarative: boolean) {
  // 最近一次成功保存的配置
  let persisted = structuredClone(DEFAULT_SETTINGS);
  // 模拟磁盘保存入口并保留实际传入的完整配置
  const updateSettings = vi.fn((settings: typeof DEFAULT_SETTINGS) => { persisted = structuredClone(settings); return Promise.resolve(); });
  // 提供设置页所需的仓储与看板刷新边界
  const plugin = { app: {}, repository: { getSettings: () => structuredClone(persisted), updateSettings }, refreshDashboard: vi.fn() } as unknown as OvertimeVisualizerPlugin;
  // 两种宿主入口都创建真实设置页对象
  const tab = new OvertimeVisualizerSettingTab(plugin);
  // 设置表单的实际挂载容器
  const root = document.body.appendChild(createDiv());
  if (declarative) {
    // 新版宿主先索引定义，此过程不应保存或绘制表单
    const definition = tab.getSettingDefinitions()[0]!;
    expect(root.childElementCount).toBe(0);
    expect(updateSettings).not.toHaveBeenCalled();
    expect(definition).toHaveProperty("name", "解压事项");
    expect("aliases" in definition && definition.aliases).toContain(DEFAULT_SETTINGS.reliefActivities[0]!.name);
    if (!("render" in definition) || !definition.render) throw new Error("设置定义缺少表单渲染入口");
    definition.render({ settingEl: root } as unknown as Setting, {} as never);
  } else {
    tab.containerEl = root;
    tab.display();
  }
  return { root, updateSettings, current: () => persisted };
}

describe.each([false, true])("设置页保存行为（新版定义入口：%s）", (declarative) => {
  it("保存单项只提交该事项，保留另一事项未保存草稿之外的已存配置", async () => {
    // 在两个事项中分别保留不同的编辑草稿
    const { root, updateSettings, current } = setupSettings(declarative);
    // 首个事项和第二个事项的名称输入框
    const first = root.querySelector<HTMLInputElement>('[aria-label="事项 1 名称"]')!;
    const second = root.querySelector<HTMLInputElement>('[aria-label="事项 2 名称"]')!;
    first.value = "尚未保存的草稿";
    first.dispatchEvent(new Event("input"));
    second.value = "已保存的新事项";
    second.dispatchEvent(new Event("input"));
    root.querySelector<HTMLButtonElement>('[aria-label="保存事项 2"]')!.click();
    await vi.waitFor(() => { expect(updateSettings).toHaveBeenCalledOnce(); });
    expect(current().reliefActivities[0]!.name).toBe(DEFAULT_SETTINGS.reliefActivities[0]!.name);
    expect(current().reliefActivities[1]!.name).toBe("已保存的新事项");
  });

  it("切换启用状态立即保存，不顺带提交当前名称草稿", async () => {
    // 使用与正式设置页一致的独立编辑副本
    const { root, updateSettings, current } = setupSettings(declarative);
    // 名称修改仍需手动保存
    const name = root.querySelector<HTMLInputElement>('[aria-label="事项 1 名称"]')!;
    name.value = "不应随开关保存";
    name.dispatchEvent(new Event("input"));
    // 真实开关事件只提交启用状态
    const toggle = root.querySelector<HTMLInputElement>('[aria-label="启用事项 1"]')!;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));
    await vi.waitFor(() => { expect(updateSettings).toHaveBeenCalledOnce(); });
    expect(current().reliefActivities[0]).toMatchObject({ name: DEFAULT_SETTINGS.reliefActivities[0]!.name, enabled: false });
  });
});
