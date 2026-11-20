import { describe, expect, it } from "vitest";
import { CompTimeStore, createMemoryCompTimeAdapter, sanitizeCompTimeData } from "./comp-time-store";

describe("调休本地仓储 CompTimeStore", () => {
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
