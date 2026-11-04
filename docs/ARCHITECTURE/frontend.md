# Frontend — 화면 구조와 디자인 시스템

> 정본: `docs/DESIGN.md`(승인: 청록 A + 기본 밀도). 시안 원본: `docs/design/preview.html`.
> 기술: React 19 + Vite + react-router(TD-005). 빌드 결과물 `web/dist`는 서버가 정적 파일로 제공하고, 화면 경로는 모두 `index.html`로 돌려준다.

## 1. 토큰과 기본 스타일
- `web/src/styles/tokens.css`: DESIGN §2의 모든 토큰을 그대로 옮긴다. 라이트는 `:root`, 다크는 `[data-theme="dark"]`와 `prefers-color-scheme`에 둔다. 간격·반지름·글자 크기 토큰도 여기에 둔다.
- 테마 선택: "시스템 / 라이트 / 다크"를 `localStorage('theme')`에 저장하고(실패해도 무시), `<html data-theme>`에 반영한다.
- `base.css`: Pretendard `@font-face`(`/fonts/PretendardVariable.woff2`), 포커스 링, `[hidden]`, `tabular-nums` 유틸리티, 줄어든 움직임 설정
- `print.css`: `@page A4 15mm`, `.no-print` 숨김, 머리말·쪽 번호, 표 행이 쪽 경계에서 잘리지 않게 처리
- 아이콘: 시안의 인라인 SVG 심볼 세트를 `components/Icon.tsx`로 옮긴다(외부 아이콘 라이브러리 없음).

## 2. 공용 컴포넌트 (`web/src/components`)

| 컴포넌트 | 역할·규칙 |
|---|---|
| `Button` | `variant: primary/default/ghost/danger`, `size: md/sm`, `loading`. 화면마다 primary는 하나만 쓴다 |
| `IconButton` | `aria-label` 필수, 배지 옵션 |
| `Card` | `title`, `sub`, `action(링크)`, `span` 지정 가능 |
| `Chip` | `tone: danger/warn/ok/info/ghost`, 글자 필수(색만으로 상태를 나타내지 않음) |
| `Kpi` | 요약 숫자 타일(라벨, 값, 단위, 보조 문구, 링크, tone) |
| `DataTable` | 열 정의, 정렬, 빈 상태와 불러오는 중 처리 내장, 가로 스크롤 컨테이너, 행 클릭, 선택 |
| `Toolbar` · `Segmented` · `SearchInput` · `Select` · `DateInput` · `NumberInput` | 필터와 입력 |
| `Field` | 레이블, 도움말, 오류(`aria-describedby` 연결), 필수 표시 |
| `Dialog` · `ConfirmDialog` | 포커스 가두기, Esc로 닫기. 위험한 작업은 확인 문구 입력형 |
| `Drawer` | 태블릿에서 상세 편집 |
| `Toast` | 저장됨·오류 알림(`role=status`) |
| `EmptyState` · `Skeleton` · `ErrorState` | **모든 목록·카드가 셋 다 반드시 처리**한다(NFR-006 AC3). ErrorState에는 "다시 시도" 버튼을 둔다 |
| `PrivacyGuard` | 빨간 "환자 개인정보 입력 금지" 안내와 입력 중 경고(노란색, `lib/privacy.ts`) |
| `AiPanel` | AI 입력 영역 + 등급 선택(예상 비용 표시) + 실행·중지 + 결과 + "참고용·법률 자문 아님" 고지 + 개인정보 처리 결과 표시 + 오류(§backend 5) 표시 |
| `MarkdownEditor` · `MarkdownView` | 굵게·제목·목록 버튼이 있는 텍스트 편집기와 안전한 미리보기(HTML 불허) |
| `PaperPreview` | A4 문서 모양 미리보기(문서 머리줄, 제목, 서명) |
| `MiniBar` · `Sparkline` · `BarChart` · `DonutChart` | SVG 그래프. 색은 토큰, 축과 라벨은 `--muted` |
| `CopyButton` | `lib/clipboard.ts`(http 대체 경로 포함) |
| `FileDrop` | 확장자·크기 사전 검사, 사진은 축소(`lib/image.ts`) |

## 3. 화면 목록과 경로

AppShell(상단바 + 사이드바 + 본문) 안에 들어가는 화면이다. 사이드바 묶음과 순서는 시안 v2와 같다. 권한이 없는 메뉴는 `shared/roles.ts` 기준으로 숨긴다.

