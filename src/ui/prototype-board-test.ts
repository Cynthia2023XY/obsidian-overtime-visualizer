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
import type { ReliefEntry } from "../types/storage";
import { ReliefEditModal } from "./data-management-modals";

/** 宿主窗口与弹窗不参与日期筛选验证 */
vi.mock("obsidian", () => ({ App: vi.fn(), Modal: class {
    // 测试只验证编辑入口，宿主弹窗无需挂载到工作区
    open() {}
}, Notice: vi.fn(), Setting: vi.fn(), setIcon: vi.fn() }));
/** 仅验证顶部按钮的导出数据，实际磁盘写入由导出模块单独测试 */
vi.mock("../export/json-export", () => ({ exportJson: vi.fn().mockResolvedValue(undefined) }));
/** 保留图表配置以验证日期与真实压力数据的对应关系 */
vi.mock("echarts/core", () => ({ use: vi.fn(), init: vi.fn(() => ({ setOption: vi.fn(), dispose: vi.fn(), resize: vi.fn() })) }));

/** 测试结束后恢复时钟并销毁残留 DOM */
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

/** 构造包含真实打卡、空考勤及休息日出勤的记录 */
function attendance(date: string, startMinute: number | null, endMinute: number | null, dayType: AttendanceRecord["dayType"] = "workday"): AttendanceRecord {
    return { ...ATTENDANCE_RECORD_MOCKS[0]!, date, startMinute, endMinute, dayType, attendanceState: startMinute !== null && endMinute !== null ? "complete" : "incomplete", warnings: [], leaveReasons: [], overnightState: "none" };
}

/** 用内存仓储渲染并操作真实看板，不接触用户笔记 */
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
    const entries: ReliefEntry[] = [{ id: "off-day", date: "2026-10-18", type: "sanlian", durationMinutes: 30, createdAt: 0 }];
    // 模拟仓储将解压记录独立写入指定日期
    const addReliefEntry = vi.fn<Parameters<PluginDataRepository["addReliefEntry"]>, ReturnType<PluginDataRepository["addReliefEntry"]>>((date, type, durationMinutes) => {
        // 新增的内存解压明细随看板重绘被读取
        const entry = { id: "new-entry", date, type, durationMinutes, createdAt: 1 };
        entries.push(entry);
        return Promise.resolve(entry);
    });
    // 模拟仓储根据明细标识删除本条记录
    const deleteReliefEntry = vi.fn((id: string) => {
        entries.splice(entries.findIndex((entry) => entry.id === id), 1);
        return Promise.resolve();
    });
    // 提供看板所需的内存数据读写边界
    const repository = { list: () => records, get: (date: string) => records.find((record) => record.date === date) ?? null, listReliefEntries: () => entries, getSettings: () => DEFAULT_SETTINGS, addReliefEntry, deleteReliefEntry } as unknown as PluginDataRepository;
    // 测试看板的独立挂载节点
    const root = document.body.appendChild(createDiv());
    // 可实际操作导航、筛选和详情的看板
    const board = new PrototypeBoard({} as App, repository, root, page);
    board.render();
    return { root, board, addReliefEntry, deleteReliefEntry };
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
        expect(Array.from(root.querySelectorAll(".otv-daily-weekday"), (day) => day.textContent)).toEqual(["周一", "周五"]);
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

describe("每日记录月份筛选", () => {
    it("用中文月份网格跨年筛选，支持返回本月和键盘关闭", () => {
        // 当前月和跨年历史月各有一条可验证的考勤
        const { root, board } = renderBoard([attendance("2026-10-19", 540, 1200), attendance("2025-03-12", 540, 1200)]);
        // 看板筛选重绘后重新定位月份按钮
        const trigger = () => root.querySelector<HTMLButtonElement>(".pv-month-filter .pv-date-trigger")!;
        expect(root.querySelector('input[type="month"]')).toBeNull();
        expect(trigger().textContent).toBe("2026 年 10 月");
        trigger().click();
        expect(document.activeElement?.getAttribute("aria-label")).toBe("2026 年 10 月");
        expect(root.querySelectorAll(".pv-month-grid button")).toHaveLength(12);
        root.querySelector<HTMLButtonElement>('button[aria-label="上一年"]')!.click();
        root.querySelector<HTMLButtonElement>('button[aria-label="2025 年 3 月"]')!.click();
        expect(root.querySelector("tbody")?.textContent).toContain("3月12日");
        expect(trigger().textContent).toBe("2025 年 3 月");
        expect(document.activeElement).toBe(trigger());
        trigger().click();
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(trigger().getAttribute("aria-expanded")).toBe("false");
        expect(document.activeElement).toBe(trigger());
        trigger().click();
        root.querySelector<HTMLButtonElement>(".pv-month-footer button")!.click();
        expect(root.querySelector("tbody")?.textContent).toContain("10月19日");
        board.destroy();
    });
});

