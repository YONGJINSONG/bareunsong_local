// 이 파일이 하는 일: 출퇴근 기록(바른송치과 추가 기능, DECISIONS D-B01)의 입력 검사(zod), API 응답 모양, 원내 와이파이 대역(CIDR) 계산을 서버와 화면이 함께 쓰게 둔다.
// 출퇴근은 "허용한 와이파이 대역"에서 접속한 기기로만 찍을 수 있다. 대역을 비워 두면 원내망(사설망) 전체를 허용한다(서버는 원래 원내망 밖 접속을 모두 막는다).
// 지각·조퇴는 근무표의 그날 근무 유형 시작·끝 시각과 비교한다(지각은 settings.attendance.lateGraceMin분까지 봐준다). 승인된 오전 반차는 지각, 오후 반차는 조퇴를 보지 않는다.
// shared 폴더는 다른 폴더를 import하지 않는다.
import { z } from 'zod';

/** settings.attendance 기본값: 대역 제한 없음(원내망 전체), 지각 유예 5분 */
export const DEFAULT_ATTENDANCE_SETTINGS = { allowedNetworks: [] as string[], lateGraceMin: 5 } as const;

/** 허용 대역은 최대 10개 */
export const MAX_ALLOWED_NETWORKS = 10;

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** IPv4 주소를 32비트 숫자로. 형식이 틀리면 null. IPv4를 IPv6로 쓴 주소(::ffff:192.168.0.5)도 읽는다 */
export function ipv4ToNumber(address: string): number | null {
  const ip = address.trim().toLowerCase().replace(/^::ffff:/, '');
  const m = IPV4_RE.exec(ip);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return (((parts[0] ?? 0) << 24) >>> 0) + ((parts[1] ?? 0) << 16) + ((parts[2] ?? 0) << 8) + (parts[3] ?? 0);
}

/** '192.168.0.0/24' 또는 주소 하나('192.168.0.5' = /32)를 [시작 숫자, 접두 길이]로. 틀리면 null */
export function parseCidr(text: string): { base: number; bits: number } | null {
  const [ip, bitsText, extra] = text.trim().split('/');
  if (extra !== undefined || !ip) return null;
  const n = ipv4ToNumber(ip);
  if (n === null || ip.includes(':')) return null;
  const bits = bitsText === undefined ? 32 : /^\d{1,2}$/.test(bitsText) ? Number(bitsText) : NaN;
  if (!Number.isInteger(bits) || bits < 8 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: (n & mask) >>> 0, bits };
}

/** 주소가 대역 안에 있는지 */
export function inCidr(address: string, cidr: string): boolean {
  const ip = ipv4ToNumber(address);
  const c = parseCidr(cidr);
  if (ip === null || !c) return false;
  const mask = (0xffffffff << (32 - c.bits)) >>> 0;
  return ((ip & mask) >>> 0) === c.base;
}

/** 주소가 속한 /24 대역 이름(예: '192.168.0.37' → '192.168.0.0/24'). IPv4가 아니면 null */
export function subnet24Of(address: string): string | null {
  const n = ipv4ToNumber(address);
  if (n === null) return null;
  return `${n >>> 24}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.0/24`;
}

