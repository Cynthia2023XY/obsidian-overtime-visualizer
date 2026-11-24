import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { CompTimePanel } from "./comp-time-panel";
import { PrototypeBoard } from "./prototype-board";
import { renderDatePicker } from "./date-picker";
import { exportJson } from "../export/json-export";
import { CompTimeStore, createMemoryCompTimeAdapter } from "../repository/comp-time-store";
import { ATTENDANCE_RECORD_MOCKS } from "../mocks/attendance-records";
import { DEFAULT_SETTINGS } from "../settings";
import type { AttendanceRecord } from "../types/attendance";
import type { PluginDataRepository } from "../repository/plugin-data-repository";

/** 模拟 Obsidian 宿主接口 */
vi.mock("obsidian", () => ({
  App: vi.fn(),
  Modal: class {
    open() {}
    close() {}
    setTitle() {}
  },
  Notice: vi.fn(),
  Setting: vi.fn(),
  setIcon: vi.fn(),
}));

/** 模拟导出工具 */
vi.mock("../export/json-export", () => ({
  exportJson: vi.fn().mockResolvedValue(undefined),
}));

/** 模拟图表库 */
vi.mock("echarts/core", () => ({
  use: vi.fn(),
  init: vi.fn(() => ({ setOption: vi.fn(), dispose: vi.fn(), resize: vi.fn() })),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** 构造法定节假日或工作日考勤记录 */
function createRecord(
  date: string,
  startMinute: number,
  endMinute: number,
  dayType: AttendanceRecord["dayType"],
  overnightState: AttendanceRecord["overnightState"] = "none",
): AttendanceRecord {
  return {
    ...ATTENDANCE_RECORD_MOCKS[0]!,
    date,
    startMinute,
    endMinute,
    dayType,
    overnightState,
    attendanceState: "complete",
    warnings: [],
    leaveReasons: [],
  };
}

describe("调休统计面板集成测试", () => {
  it("最右列加班事项自动保存且刚输入的文本可立即导出并重新导入", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T12:00:00+08:00"));
    /** 本次编辑的考勤日期 */
    const record = createRecord("2026-11-18", 601, 1295, "workday");
    /** 不改变的考勤来源 */
    const repository = { list: () => [record] } as unknown as PluginDataRepository;
    /** 用于验证重新打开后仍存在事项的磁盘适配器 */
    const adapter = createMemoryCompTimeAdapter();
    /** 当前仓储 */
    const store = new CompTimeStore(adapter);
    await store.initialize();
    /** 用户编辑的面板容器 */
    const root = document.body.appendChild(createDiv());
    new CompTimePanel({} as App, repository, store, vi.fn()).render(root);
    expect(Array.from(root.querySelectorAll("th")).slice(-1)[0]?.textContent).toBe("加班事项");
    /** 明细行最右侧的输入框 */
    const input = root.querySelector<HTMLInputElement>('[aria-label="2026-11-18 加班事项"]')!;
    expect(input.closest("td")).toBe(root.querySelector("tbody tr td:last-child"));
    input.value = "折叠屏适配联调";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    vi.mocked(exportJson).mockClear();
    /** 不等待保存完成即点击导出，导出应主动等待排队写入 */
    const exportButton = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "导出调休")!;
    exportButton.click();
    await store.flush();
    expect(exportJson).toHaveBeenCalledWith(expect.anything(), "调休时长明细", expect.objectContaining({
      totalHours: 1.5,
      items: [expect.objectContaining({ date: "2026-11-18", hours: 1.5, overtimeNote: "折叠屏适配联调" })],
    }));
    /** 重新加载仓储及面板 */
    const reloaded = new CompTimeStore(adapter);
    await reloaded.initialize();
    root.empty();
    new CompTimePanel({} as App, repository, reloaded, vi.fn()).render(root);
    expect(root.querySelector<HTMLInputElement>("tbody input")?.value).toBe("折叠屏适配联调");
    expect(root.textContent).toContain("1.5 小时");
    /** 将实际导出文件导入新的仓储，验证事项往返 */
    const restored = new CompTimeStore();
    await restored.initialize();
    await restored.importCompTimePayload(JSON.stringify(vi.mocked(exportJson).mock.calls[0]![2]));
    expect(restored.getData().overtimeNotes[record.date]).toBe("折叠屏适配联调");
  });

  it("实际工作日10:01至21:35在面板和导出中均显示1.5小时", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T12:00:00+08:00"));
    /** 用户反馈的晚到工作日 */
    const record = createRecord("2026-11-18", 601, 1295, "workday");
    /** 仅提供这条考勤 */
    const repository = { list: () => [record] } as unknown as PluginDataRepository;
    /** 当前调休仓储 */
    const store = new CompTimeStore();
    await store.initialize();
    /** 用户可见的统计区域 */
    const root = document.body.appendChild(createDiv());
    new CompTimePanel({} as App, repository, store, vi.fn()).render(root);
    expect(root.textContent).toContain("1.5 小时");
    expect(root.textContent).not.toContain("2.5 小时");
    expect(root.textContent).toContain("工作日扣除8小时正常工时");
    expect(root.textContent).toContain("2027-01-31");
    vi.mocked(exportJson).mockClear();
    /** 导出当前统计结果 */
    const exportButton = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "导出调休");
    exportButton!.click();
    await store.flush();
    expect(exportJson).toHaveBeenCalledWith(expect.anything(), "调休时长明细", expect.objectContaining({
      totalHours: 1.5,
      items: [expect.objectContaining({ date: "2026-11-18", hours: 1.5 })],
    }));
  });

  it("跨夜次日展示默认09:00及起算说明，避免把推定时间误当凌晨打卡", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T12:00:00+08:00"));
    /** 上班时间已被前一日跨夜占用的休息日 */
    const record = { ...createRecord("2026-11-14", 120, 18 * 60, "rest-day"), attendanceState: "ambiguous-start" as const };
    /** 只提供面板读取所需的考勤数据 */
    const repository = { list: () => [record] } as unknown as PluginDataRepository;
    /** 独立调休仓储 */
    const store = new CompTimeStore();
    await store.initialize();
    /** 用户可见的统计面板 */
    const root = document.body.appendChild(createDiv());
    new CompTimePanel({} as App, repository, store, vi.fn()).render(root);
    expect(root.textContent).toContain("09:00 – 18:00");
    expect(root.textContent).toContain("跨夜次日，默认09:00起算");
    expect(root.textContent).toContain("8 小时");
    expect(root.textContent).not.toContain("02:00");
  });

  it("展示简洁版可提报时长统计，支持当前考勤周期/本月切换及调休导出", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T12:00:00+08:00"));
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });

    const records = [
      // 上个周期月末（10月25日属于10-22~11-21周期，但不属于11月本月）
      createRecord("2026-10-25", 9 * 60, 18 * 60, "rest-day"),
      // 本月工作日加班（09:00-21:40扣2小时吃饭及8小时正常工时后为2.5小时）
      createRecord("2026-11-11", 9 * 60, 21 * 60 + 40, "workday"),
      // 本月跨夜节假日（10:00-次日02:00 -> 跨夜封顶 4小时）
      createRecord("2026-11-14", 10 * 60, 26 * 60, "holiday", "linked"),
    ];

    const repository = {
      list: () => records,
      get: (date: string) => records.find((item) => item.date === date) ?? null,
      listReliefEntries: () => [],
      getSettings: () => DEFAULT_SETTINGS,
    } as unknown as PluginDataRepository;

    const store = new CompTimeStore(createMemoryCompTimeAdapter());
    await store.initialize();

    const root = document.body.appendChild(createDiv());
    const board = new PrototypeBoard({} as App, repository, root, "概览", store);
    board.render();

    const compTab = Array.from(root.querySelectorAll<HTMLButtonElement>(".pv-nav > button"))
      .find((button) => button.textContent === "调休统计");
    expect(compTab).toBeDefined();
    compTab!.click();

    // 不展示多余文案、可用/过期/已使用卡片及确认提报/忽略按钮
    expect(root.textContent).not.toContain("感谢您的辛苦付出");
    expect(root.textContent).not.toContain("可用调休时长");
    expect(root.textContent).not.toContain("确认提报");
    expect(root.textContent).toContain("可提报调休时长");

    // 默认「当前考勤周期」（2026-10-22 ~ 2026-11-21）：8 + 2.5 + 4 = 14.5 小时
    expect(root.textContent).toContain("14.5 小时");
    expect(root.textContent).toContain("2026-10-25");
    expect(root.textContent).toContain("考勤周期：每月22日至次月21日");
    expect(root.textContent).toContain("当前周期 2026-10-22 至 2026-11-21");
    expect(Array.from(root.querySelectorAll("button")).some((button) => button.textContent === "当前考勤周期")).toBe(true);

    // 切换到「本月」（2026-11-01 ~ 2026-11-20）：2.5 + 4 = 6.5 小时
    const monthButton = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "本月");
    expect(monthButton).toBeDefined();
    monthButton!.click();

    expect(root.textContent).toContain("6.5 小时");
    expect(root.textContent).not.toContain("2026-10-25");

    // 导出调休 JSON
    vi.mocked(exportJson).mockClear();
    const exportButton = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "导出调休");
    expect(exportButton).toBeDefined();
    exportButton!.click();
    await store.flush();

    expect(exportJson).toHaveBeenCalledWith(
      expect.anything(),
      "调休时长明细",
      expect.objectContaining({
        format: "overtime-visualizer-comp-time",
        startDate: "2026-11-01",
        endDate: "2026-11-20",
        totalHours: 6.5,
      }),
    );
    /** 返回考勤周期后恢复完整周期内的统计 */
    const cycleButton = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "当前考勤周期");
    cycleButton!.click();
    expect(root.textContent).toContain("14.5 小时");
    expect(root.textContent).toContain("2026-10-25");
  });

  it("日期选择器点击左右切换月份按钮时保持浮层打开且正确切换月份", () => {
    const host = document.body.appendChild(createDiv());
    const onChange = vi.fn();
    renderDatePicker(host, "起始日期", "2026-11-20", onChange);

    const trigger = host.querySelector<HTMLButtonElement>(".pv-date-trigger");
    const popover = host.querySelector<HTMLElement>(".pv-date-popover");
    expect(trigger).not.toBeNull();
    expect(popover).not.toBeNull();

    trigger!.click();
    expect(popover!.hidden).toBe(false);
    expect(popover!.textContent).toContain("2026 年 11 月");

    const prevButton = popover!.querySelector<HTMLButtonElement>('[aria-label="上个月"]');
    expect(prevButton).not.toBeNull();
    prevButton!.focus();
    prevButton!.click();

    expect(popover!.hidden).toBe(false);
    expect(popover!.textContent).toContain("2026 年 10 月");
  });
});
