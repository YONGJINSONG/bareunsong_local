// 이 파일이 하는 일: 출퇴근 기록 API(attendance.ts·attendance-routes.ts, 바른송 추가 기능 D-B01)를 실제 라우트와 DB로 확인한다.
// 출근·퇴근 한 번씩, 허용 와이파이 대역 밖 기기 차단(서버 PC는 허용), 근무표 기준 지각·조퇴와 유예 시간, 자정을 넘긴 야간 퇴근,
// 직원은 본인 기록만, 실장의 기록 고치기(사유 필수·다음 날 퇴근)와 CSV, 설정 입력 검사를 본다. 시계는 2026-11-02(월) 08:50 KST에서 움직인다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../../app.ts';
import { manualClock, type ManualClock } from '../../lib/clock.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { createSession } from '../../auth/sessions.ts';
import { inCidr, parseCidr, subnet24Of, type AttendanceMonth, type AttendanceRecord, type AttendanceToday } from '../../../shared/schemas/attendance.ts';

const START = '2026-11-02T08:50:00+09:00';

let app: FastifyInstance | null = null;
let tmp: string | null = null;
let clock: ManualClock;

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

async function makeApp() {
  tmp = makeTmpDir('dentalax-attendance-');
  clock = manualClock(START);
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock });
  return app;
}

/**
 * 그 사용자로 지금 막 로그인한 헤더. 시계를 하루씩 넘기면 세션(8시간)이 끝나므로 요청마다 새 세션을 연다.
 */
function as(a: FastifyInstance, who: TestLogin): { headers: Record<string, string>; writeHeaders: Record<string, string> } {
  const s = createSession(a.db, a.clock, who.userId, '127.0.0.1');
  const cookie = `sid=${s.token}`;
  return { headers: { cookie }, writeHeaders: { cookie, 'x-csrf-token': s.csrfToken } };
}

/** 이 직원의 그날 근무표 칸을 넣는다(근무 유형 코드) */
function setShift(a: FastifyInstance, userId: number, date: string, code: string) {
  const t = a.db.get<{ id: number }>('SELECT id FROM shift_types WHERE code = ?', [code]);
  a.db.run('INSERT OR REPLACE INTO roster (user_id, date, shift_type_id) VALUES (?, ?, ?)', [userId, date, t?.id]);
}

function punch(a: FastifyInstance, who: TestLogin, kind: 'in' | 'out', ip = '192.168.0.31') {
  const opts: InjectOptions = { method: 'POST', url: `/api/attendance/clock-${kind}`, headers: as(a, who).writeHeaders, remoteAddress: ip };
  return a.inject(opts);
}

async function today(a: FastifyInstance, who: TestLogin, ip = '192.168.0.31'): Promise<AttendanceToday> {
  const res = await a.inject({ method: 'GET', url: '/api/attendance/today', headers: as(a, who).headers, remoteAddress: ip });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: AttendanceToday }>().data;
}

async function month(a: FastifyInstance, who: TestLogin, query = ''): Promise<AttendanceMonth> {
  const res = await a.inject({ method: 'GET', url: `/api/attendance${query}`, headers: as(a, who).headers });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: AttendanceMonth }>().data;
}

describe('대역 계산(shared)', () => {
  test('D-B01: CIDR 읽기·포함 여부·/24 대역 이름', () => {
    expect(parseCidr('192.168.0.0/24')).toEqual({ base: (192 << 24 >>> 0) + (168 << 16), bits: 24 });
    expect(parseCidr('192.168.0.7')?.bits).toBe(32);
    expect(parseCidr('192.168.0.0/40')).toBeNull();
    expect(parseCidr('wifi')).toBeNull();
    expect(inCidr('192.168.0.200', '192.168.0.0/24')).toBe(true);
    expect(inCidr('::ffff:192.168.0.5', '192.168.0.0/24')).toBe(true);
    expect(inCidr('192.168.1.5', '192.168.0.0/24')).toBe(false);
    expect(subnet24Of('10.0.3.77')).toBe('10.0.3.0/24');
  });
});

