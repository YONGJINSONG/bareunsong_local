// 이 파일이 하는 일: hr 모듈의 데모 데이터(database.md §11, TD-024). 지금은 연차·휴가(phase-03-task-09) 부분만 넣는다. 가상 치과 "하늘숲치과" 기준이고 환자 정보는 없다.
// 연차 신청 몇 건(승인·승인 대기·반려·병가)과 직원 몇 명의 올해 부여 일수를 넣는다. 승인 대기 1건은 같은 날 이미 2명이 승인된 날이라 승인 화면에 인원 초과 경고가 보인다.
// 날짜는 기준일(시계)로부터 며칠 전·후로 정하고, 병원 휴진일이면 다음 진료일로 옮긴다. 직원은 admin 모듈 seed가 먼저 넣은 데모 직원이고, 없으면 그 건은 건너뛴다.
// 이미 신청이 있으면 넣지 않는다. 근무 유형·근무표(phase-04-task-01), 교육·온보딩(phase-04-task-02)은 각 태스크가 이 파일에 더한다. 모양은 server/db/seed/types.ts의 ModuleSeed다.
import type { Db } from '../../db/index.ts';
import type { SeedContext } from '../../db/seed/types.ts';
import { addDays, kstDate, kstMidnight } from '../../lib/dates.ts';
import { readClinic } from '../admin/clinic.ts';
import { seedTrainingDemo } from './training-seed.ts';
import { countLeaveDays, isClinicOpen, type LeaveStatus, type LeaveType } from '../../../shared/schemas/leave.ts';
import { seedRosterDemo } from './roster-seed.ts';
import { seedAttendanceDemo } from './attendance-seed.ts';

/** 이 모듈이 소유한 업무 테이블(초기화 때 비울 대상). 근무표·교육·온보딩 테이블은 각 태스크가 더한다 */
export const tables: readonly string[] = ['leave_requests', 'leave_allowances', 'roster', 'attendance'];

/** 데모 연차 신청(가상). offset은 기준일로부터 며칠 뒤(음수면 전), span은 달력 날 수 */
export const DEMO_LEAVES: ReadonlyArray<{ user: string; type: LeaveType; offset: number; span?: number; status: LeaveStatus; reason?: string; rejectReason?: string }> = [
  { user: 'jeonghaneul', type: 'annual', offset: 4, status: 'approved', reason: '가족 행사' },
  { user: 'seodaon', type: 'half_pm', offset: 4, status: 'approved', reason: '병원 진료 예약' },
  { user: 'ohsodam', type: 'annual', offset: 4, status: 'pending', reason: '개인 일정' },
  { user: 'joeunsol', type: 'annual', offset: 10, span: 2, status: 'pending', reason: '여행' },
  { user: 'yoongaram', type: 'half_am', offset: 18, status: 'pending', reason: '은행 업무' },
  { user: 'limchaeun', type: 'sick', offset: -5, status: 'approved', reason: '감기 몸살' },
  { user: 'baenuri', type: 'other', offset: -13, status: 'rejected', reason: '이사', rejectReason: '그날 신규 직원 교육이 있어요. 다른 날로 다시 신청해 주세요.' },
  { user: 'jeonghaneul', type: 'annual', offset: -19, span: 2, status: 'approved', reason: '여행' },
  { user: 'moonjian', type: 'annual', offset: -40, status: 'approved' },
  { user: 'ohsodam', type: 'half_am', offset: -26, status: 'canceled', reason: '일정 변경' },
];

/** 직원별 올해 부여 일수(가상). 여기 없는 직원은 기본값(settings.leave.defaultAllowance)을 쓴다 */
export const DEMO_ALLOWANCES: ReadonlyArray<{ user: string; days: number }> = [
  { user: 'yoongaram', days: 20 },
  { user: 'moonjian', days: 18 },
  { user: 'jeonghaneul', days: 17 },
  { user: 'limchaeun', days: 11 },
  { user: 'baenuri', days: 11 },
];

/** 아이디로 사용자 id를 찾는다(없으면 null) */
function userIdOf(db: Db, username: string): number | null {
  return db.get<{ id: number }>('SELECT id FROM users WHERE username = ?', [username])?.id ?? null;
}

