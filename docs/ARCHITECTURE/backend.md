# Backend — 모듈과 API 계약

> 공통 형식은 overview.md §2를 따른다. 모든 경로의 앞에는 `/api`가 붙는다.
> 권한 표기: `A`=admin, `M`=manager 이상, `S`=모든 로그인 사용자. 표기가 없는 행은 S다.
> `cap:<이름>`은 `shared/roles.ts`의 기능 권한 키다. 상태를 바꾸는 요청(POST·PATCH·PUT·DELETE)에는 모두 CSRF 헤더가 필요하다.

## 1. 공통 객체

```ts
// shared/schemas/common.ts
type Role = 'admin' | 'manager' | 'staff'
type Me = { id: number; username: string; name: string; role: Role; jobType: string; mustChangePw: boolean }
type ApiError = { error: { code: string; message: string; fields?: Record<string, string> } }
type Page<T> = { data: T[]; total: number }   // ?page=1&pageSize=50 (최대 200), ?q=검색어, ?sort=허용열&dir=asc|desc
type AiResult = { text: string; demo: boolean; usage: { inputTokens: number; outputTokens: number; costKrw: number; estimated: boolean };
                  privacy: { findings: { type: PiiType; count: number }[]; redacted: boolean }; requestId: number }
type PiiType = 'rrn' | 'phone' | 'email' | 'card' | 'account' | 'passport'
```

## 2. 오류 코드 (HTTP 상태 · code · 화면 문구 예)

| 상태 | code | 문구 |
|---|---|---|
| 400 | `VALIDATION` | "입력값을 확인해 주세요." + `fields`(항목별 이유) |
| 401 | `UNAUTHENTICATED` | "다시 로그인해 주세요." |
| 401 | `INVALID_LOGIN` | "아이디 또는 비밀번호가 맞지 않습니다." |
| 403 | `FORBIDDEN` | "이 기능을 사용할 권한이 없습니다." |
| 403 | `CSRF` | "보안 확인에 실패했습니다. 화면을 새로 고쳐 주세요." |
| 403 | `NETWORK_BLOCKED` | "원내 네트워크에서만 접속할 수 있습니다." |
| 403 | `PASSWORD_CHANGE_REQUIRED` | "새 비밀번호로 바꾼 뒤 이용할 수 있습니다." |
| 404 | `NOT_FOUND` | "찾는 항목이 없습니다." |
| 409 | `CONFLICT` / `SETUP_DONE` / `LAST_ADMIN` | 상황별 문구 |
| 413 | `FILE_TOO_LARGE` | "파일이 너무 큽니다(최대 20MB)." |
| 415 | `FILE_TYPE` | "올릴 수 없는 파일 형식입니다." |
| 423 | `LOCKED` | "로그인을 5번 실패해 15분 동안 잠겼습니다. 약 N분 뒤 다시 시도해 주세요." |
| 503 | `MAINTENANCE` | "백업 복원 중입니다. 잠시 후 다시 시도해 주세요." |
| 기타 | AI 오류 | §5 |

## 3. 모듈과 엔드포인트

### 3.1 auth · setup · session (`server/auth`)
| 메서드 경로 | 권한 | 요청 → 응답 | FR |
|---|---|---|---|
| GET `/session` | 공개 | → `{ setupRequired, user: Me|null, csrfToken|null, clinicName, demoMode }` | 001·002 |
| POST `/setup` | 공개(사용자 0명일 때만) | `{clinicName, name, username(4~20 영문·숫자), password(≥8), withDemo}` → `{user, csrfToken}` | 001 |
| POST `/auth/login` | 공개 | `{username, password}` → `{user, csrfToken}` / 401·423 | 002 |
| POST `/auth/logout` | S | → 204 | 002 |
| POST `/auth/password` | S | `{current, next}` → 204 | 002 AC6 |
| GET `/health` | 공개 | → `{ok, version, db}` | — |

