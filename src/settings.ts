import type { ReliefActivityType } from "./types/storage";

/** 可在插件设置页编辑的单项解压配置 */
export interface ReliefActivitySetting {
  type: ReliefActivityType;
  name: string;
  score: number;
  /** 是否显示在新增解压快捷入口，停用不删除历史记录 */
  enabled?: boolean;
  /** 每次快捷记录的分钟数，旧事项沿用原有时长 */
  durationMinutes?: number;
}

/** 影响考勤清洗与统计口径的插件设置 */
export interface OvertimeVisualizerSettings {
  startFloorMinute: number;
  endBenchmarkMinute: number;
  overnightCutoffMinute: number;
  releaseWeekdays: number[];
  reliefActivities: ReliefActivitySetting[];
}

/** 与初版需求一致的默认统计口径 */
export const DEFAULT_SETTINGS: OvertimeVisualizerSettings = {
  startFloorMinute: 9 * 60,
  endBenchmarkMinute: 21 * 60,
  overnightCutoffMinute: 5 * 60,
  releaseWeekdays: [2, 4],
  reliefActivities: [
    { type: "sanlian", name: "看三联周刊30分钟", score: 0.5 },
    { type: "scientific-american", name: "看科普文章30分钟", score: 0.5 },
    { type: "walk", name: "下楼逛一圈15分钟", score: 0.2 },
    { type: "cycling", name: "骑车运动1小时", score: 2 },
    { type: "custom-1", name: "自定义解压 1", score: 0.5, durationMinutes: 30, enabled: false },
    { type: "custom-2", name: "自定义解压 2", score: 0.5, durationMinutes: 30, enabled: false },
    { type: "custom-3", name: "自定义解压 3", score: 0.5, durationMinutes: 30, enabled: false },
    { type: "custom-4", name: "自定义解压 4", score: 0.5, durationMinutes: 30, enabled: false },
  ],
};
