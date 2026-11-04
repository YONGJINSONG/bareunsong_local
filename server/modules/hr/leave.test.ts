// 이 파일이 하는 일: 연차·휴가 API(leave.ts·leave-routes.ts, FR-080)를 실제 라우트와 DB로 확인한다(phase-03-task-09 AC1~AC4).
// 신청 → 실장 알림 → 승인 → 신청자 알림·잔여 감소(반차 0.5, 휴진일 빼고 세기), 반려 사유 필수, 같은 날 인원 초과 경고(승인은 됨), 직원의 승인 403을 본다.
// 요청은 fastify.inject로 보내고 시계는 2026-11-02 09:00(월)으로 고정한다. 데이터는 .tmp/unit/ 임시 폴더만 쓴다.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.ts';
import { manualClock } from '../../lib/clock.ts';
import { makeTmpDir } from '../../../tests/helpers/tmp-dir.ts';
import { loginAs, type TestLogin } from '../../../tests/helpers/auth.ts';
import { seedDemo as seedAdminDemo } from '../admin/seed.ts';
import { seedDemo as seedHrDemo, tables } from './seed.ts';
import { approvedLeaveDays, pendingLeaveCount } from './leave.ts';
import type { LeaveAllowanceTable, LeaveDecision, LeaveRequestItem } from '../../../shared/schemas/leave.ts';

const START = '2026-11-02T09:00:00+09:00';

let app: FastifyInstance | null = null;
let tmp: string | null = null;

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

async function makeApp() {
  tmp = makeTmpDir('dentalax-leave-');
  const clock = manualClock(START);
  app = await buildApp({ dataDir: tmp, webDist: path.join(tmp, 'no-web'), clock });
  return app;
}

async function request(a: FastifyInstance, who: TestLogin, payload: Record<string, unknown>) {
  return a.inject({ method: 'POST', url: '/api/leave', headers: who.writeHeaders, payload });
}

async function decide(a: FastifyInstance, who: TestLogin, id: number, payload: Record<string, unknown>) {
  return a.inject({ method: 'POST', url: `/api/leave/${id}/decide`, headers: who.writeHeaders, payload });
}

async function allowances(a: FastifyInstance, who: TestLogin, year = 2026): Promise<LeaveAllowanceTable> {
  const res = await a.inject({ method: 'GET', url: `/api/leave/allowances?year=${year}`, headers: who.headers });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: LeaveAllowanceTable }>().data;
}

async function list(a: FastifyInstance, who: TestLogin, query = ''): Promise<LeaveRequestItem[]> {
  const res = await a.inject({ method: 'GET', url: `/api/leave${query}`, headers: who.headers });
  expect(res.statusCode).toBe(200);
  return res.json<{ data: LeaveRequestItem[] }>().data;
}

function notificationsOf(a: FastifyInstance, userId: number) {
  return a.db.all<{ type: string; title: string; body: string | null; link: string | null }>('SELECT type, title, body, link FROM notifications WHERE user_id = ? ORDER BY id', [userId]);
}