describe('출근·퇴근 찍기', () => {
  test('D-B01: 출근 → 다시 출근은 409 → 퇴근하면 근무 분이 계산되고, 다시 퇴근은 409', async () => {
    const a = await makeApp();
    const staff = loginAs(a, 'staff');
    expect((await today(a, staff)).next).toBe('in');

    const inRes = await punch(a, staff, 'in');
    expect(inRes.statusCode).toBe(200);
    expect((await today(a, staff)).next).toBe('out');

    const again = await punch(a, staff, 'in');
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: { message: string } }>().error.message).toContain('08:50에 출근');

    clock.set('2026-11-02T18:40:00+09:00');
    const outRes = await punch(a, staff, 'out');
    expect(outRes.statusCode).toBe(200);
    expect(outRes.json<{ data: AttendanceRecord }>().data.minutes).toBe(590);
    expect((await today(a, staff)).next).toBe('done');
    expect((await punch(a, staff, 'out')).statusCode).toBe(409);

    const log = a.db.all<{ action: string }>("SELECT action FROM audit_log WHERE action LIKE 'attendance.%' ORDER BY id");
    expect(log.map((l) => l.action)).toEqual(['attendance.clock_in', 'attendance.clock_out']);
  });

  test('D-B01: 출근 없이 퇴근하면 409와 쉬운 안내', async () => {
    const a = await makeApp();
    const staff = loginAs(a, 'staff');
    const res = await punch(a, staff, 'out');
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { message: string } }>().error.message).toContain('출근 기록이 없어요');
  });

  test('D-B01: 야간 근무로 자정을 넘겨 퇴근해도 출근한 날 기록에 붙는다', async () => {
    const a = await makeApp();
    const staff = loginAs(a, 'staff');
    setShift(a, staff.userId, '2026-11-02', 'night');
    clock.set('2026-11-02T12:55:00+09:00');
    expect((await punch(a, staff, 'in')).statusCode).toBe(200);
    clock.set('2026-11-03T00:40:00+09:00');
    const t = await today(a, staff);
    expect(t.next).toBe('out');
    expect(t.record?.workDate).toBe('2026-11-02');
    const out = await punch(a, staff, 'out');
    expect(out.statusCode).toBe(200);
    const rec = out.json<{ data: AttendanceRecord }>().data;
    expect(rec.workDate).toBe('2026-11-02');
    expect(rec.earlyMin).toBe(0);
    expect(rec.lateMin).toBe(0);
  });
});

describe('원내 와이파이 대역 제한', () => {
  test('D-B01: 대역을 정하면 그 밖의 원내 기기는 403, 대역 안 기기와 서버 PC는 찍힌다. 비우면 원내망 전체 허용', async () => {
    const a = await makeApp();
    const admin = loginAs(a, 'admin');
    const staff = loginAs(a, 'staff');
    const other = loginAs(a, 'staff');
    const third = loginAs(a, 'staff');

    // 기본값(대역 없음): 원내망 어디서나
    expect((await today(a, staff, '192.168.5.9')).device.allowed).toBe(true);

    const set = await a.inject({ method: 'PUT', url: '/api/settings/attendance', headers: admin.writeHeaders, payload: { allowedNetworks: ['192.168.0.0/24'], lateGraceMin: 5 } });
    expect(set.statusCode).toBe(200);

    const t = await today(a, staff, '192.168.5.9');
    expect(t.device).toEqual({ ip: '192.168.5.9', allowed: false, allowedNetworks: ['192.168.0.0/24'] });
    const blocked = await punch(a, staff, 'in', '192.168.5.9');
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json<{ error: { message: string; reason: string } }>().error).toMatchObject({ reason: 'ATTENDANCE_NETWORK' });
    expect(blocked.json<{ error: { message: string } }>().error.message).toContain('병원 와이파이');

    expect((await punch(a, staff, 'in', '192.168.0.44')).statusCode).toBe(200);
    expect((await punch(a, other, 'in', '127.0.0.1')).statusCode).toBe(200);
    expect((await punch(a, third, 'in', '::ffff:192.168.0.8')).statusCode).toBe(200);
  });

  test('D-B01: 설정 입력 검사 — 틀린 대역·범위 밖 유예는 400, 직원은 설정 403', async () => {
    const a = await makeApp();
    const admin = loginAs(a, 'admin');
    const manager = loginAs(a, 'manager');
    const bad = await a.inject({ method: 'PUT', url: '/api/settings/attendance', headers: admin.writeHeaders, payload: { allowedNetworks: ['병원 와이파이'], lateGraceMin: 90 } });
    expect(bad.statusCode).toBe(400);
    const fields = bad.json<{ error: { fields: Record<string, string> } }>().error.fields;
    expect(fields['allowedNetworks.0']).toContain('192.168.0.0/24');
    expect(fields.lateGraceMin).toContain('60분');
    expect((await a.inject({ method: 'PUT', url: '/api/settings/attendance', headers: manager.writeHeaders, payload: { allowedNetworks: [], lateGraceMin: 5 } })).statusCode).toBe(403);
  });
});

