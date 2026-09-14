import type { AttendanceRecord } from "../types/attendance";

/** 小范围试点中只需手工填写的核心考勤字段 */
type AttendanceMockInput = Omit<AttendanceRecord, "leaveReasons" | "warnings" | "source" | "manuallyEdited">;

/** 为试点记录补齐脱敏原始快照和审计字段 */
function createAttendanceMock(input: AttendanceMockInput): AttendanceRecord {
  return {
    ...input,
    leaveReasons: input.attendanceState === "full-leave" ? ["调休假"] : [],
    warnings: input.attendanceState === "ambiguous-start" ? ["起始时间可能属于前一天跨夜打卡"] : [],
    source: {
      attendanceDay: input.date.replace(/-/g, "."),
      attendanceStartTime: null,
      attendanceEndTime: null,
      weekDay: null,
      workDayType: input.dayType === "workday" ? "工作日" : "休息日",
      applyReason: input.attendanceState === "full-leave" ? "调休假" : "正常",
      attendanceStatus: "正常",
    },
    manuallyEdited: false,
  };
}

/** 代表普通、上线、周末、跨夜、请假和歧义数据的小范围试点记录 */
export const ATTENDANCE_RECORD_MOCKS: AttendanceRecord[] = ([
  { date: "2026-02-03", weekday: 2, dayType: "workday", startMinute: 627, endMinute: 1_351, attendanceState: "complete", overnightState: "none", isReleaseDay: true },
  { date: "2026-02-04", weekday: 3, dayType: "workday", startMinute: 620, endMinute: 1_271, attendanceState: "complete", overnightState: "none", isReleaseDay: false },
  { date: "2026-02-05", weekday: 4, dayType: "workday", startMinute: 566, endMinute: 1_319, attendanceState: "complete", overnightState: "none", isReleaseDay: true },
  { date: "2026-02-06", weekday: 5, dayType: "workday", startMinute: 625, endMinute: 1_167, attendanceState: "complete", overnightState: "none", isReleaseDay: false },
  { date: "2026-02-07", weekday: 6, dayType: "rest-day", startMinute: 600, endMinute: 1_140, attendanceState: "complete", overnightState: "none", isReleaseDay: false },
  { date: "2026-02-12", weekday: 4, dayType: "workday", startMinute: null, endMinute: null, attendanceState: "full-leave", overnightState: "none", isReleaseDay: true },
  { date: "2026-01-22", weekday: 4, dayType: "workday", startMinute: 538, endMinute: 1_441, attendanceState: "complete", overnightState: "linked", isReleaseDay: true },
  { date: "2026-01-23", weekday: 5, dayType: "workday", startMinute: 1, endMinute: 1_160, attendanceState: "ambiguous-start", overnightState: "none", isReleaseDay: false },
] satisfies AttendanceMockInput[]).map(createAttendanceMock);
