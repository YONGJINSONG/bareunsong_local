# Database — 데이터 구조 (node:sqlite, `data/app.db`)

> overview.md §1·§2의 공통 규칙을 따른다. 마이그레이션은 `server/db/migrations/NNN_<이름>.sql` 파일이고, 번호 순서대로 한 번씩 적용한다(`schema_version`).
> 표기 규칙
> - 모든 테이블의 `id INTEGER PRIMARY KEY`는 생략하고 적는다.
> - 시각은 `TEXT` ISO-8601 UTC이고 `_at`으로 끝난다. 날짜는 `TEXT YYYY-MM-DD`이고 `_on`이나 `date`로 끝난다.
> - 불리언은 `INTEGER 0/1`이다.
> - `→`는 외래키다.

## 1. 공통·보안 (FR-001~009)

| 테이블 | 열 | 비고 |
|---|---|---|
| `settings` | `key TEXT PK`, `value TEXT(JSON)`, `updated_at` | 키 목록은 §5 |
| `users` | `username UNIQUE`, `name`, `role CHECK(admin/manager/staff)`, `job_type CHECK(hygienist/assistant/desk/doctor/other)`, `hired_on`, `password_hash`, `must_change_pw`, `active`, `created_at`, `updated_at` | 직원 정보는 이 열들만 둔다(FR-004 AC1) |
| `sessions` | `token_hash UNIQUE`, `user_id→users`, `csrf_token`, `created_at`, `last_seen_at`, `expires_at`, `ip` | 인덱스 `(expires_at)` |
| `login_attempts` | `username PK`, `failed_count`, `first_failed_at`, `locked_until` | IP별 제한은 메모리에 둔다 |
| `audit_log` | `at`, `user_id`, `username`, `action`, `target_type`, `target_id`, `detail TEXT(JSON)`, `ip` | 트리거 `BEFORE UPDATE/DELETE → RAISE(ABORT)`, 인덱스 `(at)`, `(user_id, at)`, `(action)` |
| `notifications` | `user_id→users`, `type`, `title`, `body`, `link`, `dedupe_key`, `created_at`, `read_at` | `UNIQUE(user_id, dedupe_key)`, 인덱스 `(user_id, read_at)` |
| `files` | `stored_path`, `original_name`, `mime`, `size`, `sha256`, `purpose`, `uploaded_by`, `created_at` | purpose는 form/kb/receipt/training/equipment/expense |

## 2. 데스크·소통 (FR-040~044, FR-120·121·084)

| 테이블 | 열 | 비고 |
|---|---|---|
| `posts` | `kind CHECK(notice/handover)`, `category`, `title`, `body`, `pinned`, `author_id`, `resolved_at`, `resolved_by`, `created_at`, `updated_at`, `deleted_at` | 인덱스 `(kind, pinned, created_at)` |
| `post_reads` | `post_id→posts`, `user_id`, `read_at` | PK`(post_id, user_id)` |
| `checklist_items` | `kind CHECK(open/close)`, `text`, `role_hint`, `sort`, `active` | |
| `checklist_checks` | `item_id→checklist_items`, `date`, `checked_by`, `checked_at` | PK`(item_id, date)`. 체크 해제하면 행을 삭제한다(오늘 날짜만 가능) |
| `saved_texts` | `kind CHECK(script/template/review_reply/promo/hiring/onboarding)`, `category`, `title`, `body`, `meta TEXT(JSON)`, `created_by`, `created_at`, `updated_at`, `deleted_at` | 스크립트·템플릿·답글·홍보·채용 초안 보관 |
| `ad_rules` | `pattern`, `match_type CHECK(word/regex)`, `severity CHECK(high/medium)`, `reason`, `suggestion`, `active` | 의료광고 1차 점검 사전(seed: ad-rules.ts) |

## 3. 재고·구매 (FR-050~056)

### 3.1 테이블

