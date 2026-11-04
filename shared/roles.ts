// 이 파일이 하는 일: 역할(admin·manager·staff)마다 할 수 있는 일을 정한 권한 표(CAPS)를 둔다(PRD §2, FR-003).
// 서버의 권한 검사(server/auth)와 화면의 메뉴 숨김이 모두 이 표 하나만 기준으로 쓴다(overview §2).
// 모듈 태스크는 이 파일을 고치지 않는다. 바꿔야 하면 plan_setup/STATE.md "변경 요청"에 적는다(PLAN.md §3).
// shared 폴더는 다른 폴더를 import하지 않는다(같은 shared 안의 enums.ts만 쓴다).
import { USER_ROLE_LABELS, USER_ROLE_VALUES, type UserRoleValue } from './enums.ts';

/** 계정 역할 */
export type Role = UserRoleValue;
export const ROLES: readonly Role[] = USER_ROLE_VALUES;
export const ROLE_LABELS: Record<Role, string> = USER_ROLE_LABELS;

/** 역할의 높낮이(높을수록 할 수 있는 일이 많다) */
export const ROLE_RANK: Record<Role, number> = { staff: 0, manager: 1, admin: 2 };

/** backend.md 표기: A = admin만, M = manager 이상, S = 모든 로그인 사용자 */
const A: readonly Role[] = ['admin'];
const M: readonly Role[] = ['admin', 'manager'];
const S: readonly Role[] = ['admin', 'manager', 'staff'];

/** 권한 하나: 허용 역할과 화면·안내에 쓸 한국어 이름 */
interface CapDef {
  readonly roles: readonly Role[];
  readonly label: string;
}

/**
 * PRD §2 권한 표준안의 네 줄을 그대로 옮긴 묶음. 각 줄에 그 줄에 속한 세부 권한을 적는다.
 * CAPS는 이 묶음에서 만들어지므로, 한 권한이 PRD 표의 어느 줄에 속하는지 항상 알 수 있다.
 */
const GROUPS = [
  {
    row: '사용자·권한, AI 설정(키·모델·가격·예산), 백업·복원, 데모 초기화, 감사 로그',
    roles: A,
    caps: {
      'users.manage': '직원 계정 추가·수정·비활성화·비밀번호 초기화',
      'audit.view': '감사 로그(활동 기록) 보기·내보내기',
      'ai.settings': 'AI 설정(공급자·키·모델·단가·예산·기능 켜기)',
      'ai.usage': 'AI 사용량·비용 보기',
      'backup.manage': '백업 만들기·내려받기·복원',
      'demo.manage': '데모 데이터 넣기·초기화',
      'settings.clinic.edit': '병원 기본 정보 수정',
      'settings.manage': '설정 바꾸기(개인정보·재고·연차·백업·법정 일정)',
      'leave.allowance.edit': '직원별 연차 일수 정하기',
      'legal.edit': '법정 의무 일정 추가·수정(주기·적용 여부)',
      'adrules.edit': '의료광고 점검 규칙 수정',
    },
  },
  {
    row: '연차 승인, 근무표 편집, 발주서 작성, 거래처 관리, 지출 기록·월간 요약, 공지 작성·고정',
    roles: M,
    caps: {
      'users.view': '직원 목록 보기(근무표·연차 승인에 필요)',
      'leave.approve': '연차·휴가 승인·반려',
      'attendance.manage': '전 직원 출퇴근 기록 보기·고치기·내보내기(바른송 추가)',
      'roster.edit': '근무표·근무 유형 편집',
      'orders.manage': '발주서 만들기·발주·입고 처리',
      'vendors.manage': '거래처 등록·수정',
      'expenses.manage': '지출 기록·지출 분류 관리',
      'finance.monthly': '월간 운영 요약 보기',
      'ai.monthly_summary': 'AI 월간 요약 문장',
      'notices.write': '공지 작성·고정',
      'posts.moderate': '다른 사람의 공지·인수인계 고치기·지우기',
      'checklist.edit': '체크리스트 항목 편집',
      'savedtexts.shared.edit': '공용 스크립트·템플릿 고치기',
      'documents.upload': '서식 파일 올리기',
      'documents.edit_any': '다른 사람이 쓴 문서 고치기·지우기',
      'kb.manage': '원내 매뉴얼(AI 도우미 자료) 올리기·지우기·가리기 확인',
      'trainings.manage': '교육 과정 관리·다른 직원 이수 기록 입력',
      'onboarding.manage': '온보딩 템플릿 관리·배정',
      'equipment.manage': '장비 등록·수정',
      'legal.done': '법정 의무 일정 완료 처리',
      'receipt.expense': '명세서 입고 때 지출도 함께 기록',
    },
  },
  {
    row: '품목 등록·수정·삭제, CSV 가져오기',
    roles: M,
    caps: {
      'items.manage': '품목 등록·수정·삭제',
      'items.import': 'CSV 가져오기',
      'inventory.export': '재고·거래처·입출고 CSV 내보내기',
      'inventory.adjust': '재고 수량 직접 조정',
    },
  },
  {
    row: '조회 전반, 입출고 기록, 체크리스트, 장비·멸균 점검 기록, 인수인계 작성, 본인 연차 신청, AI 기능 사용(관리자가 켠 기능만)',
    roles: S,
    caps: {
      'app.view': '조회 전반(대시보드·목록·상세)',
      'inventory.move': '입고·출고 기록',
      'checklist.check': '체크리스트 체크',
      'facility.log': '장비·멸균 점검 기록',
      'handover.write': '인수인계 작성',
      'leave.request': '본인 연차 신청·취소',
      'attendance.punch': '본인 출근·퇴근 찍기(허용한 원내 와이파이에서만, 바른송 추가)',
      'documents.write': '문서 작성(본인 문서 고치기)',
      'savedtexts.own': '본인 스크립트·템플릿 보관',
      'notifications.read': '내 알림 보기',
      // AI 기능(backend.md §4). 이것은 기본 역할이고, 관리자가 AI 설정에서 기능별로 끄거나 역할을 줄일 수 있다
      'ai.quick': 'AI 빠른 요청',
      'ai.script': 'AI 전화 응대 스크립트',
      'ai.review_reply': 'AI 리뷰 답글',
      'ai.template': 'AI 문자·안내문 템플릿',
      'ai.doc_writer': 'AI 문서 작성',
      'ai.doc_revise': 'AI 문서 부분 수정',
      'ai.minutes': 'AI 회의록 요약',
      'ai.adcheck': 'AI 의료광고 점검',
      'ai.promo': 'AI 홍보 글',
      'ai.hiring': 'AI 채용 공고·면접 질문',
      'ai.onboarding': 'AI 온보딩 초안',
      'ai.assistant': '원내 AI 도우미',
      'ai.receipt': 'AI 명세서 사진 읽기',
    },
  },
] as const;

