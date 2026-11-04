// 이 파일이 하는 일: 첫 화면 E2E. Edge로 테스트 서버에 접속해 빌드된 첫 화면이 뜨는지,
// 화면 주소 새로고침(SPA 폴백)과 준비 상태 API가 동작하는지 확인한다(phase-01-task-01 AC2·AC5).
// phase-01-task-04가 준비 중 안내 화면을 실제 첫 설정·로그인 화면으로 바꿔서, 첫 화면 확인은 그 화면의 제목(h1)으로 한다.
// 서버는 spec 파일마다 따로 띄운 격리 서버다(tests/e2e/fixtures.ts).
import { expect, test } from './fixtures.ts';

test('phase-01-task-01 AC5: 첫 화면이 "바른송치과 원내 AX" 문서 제목(병원 이름 정하기 전)과 첫 설정(또는 로그인) 화면을 보여 준다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);
  // 첫 설정 전에는 데모 병원 이름(하늘숲치과)이 아니라 일반 이름을 쓴다
  await expect(page).toHaveTitle('바른송치과 원내 AX');
  // spec마다 새 서버(tests/e2e/fixtures.ts)라 사용자가 없어서 첫 설정 화면으로 간다
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole('heading', { level: 1, name: '첫 설정' })).toBeVisible();
  expect(await page.locator('html').getAttribute('lang')).toBe('ko');
  expect(errors).toEqual([]);
});

test('phase-01-task-01 AC2: 화면 주소로 바로 들어가도(SPA 폴백) 첫 화면이 열린다', async ({ page }) => {
  const res = await page.goto('/inventory/items');
  expect(res?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: '첫 설정' })).toBeVisible();
});

test('phase-01-task-01 AC2: GET /api/health가 ok:true와 고정 시각(TEST_NOW)을 돌려준다', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { ok: boolean; db: string; version: string; now: string };
  expect(body).toMatchObject({ ok: true, db: 'ok' });
  expect(body.now).toBe('2026-11-02T00:00:00.000Z');
});