describe('신청과 승인', () => {
  test('phase-03-task-09 AC1: 직원이 반차를 신청하면 실장에게 알림이 가고, 승인하면 신청자에게 알림이 가며 잔여 일수가 0.5 줄어든다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const admin = loginAs(a, 'admin');
    const staff = loginAs(a, 'staff');
    const other = loginAs(a, 'staff');

    const before = await allowances(a, staff);
    expect(before.rows).toEqual([expect.objectContaining({ userId: staff.userId, allowance: 15, isDefault: true, used: 0, remaining: 15 })]);

    const r = await request(a, staff, { type: 'half_am', startOn: '2026-11-06', reason: '은행 업무' });
    expect(r.statusCode).toBe(201);
    const item = r.json<{ data: LeaveRequestItem }>().data;
    expect(item).toMatchObject({ type: 'half_am', startOn: '2026-11-06', endOn: '2026-11-06', days: 0.5, status: 'pending', reason: '은행 업무' });

    // 실장·원장에게 알림, 다른 직원·본인에게는 없음
    for (const m of [manager, admin]) {
      expect(notificationsOf(a, m.userId)).toEqual([expect.objectContaining({ type: 'leave_requested', title: '테스트 staff 님이 휴가를 신청했어요', link: '/hr/leave' })]);
      expect(notificationsOf(a, m.userId)[0]?.body).toContain('반차(오전) · 11월 6일(금) · 0.5일');
    }
    expect(notificationsOf(a, staff.userId)).toEqual([]);
    expect(notificationsOf(a, other.userId)).toEqual([]);
    // 대기 중에는 잔여가 줄지 않고 "대기"로 보인다
    expect((await allowances(a, staff)).rows[0]).toMatchObject({ used: 0, pending: 0.5, remaining: 15 });
    expect(pendingLeaveCount(a.db)).toBe(1);

    const d = await decide(a, manager, item.id, { approve: true });
    expect(d.statusCode).toBe(200);
    const result = d.json<{ data: LeaveDecision }>().data;
    expect(result.request).toMatchObject({ status: 'approved', decidedBy: { id: manager.userId } });
    expect(result.warnings).toEqual([]);
    expect(notificationsOf(a, staff.userId)).toEqual([expect.objectContaining({ type: 'leave_result', title: '11월 6일(금) 반차(오전) 신청이 승인됐어요', link: '/hr/leave' })]);
    expect((await allowances(a, staff)).rows[0]).toMatchObject({ used: 0.5, pending: 0, remaining: 14.5 });
    expect(pendingLeaveCount(a.db)).toBe(0);
    // 근무표가 읽을 승인된 휴가 날짜
    expect(approvedLeaveDays(a.db, '2026-11-01', '2026-11-30')).toEqual([{ userId: staff.userId, date: '2026-11-06', type: 'half_am', requestId: item.id }]);
    // 감사 기록
    const actions = a.db.all<{ action: string }>("SELECT action FROM audit_log WHERE action LIKE 'leave.%' ORDER BY id").map((x) => x.action);
    expect(actions).toEqual(['leave.request', 'leave.approve']);
  });

  test('phase-03-task-09 AC1: 기간 연차는 병원 휴진일(일요일)을 빼고 세고, 승인되면 그만큼 잔여가 줄어든다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    // 11/7(토)~11/10(화): 기본 진료시간은 토요일 진료, 일요일 휴진 → 토·월·화 3일
    const r = await request(a, staff, { type: 'annual', startOn: '2026-11-07', endOn: '2026-11-10' });
    expect(r.statusCode).toBe(201);
    const item = r.json<{ data: LeaveRequestItem }>().data;
    expect(item.days).toBe(3);
    expect((await decide(a, manager, item.id, { approve: true })).statusCode).toBe(200);
    expect((await allowances(a, staff)).rows[0]).toMatchObject({ used: 3, remaining: 12 });
    expect(approvedLeaveDays(a.db, '2026-11-01', '2026-11-30').map((x) => x.date)).toEqual(['2026-11-07', '2026-11-09', '2026-11-10']);
    // 병가는 일수만 기록되고 잔여에서 빠지지 않는다
    const sick = (await request(a, staff, { type: 'sick', startOn: '2026-11-12' })).json<{ data: LeaveRequestItem }>().data;
    await decide(a, manager, sick.id, { approve: true });
    expect((await allowances(a, staff)).rows[0]).toMatchObject({ used: 3, otherUsed: 1, remaining: 12 });
  });

  test('phase-03-task-09 AC1: 휴진일만 고르거나 반차를 여러 날로, 본인 기간이 겹치게 신청하면 저장되지 않는다', async () => {
    const a = await makeApp();
    const staff = loginAs(a, 'staff');
    const sunday = await request(a, staff, { type: 'annual', startOn: '2026-11-08' });
    expect(sunday.statusCode).toBe(400);
    expect(sunday.json<{ error: { fields: Record<string, string> } }>().error.fields.startOn).toBe('고른 날은 모두 병원 휴진일이에요. 진료하는 날을 골라 주세요.');
    const halfLong = await request(a, staff, { type: 'half_pm', startOn: '2026-11-09', endOn: '2026-11-10' });
    expect(halfLong.statusCode).toBe(400);
    expect(halfLong.json<{ error: { fields: Record<string, string> } }>().error.fields.endOn).toBe('반차는 하루만 신청할 수 있어요.');
    const backwards = await request(a, staff, { type: 'annual', startOn: '2026-11-10', endOn: '2026-11-09' });
    expect(backwards.statusCode).toBe(400);
    expect((await request(a, staff, { type: 'annual', startOn: '2026-11-09', endOn: '2026-11-10' })).statusCode).toBe(201);
    const clash = await request(a, staff, { type: 'annual', startOn: '2026-11-10' });
    expect(clash.statusCode).toBe(400);
    expect(clash.json<{ error: { message: string } }>().error.message).toContain('이미 11월 9일(월)~11월 10일(화) 연차 신청이 있어요(승인 대기)');
    // 같은 날 오전 반차와 오후 반차는 함께 낼 수 있다
    expect((await request(a, staff, { type: 'half_am', startOn: '2026-11-12' })).statusCode).toBe(201);
    expect((await request(a, staff, { type: 'half_pm', startOn: '2026-11-12' })).statusCode).toBe(201);
    expect((await request(a, staff, { type: 'half_pm', startOn: '2026-11-12' })).statusCode).toBe(400);
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM leave_requests')?.n).toBe(3);
  });

  test('phase-03-task-09 AC1: 본인은 승인 대기 신청만 취소할 수 있다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const other = loginAs(a, 'staff');
    const one = (await request(a, staff, { type: 'annual', startOn: '2026-11-09' })).json<{ data: LeaveRequestItem }>().data;
    const two = (await request(a, staff, { type: 'annual', startOn: '2026-11-10' })).json<{ data: LeaveRequestItem }>().data;
    expect((await a.inject({ method: 'POST', url: `/api/leave/${one.id}/cancel`, headers: other.writeHeaders })).statusCode).toBe(403);
    const ok = await a.inject({ method: 'POST', url: `/api/leave/${one.id}/cancel`, headers: staff.writeHeaders });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<{ data: LeaveRequestItem }>().data.status).toBe('canceled');
    await decide(a, manager, two.id, { approve: true });
    const late = await a.inject({ method: 'POST', url: `/api/leave/${two.id}/cancel`, headers: staff.writeHeaders });
    expect(late.statusCode).toBe(409);
    // 취소한 날은 다시 신청할 수 있다
    expect((await request(a, staff, { type: 'annual', startOn: '2026-11-09' })).statusCode).toBe(201);
  });
});