### 3.2 users · audit · settings · backup · demo (`modules/admin`)
| 메서드 경로 | 권한 | 요청 → 응답 | FR |
|---|---|---|---|
| GET `/users` | M(조회) | → `Page<UserRow>` | 004 |
| POST `/users` | A | `{name, username, role, jobType, hiredOn, tempPassword}` → UserRow | 004 |
| PATCH `/users/:id` | A | `{name?, role?, jobType?, hiredOn?, active?}` → UserRow (마지막 admin 보호) | 003·004 |
| POST `/users/:id/reset-password` | A | `{tempPassword}` → 204 | 004 AC2 |
| GET `/audit` | A | `?from&to&userId&action` → `Page<AuditRow>`; `?format=csv` | 005 |
| GET/PUT `/settings/clinic` | S 조회 / A 수정 | clinic JSON | 042 AC1 |
| GET/PUT `/settings/privacy` | A | privacy JSON | 032 AC3 |
| GET/PUT `/settings/:group` (`inventory`·`leave`·`backup`·`legal`·`attendance`) | A | JSON | — |
| GET `/backups` | A | → `[{name, createdAt, reason, sizeBytes}]` | 006 |
| POST `/backups` | A | → 생성된 항목 | 006 AC3 |
| GET `/backups/:name/download` | A | zip | 006 AC3 |
| POST `/backups/:name/restore` | A | `{confirm:'복원합니다'}` → 204 | 006 AC4 |
| POST `/demo/reset` | A | `{confirm:'초기화합니다'}` → 204 | 007 |
| POST `/demo/load` | A | → 204 (빈 상태일 때만) | 007 |

### 3.3 dashboard · notifications
| 메서드 경로 | 권한 | 응답 | FR |
|---|---|---|---|
| GET `/dashboard` | S | `{today:{date, working:[{userId,name,jobType,shift}], onLeave:[...]}, kpis:{...}, checklist:{done,total,items:[...]}, handovers:[...], approvals:[...](M만), stockAlerts:[...], dueSoon:[...], notices:[...], orders:[...](M만), weekEvents:[...], recentMoves:[...], expenseMonth:{total, trend6:[...]} (M만), ai:{monthKrw, budgetKrw, pct, demo}}` | 008 |
| GET `/notifications/summary` | S | `{unread, latestId}` (30초 폴링) | 090 |
| GET `/notifications` | S | `Page<Notification>` | 090 |
| POST `/notifications/:id/read` · POST `/notifications/read-all` | S | 204 | 090 |

### 3.4 desk (`modules/desk`)
| 메서드 경로 | 권한 | 비고 | FR |
|---|---|---|---|
| GET `/posts?kind=notice|handover&unresolved=1` | S | 목록에 `readCount`, `totalUsers`, `readByMe` 포함 | 040 |
| POST `/posts` | 공지는 M, 인수인계는 S | `{kind, category, title, body, pinned?}` | 040 |
| GET `/posts/:id` | S | 열면 읽음 처리. M과 작성자에게는 `readers`·`unreadUsers` 포함 | 040 AC2 |
| PATCH/DELETE `/posts/:id` | 작성자 또는 M | | 040 |
| POST `/posts/:id/resolve` | S | 인수인계만 | 040 AC4 |
| GET `/checklists/:kind?date=` | S | 항목과 체크 상태 | 041 |
| PUT `/checklists/:kind/items` | M | 항목 전체를 순서대로 저장 | 041 AC1 |
| POST `/checklists/check` | S | `{itemId, checked}` (오늘 날짜만) | 041 AC2 |
| GET/POST/PATCH/DELETE `/saved-texts?kind=` | S(본인 것과 공용 수정은 M) | 스크립트·템플릿·답글 등 보관 | 042~044 |