describe('지각·조퇴', () => {
  test('D-B01: 근무 시작보다 늦게 오면 지각(유예 5분까지는 아님), 끝보다 일찍 가면 조퇴', async () => {
    const a = await makeApp();
    const late = loginAs(a, 'staff');
    const ok = loginAs(a, 'staff');
    setShift(a, late.userId, '2026-11-02', 'full'); // 09:30~18:30
    setShift(a, ok.userId, '2026-11-02', 'full');

    clock.set('2026-11-02T09:34:00+09:00');
    const okIn = (await punch(a, ok, 'in')).json<{ data: AttendanceRecord }>().data;
    expect(okIn.lateMin).toBe(0);
    clock.set('2026-11-02T09:50:00+09:00');
    const lateIn = (await punch(a, late, 'in')).json<{ data: AttendanceRecord }>().data;
    expect(lateIn.lateMin).toBe(20);
    expect(lateIn.shift).toEqual({ label: '종일', start: '09:30', end: '18:30' });

    clock.set('2026-11-02T18:00:00+09:00');
    const early = (await punch(a, late, 'out')).json<{ data: AttendanceRecord }>().data;
    expect(early.earlyMin).toBe(30);
  });

  test('D-B01: 승인된 오전 반차인 날은 늦게 와도 지각이 아니다', async () => {
    const a = await makeApp();
    const staff = loginAs(a, 'staff');
    setShift(a, staff.userId, '2026-11-02', 'full');
    a.db.run(
      "INSERT INTO leave_requests (user_id, type, start_on, end_on, days, status, created_at) VALUES (?, 'half_am', '2026-11-02', '2026-11-02', 0.5, 'approved', ?)",
      [staff.userId, clock.now().toISOString()],
    );
    clock.set('2026-11-02T13:55:00+09:00');
    expect((await punch(a, staff, 'in')).json<{ data: AttendanceRecord }>().data.lateMin).toBe(0);
  });
});

describe('조회·고치기·내보내기', () => {
  test('D-B01: 직원은 userId를 줘도 본인 기록만, 실장은 전 직원 기록과 합계를 본다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const s1 = loginAs(a, 'staff');
    const s2 = loginAs(a, 'staff');
    await punch(a, s1, 'in');
    await punch(a, s2, 'in');

    const own = await month(a, s1, `?month=2026-11&userId=${s2.userId}`);
    expect(own.records.map((r) => r.user.id)).toEqual([s1.userId]);
    const all = await month(a, manager, '?month=2026-11');
    expect(all.records).toHaveLength(2);
    expect(all.summary.every((s) => s.days === 1)).toBe(true);
    expect((await month(a, manager, `?userId=${s2.userId}`)).records.map((r) => r.user.id)).toEqual([s2.userId]);
  });

  test('D-B01: 실장은 사유와 함께 기록을 넣고 고친다(퇴근이 더 이르면 다음 날). 직원은 403, 사유가 없으면 400', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    clock.set('2026-11-03T10:00:00+09:00');
    const put = (who: TestLogin, payload: Record<string, unknown>) => a.inject({ method: 'PUT', url: '/api/attendance/records', headers: as(a, who).writeHeaders, payload });
    const body = { userId: staff.userId, workDate: '2026-11-02', clockIn: '13:00', clockOut: '00:30', reason: '퇴근을 깜빡해서 근무표 보고 넣음' };

    expect((await put(staff, body)).statusCode).toBe(403);
    const noReason = await put(manager, { ...body, reason: '  ' });
    expect(noReason.statusCode).toBe(400);
    expect(noReason.json<{ error: { fields: Record<string, string> } }>().error.fields.reason).toContain('이유');

    const res = await put(manager, body);
    expect(res.statusCode).toBe(200);
    const rec = res.json<{ data: AttendanceRecord }>().data;
    expect(rec.minutes).toBe(690);
    expect(rec.clockOut).toBe('2026-11-02T15:30:00.000Z');
    expect(rec.edited).toMatchObject({ reason: '퇴근을 깜빡해서 근무표 보고 넣음' });

    const future = await put(manager, { ...body, workDate: '2026-11-04' });
    expect(future.statusCode).toBe(400);
  });

  test('D-B01: 지난 날 퇴근이 없으면 퇴근 누락으로 보이고, CSV는 실장만 받는다(BOM·한글 열 이름)', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    await punch(a, staff, 'in');
    clock.set('2026-11-03T09:10:00+09:00');
    const rec = (await month(a, manager)).records[0];
    expect(rec?.missingOut).toBe(true);
    // 어제 기록이 열린 채 20시간을 넘었으므로 오늘 출근은 새 기록이 된다
    expect((await punch(a, staff, 'in')).statusCode).toBe(200);

    const csv = await a.inject({ method: 'GET', url: '/api/attendance/export.csv?month=2026-11', headers: as(a, manager).headers });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.charCodeAt(0)).toBe(0xfeff);
    expect(csv.body).toContain('이름,날짜,근무,출근,퇴근');
    expect(csv.body).toContain('직원별 합계');
    expect((await a.inject({ method: 'GET', url: '/api/attendance/export.csv', headers: as(a, staff).headers })).statusCode).toBe(403);
  });
});