| 경로 | 화면 | 권한 | FR |
|---|---|---|---|
| `/setup` · `/login` · `/change-password` | 첫 설정·로그인·비밀번호 변경(셸 없음) | — | 001·002 |
| `/` | 대시보드 | S | 008 |
| `/desk/board` · `/desk/board/:id` | 공지·인수인계 | S | 040 |
| `/desk/checklist` | 오픈·마감 체크리스트(편집은 M) | S | 041 |
| `/desk/script` | 전화 응대 스크립트 | S | 042 |
| `/desk/review` | 리뷰 답글 초안 | S | 043 |
| `/desk/templates` | 안내 문자·안내문 템플릿 | S | 044 |
| `/inventory` · `/inventory/items/:id` | 재고 현황·품목 상세 | S | 050·052·055 |
| `/inventory/moves` | 입출고 기록 | S | 051 |
| `/inventory/receipt` | 명세서 사진으로 입고(지출 동시 기록 옵션은 M만 보임) | S | 122 |
| `/inventory/orders` · `/inventory/orders/:id` | 발주서 | M | 054 |
| `/inventory/vendors` | 거래처 | S | 053 |
| `/inventory/prices` | 단가 변동 | S | 055 |
| `/inventory/import` | CSV 가져오기 | M | 056 |
| `/docs/writer` | AI 문서 작성 | S | 060 |
| `/docs/assistant` | 원내 AI 도우미(+ 문서 관리 탭은 M) | S | 070·071 |
| `/docs/minutes` | 회의록 요약 | S | 061 |
| `/docs/adcheck` | 의료광고 문구 점검 | S | 120 |
| `/docs/promo` | 블로그·SNS 홍보 글 | S | 121 |
| `/docs/library` · `/docs/library/:id` | 서식 보관함 | S | 062 |
| `/hr/roster` | 근무표 | S | 081 |
| `/hr/leave` | 연차·휴가 | S | 080 |
| `/hr/attendance` | 출퇴근 기록(바른송 추가: 원내 와이파이에서 출근·퇴근, 실장 이상은 전 직원 기록·고치기·CSV) | S | D-B01 |
| `/hr/training` | 교육 이수 기록 | S | 082 |
| `/hr/onboarding` | 신규 직원 온보딩 | S | 083 |
| `/hr/hiring` | 채용 공고·면접 질문 | S | 084 |
| `/facility/equipment` | 장비 점검·유지보수 | S | 101 |
| `/facility/sterilizer` | 멸균기 점검 기록 | S | 102 |
| `/facility/legal` | 법정 의무 일정 | S | 100 |
| `/finance/expenses` | 지출 기록 | M | 110 |
| `/finance/monthly` | 월간 요약 | M | 111 |
| `/admin/users` | 사용자·권한 | A | 003·004 |
| `/admin/clinic` | 병원 기본 정보 | A | 042 |
| `/admin/ai` | AI 설정·예산·모델 단가 | A | 030~036 |
| `/admin/ai-usage` | AI 사용량·비용 | A | 034 |
| `/admin/backup` | 백업·복원 | A | 006 |
| `/admin/audit` | 활동 기록 | A | 005 |
| `/admin/reset` | 데모 데이터 초기화 | A | 007 |
| `/notifications` | 알림 전체 | S | 090 |
| `/print/order/:id` · `/print/document/:id` · `/print/checklist/:kind/:date` · `/print/roster?from&to` · `/print/sterilizer?from&to` · `/print/equipment/:id` | 인쇄 전용(셸 없음, 자동 인쇄 버튼) | 각 원본 권한 | 063 |

## 4. 화면 공통 패턴
- **목록 화면**: `PageHeader`(제목, 요약 문구, 주 행동 1개 + 보조 행동) → `Toolbar` → `DataTable`. 등록과 수정은 데스크톱에서 `Dialog`, 태블릿·휴대폰에서 `Drawer`로 연다.
- **빠른 입력**: 대시보드의 "출고 기록" 버튼은 품목 검색 자동완성 + 수량 + 저장 Dialog를 연다(NFR-009 클릭 3회 이하).
- **상태 표시**: 재고(`부족/곧 부족/임박 D-n/만료/정상`), 일정(`오늘/D-n/기한 지남`), 확인 상태(`확인됨/권장값/확인 필요`)는 모두 Chip으로 보여 준다.
- **AI 화면**: `PrivacyGuard` → 입력 → `AiPanel`. 결과에는 복사, 저장(서식 보관함이나 saved_texts), 인쇄 버튼을 둔다. 데모 모드면 상단바 배지와 결과에 "[데모 응답]"이 보인다.
- **반응형**(DESIGN §4): 1480px 이상 4열, 1101px 이상 3열, 721px 이상 2열과 아이콘 막대, 720px 이하 1열과 아래쪽 탭 막대. 표는 가로 스크롤 컨테이너 안에 둔다.
- **연결 끊김**: `lib/api.ts`가 네트워크 실패를 연속 2회 감지하면 `OfflineBanner`를 띄우고, 폴링이 성공하면 숨긴다(TD-017).
- **세션 만료**: 401을 받으면 로그인 화면으로 이동하고, 원래 경로는 `?next=`로 넘긴다.

## 5. 화면 데이터 계약
- `lib/api.ts`
  - `api.get/post/patch/put/del`은 JSON을 주고받으며 CSRF 헤더를 자동으로 붙인다.
  - 오류는 `ApiError` 객체로 던진다. `message`는 서버의 한국어 문구를 그대로 쓴다.
  - SSE 스트림은 `api.stream(path, body, onDelta)`로 받는다. 중지는 AbortController로 한다.
- `useApi(key, fetcher)` → `{data, error, loading, reload}`. 저장한 뒤에는 관련 key를 `invalidate`한다.
- 타입은 `shared/schemas/*`를 import해서 서버와 같은 계약을 쓴다.