### 3.5 inventory (`modules/inventory`)
| 메서드 경로 | 권한 | 비고 | FR |
|---|---|---|---|
| GET `/items?status=low|soon_low|expiring|expired&category=&q=` | S | `ItemRow{id,name,category,unit,par,stock,status,nearestExpiry,dday,vendor,lastPrice,priceUpPct}` | 050·052 |
| POST/PATCH `/items(/:id)` · DELETE(→inactive) | M | 이름 중복이면 `warnings` | 050 |
| GET `/items/:id` | S | 상세, 로트별 잔량, 최근 기록, 단가 추이 | 050·055 |
| GET `/items/by-barcode?code=` | S | 바코드로 품목 찾기(스캐너·사진 해독 결과). `{id,name,unit,stock,active}`, 없으면 404. 품목의 `barcode`는 병원 안에서 고유(중복 409) | 130 |
| POST `/inventory/moves` | S(in·out), M(adjust) | `{itemId, type, qty, unitPrice?, vendorId?, lot?, expiryOn?, reason?}`. out이 재고보다 많으면 `force` 없이는 409 `CONFLICT{needsConfirm}` | 051 |
| GET `/inventory/moves?itemId&type&from&to` | S | `Page`, `?format=csv` | 051·056 |
| GET/POST/PATCH `/vendors(/:id)` | 조회 S, 수정 M | | 053 |
| POST `/orders/draft` | M | → 거래처별 발주서 초안 목록 | 054 AC1 |
| GET `/orders?status=` · GET `/orders/:id` | M | | 054 |
| PATCH `/orders/:id` | M | `{lines:[{itemId, qty}], note}` (draft일 때만) | 054 |
| POST `/orders/:id/order` · `/cancel` | M | 상태 전이 `draft→ordered`, `draft|ordered→canceled` | 054 AC3 |
| POST `/orders/:id/receive` | M | 입고 묶음 트랜잭션, `{lines, alsoExpense:{categoryId, payMethod}?}` | 054 AC3 |
| GET `/prices?itemId&vendorId` | S | 단가 이력 | 055 |
| GET `/export/:entity.csv` (items·vendors·moves) | M | UTF-8 BOM | 056 |
| POST `/import/items/preview` | M | multipart CSV → `{rows:[{line, action:'new'|'update'|'error', data, errors}]}`, `token` | 056 AC2 |
| POST `/import/items/commit` | M | `{token, skipErrors:true}` → `{created, updated, skipped}` | 056 |
| GET `/import/items/template.csv` | M | 양식 | 056 |
| POST `/ai/receipt` | S + cap:ai.receipt | multipart image + `confirmed=true` → `{draft, candidates, ai: AiResult}` | 122 |
| POST `/inventory/receipt-commit` | S (`alsoExpense`는 M일 때만 허용) | `{fileId, vendorId|vendorName, date, lines:[{itemId|newItem, qty, unitPrice, lot?, expiryOn?}], alsoExpense?}` | 122 AC2 |

### 3.6 documents · assistant (`modules/docs`, `modules/assistant`)
| 메서드 경로 | 권한 | 비고 | FR |
|---|---|---|---|
| GET `/documents?folder&kind&q&tag` | S | 서식 보관함 | 062 |
| POST `/documents` | 작성은 S, 업로드는 M | 작성 `{kind,title,body_md,folder,tags}` / multipart 업로드 | 060·062 |
| GET/PATCH/DELETE `/documents/:id` | 조회 S, 수정은 작성자 또는 M | 수정하면 `document_versions`에 추가 | 060 AC3 |
| GET `/documents/:id/versions` | S | | 060 |
| GET `/files/:id` | S(목적별 권한 확인) | attachment로 내려보냄 | 062 |
| GET `/kb/docs` · POST `/kb/docs` · DELETE `/kb/docs/:id` | 조회 S(visibility 적용), 수정 M | 업로드 → `{status, findings?}` | 070 |
| POST `/kb/docs/:id/confirm-redact` | M | needs_review → 가린 뒤 색인 | 070 AC3 |
| POST `/assistant/ask` | S + cap:ai.assistant | `{question}` → `{answer, sources, found, ai?: AiResult}` | 071 |
| GET `/assistant/history` · DELETE `/assistant/history` | S(본인) | | 071 AC4 |
| GET `/ai/transcribe/status` · POST `/ai/transcribe` | S + cap:ai.minutes | 회의 녹음(m4a·mp3·wav·webm, 20MB 이하, 초과 413) → 받아쓴 글(개인정보 가림). 공급자가 음성을 지원하지 않으면(Anthropic) 403 `AI_DISABLED`. 녹음은 디스크에 쓰지 않는다 | 132 |

