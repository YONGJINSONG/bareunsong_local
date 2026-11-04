// 이 파일이 하는 일: 백업·복원 API(backend.md §3.2, FR-006). 경로에는 '/api'가 붙는다(admin/routes.ts가 등록).
// GET /backups(목록) · POST /backups(지금 백업) · GET /backups/:name/download(zip) · POST /backups/:name/restore {confirm:'복원합니다'}
// GET·PUT /settings/backup(보관 개수). 권한은 server/auth/api-permissions.ts 표(backup.manage·settings.manage)가 먼저 확인한다.
// 복원이 끝나면 모든 세션이 지워지므로 이 요청의 쿠키도 지우고 204를 돌려준다(화면은 로그인 화면으로 간다).
import type { FastifyInstance } from 'fastify';
import { audit } from '../../lib/audit.ts';
import { auditCtx } from '../../auth/guard.ts';
import { parseInput } from '../../security/validate.ts';
import { SESSION_COOKIE } from '../../../shared/schemas/auth.ts';
import { backupSettingsSchema, restoreSchema } from '../../../shared/schemas/backup.ts';
import { backupEnvOf } from '../../jobs/backup-job.ts';
import { createBackup, listBackups, readBackupSettings, restoreBackup, writeBackupSettings, zipBackup } from './backup-service.ts';
import { isSwappableDb } from './backup-swap.ts';

/** 백업·복원 API를 등록한다 */
export async function backupRoutes(app: FastifyInstance): Promise<void> {
  // 목록(새것부터)
  app.get('/backups', async () => ({ data: listBackups(app.backupDir) }));

  // 지금 백업
  app.post('/backups', async (req, reply) => {
    const item = createBackup(backupEnvOf(app), 'manual');
    audit(auditCtx(req), 'backup.create', 'backup', item.name, { reason: 'manual', sizeBytes: item.sizeBytes });
    return reply.code(201).send({ data: item });
  });

  // zip으로 내려받기
  app.get<{ Params: { name: string } }>('/backups/:name/download', async (req, reply) => {
    const zip = zipBackup(app.backupDir, req.params.name);
    audit(auditCtx(req), 'backup.download', 'backup', req.params.name, null);
    return reply
      .header('content-type', 'application/zip')
      .header('content-disposition', `attachment; filename="bareunsong-backup-${req.params.name}.zip"`)
      .header('cache-control', 'no-store')
      .send(Buffer.from(zip));
  });

  // 복원: 확인 문구가 정확해야 한다(틀리면 400, 아무것도 바뀌지 않음)
  app.post<{ Params: { name: string } }>('/backups/:name/restore', async (req, reply) => {
    parseInput(restoreSchema, req.body);
    const db = app.db;
    if (!isSwappableDb(db)) throw new Error('복원하려면 서버 DB가 바꿔 끼울 수 있는 형태여야 해요(app.ts).');
    await restoreBackup({ ...backupEnvOf(app), db, maintenance: app.maintenance }, req.params.name, auditCtx(req));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  // 백업 설정(보관 개수)
  app.get('/settings/backup', async () => ({ data: readBackupSettings(app.db) }));
  app.put('/settings/backup', async (req) => {
    const input = parseInput(backupSettingsSchema, req.body);
    return { data: writeBackupSettings(backupEnvOf(app), input, auditCtx(req)) };
  });
}