| 테이블 | 열 | 비고 |
|---|---|---|
| `vendors` | `name UNIQUE`, `contact_name`, `phone`, `email`, `order_method`, `memo`, `active` | 사업자 정보다. AI 입력에 넣지 않는다 |
| `items` | `name`, `category`, `unit`, `par_level REAL`, `track_expiry`, `default_vendor_id→vendors`, `location`, `memo`, `active`, `created_at`, `updated_at`, `barcode TEXT NULL`(022, P2) | 인덱스 `(active, category)`, `(name)`, 부분 고유 `(barcode) WHERE barcode IS NOT NULL` |
| `stock_moves` | `item_id→items`, `type CHECK(in/out/adjust)`, `qty REAL`, `unit_price REAL NULL`, `vendor_id NULL`, `lot`, `expiry_on NULL`, `reason`, `order_id NULL→purchase_orders`, `moved_at`, `user_id` | `qty`는 in/out에서 양수이고 adjust에서만 부호가 있다. 인덱스 `(item_id, moved_at)`, `(type, item_id, vendor_id, moved_at)`(단가 추이) |
| `purchase_orders` | `po_no UNIQUE`(`PO-YYMM-NNN`), `vendor_id`, `status CHECK(draft/ordered/received/canceled)`, `note`, `created_by`, `created_at`, `ordered_at`, `received_at` | |
| `po_lines` | `po_id→purchase_orders`, `item_id`, `qty`, `unit_price` | `unit_price`는 만들 때의 최근 단가 |

### 3.2 계산 규칙 (저장하지 않음)
- **현재고**: `stock = Σ(in.qty) − Σ(out.qty) + Σ(adjust.qty)`
- **수량 상태**
  - `stock < par` → `low`
  - `par ≤ stock ≤ par×1.2` → `soon_low`
  - 그 밖에는 `ok`
  - `par_level = 0`이면 상태 계산을 하지 않는다.
- **유효기간 상태** (`track_expiry=1`인 품목만)
  - in 기록을 `expiry_on` 오름차순으로 늘어놓고, 출고·감소분을 유효기간이 빠른 로트부터 빼 나간다(FEFO).
  - 남은 수량이 있는 가장 빠른 `expiry_on`을 기준으로 한다.
  - 그 날짜가 오늘보다 앞이면 `expired`, `settings.inventory.expiryWarnDays`(기본 30일) 안이면 `expiring(D-n)`이다.
- **표시 상태 우선순위**: `expired > low > expiring > soon_low > ok`
- **단가 인상**: 같은 품목의 직전 in 단가 대비 `(새 단가 − 직전) / 직전 > settings.inventory.priceAlertPct`(기본 5%)이면 인상으로 표시한다.
- **성능**: 목록 조회는 품목별 합계를 `GROUP BY item_id` 한 번으로 구한다. 2만 건 기준 NFR-005 측정 대상이다.

## 4. 개인정보 구조 검사 (NFR-001)

`tests/schema-privacy.test.ts`는 모든 테이블·열 이름을 `PRAGMA table_info`로 읽어 아래 금지어 부분 문자열과 대조한다(대소문자 무시).

`patient`, `rrn`, `resident`, `ssn`, `chart`, `diagnos`, `treatment`, `medical_record`, `insurance_no`, `birth`, `phone`의 users 테이블 사용, `address`의 users 테이블 사용

- `vendors.phone`은 사업자 연락처라서 허용한다.
- 이 금지어 목록은 테스트 파일 안에 그대로 둔다.

## 5. `settings` 키

| 키 | 값(JSON) 예 |
|---|---|
| `clinic` | `{name, phone(대표번호), hours:{mon..sun:{open,close,lunch?}|null}, holidayNote, parking, location, insuranceNote}` |
| `privacy` | `{allowlist:["02-123-4567"], policy:{rrn:'block', card:'block', phone:'redact', email:'redact', account:'redact', passport:'redact'}}` |
| `ai` | `{provider:'demo'|'anthropic'|'openai'|'gemini', keys:{anthropic?:enc, openai?:enc, gemini?:enc}, monthlyBudgetKrw:40000, warnPct:80, fxKrwPerUsd:1450, features:{<id>:{enabled, roles:[...], tier}}, storePrompts:false}` |
| `inventory` | `{expiryWarnDays:30, priceAlertPct:5, soonLowRatio:1.2}` |
| `leave` | `{maxPerDay:2, defaultAllowance:15}` |
| `backup` | `{keep:30, hour:12}` |
| `legal` | `{warnDays:30}` |
| `demo` | `{loaded:true, loadedAt}` |

`keys`는 TD-008의 AES-GCM 결과 `{iv, tag, data}`(base64)를 담는다.