/** 결정한 사람: 데모 실장 → 아무 manager → 첫 관리자 */
function decider(db: Db, except: number): number | null {
  const ids = [
    userIdOf(db, 'yoongaram'),
    userIdOf(db, 'director'),
    db.get<{ id: number }>("SELECT id FROM users WHERE role IN ('admin', 'manager') AND active = 1 AND id <> ? ORDER BY id LIMIT 1", [except])?.id ?? null,
  ];
  return ids.find((id) => id !== null && id !== except) ?? null;
}

/** 기준일 며칠 뒤 몇 시(KST)의 UTC ISO 시각 */
function atKst(day: string, hour: number): string {
  return new Date(kstMidnight(day).getTime() + hour * 3_600_000).toISOString();
}

/** 데모 연차 신청과 부여 일수를 넣는다 */
export function seedDemo(db: Db, ctx: SeedContext): void {
  // 근무표 4주(phase-04-task-01, roster-seed.ts). 근무 유형은 061 마이그레이션이 넣는다
  seedRosterDemo(db, ctx);
  seedTrainingDemo(db, ctx); // 교육·온보딩(phase-04-task-02, training-seed.ts)
  if (db.get('SELECT 1 AS x FROM leave_requests LIMIT 1')) {
    seedAttendanceDemo(db, ctx); // 출퇴근(바른송 추가, attendance-seed.ts)
    return;
  }
  const today = kstDate(ctx.clock.now());
  const year = Number(today.slice(0, 4));
  const hours = readClinic(db).hours;
  const scale = Math.max(1, Math.floor(ctx.scale || 1));
  /** 휴진일이면 다음 진료일로 옮긴다 */
  const openDay = (d: string) => {
    let day = d;
    for (let i = 0; i < 7 && !isClinicOpen(day, hours); i += 1) day = addDays(day, 1);
    return day;
  };

  db.tx(() => {
    const insert = (l: (typeof DEMO_LEAVES)[number], startOn: string) => {
      const userId = userIdOf(db, l.user);
      if (userId === null) return;
      const endOn = addDays(startOn, (l.span ?? 1) - 1);
      const counted = countLeaveDays(l.type, startOn, endOn, hours);
      if ('error' in counted) return; // 해를 넘기는 등 맞지 않는 날짜는 건너뛴다
      const createdDay = addDays(startOn < today ? startOn : today, -3);
      const by = l.status === 'approved' || l.status === 'rejected' ? decider(db, userId) : null;
      if ((l.status === 'approved' || l.status === 'rejected') && by === null) return;
      db.run(
        'INSERT INTO leave_requests (user_id, type, start_on, end_on, days, reason, status, decided_by, decided_at, reject_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          userId,
          l.type,
          startOn,
          endOn,
          counted.days,
          l.reason ?? '',
          l.status,
          by,
          by === null ? null : atKst(addDays(createdDay, 1), 10),
          l.status === 'rejected' ? (l.rejectReason ?? '다른 날로 다시 신청해 주세요.') : null,
          atKst(createdDay, 9),
        ],
      );
    };
    for (const l of DEMO_LEAVES) insert(l, openDay(addDays(today, l.offset)));
    // scale=10(성능 측정): 직원마다 올해 앞쪽 달에 승인된 하루 연차를 더 넣는다
    if (scale > 1) {
      const users = db.all<{ username: string }>("SELECT username FROM users WHERE active = 1 AND role <> 'admin' ORDER BY id");
      users.forEach((u, k) => {
        for (let i = 0; i < scale; i += 1) {
          const day = openDay(`${year}-${String((i % 9) + 1).padStart(2, '0')}-${String(((k * 3 + i) % 25) + 2).padStart(2, '0')}`);
          if (day >= today) continue;
          insert({ user: u.username, type: 'annual', offset: 0, status: 'approved' }, day);
        }
      });
    }
    for (const a of DEMO_ALLOWANCES) {
      const userId = userIdOf(db, a.user);
      if (userId !== null) db.run('INSERT OR IGNORE INTO leave_allowances (user_id, year, days) VALUES (?, ?, ?)', [userId, year, a.days]);
    }
  });
  // 출퇴근(바른송 추가, attendance-seed.ts). 근무표·휴가를 보고 넣으므로 맨 뒤에 둔다
  seedAttendanceDemo(db, ctx);
}
