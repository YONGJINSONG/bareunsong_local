// 이 파일이 하는 일: 출퇴근 기록(바른송치과 추가 기능, DECISIONS D-B01)의 처리 함수를 둔다. HTTP 등록은 attendance-routes.ts가 한다.
// - 출근·퇴근 찍기: 허용한 와이파이 대역(settings.attendance.allowedNetworks, 비우면 원내망 전체)과 이 서버 PC에서만 된다. 하루에 출근 한 번, 퇴근 한 번이다.
//   야간 근무로 자정을 넘겨 퇴근하면 20시간 안의 열린 출근 기록에 퇴근을 적는다.
// - 지각·조퇴: 근무표의 그날 근무 시작·끝과 비교한다(지각 유예 lateGraceMin분). 승인된 오전 반차는 지각, 오후 반차는 조퇴, 종일 휴가는 둘 다 보지 않는다.
// - 고치기: 실장 이상이 사유와 함께 넣거나 고친다(퇴근이 출근보다 이르면 다음 날 퇴근). 월별 목록·직원별 합계·CSV 내보내기를 만든다.
import type { Db } from '../../db/index.ts';
import type { Clock } from '../../lib/clock.ts';
import { AppError } from '../../lib/errors.ts';
import { addDays, isValidDate, kstMidnight, kstParts, monthRange, todayKst } from '../../lib/dates.ts';
import { toCsv } from '../../lib/csv.ts';
import { isInternalAddress } from '../../security/network.ts';
import { approvedLeaveDays } from './leave.ts';
import type { Role } from '../../../shared/roles.ts';
import {
  attendanceSettingsSchema,
  DEFAULT_ATTENDANCE_SETTINGS,
  formatMinutes,
  inCidr,
  type AttendanceDevice,
  type AttendanceMonth,
  type AttendanceRecord,
  type AttendanceSettings,
  type AttendanceShift,
  type AttendanceSummaryRow,
  type AttendanceToday,
  type EditAttendanceInput,
} from '../../../shared/schemas/attendance.ts';
import type { LeaveType } from '../../../shared/schemas/leave.ts';

/** 요청한 사람 */
export interface AttendanceActor {
  id: number;
  name: string;
  role: Role;
}

/** 자정을 넘긴 퇴근을 앞 기록에 붙일 수 있는 최대 시간(출근 뒤 20시간) */
export const OPEN_RECORD_HOURS = 20;
const MINUTE = 60_000;

interface AttendanceRow {
  id: number;
  user_id: number;
  user_name: string | null;
  work_date: string;
  clock_in: string;
  clock_out: string | null;
  edited_by: number | null;
  editor_name: string | null;
  edited_at: string | null;
  edit_reason: string | null;
}

const SELECT_ROW = `SELECT a.id, a.user_id, u.name AS user_name, a.work_date, a.clock_in, a.clock_out,
  a.edited_by, e.name AS editor_name, a.edited_at, a.edit_reason
  FROM attendance a
  LEFT JOIN users u ON u.id = a.user_id
  LEFT JOIN users e ON e.id = a.edited_by`;

// ── 설정 ─────────────────────────────────────────────────────