/** 출퇴근 설정 */
export const attendanceSettingsSchema = z.object({
  allowedNetworks: z
    .array(
      z
        .string({ error: '대역을 글자로 적어 주세요.' })
        .trim()
        .refine((v) => parseCidr(v) !== null, { error: '대역은 192.168.0.0/24처럼 적어 주세요(주소 하나만 적어도 돼요).' }),
      { error: '대역 목록을 확인해 주세요.' },
    )
    .max(MAX_ALLOWED_NETWORKS, { error: `대역은 ${MAX_ALLOWED_NETWORKS}개까지 적을 수 있어요.` }),
  lateGraceMin: z
    .number({ error: '지각 유예 시간을 숫자로 적어 주세요.' })
    .int({ error: '지각 유예 시간은 분 단위 정수로 적어 주세요.' })
    .min(0, { error: '지각 유예 시간은 0분 이상이에요.' })
    .max(60, { error: '지각 유예 시간은 60분까지 정할 수 있어요.' }),
});
export type AttendanceSettings = z.infer<typeof attendanceSettingsSchema>;

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 실장 이상이 기록을 넣거나 고칠 때(PUT /attendance/records). 퇴근이 출근보다 이르면 다음 날 퇴근으로 본다 */
export const editAttendanceSchema = z.object({
  userId: z.number({ error: '직원을 골라 주세요.' }).int({ error: '직원을 골라 주세요.' }).positive({ error: '직원을 골라 주세요.' }),
  workDate: z.string({ error: '날짜를 골라 주세요.' }).regex(DATE_RE, { error: '날짜를 골라 주세요.' }),
  clockIn: z.string({ error: '출근 시각을 적어 주세요.' }).regex(HHMM_RE, { error: '출근 시각은 09:30처럼 적어 주세요.' }),
  clockOut: z.union([z.literal(''), z.string().regex(HHMM_RE, { error: '퇴근 시각은 18:30처럼 적어 주세요.' })], { error: '퇴근 시각은 18:30처럼 적어 주세요.' }),
  reason: z.string({ error: '고치는 이유를 적어 주세요.' }).trim().min(1, { error: '고치는 이유를 적어 주세요.' }).max(200, { error: '이유는 200자까지 적을 수 있어요.' }),
});
export type EditAttendanceInput = z.infer<typeof editAttendanceSchema>;

/** 그날 근무표의 근무(시간이 있는 근무 유형만) */
export interface AttendanceShift {
  label: string;
  /** 'HH:MM' */
  start: string;
  end: string;
}

/** 출퇴근 기록 한 줄(응답) */
export interface AttendanceRecord {
  id: number;
  user: { id: number; name: string };
  workDate: string;
  /** UTC ISO */
  clockIn: string;
  clockOut: string | null;
  /** 근무한 분(퇴근 전이면 null) */
  minutes: number | null;
  shift: AttendanceShift | null;
  /** 근무 시작보다 늦은 분(유예 시간을 넘었을 때만, 아니면 0) */
  lateMin: number;
  /** 근무 끝보다 일찍 퇴근한 분(아니면 0) */
  earlyMin: number;
  /** 지난 날인데 퇴근 기록이 없음 */
  missingOut: boolean;
  /** 실장 이상이 고친 기록이면 누가·언제·왜 */
  edited: { by: string; at: string; reason: string } | null;
}

/** 이 기기에서 출퇴근을 찍을 수 있는지 */
export interface AttendanceDevice {
  /** 서버가 본 이 기기 주소 */
  ip: string;
  allowed: boolean;
  /** 허용 대역을 정했으면 그 목록(빈 목록이면 원내망 전체 허용) */
  allowedNetworks: string[];
}

/** GET /attendance/today 응답 */
export interface AttendanceToday {
  date: string;
  shift: AttendanceShift | null;
  /** 오늘 출근 기록(야간 근무로 어제 출근해 아직 퇴근 전이면 그 기록) */
  record: AttendanceRecord | null;
  /** 지금 누를 수 있는 버튼 */
  next: 'in' | 'out' | 'done';
  device: AttendanceDevice;
}

/** 직원별 한 달 합계 */
export interface AttendanceSummaryRow {
  userId: number;
  name: string;
  days: number;
  minutes: number;
  lateCount: number;
  earlyCount: number;
  missingOutCount: number;
}

/** GET /attendance?month= 응답 */
export interface AttendanceMonth {
  month: string;
  records: AttendanceRecord[];
  summary: AttendanceSummaryRow[];
}

/** 분 → '8시간 5분' */
export function formatMinutes(min: number | null): string {
  if (min === null) return '-';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}분`;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}