describe('반려', () => {
  test('phase-03-task-09 AC2: 반려 사유를 비우면 저장되지 않고 오류 문구가 오며, 사유를 적으면 반려되고 신청자에게 사유가 알림으로 간다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const staff = loginAs(a, 'staff');
    const item = (await request(a, staff, { type: 'annual', startOn: '2026-11-09' })).json<{ data: LeaveRequestItem }>().data;
    for (const payload of [{ approve: false }, { approve: false, reason: '' }, { approve: false, reason: '   ' }]) {
      const r = await decide(a, manager, item.id, payload);
      expect(r.statusCode).toBe(400);
      expect(r.json<{ error: { code: string; fields: Record<string, string> } }>().error).toMatchObject({ code: 'VALIDATION', fields: { reason: '반려 사유를 적어 주세요.' } });
    }
    expect((await list(a, manager))[0]).toMatchObject({ id: item.id, status: 'pending', rejectReason: null });
    expect(notificationsOf(a, staff.userId)).toEqual([]);

    const r = await decide(a, manager, item.id, { approve: false, reason: '그날 이미 두 명이 쉬어요' });
    expect(r.statusCode).toBe(200);
    expect(r.json<{ data: LeaveDecision }>().data.request).toMatchObject({ status: 'rejected', rejectReason: '그날 이미 두 명이 쉬어요' });
    expect(notificationsOf(a, staff.userId)).toEqual([
      expect.objectContaining({ type: 'leave_result', title: '11월 9일(월) 연차 신청이 반려됐어요', body: '반려 사유: 그날 이미 두 명이 쉬어요' }),
    ]);
    // 이미 처리된 신청은 다시 결정할 수 없다
    expect((await decide(a, manager, item.id, { approve: true })).statusCode).toBe(409);
    // DB도 반려에 사유가 없으면 거부한다
    expect(() => a.db.run("UPDATE leave_requests SET reject_reason = '' WHERE id = ?", [item.id])).toThrow();
  });
});