### 3.7 hr (`modules/hr`)
| 메서드 경로 | 권한 | 비고 | FR |
|---|---|---|---|
| GET `/roster?from&to` | S | `{users, days:[{date, cells:{userId:{shiftTypeId, leave?}}}], totals}` | 081 |
| PUT `/roster/cell` | M | `{userId, date, shiftTypeId|null}` | 081 AC1 |
| POST `/roster/copy-week` | M | `{fromWeekStart, toWeekStart}` | 081 AC2 |
| GET/PUT `/shift-types` | 조회 S, 수정 M | | 081 |
| POST `/roster/suggest` | M | `{weekStart, rules}` → 미리보기(근무표는 바뀌지 않음). AI에는 이름 대신 S1·S2 번호와 직무만 보낸다. 서버가 응답을 다시 검사해 승인 휴가일 근무를 빼고 최소 인원을 채우며, 못 채우면 경고 | 131 |
| POST `/roster/apply` | M | 미리보기 칸을 그 주 근무표에 적용 | 131 |
| GET `/leave?mine=1&status=` · POST `/leave` | S | 본인 신청 | 080 |
| POST `/leave/:id/decide` | M | `{approve, reason?}` → `{request, warnings}` | 080 AC2·4 |
| POST `/leave/:id/cancel` | 본인(pending일 때만) | | 080 |
| GET/PUT `/leave/allowances?year=` | 조회 S(본인), 수정 A | | 080 AC3 |
| GET `/attendance/today` | S | `{date, shift, record, next:'in'\|'out'\|'done', device:{ip, allowed, allowedNetworks}}` | D-B01 |
| POST `/attendance/clock-in` · `/attendance/clock-out` | S(`attendance.punch`), 허용 와이파이 대역·서버 PC에서만(아니면 403 `reason: ATTENDANCE_NETWORK`) | 하루 출근 1번·퇴근 1번, 자정 넘긴 퇴근은 20시간 안 열린 기록에 | D-B01 |
| GET `/attendance?month&userId` | S(직원은 본인만), M은 전 직원 | `{month, records, summary}` 지각·조퇴는 근무표 기준 | D-B01 |
| PUT `/attendance/records` | M(`attendance.manage`) | `{userId, workDate, clockIn, clockOut, reason}` 사유 필수·감사 로그 | D-B01 |
| GET `/attendance/export.csv?month` | M | UTF-8 BOM CSV | D-B01 |
| GET/POST/PATCH `/trainings` · POST `/trainings/:id/records` | 조회 S, 기록은 본인 또는 M | | 082 |
| GET/POST/PATCH `/onboarding/templates` · `/onboarding/assignments` · POST `/onboarding/assignments/:id/items/:idx` | 템플릿 M, 체크는 본인 또는 멘토 | | 083 |

### 3.8 facility (`modules/facility`)
| 메서드 경로 | 권한 | 비고 | FR |
|---|---|---|---|
| GET/POST/PATCH `/equipment` · GET/POST `/equipment/:id/logs` | 조회 S, 등록 M, 기록 S | | 101 |
| GET `/sterilizer-logs?equipmentId&from&to` · POST | S | fail이면 즉시 알림 | 102 |
| GET `/sterilizer-logs/export` · GET `/equipment/:id` | S | CSV 내보내기, 장비 상세(04-03 추가) | 101·102 |
| POST `/sterilizer-logs/:id/action` | S | `{actionTaken}` | 102 AC2 |
| GET `/legal-tasks` · PATCH `/legal-tasks/:id` · POST `/legal-tasks` | 조회 S, 수정·추가 A | 주기·상태·적용 여부 수정 | 100 AC2 |
| POST `/legal-tasks/:id/done` | M | `{doneOn, note, fileId?}` | 100 AC3 |

