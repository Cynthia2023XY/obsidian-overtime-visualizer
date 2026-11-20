import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
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
  it("展示简洁版可提报时长统计，支持近一个周期/本月切换及调休导出", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T12:00:00+08:00"));
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });

    const records = [
      // 上个周期月末（10月25日属于10-22~11-21周期，但不属于11月本月）
      createRecord("2026-10-25", 9 * 60, 18 * 60, "rest-day"),
      // 本月工作日加班（09:00-21:40 -> 19:00起算 2.5小时）
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

    // 默认「近一个周期」（2026-10-22 ~ 2026-11-21）：8 + 2.5 + 4 = 14.5 小时
    expect(root.textContent).toContain("14.5 小时");
    expect(root.textContent).toContain("2026-10-25");

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
