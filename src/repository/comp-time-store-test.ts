import { describe, expect, it, vi } from "vitest";
import { CompTimeStore, createMemoryCompTimeAdapter, sanitizeCompTimeData } from "./comp-time-store";

describe("调休本地仓储 CompTimeStore", () => {
  it("加班事项按日期保存、重载及清空，旧数据兼容空事项", async () => {
    /** 模拟持久化磁盘 */
    const adapter = createMemoryCompTimeAdapter();
    /** 编辑事项的仓储 */
    const store = new CompTimeStore(adapter);
    await store.initialize();
    await Promise.all([
      store.setOvertimeNote("2026-11-18", "折叠屏适配联调"),
      store.setOvertimeNote("2026-11-19", "处理上线问题"),
    ]);
    /** 重新加载后仍应保留两个日期的事项 */
    const reloaded = new CompTimeStore(adapter);
    await reloaded.initialize();
    expect(reloaded.getData().overtimeNotes).toEqual({ "2026-11-18": "折叠屏适配联调", "2026-11-19": "处理上线问题" });
    await reloaded.setOvertimeNote("2026-11-18", "");
    expect(reloaded.getData().overtimeNotes).toEqual({ "2026-11-19": "处理上线问题" });
    await expect(reloaded.setOvertimeNote("bad", "无效日期")).rejects.toThrow("无效");
    expect(sanitizeCompTimeData({ schemaVersion: 1 }).overtimeNotes).toEqual({});
  });

  it("事项保存失败不污染已保存内容，并允许后续继续保存", async () => {
    /** 模拟可失败的磁盘适配器 */
    const adapter = createMemoryCompTimeAdapter();
    /** 正在编辑的仓储 */
    const store = new CompTimeStore(adapter);
    await store.initialize();
    await store.setOvertimeNote("2026-11-18", "已保存事项");
    vi.spyOn(adapter, "saveCompTimeData").mockRejectedValueOnce(new Error("写入失败"));
    await expect(store.setOvertimeNote("2026-11-18", "失败内容")).rejects.toThrow("写入失败");
    expect(store.getData().overtimeNotes["2026-11-18"]).toBe("已保存事项");
    await store.setOvertimeNote("2026-11-19", "后续事项");
    expect(await adapter.loadCompTimeData()).toEqual(store.getData());
    expect(store.getData().overtimeNotes["2026-11-18"]).toBe("已保存事项");
  });

  it("导入可恢复事项，旧文件不覆盖本地事项，非法事项整批拒绝", async () => {
    /** 当前调休仓储 */
    const store = new CompTimeStore();
    await store.initialize();
    await store.setOvertimeNote("2026-11-18", "本地事项");
    await store.importCompTimePayload(JSON.stringify({ items: [{ date: "2026-11-18", hours: 1.5 }] }));
    expect(store.getData().overtimeNotes["2026-11-18"]).toBe("本地事项");
    await store.importCompTimePayload(JSON.stringify({ items: [{ date: "2026-11-18", hours: 1.5, overtimeNote: "导入事项" }] }));
    expect(store.getData().overtimeNotes["2026-11-18"]).toBe("导入事项");
    await expect(store.importCompTimePayload(JSON.stringify({ items: [
      { date: "2026-11-18", hours: 99, overtimeNote: "不应保存" },
      { date: "2026-11-19", hours: 2, overtimeNote: 123 },
    ] }))).rejects.toThrow("加班事项必须为文本");
    expect(store.getData().overtimeNotes["2026-11-18"]).toBe("导入事项");
    expect(store.getData().draftHourOverrides["2026-11-18"]).toBe(1.5);
    await store.importCompTimePayload(JSON.stringify({ items: [{ date: "2026-11-18", hours: 1.5, overtimeNote: "" }] }));
    expect(store.getData().overtimeNotes).toEqual({});
  });

  it("导入保存失败时保留旧快照，后续排队导入不会夹带失败数据", async () => {
    /** 可检查磁盘快照的内存适配器 */
    const adapter = createMemoryCompTimeAdapter();
    /** 待测试的串行仓储 */
    const store = new CompTimeStore(adapter);
    await store.initialize();
    await store.importCompTimePayload(JSON.stringify({ items: [{ date: "2026-11-18", hours: 2 }] }));
    /** 失败前已提交的完整快照 */
    const previous = store.getData();
    vi.spyOn(adapter, "saveCompTimeData").mockRejectedValueOnce(new Error("磁盘写入失败"));
    /** 第一批覆盖已有日期并新增日期，但保存失败 */
    const failed = store.importCompTimePayload(JSON.stringify({ items: [
      { date: "2026-11-18", hours: 99 }, { date: "2026-11-19", hours: 99 },
    ] }));
    /** 立即追加下一项写入，验证失败后队列可以继续 */
    const next = store.importCompTimePayload(JSON.stringify({ items: [{ date: "2026-11-20", hours: 3 }] }));
    await expect(failed).rejects.toThrow("磁盘写入失败");
    await next;
    expect(previous.draftHourOverrides).toEqual({ "2026-11-18": 2 });
    expect(store.getData().draftHourOverrides).toEqual({ "2026-11-18": 2, "2026-11-20": 3 });
    expect(await adapter.loadCompTimeData()).toEqual(store.getData());
  });

  it("保存完成前读取仍返回已提交快照", async () => {
    /** 当前模拟磁盘适配器 */
    const adapter = createMemoryCompTimeAdapter();
    /** 当前仓储 */
    const store = new CompTimeStore(adapter);
    await store.initialize();
    /** 可由测试显式放行的磁盘保存 */
    let finish: () => void = () => {};
    /** 暂停写入完成时刻 */
    const save = vi.spyOn(adapter, "saveCompTimeData").mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    /** 正在等待磁盘确认的导入 */
    const pending = store.importCompTimePayload(JSON.stringify({ items: [{ date: "2026-11-20", hours: 3 }] }));
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(store.getData().draftHourOverrides).toEqual({});
    finish();
    await pending;
    expect(store.getData().draftHourOverrides).toEqual({ "2026-11-20": 3 });
  });

  it("能够清洗损坏或非法的持久化数据，避免影响插件运行", () => {
    const cleaned = sanitizeCompTimeData({
      schemaVersion: 99,
      specialDates: [
        { date: "2026-11-11", note: "双十一" },
        { date: "invalid-date", note: "非法" },
      ],
      ignoredDates: ["2026-10-01", "2026-10-01", "bad"],
      draftHourOverrides: { "2026-11-11": 3.4, bad: 5 },
      entries: {
        __proto__: { id: "__proto__", date: "2026-10-01", hours: 8 },
        ok: {
          id: "ok",
          date: "2026-07-13",
          sourceType: "holiday",
          hours: 4,
          usages: [{ id: "u1", usedHours: 1.5, usedDate: "2026-08-01", note: "半天" }],
        },
      },
    });

    expect(cleaned.specialDates).toEqual([{ date: "2026-11-11", note: "双十一" }]);
    expect(cleaned.ignoredDates).toEqual(["2026-10-01"]);
    expect(cleaned.draftHourOverrides).toEqual({ "2026-11-11": 3.5 });
    expect(Object.keys(cleaned.entries)).toEqual(["ok"]);
    expect(cleaned.entries.ok!.initialExpiresAt).toBe("2026-09-30");
  });

  it("支持提报、手动增减、使用扣减、撤销以及仅限一次的3个月延期", async () => {
    const adapter = createMemoryCompTimeAdapter();
    const store = new CompTimeStore(adapter);
    await store.initialize();

    const created = await store.submitCompTime({
      date: "2026-07-13",
      sourceType: "holiday",
      hours: 6,
      note: "节假日值班",
    });
    expect(created.initialExpiresAt).toBe("2026-09-30");
    expect(created.expiresAt).toBe("2026-09-30");

    // 延期一次：从 2026-09-30 延至 2026-12-31
    await store.extendEntry(created.id);
    expect(store.getData().entries[created.id]!.expiresAt).toBe("2026-12-31");
    expect(store.getData().entries[created.id]!.extended).toBe(true);

    // 禁止第二次延期
    await expect(store.extendEntry(created.id)).rejects.toThrow("每笔调休仅支持延期一次");

    // 登记使用调休，且不允许超过剩余额度
    await store.addUsage(created.id, 2.5, "2026-10-10", "调休下午");
    await expect(store.addUsage(created.id, 4, "2026-10-11", "超额")).rejects.toThrow("超出剩余可用额度");

    // 不允许将总时长调整到小于已使用时长
    await expect(store.updateEntry(created.id, 2, "下调")).rejects.toThrow("不能小于已使用时长");
    await store.updateEntry(created.id, 7, "核实加1小时");
    expect(store.getData().entries[created.id]!.hours).toBe(7);

    // 撤销使用后删除
    const usageId = store.getData().entries[created.id]!.usages[0]!.id;
    await store.removeUsage(created.id, usageId);
    expect(store.getData().entries[created.id]!.usages).toHaveLength(0);

    await store.deleteEntry(created.id);
    expect(Object.keys(store.getData().entries)).toHaveLength(0);
  });

  it("支持导入标准调休 JSON 并校验非法数据", async () => {
    const store = new CompTimeStore(createMemoryCompTimeAdapter());
    await store.initialize();

    await expect(store.importCompTimePayload("not-json")).rejects.toThrow("不是有效的 JSON");
    await expect(store.importCompTimePayload(JSON.stringify({ items: [{ date: "bad", hours: 2 }] }))).rejects.toThrow("无效日期");

    const result = await store.importCompTimePayload(JSON.stringify({
      format: "overtime-visualizer-comp-time",
      version: 1,
      items: [
        { date: "2026-11-18", hours: 3.5 },
        { date: "2026-11-19", hours: 2.2 },
      ],
    }));

    expect(result.importedCount).toBe(2);
    expect(store.getData().draftHourOverrides).toEqual({
      "2026-11-18": 3.5,
      "2026-11-19": 2,
    });
  });
});
