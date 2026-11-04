// 이 파일이 하는 일: 백업·복원 화면(/admin/backup)과 데모 데이터 초기화 화면(/admin/reset) E2E(phase-02-task-05 AC1·AC3·AC4·AC5·AC6).
// 이 파일 전용 격리 서버(tests/e2e/fixtures.ts)에서: 서버를 켜자 오늘 자동 백업이 생겼는지(AC3), "지금 백업" → 값 바꾸기 → 화면에서 복원 → 값이 돌아오고
// "복원 직전" 백업이 생기는지(AC1), 내려받은 zip에 업로드 파일이 들어 있는지(AC4), 초기화 뒤 업무 데이터가 비고 관리자·설정이 남는지(AC5),
// 확인 문구가 틀리면 실행 버튼이 눌리지 않는지(AC6), 두 화면의 4너비×2테마 가로 스크롤·axe 위반 0건을 확인한다. 테스트는 이 파일 안 순서대로 실행된다.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { unzipSync } from 'fflate';
import { expect, test, type IsoServer } from './fixtures.ts';

const ADMIN = { clinicName: '값A치과', name: '김원장', username: 'backupadmin', password: 'Backup-Admin-Pass-9', withDemo: true };
const WIDTHS: Array<[number, number]> = [[1440, 900], [1024, 768], [768, 1024], [390, 844]];
const THEMES = ['light', 'dark'] as const;

let server: IsoServer;
const url = (p: string) => `${server.baseURL}${p}`;

/** 서버의 app.db를 직접 열어 한 가지 일을 한다(서버가 켜진 채로, WAL이라 함께 쓸 수 있다) */
function withDb<T>(fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path.join(server.dataDir, 'app.db'));
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    return fn(db);
  } finally {
    db.close();
  }
}

/** 병원 이름을 직접 바꾼다(백업·복원으로 오가는 "값") */
function setClinicName(name: string): void {
  withDb((db) => db.prepare("UPDATE settings SET value = json_set(value, '$.name', ?) WHERE key = 'clinic'").run(name));
}

/** 페이지의 콘솔 오류를 모은다(시험이 일부러 만든 4xx 응답 줄은 뺀다) */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) return;
    errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

/** API로 로그인한 새 브라우저 묶음 */
async function loggedIn(browser: Browser, opts: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...opts });
  const r = await ctx.request.post(url('/api/auth/login'), { data: { username: ADMIN.username, password: ADMIN.password } });
  expect(r.status()).toBe(200);
  return ctx;
}

/** 화면의 백업 목록 줄(만든 시각·종류 글자) */
function backupRows(page: Page) {
  return page.getByRole('list', { name: '백업 목록' }).getByRole('listitem');
}

