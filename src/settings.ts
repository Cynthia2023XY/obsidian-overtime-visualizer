import type { ReliefActivityType } from "./types/storage";

/** 可在插件设置页编辑的单项解压配置 */
export interface ReliefActivitySetting {
  type: ReliefActivityType;
  name: string;
  score: number;
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
  ],
};