### 3.9 finance (`modules/finance`) — 모두 M
| 메서드 경로 | 비고 | FR |
|---|---|---|
| GET/POST/PATCH/DELETE `/expenses` | `?month=YYYY-MM&categoryId`, `?format=csv` | 110 |
| GET/PUT `/expense-categories` | | 110 AC1 |
| GET `/finance/monthly?month=` | `{total, byCategory, prevMonth, prevYear, topVendors, materialTrend12}` | 111 |

### 3.10 ai · 마케팅 (`modules/ai-admin`, `server/ai`)
| 메서드 경로 | 권한 | 비고 | FR |
|---|---|---|---|
| POST `/ai/run` | S + 기능 권한 | `{feature, input, tier?}` → `AiResult` (+ 기능별 `extra`) | 030~ |
| POST `/ai/stream` | S + 기능 권한 | 같은 요청. 응답은 `text/event-stream`, 이벤트 `delta{text}` · `done{AiResult 메타}` · `error{code,message}` | 060 AC4 |
| POST `/adcheck` | S + cap:ai.adcheck | `{text, useAi}` → `{ruleHits:[{start,end,phrase,severity,reason,suggestion}], ai?: AiResult(JSON 결과)}` | 120 |
| GET/PUT `/ai/settings` | A | 키는 `maskedKey`만 응답. PUT `{provider, keys?:{anthropic?:string|null...}, monthlyBudgetKrw, fxKrwPerUsd, warnPct, features:{<id>:{enabled,roles,tier}}}`(budget·fx도 별칭으로 받음, 02-02) | 030·031·033·035 |
| GET `/ai/status` | S | `{demo, provider, features[{id,label,enabled,allowed,tier,userTier}], budget:{exceeded, (ai.usage 권한이면 monthKrw·budgetKrw·pct·warnPct)}}`. AiPanel의 데모 표시와 비활성 안내에 쓴다(02-02 추가) | 030·033 |
| POST `/ai/test` | A | `{provider}` → `{ok, message}` | 030 AC3 |
| GET/PUT `/ai/models` | A | 모델·단가 표 | 036 |
| GET `/ai/usage?month=` | A | `{monthKrw, budgetKrw, pct, byFeature, byUser, byDay, recent}` | 034 |
| GET/PUT `/ad-rules` | 조회 S, 수정 A | | 120 AC3 |

## 4. AI 기능 목록 (`shared/ai-features.ts`)

| id | 화면 | 기본 등급 | 기본 역할 | 시간 초과 | 입력 → 출력 |
|---|---|---|---|---|---|
| `quick` | 대시보드 빠른 요청 | fast | S | 30s | 자유 요청 → 텍스트 |
| `script` | 전화 응대 스크립트 | fast | S | 30s | `{situation, tone, extra}` + 병원 정보 → 스크립트 |
| `review_reply` | 리뷰 답글 | fast | S | 30s | `{review, tones[]}` → JSON `{replies:[{tone,text}]}` |
| `template` | 문자·안내문 템플릿 | fast | S | 30s | `{purpose, length}` → 텍스트(치환자 사용) |
| `doc_writer` | AI 문서 작성 | standard(사용자 선택) | S | 90s(premium 120s) | `{kind, points, length, tone}` → 마크다운 |
| `doc_revise` | 문서 부분 수정 | fast | S | 60s | `{text, instruction}` → 마크다운 |
| `minutes` | 회의록 요약 | fast | S | 60s | `{notes}` → JSON `{decisions[], todos[{text,role,due}], summary}` |
| `adcheck` | 광고 점검 2차 | fast | S | 45s | `{text, ruleHits}` → JSON `{issues[{phrase,reason,suggestion}], overall}` |
| `promo` | 홍보 글 | standard | S | 90s | `{topic, channel, length}` → 마크다운(그 뒤 adcheck 자동 실행) |
| `hiring` | 채용 공고·면접 질문 | standard | S | 90s | `{jobType, conditions, preferred}` → JSON `{posting, questions[]}` + 차별 표현 규칙 점검 |
| `onboarding` | 온보딩 초안 | standard | S | 60s | `{jobType}` → JSON `{items[]}` |
| `assistant` | 원내 AI 도우미 | standard | S | 60s | `{question, chunks[]}` → 텍스트(근거 번호 인용) |
| `receipt` | 명세서 사진 | standard(이미지 지원 모델) | S | 90s | image → JSON `{vendorName,date,lines[],total}` |
| `monthly_summary` | 월간 요약 문장 | fast | M(화면이 M 전용) | 45s | 집계 숫자 → 텍스트 |
| `roster_suggest` | 근무표 배정 제안(P2) | standard | M(cap roster.edit) | 90s | `{week, days, staff:[{ref,jobType}], shifts, rules}` → JSON 배정 |
| `transcribe` | 회의 녹음 받아쓰기(P2) | fast | S(cap ai.minutes) | 300s | 녹음 파일 → 텍스트. OpenAI gpt-transcribe(분 단가), Gemini 오디오 입력. Anthropic은 미지원 |