test.describe.serial('백업·복원·데모 초기화 화면', () => {
  test.beforeEach(({ isoServer }) => {
    server = isoServer;
  });

  test('phase-02-task-05 AC3: 서버를 켜면 오늘(고정 시각 2026-11-02) 자동 백업이 바로 생기고 목록 화면에 보인다', async ({ page, request }) => {
    const errors = watchErrors(page);
    // 첫 설정(데모 데이터 포함) — 서버는 그 전에 이미 켜져 자동 백업을 만들었다
    const setup = await request.post(url('/api/setup'), { data: ADMIN });
    expect(setup.status()).toBe(201);
    const r = await request.get(url('/api/backups'));
    const list = ((await r.json()) as { data: Array<{ name: string; reason: string; createdAt: string }> }).data;
    expect(list.map((b) => b.reason)).toEqual(['auto']);
    expect(list[0]?.name).toMatch(/^20261102-\d{6}-auto$/);

    expect((await page.request.post(url('/api/auth/login'), { data: { username: ADMIN.username, password: ADMIN.password } })).status()).toBe(200);
    await page.goto(url('/admin/backup'));
    await expect(page.getByRole('heading', { level: 1, name: '백업·복원' })).toBeVisible();
    await expect(backupRows(page)).toHaveCount(1);
    await expect(backupRows(page).first()).toContainText('자동');
    await expect(backupRows(page).first()).toContainText('2026-11-02');
    await expect(page.getByText('최근 30개를 보관해요')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('phase-02-task-05 AC1·AC6: 값 A로 "지금 백업" → 값 B로 수정 → 확인 문구를 틀리면 복원 버튼이 눌리지 않고, 맞게 넣으면 값 A로 돌아오며 "복원 직전" 백업이 생긴다', async ({ page }) => {
    const errors = watchErrors(page);
    await page.request.post(url('/api/auth/login'), { data: { username: ADMIN.username, password: ADMIN.password } });
    await page.goto(url('/admin/backup'));
    await expect(page.getByRole('banner')).toContainText('값A치과');

    await page.getByRole('button', { name: '지금 백업' }).click();
    await expect(page.getByText('백업을 만들었어요')).toBeVisible();
    await expect(backupRows(page)).toHaveCount(2);
    await expect(backupRows(page).first()).toContainText('직접');

    setClinicName('값B치과');
    await page.reload();
    await expect(page.getByRole('banner')).toContainText('값B치과');

    // "직접" 백업 줄의 복원 버튼 → 확인 대화상자
    await backupRows(page).filter({ hasText: '직접' }).getByRole('button', { name: /백업으로 복원$/ }).click();
    const dialog = page.getByRole('dialog', { name: '이 백업으로 복원할까요?' });
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole('button', { name: '복원하기' });
    const phrase = dialog.getByLabel('확인을 위해 "복원합니다"를 입력해 주세요');
    // AC6: 틀린 문구 → 버튼이 눌리지 않고 아무것도 바뀌지 않는다
    await expect(confirm).toBeDisabled();
    await phrase.fill('복원');
    await expect(confirm).toBeDisabled();
    await phrase.fill('복원 합니다');
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('button', { name: '취소' }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.getByRole('banner')).toContainText('값B치과');
    await expect(backupRows(page)).toHaveCount(2);

    // 맞는 문구 → 복원 → 다시 로그인 안내와 함께 로그인 화면
    await backupRows(page).filter({ hasText: '직접' }).getByRole('button', { name: /백업으로 복원$/ }).click();
    await dialog.getByLabel('확인을 위해 "복원합니다"를 입력해 주세요').fill('복원합니다');
    await dialog.getByRole('button', { name: '복원하기' }).click();
    await expect(page).toHaveURL(url('/login?next=%2Fadmin%2Fbackup'));
    await expect(page.getByText('백업으로 복원했어요. 다시 로그인해 주세요.')).toBeVisible();

    // 다시 로그인하면 이 화면으로 돌아와 값 A가 보이고, 목록에 "복원 직전" 백업이 있다
    await page.getByLabel('아이디').fill(ADMIN.username);
    await page.getByLabel('비밀번호').fill(ADMIN.password);
    await page.getByRole('button', { name: '로그인' }).click();
    await expect(page).toHaveURL(url('/admin/backup'));
    await expect(page.getByRole('banner')).toContainText('값A치과');
    await expect(backupRows(page)).toHaveCount(3);
    await expect(backupRows(page).first()).toContainText('복원 직전');
    expect(errors).toEqual([]);
  });

  test('phase-02-task-05 AC4: 업로드 파일이 화면에서 내려받은 백업 zip 안에 들어 있다', async ({ page }) => {
    const file = path.join(server.dataDir, 'uploads', '2026', '11', 'e2e-receipt.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'E2E 업로드 시험 파일');
    await page.request.post(url('/api/auth/login'), { data: { username: ADMIN.username, password: ADMIN.password } });
    await page.goto(url('/admin/backup'));
    await page.getByRole('button', { name: '지금 백업' }).click();
    await expect(backupRows(page)).toHaveCount(4);

    const [download] = await Promise.all([page.waitForEvent('download'), backupRows(page).first().getByRole('link', { name: /백업 내려받기$/ }).click()]);
    expect(download.suggestedFilename()).toMatch(/^bareunsong-backup-20261102-\d{6}-manual(-\d+)?\.zip$/);
    const saved = path.join(server.dataDir, 'download.zip');
    await download.saveAs(saved);
    const files = unzipSync(new Uint8Array(fs.readFileSync(saved)));
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['app.db', 'manifest.json', 'uploads/2026/11/e2e-receipt.txt']));
    expect(Buffer.from(files['uploads/2026/11/e2e-receipt.txt'] as Uint8Array).toString('utf8')).toBe('E2E 업로드 시험 파일');
  });

  test('phase-02-task-05 AC5·AC6: 초기화는 확인 문구가 맞아야 실행되고, 실행 뒤 업무 데이터는 비며 관리자·설정·감사 로그·AI 사용 기록이 남고 "초기화 직전" 백업이 있다', async ({ page }) => {
    const errors = watchErrors(page);
    await page.request.post(url('/api/auth/login'), { data: { username: ADMIN.username, password: ADMIN.password } });
    const now = new Date('2026-11-02T00:00:00Z').toISOString();
    withDb((db) => {
      db.prepare("INSERT INTO ai_usage (at, user_id, feature, provider, status, cost_krw) VALUES (?, NULL, 'quick', 'demo', 'ok', 7)").run(now);
      db.prepare("INSERT INTO notifications (user_id, type, title, created_at) SELECT id, 'notice', '시험 공지', ? FROM users").run(now);
    });
    const before = withDb((db) => ({
      users: (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role <> 'admin'").get() as { n: number }).n,
      audit: (db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n,
    }));
    expect(before.users).toBe(8);

    await page.goto(url('/admin/reset'));
    await expect(page.getByRole('heading', { level: 1, name: '데모 데이터 초기화' })).toBeVisible();
    await expect(page.getByText('데모 데이터 사용 중')).toBeVisible();
    await expect(page.getByText('업무 데이터 있음')).toBeVisible();
    // 상단바 배지: 데모 데이터를 쓰는 중이고(가상 데이터), 이 시험 서버에는 AI 키가 없다(AI 키 미설정, phase-03-task-10에서 연결)
    const badge = page.getByRole('banner').getByTestId('demo-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('데모 모드');
    await expect(badge).toContainText('가상 데이터');
    await expect(badge).toContainText('AI 키 미설정');

    await page.getByRole('button', { name: '데모 데이터 지우기(초기화)' }).click();
    const dialog = page.getByRole('dialog', { name: '데모 데이터를 모두 지울까요?' });
    const confirm = dialog.getByRole('button', { name: '초기화하기' });
    const phrase = dialog.getByLabel('확인을 위해 "초기화합니다"를 입력해 주세요');
    // AC6: 틀린 문구 → 버튼이 눌리지 않는다
    await expect(confirm).toBeDisabled();
    await phrase.fill('초기화');
    await expect(confirm).toBeDisabled();
    await phrase.fill('복원합니다');
    await expect(confirm).toBeDisabled();
    expect(withDb((db) => (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role <> 'admin'").get() as { n: number }).n)).toBe(8);

    await phrase.fill('초기화합니다');
    await confirm.click();
    await expect(page.getByText('업무 데이터를 모두 지웠어요')).toBeVisible();
    await expect(page.getByText('업무 데이터 비어 있음')).toBeVisible();
    await expect(page.getByText('데모 데이터 없음')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /지우기 직전 상태를 백업 "20261102-\d{6}-pre-reset/ })).toBeVisible();
    // 초기화 뒤에는 가상 데이터 표시가 사라진다. AI 키는 여전히 없으므로 배지는 "AI 키 미설정"만 남는다
    await expect(badge).not.toContainText('가상 데이터');
    await expect(badge).toContainText('AI 키 미설정');
    await expect(page.getByRole('banner').getByText('가상 데이터')).toHaveCount(0);

    const after = withDb((db) => ({
      users: db.prepare('SELECT username, role FROM users').all() as Array<{ username: string; role: string }>,
      notifications: (db.prepare('SELECT COUNT(*) AS n FROM notifications').get() as { n: number }).n,
      aiUsage: (db.prepare('SELECT COUNT(*) AS n FROM ai_usage').get() as { n: number }).n,
      audit: (db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n,
      clinic: JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'clinic'").get() as { value: string }).value) as { name: string },
    }));
    expect(after.users).toEqual([{ username: ADMIN.username, role: 'admin' }]);
    expect(after.notifications).toBe(0);
    expect(after.aiUsage).toBe(1);
    expect(after.audit).toBeGreaterThan(before.audit);
    expect(after.clinic.name).toBe('값A치과');

    await page.goto(url('/admin/backup'));
    await expect(backupRows(page).first()).toContainText('초기화 직전');

    // 비어 있으니 데모 데이터를 다시 넣을 수 있다
    await page.goto(url('/admin/reset'));
    await page.getByRole('button', { name: '데모 데이터 넣기' }).click();
    await expect(page.getByText('하늘숲치과 데모 데이터를 넣었어요.')).toBeVisible();
    await expect(page.getByText('데모 데이터 사용 중')).toBeVisible();
    await expect(badge).toContainText('가상 데이터');
    expect(errors).toEqual([]);
  });

  for (const pageCase of [
    { name: 'backup', path: '/admin/backup', title: '백업·복원' },
    { name: 'reset', path: '/admin/reset', title: '데모 데이터 초기화' },
  ]) {
    test(`phase-02-task-05 화면(${pageCase.name}): 4너비×2테마에서 가로 스크롤이 없다`, async ({ browser }) => {
      for (const theme of THEMES) {
        for (const [width, height] of WIDTHS) {
          const ctx = await loggedIn(browser, { viewport: { width, height }, colorScheme: theme });
          const page = await ctx.newPage();
          await page.goto(url(pageCase.path));
          await expect(page.getByRole('heading', { level: 1, name: pageCase.title })).toBeVisible();
          await expect(page.locator('.skel')).toHaveCount(0);
          const m = (await page.evaluate('({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })')) as { sw: number; iw: number };
          expect(m.iw, `${pageCase.name} ${width} 창 너비 그대로`).toBe(width);
          expect(m.sw, `${pageCase.name} ${width} ${theme}`).toBeLessThanOrEqual(m.iw);
          await ctx.close();
        }
      }
    });

    for (const theme of THEMES) {
      test(`phase-02-task-05 화면(${pageCase.name}): ${theme} 테마 axe 위반 0건(확인 대화상자 포함)`, async ({ browser }) => {
        const ctx = await loggedIn(browser, { viewport: { width: 1440, height: 900 }, colorScheme: theme });
        const page = await ctx.newPage();
        await page.goto(url(pageCase.path));
        await expect(page.getByRole('heading', { level: 1, name: pageCase.title })).toBeVisible();
        await expect(page.locator('.skel')).toHaveCount(0);
        const main = await new AxeBuilder({ page }).analyze();
        expect(main.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
        // 확인 대화상자를 연 상태
        if (pageCase.name === 'backup') await backupRows(page).first().getByRole('button', { name: /백업으로 복원$/ }).click();
        else await page.getByRole('button', { name: '데모 데이터 지우기(초기화)' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        const dlg = await new AxeBuilder({ page }).analyze();
        expect(dlg.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
        await ctx.close();
      });
    }
  }
});
