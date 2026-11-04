// 이 파일이 하는 일: hr 모듈 API(backend.md §3.7)의 등록부. 지금은 연차·휴가(leave-routes.ts, phase-03-task-09)를 붙인다.
// 근무표·근무 유형(phase-04-task-01), 교육·온보딩(phase-04-task-02)은 이 파일에 한 줄씩 더 붙인다. 경로는 '/api'가 붙은 채로 등록된다(server/modules/index.ts).
// 로그인·CSRF·주소별 권한은 server/auth/guard.ts가 먼저 확인하고, 본문·작성자에 따라 다른 권한은 각 파일이 확인한다.
import type { FastifyInstance } from 'fastify';
import { registerLeaveRoutes } from './leave-routes.ts';
import { registerRosterRoutes } from './roster-routes.ts';
import { registerTrainingRoutes } from './training-routes.ts';
import { registerOnboardingRoutes } from './onboarding-routes.ts';
import { registerRosterSuggestRoutes } from './roster-suggest-routes.ts';
import { registerAttendanceRoutes } from './attendance-routes.ts';

/** hr 모듈 API를 등록한다 */
export default async function routes(app: FastifyInstance): Promise<void> {
  registerLeaveRoutes(app);
  registerRosterRoutes(app);
  await registerTrainingRoutes(app);
  registerOnboardingRoutes(app);
  registerRosterSuggestRoutes(app);
  registerAttendanceRoutes(app); // 출퇴근(바른송 추가)
}
