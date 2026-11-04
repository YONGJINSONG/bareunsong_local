// 이 파일이 하는 일: web/public/icons/icon.svg를 Edge로 그려 홈 화면용 PNG 아이콘(192·512, apple-touch-icon 180, 가장자리 여백형 maskable 512)을 만든다.
// 아이콘 그림을 바꿨을 때만 한 번 실행한다: node scripts/make-icons.ts (새 패키지 없이 설치된 Playwright + Edge를 쓴다)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'web', 'public', 'icons');
const svg = fs.readFileSync(path.join(DIR, 'icon.svg'), 'utf8');
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

/** 만들 PNG: 파일 이름, 크기, 여백 비율(maskable은 안전 영역 때문에 바탕을 꽉 채우고 그림을 줄인다) */
const OUTPUTS: Array<{ file: string; size: number; maskable?: boolean }> = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180, maskable: true },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const o of OUTPUTS) {
    const page = await browser.newPage({ viewport: { width: o.size, height: o.size } });
    const inner = o.maskable ? Math.round(o.size * 0.8) : o.size;
    const html = `<html><body style="margin:0;width:${o.size}px;height:${o.size}px;display:grid;place-items:center;background:${o.maskable ? '#1B3A6B' : 'transparent'}"><img src="${dataUrl}" width="${inner}" height="${inner}"></body></html>`;
    await page.setContent(html);
    await page.screenshot({ path: path.join(DIR, o.file), omitBackground: !o.maskable });
    await page.close();
    console.log(`만듦: web/public/icons/${o.file}`);
  }
} finally {
  await browser.close();
}
