import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { init } from "echarts/core";
import { PrototypeBoard } from "./prototype-board";
import { exportJson } from "../export/json-export";
import { getAttendanceDates } from "./attendance-dates";
import { ATTENDANCE_RECORD_MOCKS } from "../mocks/attendance-records";
import { DEFAULT_SETTINGS } from "../settings";
import type { AttendanceRecord } from "../types/attendance";
import type { PluginDataRepository } from "../repository/plugin-data-repository";

/** 宿主窗口与弹窗不参与日期筛选验证 */
vi.mock("obsidian", () => ({ App: vi.fn(), Modal: vi.fn(), Notice: vi.fn(), Setting: vi.fn(), setIcon: vi.fn() }));
/** 仅验证顶部按钮的导出数据，实际磁盘写入由导出模块单独测试 */
vi.mock("../export/json-export", () => ({ exportJson: vi.fn().mockResolvedValue(undefined) }));
/** 保留图表配置以验证日期与真实压力数据的对应关系 */
vi.mock("echarts/core", () => ({ use: vi.fn(), init: vi.fn(() => ({ setOption: vi.fn(), dispose: vi.fn(), resize: vi.fn() })) }));

/** 在 DOM 测试中补齐看板使用的 Obsidian 元素创建方法 */
Object.assign(HTMLElement.prototype, {
    // 按宿主参数创建带文本、样式和表单属性的元素
    createEl(this: HTMLElement, tag: string, options: { cls?: string; text?: string; type?: string; value?: string; placeholder?: string } = {}) {
        // 模拟宿主生成的实际 DOM 节点
        const element = document.createElement(tag);
        if (options.cls) element.className = options.cls;
        if (options.text) element.textContent = options.text;
        // 将表单配置映射到对应属性
        for (const key of ["type", "value", "placeholder"] as const) {
            if (options[key]) element.setAttribute(key, options[key]);
        }
        this.append(element);
        return element;
    },
    // 创建布局容器，复用统一的元素选项
    createDiv(this: HTMLElement, options?: { cls?: string; text?: string }) { return this.createEl("div", options); },
    // 创建内联文本或图标容器
    createSpan(this: HTMLElement, options?: { cls?: string; text?: string }) { return this.createEl("span", options); },
    // 模拟每次重绘前的宿主清理
    empty(this: HTMLElement) { this.replaceChildren(); },
    // 模拟宿主样式类接口
    addClass(this: HTMLElement, ...classes: string[]) { this.classList.add(...classes); },
});

/** 测试结束后恢复时钟并销毁残留 DOM */
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

/** 构造包含真实打卡、空考勤及休息日出勤的记录 */
function attendance(date: string, startMinute: number | null, endMinute: number | null, dayType: AttendanceRecord["dayType"] = "workday"): AttendanceRecord {
    return { ...ATTENDANCE_RECORD_MOCKS[0]!, date, startMinute, endMinute, dayType, attendanceState: startMinute !== null && endMinute !== null ? "complete" : "incomplete", warnings: [], leaveReasons: [], overnightState: "none" };
}

/** 用本地只读仓储渲染真实看板，不接触用户笔记 */
function renderBoard(records: AttendanceRecord[], page = "每日记录") {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T12:00:00+08:00"));
    vi.stubGlobal("ResizeObserver", class {
        // 测试图表无需响应真实窗口布局
        observe() {}
        // 销毁看板时兼容宿主清理
        disconnect() {}
    });
    // 无考勤日期也有解压活动，确保不会因此出现在列表或详情
    const entries = [{ id: "off-day", date: "2026-10-18", type: "sanlian", durationMinutes: 30, createdAt: 0 }];
    // 提供看板所需的本地数据读取边界
    const repository = { list: () => records, get: (date: string) => records.find((record) => record.date === date) ?? null, listReliefEntries: () => entries, getSettings: () => DEFAULT_SETTINGS } as unknown as PluginDataRepository;
    // 测试看板的独立挂载节点
    const root = document.body.appendChild(document.createElement("div"));
    // 可实际操作导航、筛选和详情的看板
    const board = new PrototypeBoard({} as App, repository, root, page);
    board.render();
    return { root, board };
}