## 6. 문서·AI 도우미 (FR-060~063, FR-070·071)

| 테이블 | 열 | 비고 |
|---|---|---|
| `documents` | `kind CHECK(notice_patient/official/policy/manual/review/minutes/other/form)`, `title`, `body_md`, `folder`, `tags TEXT(JSON)`, `source CHECK(ai/manual/upload)`, `file_id NULL`, `created_by`, `created_at`, `updated_at`, `deleted_at` | 서식 보관함이 이 테이블을 쓴다. 업로드 서식은 `file_id`만 가진다 |
| `document_versions` | `document_id`, `body_md`, `created_by`, `created_at` | 저장할 때마다 한 줄씩 쌓인다 |
| `kb_docs` | `title`, `file_id NULL`, `document_id NULL`, `visibility CHECK(all/manager)`, `status CHECK(processing/needs_review/ready/failed)`, `error`, `chunk_count`, `created_by`, `created_at`, `deleted_at` | |
| `kb_chunks` | `kb_doc_id→kb_docs`, `seq`, `heading`, `text` | |
| `kb_fts` | FTS5 `(heading, grams, cross, tokenize='unicode61')`, `rowid = kb_chunks.id` | TD-011 2-gram. 제목 가중 2, 띄어쓰기를 건너는 2-gram은 `cross` 열(가중 0.5). DDL은 `server/modules/assistant/search.ts`의 `KB_FTS_DDL`이 정본이다(01-06 결정) |
| `assistant_messages` | `user_id`, `role CHECK(user/assistant)`, `text`, `sources TEXT(JSON)`, `created_at` | 사용자별로 최근 200개를 남긴다 |

## 7. 인사·근무 (FR-080~084)

| 테이블 | 열 | 비고 |
|---|---|---|
| `shift_types` | `code UNIQUE`, `label`, `start_time`, `end_time`, `color_token`, `counts_as_work`, `sort`, `active` | seed: 종일/오전/오후/야간/휴무 |
| `roster` | `user_id`, `date`, `shift_type_id`, `note` | PK`(user_id, date)` |
| `leave_requests` | `user_id`, `type CHECK(annual/half_am/half_pm/sick/other)`, `start_on`, `end_on`, `days REAL`, `reason`, `status CHECK(pending/approved/rejected/canceled)`, `decided_by`, `decided_at`, `reject_reason`, `created_at` | 인덱스 `(status)`, `(start_on)` |
| `leave_allowances` | `user_id`, `year`, `days` | PK`(user_id, year)` |
| `attendance` (063, 바른송 추가) | `user_id`, `work_date`, `clock_in`, `clock_out?`, `in_ip?`, `out_ip?`, `edited_by?`, `edited_at?`, `edit_reason?`, `created_at` | UNIQUE`(user_id, work_date)`, 퇴근 > 출근, 고친 기록은 사유 필수 |
| `trainings` | `name`, `cycle_months NULL`, `description`, `legal_task_id NULL`, `active` | |
| `training_records` | `training_id`, `user_id`, `completed_on`, `file_id NULL`, `note` | 다음 예정일 = 가장 최근 이수일 + 주기 |
| `onboarding_templates` | `job_type`, `title`, `items TEXT(JSON 문자열 배열)` | |
| `onboarding_assignments` | `user_id`, `template_id`, `mentor_id`, `started_on`, `items_snapshot TEXT(JSON)` | |
| `onboarding_progress` | `assignment_id`, `item_index`, `done_at`, `done_by` | PK`(assignment_id, item_index)` |

## 8. 시설·법정 (FR-100~102)