describe("解压日历", () => {
    it("跨月选中无考勤日期后可以补录、打开编辑并删除，重绘保留选中日期", async () => {
        // 考勤完全为空，解压日历仍允许处理任何历史日期
        const { root, board, addReliefEntry, deleteReliefEntry } = renderBoard([], "概览");
        // 每次重绘后查询最新日历节点
        const calendar = () => root.querySelector<HTMLElement>(".otv-relief-calendar")!;
        // 获取某天对应的按钮，允许记录标记更新后仍能定位
        const dayButton = (date: string) => calendar().querySelector<HTMLButtonElement>(`[aria-label^="${date} "]`)!;
        // 获取当前日期的解压明细区
        const detail = () => calendar().querySelector<HTMLElement>(".otv-relief-calendar__detail")!;
        expect(root.querySelector(".otv-relief-panel, details.otv-relief-calendar")).toBeNull();
        expect(calendar().querySelector("h2")?.textContent).toBe("解压日历");
        expect(dayButton("2026-10-19").getAttribute("aria-current")).toBe("date");
        expect(dayButton("2026-10-19").getAttribute("aria-pressed")).toBe("true");
        expect(detail().textContent).toContain("2026-10-19 · 周一");
        expect(dayButton("2026-10-20").classList.contains("is-future")).toBe(true);
        expect(dayButton("2026-10-18").classList.contains("is-future")).toBe(false);
        expect(dayButton("2026-10-18").classList.contains("has-relief")).toBe(true);
        calendar().querySelector<HTMLButtonElement>('[aria-label="上个月"]')!.click();
        dayButton("2026-09-12").click();
        expect(detail().textContent).toContain("2026-09-12 · 周六");
        expect(detail().querySelector(".otv-relief-calendar__detail-heading .otv-relief-calendar__attendance")?.textContent).toBe("暂无打卡");
        expect(detail().textContent).toContain("当天暂无解压记录");
        detail().querySelector<HTMLButtonElement>(".pv-relief-add")!.click();
        await vi.waitFor(() => expect(dayButton("2026-09-12").classList.contains("has-relief")).toBe(true));
        expect(addReliefEntry).toHaveBeenCalledWith("2026-09-12", expect.any(String), expect.any(Number));
        expect(dayButton("2026-09-12").getAttribute("aria-pressed")).toBe("true");
        // 确认现有编辑弹窗可从无考勤日期的记录打开
        const openEditor = vi.spyOn(ReliefEditModal.prototype, "open");
        detail().querySelector<HTMLButtonElement>('[aria-label="编辑解压记录"]')!.click();
        expect(openEditor).toHaveBeenCalledOnce();
        detail().querySelector<HTMLButtonElement>('[aria-label="删除解压记录"]')!.click();
        await vi.waitFor(() => expect(dayButton("2026-09-12").classList.contains("has-relief")).toBe(false));
        expect(deleteReliefEntry).toHaveBeenCalledWith("new-entry");
        Array.from(calendar().querySelectorAll("button")).find((button) => button.textContent === "回到今天")!.click();
        expect(dayButton("2026-10-19").getAttribute("aria-pressed")).toBe("true");
        board.destroy();
    });
});

describe("压力构成", () => {
    it("显示各档每日分值与实际天数，零天的档位也可查看分值", () => {
        // 仅提供一条 21:30 下班记录，其他档位保留计分说明
        const { root, board } = renderBoard([attendance("2026-10-19", 540, 21 * 60 + 30)], "概览");
        Array.from(root.querySelectorAll<HTMLButtonElement>(".pv-tabs button")).find((button) => button.textContent === "压力构成")?.click();
        // 按档位检查分值与右侧出现天数
        const rows = Array.from(root.querySelectorAll(".pv-bar"));
        expect(rows.map((row) => row.querySelector("small")?.textContent)).toEqual(["1 分/天", "2 分/天", "4 分/天", "6 分/天", "8 分/天", "12 分/天"]);
        expect(rows.map((row) => row.lastElementChild?.textContent)).toEqual(["0 天", "1 天", "0 天", "0 天", "0 天", "0 天"]);
        board.destroy();
    });
});

describe("平均压力面板", () => {
    it("默认只展示原始压力，月周开关独立且勾选后可撤销，重绘保留滚动位置", () => {
        vi.mocked(init).mockClear();
        // 已结算的周末考勤同时拥有解压记录，验证最终压力确实降低
        const { root, board } = renderBoard([attendance("2026-10-18", 540, 1380)], "概览");
        // 从标题定位两个新增面板，不依赖图表创建顺序
        const panels = () => Array.from(root.querySelectorAll<HTMLElement>(".pv-panel")).filter((panel) => /[月周]平均压力指数/.test(panel.querySelector("h2")?.textContent ?? ""));
        // 读取挂载在指定面板内的图表配置
        const option = (panel: HTMLElement) => {
            // 根据 ECharts 初始化时的宿主节点匹配实例
            const index = vi.mocked(init).mock.calls.findIndex(([host]) => host === panel.querySelector(".pv-chart"));
            return (vi.mocked(init).mock.results[index]!.value as { setOption: ReturnType<typeof vi.fn> }).setOption.mock.calls[0]![0] as { series: { name: string; data: { value: number[] }[] }[] };
        };
        expect(panels()).toHaveLength(2);
        expect(panels().map((panel) => option(panel).series.map((series) => series.name))).toEqual([["原始加班压力"], ["原始加班压力"]]);
        root.scrollTop = 360;
        panels()[0]!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
        expect(root.scrollTop).toBe(360);
        expect(option(panels()[0]!).series.map((series) => series.name)).toEqual(["原始加班压力", "最终压力"]);
        expect(option(panels()[0]!).series[1]!.data[0]!.value[1]).toBeLessThan(option(panels()[0]!).series[0]!.data[0]!.value[1]!);
        expect(option(panels()[1]!).series).toHaveLength(1);
        panels()[0]!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
        expect(option(panels()[0]!).series).toHaveLength(1);
        board.destroy();
    });
});