describe("仅展示实际打卡日期", () => {
    it("顶部在导入旁展示合并及单独导出入口，导出完整数据而不受每日月份筛选影响", () => {
        vi.mocked(exportJson).mockClear();
        // 不同月份的数据用于验证导出覆盖完整仓储
        const records = [attendance("2026-10-19", 540, null), attendance("2026-09-16", 540, 1200)];
        // 每日记录页只显示当前月份
        const { root } = renderBoard(records);
        // 顶部导入及两个相邻导出按钮
        const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(".pv-nav > button"));
        // 定位现有导入入口
        const index = buttons.findIndex((button) => button.textContent === "导入考勤");
        expect(buttons.slice(index, index + 4).map((button) => button.textContent)).toEqual(["导入考勤", "导出全部", "导出考勤", "导出解压"]);
        buttons[index + 1]!.click();
        expect(exportJson).toHaveBeenLastCalledWith(expect.anything(), "考勤与解压备份", expect.objectContaining({ format: "overtime-visualizer-backup", attendance: records }));
        buttons[index + 2]!.click();
        expect(exportJson).toHaveBeenLastCalledWith(expect.anything(), "考勤明细", { body: { list: records.map((record) => record.source) } });
        buttons[index + 3]!.click();
        expect(exportJson).toHaveBeenLastCalledWith(expect.anything(), "解压明细", { entries: [expect.objectContaining({ id: "off-day", date: "2026-10-18" })] });
    });
    it("压力趋势只连接打卡日，保留零压力日并平滑呈现真实数值", () => {
        vi.mocked(init).mockClear();
        // 有加班、无出勤、正常下班与单次打卡混合在同一趋势区间
        const { board } = renderBoard([attendance("2026-10-16", 540, 1380), attendance("2026-10-17", null, null), attendance("2026-10-18", 540, 1080, "rest-day"), attendance("2026-10-19", 540, null)], "概览");
        // 图表边界保留看板传入的配置，不在测试中重复实现压力计算
        const chart = vi.mocked(init).mock.results[0]!.value as { setOption: ReturnType<typeof vi.fn> };
        // 按打卡日期排列的三条曲线配置
        const option = chart.setOption.mock.calls[0]![0] as { xAxis: { data: string[] }; series: { smooth: number; smoothMonotone: string; data: number[] }[] };
        expect(option.xAxis.data).toEqual(["10-16", "10-18", "10-19"]);
        expect(option.series).toHaveLength(3);
        expect(option.series[0]!.data[0]).toBeGreaterThan(0);
        expect(option.series[0]!.data.slice(1)).toEqual([0, 0]);
        expect(option.series.every((series) => series.data.length === 3 && series.smooth === 0.4 && series.smoothMonotone === "x")).toBe(true);
        board.destroy();
    });
    it("忽略空考勤并保留单次打卡、休息日出勤和午夜打卡，日期去重排序", () => {
        expect(getAttendanceDates([
            attendance("2026-10-19", 540, null),
            attendance("2026-10-18", null, null, "rest-day"),
            attendance("2026-10-17", 540, 1200, "rest-day"),
            attendance("2026-10-16", null, 0),
            attendance("2026-10-17", 540, 1200),
            attendance("2026-10-15", null, null),
        ])).toEqual(["2026-10-16", "2026-10-17", "2026-10-19"]);
    });

    it("列表与详情跳过无打卡和只有解压的日期，待处理单次打卡仍可见", () => {
        // 当前月包含两次实际出勤和两天没有打卡的考勤行
        const { root } = renderBoard([attendance("2026-10-19", 540, null), attendance("2026-10-18", null, null, "rest-day"), attendance("2026-10-17", null, null), attendance("2026-10-16", 540, 1200)]);
        expect(root.querySelectorAll("tbody tr")).toHaveLength(2);
        expect(root.querySelector("h2")?.textContent).toContain("2026-10-19");
        // 详情中的前一天按钮应直接跳到上一次考勤
        const previous = root.querySelector<HTMLButtonElement>(".pv-daily-grid > .pv-panel:nth-child(2) .pv-heading button")!;
        previous.click();
        expect(root.querySelector("h2")?.textContent).toContain("2026-10-16");
        expect(root.querySelector<HTMLButtonElement>(".pv-daily-grid > .pv-panel:nth-child(2) .pv-heading button")?.disabled).toBe(true);
        Array.from(root.querySelectorAll("button")).find((button) => button.textContent === "待处理")!.click();
        expect(root.querySelectorAll("tbody tr")).toHaveLength(1);
        expect(root.querySelector("h2")?.textContent).toContain("2026-10-19");
    });

    it("从无考勤日期进入每日页时回退到实际出勤，搜索无结果后清空详情", () => {
        // 保留空考勤与有出勤日期的混合样本
        const { root, board } = renderBoard([attendance("2026-10-19", 540, null), attendance("2026-10-18", null, null)]);
        // 模拟从概览日历进入无考勤日期
        (board as unknown as { navigate(page: string, date: string): void }).navigate("每日记录", "2026-10-18");
        expect(root.querySelector("h2")?.textContent).toContain("2026-10-19");
        // 搜索命中仅有解压的日期时列表和详情必须同时为空
        const search = root.querySelector<HTMLInputElement>('input[type="search"]')!;
        search.value = "2026-10-18";
        search.dispatchEvent(new Event("change"));
        expect(root.querySelectorAll("tbody tr")).toHaveLength(0);
        expect(root.querySelector("h2")).toBeNull();
        expect(root.textContent).toContain("暂无可展示的考勤详情");
    });

    it("月份没有打卡记录时不渲染空日期详情", () => {
        // 空考勤不能作为详情的默认日期
        const { root } = renderBoard([attendance("2026-10-18", null, null)]);
        expect(root.querySelectorAll("tbody tr")).toHaveLength(0);
        expect(root.querySelector("h2")).toBeNull();
    });
});
