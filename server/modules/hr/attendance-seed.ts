// 이 파일이 하는 일: 출퇴근 기록 데모 데이터(바른송치과 추가 기능, DECISIONS D-B01). hr 모듈 seed.ts의 seedDemo가 근무표·휴가를 넣은 뒤 부른다.
// 지난 14일(오늘 포함) 동안 근무표에 시간이 있는 근무가 잡힌 직원마다 출근·퇴근을 넣는다. 종일 휴가(승인)인 날은 건너뛴다.
// 대부분 근무 시작 5~20분 전에 출근하고 끝난 뒤 0~25분 사이에 퇴근한다. 몇 건은 지각, 오늘 전 마지막 근무일의 한 건은 퇴근 누락이 보이도록 섞는다.
// 오늘은 근무가 이미 시작된 사람만 출근 기록을 넣고 퇴근은 비워 둔다. 값은 아이디·날짜로 정해지므로 몇 번 넣어도 같다. 가상 데이터이고 환자 정보는 없다.
import type { Db } from '../../db/index.ts';
import type { SeedContext } from '../../db/seed/types.ts';
import { addDays, kstDate, kstMidnight } from '../../lib/dates.ts';
import { approvedLeaveDays } from './leave.ts';

/** 데모로 채울 지난 날 수(오늘 포함) */
export const DEMO_ATTENDANCE_DAYS = 14;

/** 'HH:MM' → 분 */
function toMin(v: string): number {
  const [h, m] = v.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** 아이디·날짜로 정해지는 0 이상 n 미만 수(무작위처럼 보이지만 늘 같다) */
function pick(key: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  return h % n;
}

/** 데모 출퇴근 기록을 넣는다(이미 있으면 넣지 않는다) */
export function seedAttendanceDemo(db: Db, ctx: SeedContext): void {
  if (db.get('SELECT 1 AS x FROM attendance LIMIT 1')) return;
  const now = ctx.clock.now();
  const today = kstDate(now);
  const from = addDays(today, -(DEMO_ATTENDANCE_DAYS - 1));
  const cells = db.all<{ user_id: number; username: string; date: string; start_time: string; end_time: string }>(
    `SELECT r.user_id, u.username, r.date, s.start_time, s.end_time FROM roster r
     JOIN shift_types s ON s.id = r.shift_type_id JOIN users u ON u.id = r.user_id
     WHERE r.date BETWEEN ? AND ? AND s.counts_as_work = 1 AND s.start_time IS NOT NULL AND u.active = 1
     ORDER BY r.date, r.user_id`,
    [from, today],
  );
  const fullLeave = new Set(approvedLeaveDays(db, from, today).filter((l) => l.type !== 'half_am' && l.type !== 'half_pm').map((l) => `${l.userId}|${l.date}`));
  // 오늘 전 마지막 근무일 기록 하나는 퇴근을 빠뜨린 것으로 둔다(화면에 "퇴근 누락"이 보이게)
  const lastPast = cells.filter((c) => c.date < today).map((c) => c.date).sort().pop() ?? null;
  let missingDone = false;
  db.tx(() => {
    for (const c of cells) {
      if (fullLeave.has(`${c.user_id}|${c.date}`)) continue;
      const key = `${c.username}|${c.date}`;
      const day = kstMidnight(c.date).getTime();
      const start = toMin(c.start_time);
      let end = toMin(c.end_time);
      if (end <= start) end += 24 * 60;
      // 열에 하나꼴로 지각(유예 5분을 넘는 7~18분), 나머지는 5~20분 일찍
      const late = pick(`late|${key}`, 10) === 0;
      const inMin = late ? start + 7 + pick(`lm|${key}`, 12) : start - 5 - pick(`em|${key}`, 16);
      const inAt = new Date(day + inMin * 60_000);
      if (inAt.getTime() > now.getTime()) continue; // 아직 출근 전
      let outAt: Date | null = new Date(day + (end + pick(`out|${key}`, 26)) * 60_000);
      if (outAt.getTime() > now.getTime()) outAt = null; // 아직 근무 중
      if (!missingDone && c.date === lastPast && c.username !== 'director') {
        outAt = null;
        missingDone = true;
      }
      const at = inAt.toISOString();
      db.run('INSERT OR IGNORE INTO attendance (user_id, work_date, clock_in, clock_out, in_ip, out_ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        c.user_id,
        c.date,
        at,
        outAt?.toISOString() ?? null,
        '192.168.0.20',
        outAt ? '192.168.0.20' : null,
        at,
      ]);
    }
  });
}