describe('같은 날 인원 초과 경고', () => {
  test('phase-03-task-09 AC3: 같은 날 이미 2명이 승인(maxPerDay=2)된 날을 승인하려 하면 경고가 나오고, 승인은 된다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const admin = loginAs(a, 'admin');
    const s1 = loginAs(a, 'staff');
    const s2 = loginAs(a, 'staff');
    const s3 = loginAs(a, 'staff');
    expect((await a.inject({ method: 'GET', url: '/api/settings/leave', headers: admin.headers })).json<{ data: unknown }>().data).toEqual({ maxPerDay: 2, defaultAllowance: 15 });
    const r1 = (await request(a, s1, { type: 'annual', startOn: '2026-11-11' })).json<{ data: LeaveRequestItem }>().data;
    const r2 = (await request(a, s2, { type: 'half_pm', startOn: '2026-11-11' })).json<{ data: LeaveRequestItem }>().data;
    const r3 = (await request(a, s3, { type: 'annual', startOn: '2026-11-10', endOn: '2026-11-11' })).json<{ data: LeaveRequestItem }>().data;
    expect((await decide(a, manager, r1.id, { approve: true })).json<{ data: LeaveDecision }>().data.warnings).toEqual([]);
    expect((await decide(a, manager, r2.id, { approve: true })).json<{ data: LeaveDecision }>().data.warnings).toEqual([]);

    // 승인 화면 목록에서 미리 경고가 보인다(직원 목록에는 경고를 넣지 않는다)
    const pending = (await list(a, manager, '?status=pending')).find((x) => x.id === r3.id);
    expect(pending?.warnings).toEqual(['11월 11일(수)에 이미 2명이 휴가예요. 승인하면 하루 최대 2명을 넘어요.']);
    expect((await list(a, s3))[0]?.warnings).toEqual([]);

    const d = await decide(a, manager, r3.id, { approve: true });
    expect(d.statusCode).toBe(200);
    const result = d.json<{ data: LeaveDecision }>().data;
    expect(result.request.status).toBe('approved');
    expect(result.warnings).toEqual(['11월 11일(수)에 이미 2명이 휴가예요. 승인하면 하루 최대 2명을 넘어요.']);

    // admin이 하루 최대 인원을 3으로 올리면 경고가 사라진다
    const put = await a.inject({ method: 'PUT', url: '/api/settings/leave', headers: admin.writeHeaders, payload: { maxPerDay: 3, defaultAllowance: 15 } });
    expect(put.statusCode).toBe(200);
    const s4 = loginAs(a, 'staff');
    const r4 = (await request(a, s4, { type: 'annual', startOn: '2026-11-11' })).json<{ data: LeaveRequestItem }>().data;
    expect((await decide(a, manager, r4.id, { approve: true })).json<{ data: LeaveDecision }>().data.warnings).toEqual([
      '11월 11일(수)에 이미 3명이 휴가예요. 승인하면 하루 최대 3명을 넘어요.',
    ]);
  });

  test('phase-03-task-09 AC3: 승인하면 잔여 연차가 모자라는 경우에도 경고가 나온다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const admin = loginAs(a, 'admin');
    const staff = loginAs(a, 'staff');
    const saved = await a.inject({ method: 'PUT', url: '/api/leave/allowances', headers: admin.writeHeaders, payload: { year: 2026, items: [{ userId: staff.userId, days: 1 }] } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<{ data: LeaveAllowanceTable }>().data.rows.find((x) => x.userId === staff.userId)).toMatchObject({ allowance: 1, isDefault: false, remaining: 1 });
    const item = (await request(a, staff, { type: 'annual', startOn: '2026-11-09', endOn: '2026-11-10' })).json<{ data: LeaveRequestItem }>().data;
    const result = (await decide(a, manager, item.id, { approve: true })).json<{ data: LeaveDecision }>().data;
    expect(result.warnings).toEqual(['승인하면 2026년 잔여 연차가 -1일이 돼요(부여 1일).']);
    expect((await allowances(a, staff)).rows[0]).toMatchObject({ used: 2, remaining: -1 });
  });
});