type Group = (typeof GROUPS)[number];
type CapsOf<G> = G extends { caps: infer C } ? keyof C & string : never;
/** 권한 이름(예: 'audit.view', 'ai.receipt') */
export type Cap = CapsOf<Group>;

function buildCaps(): Record<Cap, CapDef> {
  const out = {} as Record<Cap, CapDef>;
  for (const g of GROUPS) {
    for (const [cap, label] of Object.entries(g.caps)) {
      if (cap in out) throw new Error(`권한 이름 "${cap}"이(가) 두 번 적혀 있어요.`);
      out[cap as Cap] = { roles: g.roles, label };
    }
  }
  return out;
}

/** 권한 표: 권한 이름 → { 허용 역할, 한국어 이름 }. 서버 가드와 화면 메뉴가 함께 쓴다 */
export const CAPS: Readonly<Record<Cap, CapDef>> = buildCaps();

/** 모든 권한 이름 */
export const CAP_NAMES = Object.keys(CAPS) as Cap[];

/** PRD §2 표의 줄(검사·안내용): 줄 설명, 허용 역할, 그 줄에 속한 권한 이름 */
export const PERMISSION_ROWS: readonly { row: string; roles: readonly Role[]; caps: readonly Cap[] }[] = GROUPS.map((g) => ({
  row: g.row,
  roles: g.roles,
  caps: Object.keys(g.caps) as Cap[],
}));

/** 값이 역할 이름인지 */
export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** 값이 권한 이름인지 */
export function isCap(value: unknown): value is Cap {
  return typeof value === 'string' && Object.hasOwn(CAPS, value);
}

/** 이 역할이 이 권한을 가졌는지. 로그인하지 않았으면(null) 항상 false */
export function can(role: Role | null | undefined, cap: Cap): boolean {
  if (!role) return false;
  return CAPS[cap].roles.includes(role);
}

/** 역할이 기준 역할 이상인지(예: atLeast('manager', 'manager') → true) */
export function atLeast(role: Role | null | undefined, min: Role): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** 이 역할이 가진 권한 목록(화면이 메뉴를 고를 때 쓴다) */
export function capsOf(role: Role | null | undefined): Cap[] {
  return CAP_NAMES.filter((c) => can(role, c));
}

/**
 * 화면 경로 → 필요한 권한(frontend.md §3). 여기 없는 경로는 로그인한 모든 사용자가 볼 수 있다.
 * 메뉴 숨김과 화면 접근 막기에 쓴다. 실제 차단은 서버가 한다.
 */
export const PAGE_CAPS: Readonly<Record<string, Cap>> = {
  '/inventory/orders': 'orders.manage',
  '/inventory/import': 'items.import',
  '/finance/expenses': 'expenses.manage',
  '/finance/monthly': 'finance.monthly',
  '/admin/users': 'users.manage',
  '/admin/clinic': 'settings.clinic.edit',
  '/admin/ai': 'ai.settings',
  '/admin/ai-usage': 'ai.usage',
  '/admin/backup': 'backup.manage',
  '/admin/audit': 'audit.view',
  '/admin/reset': 'demo.manage',
};

/** 화면 경로(예: '/inventory/orders/12')를 볼 수 있는지. 가장 길게 맞는 PAGE_CAPS 항목으로 판단한다 */
export function canSeePage(role: Role | null | undefined, pathname: string): boolean {
  if (!role) return false;
  const clean = pathname.split(/[?#]/)[0] ?? '/';
  let best: string | null = null;
  for (const prefix of Object.keys(PAGE_CAPS)) {
    if ((clean === prefix || clean.startsWith(`${prefix}/`)) && (!best || prefix.length > best.length)) best = prefix;
  }
  return best ? can(role, PAGE_CAPS[best] as Cap) : true;
}