- 기본 역할은 IDEA 4절의 사용자 결정("전 직원 사용, 관리자 조정")을 따른다. admin은 `/admin/ai`에서 기능별로 허용 역할을 줄일 수 있다.

- JSON 출력 기능은 응답에서 JSON을 추출하고 zod로 검증한다. 실패하면 한 번 다시 요청하고, 그래도 실패하면 `AI_BAD_OUTPUT`을 돌려준다.
- 데모 응답(`demo(input)`)은 입력의 핵심 단어를 반영한 그럴듯한 예시이고, 앞에 "[데모 응답]"이라고 표시한다.

## 5. AI 오류 코드

| 상태 | code | 문구 |
|---|---|---|
| 403 | `AI_DISABLED` | "관리자가 이 AI 기능을 꺼 두었습니다." / "사진을 읽을 수 있는 AI 모델이 설정되지 않았습니다." |
| 402 | `AI_BUDGET_EXCEEDED` | "이번 달 AI 예산을 모두 사용했습니다. 관리자에게 한도 조정을 요청하세요." |
| 422 | `AI_PII_BLOCKED` | "주민등록번호로 보이는 내용이 있어 AI로 보내지 않았습니다. 해당 부분을 지우고 다시 시도해 주세요." (`findings` 포함) |
| 504 | `AI_TIMEOUT` | "AI 응답이 너무 오래 걸려 중단했습니다. 내용을 줄이거나 잠시 후 다시 시도해 주세요." |
| 502 | `AI_AUTH` | "AI 키가 올바르지 않거나 만료되었습니다. 관리자에게 AI 설정 확인을 요청하세요." |
| 429 | `AI_RATE_LIMIT` | "AI 서비스 요청이 많아 잠시 막혔습니다. 1분 뒤 다시 시도해 주세요." |
| 502 | `AI_UNAVAILABLE` | "AI 서비스에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요." |
| 502 | `AI_NETWORK` | "인터넷 연결을 확인해 주세요. 원내 서버 PC가 인터넷에 연결되어 있어야 AI를 쓸 수 있습니다." |
| 502 | `AI_BAD_OUTPUT` | "AI 응답을 이해하지 못했습니다. 다시 시도해 주세요." |

## 6. 백그라운드 작업 (`server/jobs`)

| 작업 | 언제 | 하는 일 |
|---|---|---|
| `backupJob.ensureDaily` | 시작할 때, 매시 정각 | 오늘 날짜 백업이 없으면 만들고 보관 개수를 정리한다 |
| `notifyJob.scan` | 시작할 때, 매시 정각 | 재고 경고·유효기간·법정/장비 D-30·D-7·당일·기한 지남, 교육 예정, 멸균 미조치를 찾아 알림을 만든다(dedupe) |
| 세션 정리 | 매시 정각 | 만료된 세션 삭제 |
| 업로드 임시파일 정리 | 매일 | CSV 미리보기 토큰과 임시 파일을 24시간 뒤 삭제 |