| 테이블 | 열 | 비고 |
|---|---|---|
| `equipment` | `name`, `kind CHECK(xray/sterilizer/unit_chair/compressor/suction/other)`, `installed_on`, `vendor_name`, `inspect_cycle_months NULL`, `memo`, `active` | |
| `equipment_logs` | `equipment_id`, `date`, `kind CHECK(inspection/repair)`, `content`, `cost`, `vendor_name`, `file_id`, `user_id`, `created_at` | |
| `sterilizer_logs` | `equipment_id`(kind=sterilizer), `date`, `test_type CHECK(bd/bi/ci/cycle)`, `cycle_no`, `temp_c`, `pressure_kpa`, `minutes`, `result CHECK(pass/fail)`, `action_taken`, `action_at`, `user_id`, `created_at` | 환자 관련 열은 없다. `result=fail AND action_at IS NULL`이면 대시보드 경고 |
| `legal_tasks` | `template_key NULL`, `title`, `category CHECK(radiation/waste/fire/privacy/infection/labor/report/license/other)`, `cycle_months NULL`, `cycle_days NULL`, `basis`, `source_url`, `verify_status CHECK(verified/recommended/needs_check)`, `applicability CHECK(always/conditional)`, `enabled`, `equipment_id NULL`, `last_done_on`, `note`, `checked_on`(법령 확인일) | 다음 예정일 = `last_done_on + 주기`. 수행 기록이 없으면 "최초 수행일 입력 필요". 기본값은 TRD TD-022 표에서 seed한다 |
| `legal_task_logs` | `legal_task_id`, `done_on`, `note`, `file_id`, `user_id` | 수행 이력 |

## 9. 운영 지표 (FR-110·111)

| 테이블 | 열 | 비고 |
|---|---|---|
| `expense_categories` | `name UNIQUE`, `sort`, `active` | seed: 재료비·장비·임대료·공과금·인건비 외·마케팅·기타 |
| `expenses` | `date`, `category_id`, `vendor_id NULL`, `vendor_name`, `amount INTEGER(원)`, `pay_method CHECK(card/transfer/cash/other)`, `memo`, `file_id NULL`, `stock_move_ref NULL`(입고 묶음 참조 `order:<id>`/`receipt:<fileId>`), `created_by`, `created_at`, `deleted_at` | 인덱스 `(date)`. 매출 테이블은 없다 |

## 10. AI (FR-030~037)

| 테이블 | 열 | 비고 |
|---|---|---|
| `ai_models` | `provider`, `model_id`, `tier CHECK(fast/standard/premium)`, `input_usd_per_m`, `output_usd_per_m`, `long_threshold_tokens NULL`, `long_input_usd_per_m NULL`, `long_output_usd_per_m NULL`, `supports_images`, `checked_on`, `source_url`, `active` | `UNIQUE(provider, tier)`인 활성 행이 그 등급의 모델이다. 기본값은 TRD TD-021 |
| `ai_usage` | `at`, `user_id`, `feature`, `provider`, `model`, `input_tokens`, `output_tokens`, `cost_usd REAL`, `cost_krw REAL`, `estimated`, `demo`, `status CHECK(ok/error/blocked)`, `error_code`, `privacy TEXT(JSON {type:count})`, `duration_ms` | 인덱스 `(at)`, `(user_id, at)`, `(feature, at)`. 프롬프트 원문은 저장하지 않는다 |

- **월 누적**: `SUM(cost_krw) WHERE at >= 이번 달 1일 00:00 KST(UTC로 바꾼 값)`
- **예산 경고 중복 방지**: `notifications.dedupe_key = budget80:<yyyy-mm>`

## 11. 데모 데이터와 초기화 (FR-007, TD-024)
- **`seed/demo.ts`**: `seedDemo(db, {clock, scale=1})`. 하늘숲치과 데이터는 직원 9명(로그인 계정은 관리자만 실제 비밀번호, 나머지는 `must_change_pw=1`과 무작위 비밀번호), 품목 약 80개, 거래처 5곳, 90일 입출고, 지출, 공지 6개, 체크리스트, 장비 6대, 멸균 기록 30일, 원내 매뉴얼 5종(kb), 근무표 4주, 연차 신청 몇 건이다. `scale=10`이면 NFR-005 부하 데이터다.
- **초기화**: 다음을 순서대로 한다.
  1. 자동 백업(`pre-reset`)을 만든다.
  2. 업무 테이블을 비운다. 남기는 것은 다음과 같다.
     - `settings`(단, `demo.loaded`는 false로 바꾼다)
     - 관리자 계정(초기화를 실행한 admin과 다른 admin들)
     - `audit_log`
     - `ai_models`, `ai_usage`(비용 기록은 실제 지출과 관련 있어서 유지)
     - `legal_tasks` 템플릿(수행 기록만 지운다)
     - `expense_categories`, `shift_types`, `ad_rules`
  3. 업로드 파일을 지운다.
