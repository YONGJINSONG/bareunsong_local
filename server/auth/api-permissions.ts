// 이 파일이 하는 일: "주소(메서드+경로)만 보고 권한이 정해지는 API" 표를 둔다(backend.md §3의 A·M·cap 표기).
// 서버는 모든 /api 요청에서 이 표를 먼저 확인해, 역할이 모자라면 라우트에 닿기 전에 403 FORBIDDEN을 돌려준다(FR-003 AC1).
// 모듈 라우트가 아직 없더라도 관리자 전용 주소는 막혀 있다. 권한 기준은 shared/roles.ts의 CAPS다.
// 본문·작성자에 따라 달라지는 권한(공지는 M·인수인계는 S, 작성자 또는 M 등)은 여기 넣지 않고 모듈이 guard.ts의 requireCap·can으로 확인한다.
import type { Cap } from '../../shared/roles.ts';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** 권한 규칙 한 줄: 메서드들, /api 뒤 경로 모양(:이름은 아무 한 칸), 필요한 권한 */
export interface ApiRule {
  methods: readonly Method[];
  path: string;
  cap: Cap;
}

const r = (methods: string, path: string, cap: Cap): ApiRule => ({ methods: methods.split('|') as Method[], path, cap });

/** backend.md §3에서 주소만으로 권한이 정해지는 줄 */
export const API_RULES: readonly ApiRule[] = [
  // §3.2 admin — 직원·감사·설정·백업·데모
  r('GET', '/users', 'users.view'),
  r('POST', '/users', 'users.manage'),
  r('PATCH', '/users/:id', 'users.manage'),
  r('POST', '/users/:id/reset-password', 'users.manage'),
  r('GET', '/audit', 'audit.view'),
  r('PUT', '/settings/clinic', 'settings.clinic.edit'),
  r('GET|PUT', '/settings/privacy', 'settings.manage'),
  r('GET|PUT', '/settings/inventory', 'settings.manage'),
  r('GET|PUT', '/settings/leave', 'settings.manage'),
  r('GET|PUT', '/settings/attendance', 'settings.manage'),
  r('GET|PUT', '/settings/backup', 'settings.manage'),
  r('GET|PUT', '/settings/legal', 'settings.manage'),
  r('GET|POST', '/backups', 'backup.manage'),
  r('GET', '/backups/:name/download', 'backup.manage'),
  r('POST', '/backups/:name/restore', 'backup.manage'),
  r('POST', '/demo/reset', 'demo.manage'),
  r('POST', '/demo/load', 'demo.manage'),
  r('GET', '/demo/status', 'demo.manage'),
  // §3.4 desk
  r('PUT', '/checklists/:kind/items', 'checklist.edit'),
  // §3.5 inventory
  r('POST', '/items', 'items.manage'),
  r('PATCH|DELETE', '/items/:id', 'items.manage'),
  r('POST', '/vendors', 'vendors.manage'),
  r('PATCH', '/vendors/:id', 'vendors.manage'),
  r('POST', '/orders/draft', 'orders.manage'),
  r('GET', '/orders', 'orders.manage'),
  r('GET|PATCH', '/orders/:id', 'orders.manage'),
  r('POST', '/orders/:id/order', 'orders.manage'),
  r('POST', '/orders/:id/cancel', 'orders.manage'),
  r('POST', '/orders/:id/receive', 'orders.manage'),
  r('GET', '/export/:file', 'inventory.export'),
  r('POST', '/import/items/preview', 'items.import'),
  r('POST', '/import/items/commit', 'items.import'),
  r('GET', '/import/items/template.csv', 'items.import'),
  r('POST', '/ai/receipt', 'ai.receipt'),
  // §3.6 docs · assistant
  r('POST', '/kb/docs', 'kb.manage'),
  r('DELETE', '/kb/docs/:id', 'kb.manage'),
  r('POST', '/kb/docs/:id/confirm-redact', 'kb.manage'),
  r('POST', '/assistant/ask', 'ai.assistant'),
  r('POST', '/ai/transcribe', 'ai.minutes'), // phase-06-task-03 회의 녹음 받아쓰기(회의록 요약과 같은 권한)
  // §3.7 hr
  r('PUT', '/roster/cell', 'roster.edit'),
  r('POST', '/roster/copy-week', 'roster.edit'),
  r('PUT', '/shift-types', 'roster.edit'),
  r('POST', '/roster/suggest', 'roster.edit'), // phase-06-task-02 AI 근무표 배정 제안
  r('POST', '/roster/apply', 'roster.edit'),
  r('POST', '/leave/:id/decide', 'leave.approve'),
  r('PUT', '/leave/allowances', 'leave.allowance.edit'),
  // 출퇴근(바른송 추가). 본인 기록 보기·찍기는 모든 로그인 사용자, 다른 직원 보기는 라우트가 attendance.manage로 확인한다
  r('POST', '/attendance/clock-in', 'attendance.punch'),
  r('POST', '/attendance/clock-out', 'attendance.punch'),
  r('PUT', '/attendance/records', 'attendance.manage'),
  r('GET', '/attendance/export.csv', 'attendance.manage'),
  r('POST', '/onboarding/templates', 'onboarding.manage'),
  r('PATCH', '/onboarding/templates/:id', 'onboarding.manage'),
  // 04-02 보고(05-02 반영): 아래는 주소만으로 권한이 정해지는데 모듈 assertCan으로만 막혀 있던 줄. 이중 방어로 표에도 둔다
  r('GET', '/onboarding/templates', 'onboarding.manage'),
  r('POST', '/onboarding/assignments', 'onboarding.manage'),
  r('DELETE', '/onboarding/assignments/:id', 'onboarding.manage'),
  r('POST', '/trainings', 'trainings.manage'),
  r('PATCH', '/trainings/:id', 'trainings.manage'),
  // §3.8 facility
  r('POST', '/equipment', 'equipment.manage'),
  r('PATCH', '/equipment/:id', 'equipment.manage'),
  r('POST', '/legal-tasks', 'legal.edit'),
  r('PATCH', '/legal-tasks/:id', 'legal.edit'),
  r('POST', '/legal-tasks/:id/done', 'legal.done'),
  // §3.9 finance — 모두 M
  r('GET|POST', '/expenses', 'expenses.manage'),
  r('GET|PATCH|DELETE', '/expenses/:id', 'expenses.manage'),
  r('GET|PUT', '/expense-categories', 'expenses.manage'),
  r('GET', '/finance/monthly', 'finance.monthly'),
  r('POST', '/finance/monthly/summary', 'finance.monthly'),
  // §3.10 ai · 마케팅
  r('POST', '/adcheck', 'ai.adcheck'),
  r('GET|PUT', '/ai/settings', 'ai.settings'),
  r('POST', '/ai/test', 'ai.settings'),
  r('GET|PUT', '/ai/models', 'ai.settings'),
  r('GET', '/ai/usage', 'ai.usage'),
  r('PUT', '/ad-rules', 'adrules.edit'),
];

/** 경로 모양('/users/:id')과 실제 경로('/users/3')가 맞는지 */
function pathMatches(pattern: string, path: string): boolean {
  const a = pattern.split('/');
  const b = path.split('/');
  if (a.length !== b.length) return false;
  return a.every((seg, i) => (seg.startsWith(':') ? (b[i] ?? '') !== '' : seg === b[i]));
}

/**
 * 요청에 맞는 권한 규칙을 찾는다. path는 /api 뒤 부분이다(예: '/audit', 쿼리 제외).
 * 맞는 규칙이 없으면 null(로그인만 필요하거나, 모듈이 직접 확인한다).
 */
export function findApiRule(method: string, path: string): ApiRule | null {
  const m = method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase();
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return API_RULES.find((rule) => (rule.methods as readonly string[]).includes(m) && pathMatches(rule.path, clean)) ?? null;
}
