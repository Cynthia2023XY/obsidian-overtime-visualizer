/** 考勤记录的工作日类型 */
export type AttendanceDayType = "workday" | "rest-day" | "holiday" | "unknown";

/** 考勤记录的数据完整性状态 */
export type AttendanceState = "complete" | "non-working-day" | "full-leave" | "partial-leave" | "missing-punch" | "incomplete" | "ambiguous-start";

/** 考勤记录的跨夜识别状态 */
export type OvernightState = "none" | "confirmed" | "linked" | "ambiguous";

/** 用于回溯计算结果的脱敏原始考勤快照 */
export interface AttendanceSourceSnapshot {
  attendanceDay: string;
  attendanceStartTime: string | null;
  attendanceEndTime: string | null;
  weekDay: string | null;
  workDayType: string | null;
  applyReason: string | null;
  attendanceStatus: string | null;
}

/** 经过清洗后供统计层消费的最小日考勤记录 */
export interface AttendanceRecord {
  date: string;
  weekday: number;
  dayType: AttendanceDayType;
  startMinute: number | null;
  endMinute: number | null;
  attendanceState: AttendanceState;
  overnightState: OvernightState;
  isReleaseDay: boolean;
  leaveReasons: string[];
  warnings: string[];
  source: AttendanceSourceSnapshot;
  manuallyEdited: boolean;
}

/** 已确认起止时间且能安全参与统计的考勤记录 */
export type ValidAttendanceRecord = AttendanceRecord & {
  startMinute: number;
  endMinute: number;
  attendanceState: "complete";
};
