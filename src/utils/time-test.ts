import { describe, expect, it } from "vitest";
import { formatClockMinute, formatDuration, formatMinuteDeviation } from "./time";

describe("时间显示格式化", () => {
  it("将当日和跨夜时刻格式化为可区分的文案", () => {
    expect(formatClockMinute(21 * 60 + 7)).toBe("21:07");
    expect(formatClockMinute(24 * 60 + 1)).toBe("次日 00:01");
  });

  it("保留时长的小时与两位分钟", () => {
    expect(formatDuration(688)).toBe("11小时28分");
    expect(formatDuration(null)).toBe("—");
  });

  it("在基准偏差前显示正负方向", () => {
    expect(formatMinuteDeviation(7)).toBe("相比 21:00 +7 分钟");
    expect(formatMinuteDeviation(-8)).toBe("相比 21:00 -8 分钟");
  });
});
