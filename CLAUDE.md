# 작업 지침 포인터 (에이전트용)

- 재개 지점: `plan_setup/STATE.md` → 태스크 파일(`plan_setup/phase-NN/phase-NN-tasks/`) 상태가 정본
- 루프 운영: `loop_setup/LOOP.md`
- 검증: `harness_setup/HARNESS.md` (게이트 순서 lint → unit → e2e → task_validation, `node harness_setup/scripts/gate.mjs <gate> <태스크ID>`)
- 요구·기술·설계·디자인: `docs/PRD.md`(자율운영 합의 포함) · `docs/TRD.md` · `docs/ARCHITECTURE/` · `docs/DESIGN.md`
- 공유 파일 규칙: `plan_setup/PLAN.md` §3 (권한 표·AI 기능 목록·라우트·seed·마이그레이션 번호)
- 결정 기록: `docs/DECISIONS.md`에 덧붙인다
- 모든 소스 파일 첫 5줄 안에 `이 파일이 하는 일:` 한국어 주석을 둔다. 화면 문구와 오류 문구는 쉬운 한국어로 쓴다
- 금지: 환자 정보 필드, 실제 LLM API 유료 호출, 이 폴더 밖 수정, 시스템 전역 설정 변경
- 이 저장소는 바른송치과의원 판이다(원본: https://github.com/GangJaeYu/NewDentalAX, MIT — LICENSE와 저작권 표기는 지우지 않는다). 바른송 추가·변경은 `docs/DECISIONS.md`의 D-Bnn 줄에 적는다
- 실제 서버를 인터넷에 띄우지 않는다(원내망 전용). 원본의 구경용 체험판(gh-pages)은 원본 저장소 것이며, 이 판에서 체험판을 새로 공개하려면 원장님께 먼저 묻는다
- git push: 원장님이 요청할 때만 `origin`(https://github.com/YONGJINSONG/bareunsong_local)으로 올린다. 원본은 `upstream`이며 원본으로는 올리지 않는다. 올리기 전에 비밀값·개인정보(실제 이메일·키·환자 정보)가 없는지 확인하고, 강제 푸시는 확인 없이 하지 않는다
- 커밋 작성자 이메일은 GitHub noreply 주소(`YONGJINSONG@users.noreply.github.com`)를 쓴다. 개인 이메일을 커밋에 남기지 않는다
- 화면 코드를 바꾸면 `npm run build:web`으로 `web/dist`를 다시 만들어 함께 커밋한다(설치 PC는 빌드하지 않는다)
