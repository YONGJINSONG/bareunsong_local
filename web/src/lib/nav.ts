// 이 파일이 하는 일: 왼쪽 메뉴(대시보드 + 7개 묶음)·휴대폰 아래쪽 탭·상단 메뉴 찾기의 정의(시안 v2 순서 그대로, frontend.md §3).
// 권한이 없는 메뉴는 shared/roles.ts의 canSeePage로 숨긴다(staff에게는 발주서·운영 지표·관리 묶음이 보이지 않음). 화면 경로 표는 routes.tsx가 정본이다.
import { canSeePage, type Role } from '../../../shared/roles.ts';
import type { IconName } from '../components/Icon.tsx';

/** 메뉴 항목 하나 */
export interface NavItem {
  /** 화면 경로 */
  path: string;
  /** 메뉴 이름(쪽 제목에도 쓴다) */
  label: string;
  /** AI 기능 표시(작은 "AI" 배지) */
  ai?: boolean;
}

/** 메뉴 묶음 */
export interface NavGroup {
  id: string;
  label: string;
  icon: IconName;
  items: NavItem[];
}

/** 맨 위 대시보드 */
export const HOME_ITEM: NavItem = { path: '/', label: '대시보드' };

/** 시안 v2의 7개 묶음(순서 고정) */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'desk',
    label: '데스크·소통',
    icon: 'board',
    items: [
      { path: '/desk/board', label: '공지·인수인계' },
      { path: '/desk/checklist', label: '오픈·마감 체크리스트' },
      { path: '/desk/script', label: '전화 응대 스크립트' },
      { path: '/desk/review', label: '리뷰 답글 초안' },
      { path: '/desk/templates', label: '안내 문자·안내문 템플릿' },
    ],
  },
  {
    id: 'inventory',
    label: '재고·구매',
    icon: 'box',
    items: [
      { path: '/inventory', label: '재고 현황' },
      { path: '/inventory/moves', label: '입출고 기록' },
      { path: '/inventory/receipt', label: '명세서 사진으로 입고', ai: true },
      { path: '/inventory/orders', label: '발주서' },
      { path: '/inventory/vendors', label: '거래처' },
      { path: '/inventory/prices', label: '단가 변동' },
    ],
  },
  {
    id: 'docs',
    label: '문서·AI',
    icon: 'spark',
    items: [
      { path: '/docs/writer', label: 'AI 문서 작성' },
      { path: '/docs/assistant', label: '원내 AI 도우미' },
      { path: '/docs/minutes', label: '회의록 요약' },
      { path: '/docs/adcheck', label: '의료광고 문구 점검' },
      { path: '/docs/promo', label: '블로그·SNS 홍보 글' },
      { path: '/docs/library', label: '서식 보관함' },
    ],
  },
  {
    id: 'hr',
    label: '인사·근무',
    icon: 'cal',
    items: [
      { path: '/hr/attendance', label: '출퇴근 기록' },
      { path: '/hr/roster', label: '근무표' },
      { path: '/hr/leave', label: '연차·휴가' },
      { path: '/hr/training', label: '교육 이수 기록' },
      { path: '/hr/onboarding', label: '신규 직원 온보딩' },
      { path: '/hr/hiring', label: '채용 공고·면접 질문' },
    ],
  },
  {
    id: 'facility',
    label: '시설·법정',
    icon: 'shield',
    items: [
      { path: '/facility/equipment', label: '장비 점검·유지보수' },
      { path: '/facility/sterilizer', label: '멸균기 점검 기록' },
      { path: '/facility/legal', label: '법정 의무 일정' },
    ],
  },
  {
    id: 'finance',
    label: '운영 지표',
    icon: 'won',
    items: [
      { path: '/finance/expenses', label: '지출 기록' },
      { path: '/finance/monthly', label: '월간 요약' },
    ],
  },
  {
    id: 'admin',
    label: '관리',
    icon: 'gear',
    items: [
      { path: '/admin/users', label: '사용자·권한' },
      { path: '/admin/clinic', label: '병원 기본 정보' },
      { path: '/admin/ai', label: 'AI 설정·예산' },
      { path: '/admin/ai-usage', label: 'AI 사용량·비용' },
      { path: '/admin/backup', label: '백업·복원' },
      { path: '/admin/audit', label: '활동 기록' },
      { path: '/admin/reset', label: '데모 데이터 초기화' },
    ],
  },
];

/** 휴대폰 아래쪽 탭(홈·재고·AI·근무 + 더보기 버튼) */
export const BOTTOM_TABS: ReadonlyArray<{ path: string; label: string; icon: IconName }> = [
  { path: '/', label: '홈', icon: 'home' },
  { path: '/inventory', label: '재고', icon: 'box' },
  { path: '/docs/writer', label: 'AI', icon: 'spark' },
  { path: '/hr/roster', label: '근무', icon: 'cal' },
];

/** 이 역할에게 보이는 묶음만 고른다(보이는 항목이 하나도 없는 묶음은 통째로 숨긴다) */
export function visibleGroups(role: Role | null | undefined): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => canSeePage(role, it.path)) })).filter((g) => g.items.length > 0);
}

/** 경로가 이 메뉴 항목에 속하는지(하위 경로 포함. 대시보드 '/'는 정확히 같을 때만) */
export function isActivePath(itemPath: string, pathname: string): boolean {
  if (itemPath === '/') return pathname === '/';
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

/** 지금 경로에 해당하는 메뉴 항목(가장 길게 맞는 것). 없으면 null */
export function findNavItem(pathname: string): NavItem | null {
  let best: NavItem | null = null;
  for (const it of [HOME_ITEM, ...NAV_GROUPS.flatMap((g) => g.items)]) {
    if (isActivePath(it.path, pathname) && (!best || it.path.length > best.path.length)) best = it;
  }
  return best;
}

/** 상단 "메뉴 찾기": 이름에 검색어(띄어쓰기 무시)가 들어간 메뉴를 고른다. 권한 없는 메뉴는 빼고, 앞부분이 맞는 것을 먼저 */
export function searchMenu(query: string, role: Role | null | undefined): NavItem[] {
  const q = query.replace(/\s+/g, '').toLowerCase();
  if (!q) return [];
  const all = [HOME_ITEM, ...visibleGroups(role).flatMap((g) => g.items)];
  const norm = (s: string) => s.replace(/[\s·]+/g, '').toLowerCase();
  return all
    .filter((it) => norm(it.label).includes(q))
    .sort((a, b) => Number(!norm(a.label).startsWith(q)) - Number(!norm(b.label).startsWith(q)));
}