/** settings.attendance를 읽는다. 없거나 틀린 항목은 기본값을 쓴다 */
export function readAttendanceSettings(db: Db): AttendanceSettings {
  const row = db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'attendance'");
  let raw: Record<string, unknown> = {};
  try {
    const v: unknown = row ? JSON.parse(row.value) : {};
    if (v && typeof v === 'object' && !Array.isArray(v)) raw = v as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const out: AttendanceSettings = { allowedNetworks: [...DEFAULT_ATTENDANCE_SETTINGS.allowedNetworks], lateGraceMin: DEFAULT_ATTENDANCE_SETTINGS.lateGraceMin };
  const nets = attendanceSettingsSchema.shape.allowedNetworks.safeParse(raw.allowedNetworks);
  if (nets.success) out.allowedNetworks = nets.data;
  const grace = attendanceSettingsSchema.shape.lateGraceMin.safeParse(raw.lateGraceMin);
  if (grace.success) out.lateGraceMin = grace.data;
  return out;
}

/** settings.attendance를 저장한다(같은 대역은 한 번만) */
export function saveAttendanceSettings(db: Db, clock: Clock, next: AttendanceSettings): AttendanceSettings {
  const value: AttendanceSettings = { allowedNetworks: [...new Set(next.allowedNetworks.map((n) => n.trim()))], lateGraceMin: next.lateGraceMin };
  db.run(
    "INSERT INTO settings (key, value, updated_at) VALUES ('attendance', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [JSON.stringify(value), clock.now().toISOString()],
  );
  return readAttendanceSettings(db);
}

// ── 기기 확인 ────────────────────────────────────────────────

/** 이 서버 PC 자신(루프백)인지 */
function isLoopback(ip: string): boolean {
  const v = ip.trim().toLowerCase().replace(/^::ffff:/, '');
  return v === '::1' || v.startsWith('127.');
}

/** 이 주소의 기기로 출퇴근을 찍을 수 있는지. 서버 PC 자신은 늘 된다 */
export function deviceStatus(db: Db, ip: string): AttendanceDevice {
  const { allowedNetworks } = readAttendanceSettings(db);
  const shown = ip.replace(/^::ffff:/i, '');
  if (isLoopback(ip)) return { ip: shown, allowed: true, allowedNetworks };
  const allowed = allowedNetworks.length === 0 ? isInternalAddress(ip) : allowedNetworks.some((n) => inCidr(ip, n));
  return { ip: shown, allowed, allowedNetworks };
}

/** 찍을 수 없는 기기면 막는다 */
function assertDevice(db: Db, ip: string): void {
  const d = deviceStatus(db, ip);
  if (d.allowed) return;
  throw new AppError('FORBIDDEN', {
    message: `이 기기(${d.ip})는 출퇴근을 찍도록 허용한 병원 와이파이가 아니에요. 병원 와이파이에 연결한 뒤 다시 눌러 주세요.`,
    extra: { reason: 'ATTENDANCE_NETWORK' },
  });
}

// ── 계산 ─────────────────────────────────────────────────────

/** 'HH:MM' → 자정부터 분 */
function hhmmToMin(v: string): number {
  const [h, m] = v.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** 시각이 근무일 자정(KST)부터 몇 분 뒤인지 */
function minutesFromDay(workDate: string, iso: string): number {
  return Math.round((new Date(iso).getTime() - kstMidnight(workDate).getTime()) / MINUTE);
}

/** 기간 안 직원·날짜별 근무표 근무(시간이 있는 근무 유형만) */
function shiftsBetween(db: Db, from: string, to: string): Map<string, AttendanceShift> {
  const rows = db.all<{ user_id: number; date: string; label: string; start_time: string; end_time: string }>(
    `SELECT r.user_id, r.date, s.label, s.start_time, s.end_time FROM roster r JOIN shift_types s ON s.id = r.shift_type_id
     WHERE r.date BETWEEN ? AND ? AND s.counts_as_work = 1 AND s.start_time IS NOT NULL`,
    [from, to],
  );
  return new Map(rows.map((r) => [`${r.user_id}|${r.date}`, { label: r.label, start: r.start_time, end: r.end_time }]));
}

/** 기간 안 직원·날짜별 승인된 휴가 종류들 */
function leavesBetween(db: Db, from: string, to: string): Map<string, LeaveType[]> {
  const out = new Map<string, LeaveType[]>();
  for (const l of approvedLeaveDays(db, from, to)) {
    const key = `${l.userId}|${l.date}`;
    out.set(key, [...(out.get(key) ?? []), l.type]);
  }
  return out;
}

interface Lookups {
  shifts: Map<string, AttendanceShift>;
  leaves: Map<string, LeaveType[]>;
  grace: number;
  now: Date;
}

function lookupsFor(db: Db, clock: Clock, from: string, to: string): Lookups {
  return { shifts: shiftsBetween(db, from, to), leaves: leavesBetween(db, from, to), grace: readAttendanceSettings(db).lateGraceMin, now: clock.now() };
}

/** DB 줄 → 응답(지각·조퇴·퇴근 누락 계산 포함) */
function toRecord(r: AttendanceRow, lk: Lookups): AttendanceRecord {
  const key = `${r.user_id}|${r.work_date}`;
  const shift = lk.shifts.get(key) ?? null;
  const leaves = lk.leaves.get(key) ?? [];
  const fullDayLeave = leaves.some((t) => t !== 'half_am' && t !== 'half_pm');
  let lateMin = 0;
  let earlyMin = 0;
  if (shift && !fullDayLeave) {
    const start = hhmmToMin(shift.start);
    let end = hhmmToMin(shift.end);
    if (end <= start) end += 24 * 60; // 자정을 넘는 근무
    const inMin = minutesFromDay(r.work_date, r.clock_in);
    if (!leaves.includes('half_am') && inMin - start > lk.grace) lateMin = inMin - start;
    if (r.clock_out && !leaves.includes('half_pm')) {
      const outMin = minutesFromDay(r.work_date, r.clock_out);
      if (outMin < end) earlyMin = end - outMin;
    }
  }
  const openTooLong = lk.now.getTime() - new Date(r.clock_in).getTime() > OPEN_RECORD_HOURS * 3_600_000;
  return {
    id: r.id,
    user: { id: r.user_id, name: r.user_name ?? '알 수 없음' },
    workDate: r.work_date,
    clockIn: r.clock_in,
    clockOut: r.clock_out,
    minutes: r.clock_out ? Math.round((new Date(r.clock_out).getTime() - new Date(r.clock_in).getTime()) / MINUTE) : null,
    shift,
    lateMin,
    earlyMin,
    missingOut: r.clock_out === null && openTooLong,
    edited: r.edited_by === null ? null : { by: r.editor_name ?? '알 수 없음', at: r.edited_at ?? '', reason: r.edit_reason ?? '' },
  };
}

/** 'HH:MM'(KST) 표시 */
function kstHhmm(iso: string): string {
  const p = kstParts(new Date(iso));
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

// ── 찍기 ─────────────────────────────────────────────────────

/** 아직 퇴근하지 않은 최근 기록(오늘 또는 20시간 안에 출근한 어제 기록) */
function openRecord(db: Db, clock: Clock, userId: number): AttendanceRow | null {
  const today = todayKst(clock);
  const since = new Date(clock.now().getTime() - OPEN_RECORD_HOURS * 3_600_000).toISOString();
  return (
    db.get<AttendanceRow>(`${SELECT_ROW} WHERE a.user_id = ? AND a.clock_out IS NULL AND a.work_date >= ? AND a.clock_in >= ? ORDER BY a.work_date DESC LIMIT 1`, [
      userId,
      addDays(today, -1),
      since,
    ]) ?? null
  );
}

function rowById(db: Db, id: number): AttendanceRow {
  const r = db.get<AttendanceRow>(`${SELECT_ROW} WHERE a.id = ?`, [id]);
  if (!r) throw new AppError('NOT_FOUND', { message: '출퇴근 기록을 찾지 못했어요.' });
  return r;
}

/** 한 줄을 응답 모양으로(그날 근무표·휴가를 읽어서) */
function recordOf(db: Db, clock: Clock, r: AttendanceRow): AttendanceRecord {
  return toRecord(r, lookupsFor(db, clock, r.work_date, r.work_date));
}

/** 출근 찍기 */
export function clockIn(db: Db, clock: Clock, actor: AttendanceActor, ip: string): AttendanceRecord {
  assertDevice(db, ip);
  const today = todayKst(clock);
  const open = openRecord(db, clock, actor.id);
  if (open && open.work_date !== today) {
    throw new AppError('CONFLICT', { message: `어제(${open.work_date}) 출근 기록이 아직 퇴근 전이에요. 먼저 퇴근을 찍어 주세요.` });
  }
  const done = db.get<{ clock_in: string }>('SELECT clock_in FROM attendance WHERE user_id = ? AND work_date = ?', [actor.id, today]);
  if (done) throw new AppError('CONFLICT', { message: `오늘은 이미 ${kstHhmm(done.clock_in)}에 출근을 찍었어요.` });
  const now = clock.now().toISOString();
  const res = db.run('INSERT INTO attendance (user_id, work_date, clock_in, in_ip, created_at) VALUES (?, ?, ?, ?, ?)', [actor.id, today, now, ip, now]);
  return recordOf(db, clock, rowById(db, Number(res.lastInsertRowid)));
}

/** 퇴근 찍기 */
export function clockOut(db: Db, clock: Clock, actor: AttendanceActor, ip: string): AttendanceRecord {
  assertDevice(db, ip);
  const open = openRecord(db, clock, actor.id);
  if (!open) {
    const done = db.get<{ clock_out: string | null }>('SELECT clock_out FROM attendance WHERE user_id = ? AND work_date = ?', [actor.id, todayKst(clock)]);
    if (done?.clock_out) throw new AppError('CONFLICT', { message: `오늘은 이미 ${kstHhmm(done.clock_out)}에 퇴근을 찍었어요.` });
    throw new AppError('CONFLICT', { message: '오늘 출근 기록이 없어요. 출근을 먼저 찍거나, 실장님께 기록을 고쳐 달라고 해 주세요.' });
  }
  const now = clock.now();
  if (now.getTime() <= new Date(open.clock_in).getTime()) throw new AppError('CONFLICT', { message: '출근 시각보다 이른 퇴근은 찍을 수 없어요.' });
  db.run('UPDATE attendance SET clock_out = ?, out_ip = ? WHERE id = ?', [now.toISOString(), ip, open.id]);
  return recordOf(db, clock, rowById(db, open.id));
}

/** 오늘 내 출퇴근 상태(화면 위쪽 카드) */
export function todayStatus(db: Db, clock: Clock, actor: AttendanceActor, ip: string): AttendanceToday {
  const today = todayKst(clock);
  const lk = lookupsFor(db, clock, addDays(today, -1), today);
  const open = openRecord(db, clock, actor.id);
  const todayRow = db.get<AttendanceRow>(`${SELECT_ROW} WHERE a.user_id = ? AND a.work_date = ?`, [actor.id, today]) ?? null;
  const row = open ?? todayRow;
  return {
    date: today,
    shift: lk.shifts.get(`${actor.id}|${today}`) ?? null,
    record: row ? toRecord(row, lk) : null,
    next: open ? 'out' : todayRow ? 'done' : 'in',
    device: deviceStatus(db, ip),
  };
}

// ── 조회·고치기 ───────────────────────────────────────────────

/** 한 달 기록과 직원별 합계. userId가 있으면 그 직원만 */
export function listMonth(db: Db, clock: Clock, month: string, userId?: number): AttendanceMonth {
  const { start, end } = monthRange(month);
  const lk = lookupsFor(db, clock, start, end);
  const rows = db.all<AttendanceRow>(
    `${SELECT_ROW} WHERE a.work_date BETWEEN ? AND ? ${userId ? 'AND a.user_id = ?' : ''} ORDER BY a.work_date DESC, u.name`,
    userId ? [start, end, userId] : [start, end],
  );
  const records = rows.map((r) => toRecord(r, lk));
  const byUser = new Map<number, AttendanceSummaryRow>();
  for (const r of records) {
    const s = byUser.get(r.user.id) ?? { userId: r.user.id, name: r.user.name, days: 0, minutes: 0, lateCount: 0, earlyCount: 0, missingOutCount: 0 };
    s.days += 1;
    s.minutes += r.minutes ?? 0;
    if (r.lateMin > 0) s.lateCount += 1;
    if (r.earlyMin > 0) s.earlyCount += 1;
    if (r.missingOut) s.missingOutCount += 1;
    byUser.set(r.user.id, s);
  }
  const summary = [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return { month, records, summary };
}

/** 실장 이상이 기록을 넣거나 고친다(사유 필수) */
export function editRecord(db: Db, clock: Clock, actor: AttendanceActor, input: EditAttendanceInput): AttendanceRecord {
  if (!isValidDate(input.workDate)) throw new AppError('VALIDATION', { fields: { workDate: '달력에 있는 날짜를 골라 주세요.' } });
  if (input.workDate > todayKst(clock)) throw new AppError('VALIDATION', { fields: { workDate: '앞으로 올 날짜의 기록은 넣을 수 없어요.' } });
  const user = db.get<{ id: number }>('SELECT id FROM users WHERE id = ?', [input.userId]);
  if (!user) throw new AppError('VALIDATION', { fields: { userId: '직원을 다시 골라 주세요.' } });
  const day = kstMidnight(input.workDate).getTime();
  const inAt = new Date(day + hhmmToMin(input.clockIn) * MINUTE);
  let outAt: Date | null = null;
  if (input.clockOut) {
    let outMin = hhmmToMin(input.clockOut);
    if (outMin <= hhmmToMin(input.clockIn)) outMin += 24 * 60; // 다음 날 퇴근
    outAt = new Date(day + outMin * MINUTE);
    if (outAt.getTime() > clock.now().getTime()) throw new AppError('VALIDATION', { fields: { clockOut: '아직 오지 않은 시각은 적을 수 없어요.' } });
  }
  if (inAt.getTime() > clock.now().getTime()) throw new AppError('VALIDATION', { fields: { clockIn: '아직 오지 않은 시각은 적을 수 없어요.' } });
  const now = clock.now().toISOString();
  db.run(
    `INSERT INTO attendance (user_id, work_date, clock_in, clock_out, edited_by, edited_at, edit_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, work_date) DO UPDATE SET clock_in = excluded.clock_in, clock_out = excluded.clock_out,
       edited_by = excluded.edited_by, edited_at = excluded.edited_at, edit_reason = excluded.edit_reason`,
    [input.userId, input.workDate, inAt.toISOString(), outAt?.toISOString() ?? null, actor.id, now, input.reason, now],
  );
  const id = db.get<{ id: number }>('SELECT id FROM attendance WHERE user_id = ? AND work_date = ?', [input.userId, input.workDate])?.id ?? 0;
  return recordOf(db, clock, rowById(db, id));
}

/** 한 달 기록 CSV(엑셀용, 직원별 합계 뒤에 날짜별 기록) */
export function monthCsv(db: Db, clock: Clock, month: string): string {
  const m = listMonth(db, clock, month);
  const lines: unknown[][] = [['이름', '날짜', '근무', '출근', '퇴근', '근무 시간(분)', '지각(분)', '조퇴(분)', '퇴근 누락', '고친 사람', '고친 이유']];
  for (const r of [...m.records].sort((a, b) => a.user.name.localeCompare(b.user.name, 'ko') || a.workDate.localeCompare(b.workDate))) {
    lines.push([
      r.user.name,
      r.workDate,
      r.shift ? `${r.shift.label} ${r.shift.start}~${r.shift.end}` : '',
      kstHhmm(r.clockIn),
      r.clockOut ? `${kstParts(new Date(r.clockOut)).day !== kstParts(new Date(r.clockIn)).day ? '다음 날 ' : ''}${kstHhmm(r.clockOut)}` : '',
      r.minutes ?? '',
      r.lateMin || '',
      r.earlyMin || '',
      r.missingOut ? '예' : '',
      r.edited?.by ?? '',
      r.edited?.reason ?? '',
    ]);
  }
  lines.push([]);
  lines.push(['직원별 합계', '근무일', '', '', '', '근무 시간', '지각 횟수', '조퇴 횟수', '퇴근 누락']);
  for (const s of m.summary) lines.push([s.name, s.days, '', '', '', formatMinutes(s.minutes), s.lateCount, s.earlyCount, s.missingOutCount]);
  return toCsv(lines);
}
