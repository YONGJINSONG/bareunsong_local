// 이 파일이 하는 일: 출퇴근 기록 API(바른송치과 추가 기능, DECISIONS D-B01)를 등록한다. 처리 내용은 attendance.ts에 있다.
// - GET /attendance/today : 오늘 내 상태와 이 기기가 찍을 수 있는지 · POST /attendance/clock-in · POST /attendance/clock-out (attendance.punch, 허용 대역에서만)
// - GET /attendance?month=YYYY-MM&userId= : 한 달 기록·합계(직원은 늘 본인 것만, 실장 이상은 전 직원)
// - PUT /attendance/records : 기록 넣기·고치기(attendance.manage, 사유 필수) · GET /attendance/export.csv?month= (attendance.manage)
// - GET/PUT /settings/attendance : 허용 와이파이 대역·지각 유예(admin, 주소별 권한 표 settings.manage)
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit } from '../../lib/audit.ts';
import { thisMonthKst } from '../../lib/dates.ts';
import { csvDownloadHeaders } from '../../lib/csv.ts';
import { auditCtx, currentUser } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { can } from '../../../shared/roles.ts';
import { attendanceSettingsSchema, editAttendanceSchema } from '../../../shared/schemas/attendance.ts';
import { clockIn, clockOut, editRecord, listMonth, monthCsv, readAttendanceSettings, saveAttendanceSettings, todayStatus, type AttendanceActor } from './attendance.ts';

const monthField = z.string({ error: '달을 확인해 주세요.' }).regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: '달은 2026-11처럼 적어 주세요.' });

const listQuery = z.object({
  month: monthField.optional(),
  userId: z.coerce.number({ error: '직원을 확인해 주세요.' }).int({ error: '직원을 확인해 주세요.' }).positive({ error: '직원을 확인해 주세요.' }).optional(),
});

const exportQuery = z.object({ month: monthField.optional() });

/** 세션 사용자 → 처리 함수에 넘길 모양 */
function actorOf(req: FastifyRequest): AttendanceActor {
  const u = currentUser(req);
  return { id: u.id, name: u.name, role: u.role };
}

/** 출퇴근 API를 등록한다 */
export function registerAttendanceRoutes(app: FastifyInstance): void {
  app.get('/attendance/today', async (req) => ({ data: todayStatus(app.db, app.clock, actorOf(req), req.ip) }));

  app.post('/attendance/clock-in', async (req) => {
    const rec = clockIn(app.db, app.clock, actorOf(req), req.ip);
    audit(auditCtx(req), 'attendance.clock_in', 'attendance', rec.id, { workDate: rec.workDate });
    return { data: rec };
  });

  app.post('/attendance/clock-out', async (req) => {
    const rec = clockOut(app.db, app.clock, actorOf(req), req.ip);
    audit(auditCtx(req), 'attendance.clock_out', 'attendance', rec.id, { workDate: rec.workDate, minutes: rec.minutes });
    return { data: rec };
  });

  app.get('/attendance', async (req) => {
    const q = parseInput(listQuery, req.query);
    const me = actorOf(req);
    // 직원은 다른 직원 기록을 볼 수 없다(userId를 줘도 본인 것만)
    const userId = can(me.role, 'attendance.manage') ? q.userId : me.id;
    return { data: listMonth(app.db, app.clock, q.month ?? thisMonthKst(app.clock), userId) };
  });

  app.put('/attendance/records', async (req) => {
    const input = parseInput(editAttendanceSchema, req.body);
    const rec = editRecord(app.db, app.clock, actorOf(req), input);
    audit(auditCtx(req), 'attendance.edit', 'attendance', rec.id, { userId: input.userId, workDate: input.workDate, clockIn: input.clockIn, clockOut: input.clockOut || null, reason: input.reason });
    return { data: rec };
  });

  app.get('/attendance/export.csv', async (req, reply) => {
    const q = parseInput(exportQuery, req.query);
    const month = q.month ?? thisMonthKst(app.clock);
    const stamp = month.replace('-', '');
    return reply.headers(csvDownloadHeaders(`attendance-${stamp}.csv`, `출퇴근기록-${stamp}.csv`)).send(monthCsv(app.db, app.clock, month));
  });

  app.get('/settings/attendance', async () => ({ data: readAttendanceSettings(app.db) }));

  app.put('/settings/attendance', async (req) => {
    const input = parseInput(attendanceSettingsSchema, req.body);
    const saved = saveAttendanceSettings(app.db, app.clock, input);
    audit(auditCtx(req), 'settings.attendance.update', 'settings', 'attendance', { allowedNetworks: saved.allowedNetworks, lateGraceMin: saved.lateGraceMin });
    return { data: saved };
  });
}
