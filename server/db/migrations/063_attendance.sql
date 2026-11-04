-- 이 파일이 하는 일: 인사 모듈의 출퇴근 기록(attendance) 테이블을 만든다(바른송치과 추가 기능, 2026-11-04, DECISIONS D-B01).
-- 직원 × 근무일(KST)마다 한 줄이다. 출근·퇴근 시각은 UTC ISO 문자열로 저장하고, 야간 근무처럼 자정을 넘긴 퇴근도 출근한 날 줄에 적는다.
-- 출퇴근을 찍은 기기 주소(원내 IP)는 확인용으로 남긴다. 실장 이상이 고치면 고친 사람·시각·사유가 남는다(사유 필수).
-- 환자 정보 열은 두지 않는다(NFR-001).

CREATE TABLE attendance (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 출근한 날(KST 'YYYY-MM-DD')
  work_date TEXT NOT NULL,
  clock_in TEXT NOT NULL,
  clock_out TEXT,
  in_ip TEXT,
  out_ip TEXT,
  edited_by INTEGER REFERENCES users(id),
  edited_at TEXT,
  edit_reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, work_date),
  CHECK (clock_out IS NULL OR clock_out > clock_in),
  -- 고친 기록에는 사유가 꼭 있어야 한다
  CHECK (edited_by IS NULL OR (edit_reason IS NOT NULL AND length(trim(edit_reason)) > 0))
);
CREATE INDEX idx_attendance_date ON attendance (work_date);