describe('권한', () => {
  test('phase-03-task-09 AC4: 직원은 다른 사람 신청을 승인·반려할 수 없다(403)', async () => {
    const a = await makeApp();
    const staff = loginAs(a, 'staff');
    const other = loginAs(a, 'staff');
    const item = (await request(a, other, { type: 'annual', startOn: '2026-11-09' })).json<{ data: LeaveRequestItem }>().data;
    for (const payload of [{ approve: true }, { approve: false, reason: '안 돼요' }]) {
      const r = await decide(a, staff, item.id, payload);
      expect(r.statusCode).toBe(403);
      expect(r.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN');
    }
    expect(a.db.get<{ status: string }>('SELECT status FROM leave_requests WHERE id = ?', [item.id])?.status).toBe('pending');
    // 직원은 다른 사람 신청을 볼 수도 없다(mine=0이어도 본인 것만)
    expect(await list(a, staff, '?mine=0')).toEqual([]);
    expect((await list(a, other)).map((x) => x.id)).toEqual([item.id]);
    // 직원의 부여·잔여 표에는 본인 줄만 있다
    expect((await allowances(a, staff)).rows.map((x) => x.userId)).toEqual([staff.userId]);
  });

  test('phase-03-task-09 AC4: 부여 일수·연차 설정은 admin만 바꾸고, 실장은 본인 신청을 결정할 수 없다', async () => {
    const a = await makeApp();
    const manager = loginAs(a, 'manager');
    const admin = loginAs(a, 'admin');
    const staff = loginAs(a, 'staff');
    for (const who of [manager, staff]) {
      expect((await a.inject({ method: 'PUT', url: '/api/leave/allowances', headers: who.writeHeaders, payload: { year: 2026, items: [] } })).statusCode).toBe(403);
      expect((await a.inject({ method: 'PUT', url: '/api/settings/leave', headers: who.writeHeaders, payload: { maxPerDay: 5, defaultAllowance: 15 } })).statusCode).toBe(403);
      expect((await a.inject({ method: 'GET', url: '/api/settings/leave', headers: who.headers })).statusCode).toBe(403);
    }
    // 실장은 전체 직원 표를 본다
    expect((await allowances(a, manager)).rows.map((x) => x.userId).sort()).toEqual([manager.userId, admin.userId, staff.userId].sort());
    const own = (await request(a, manager, { type: 'annual', startOn: '2026-11-09' })).json<{ data: LeaveRequestItem }>().data;
    // 본인 신청 알림은 본인에게 가지 않고 원장에게만 간다
    expect(notificationsOf(a, manager.userId)).toEqual([]);
    expect(notificationsOf(a, admin.userId).map((n) => n.type)).toEqual(['leave_requested']);
    const self = await decide(a, manager, own.id, { approve: true });
    expect(self.statusCode).toBe(403);
    expect(self.json<{ error: { message: string } }>().error.message).toBe('본인 신청은 다른 관리자가 승인하거나 반려해요.');
    expect((await decide(a, admin, own.id, { approve: true })).statusCode).toBe(200);
    // 입력 검사: 0.5일 단위가 아니면 거부
    const bad = await a.inject({ method: 'PUT', url: '/api/leave/allowances', headers: admin.writeHeaders, payload: { year: 2026, items: [{ userId: staff.userId, days: 1.3 }] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json<{ error: { fields: Record<string, string> } }>().error.fields['items.0.days']).toBe('부여 일수는 0.5일 단위로 적어 주세요.');
  });
});

describe('데모 데이터', () => {
  test('phase-03-task-09: 데모 연차 신청·부여 일수가 들어가고, 승인 대기 1건은 인원 초과 경고가 보인다', async () => {
    const a = await makeApp();
    const ctx = { clock: a.clock, scale: 1 };
    await seedAdminDemo(a.db, ctx);
    seedHrDemo(a.db, ctx);
    expect(tables).toEqual(['leave_requests', 'leave_allowances', 'roster', 'attendance']); // attendance: 바른송 추가(D-B01) // roster는 phase-04-task-01이 더했다
    const count = a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM leave_requests')?.n ?? 0;
    expect(count).toBe(10);
    seedHrDemo(a.db, ctx); // 두 번 넣어도 늘지 않는다
    expect(a.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM leave_requests')?.n).toBe(count);
    const manager = loginAs(a, 'manager');
    const pending = await list(a, manager, '?status=pending');
    expect(pending).toHaveLength(3);
    const sodam = pending.find((x) => x.user.name === '오소담');
    expect(sodam?.warnings).toEqual(['11월 6일(금)에 이미 2명이 휴가예요. 승인하면 하루 최대 2명을 넘어요.']);
    const table = await allowances(a, manager);
    expect(table.rows.find((x) => x.name === '정하늘')).toMatchObject({ allowance: 17, used: 3, remaining: 14 });
    // 반려 건에는 사유가 있다
    expect(a.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'rejected' AND length(reject_reason) > 0")?.n).toBe(1);
  });
});
