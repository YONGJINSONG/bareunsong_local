// 이 파일이 하는 일: 첫 설정·로그인·비밀번호 변경 화면(셸 없음)의 공통 틀. 가운데 카드에 병원 표시·제목·설명·본문을 놓고,
// 입력 검사 결과(zod)를 항목별 한국어 오류로 바꾸는 도우미(fieldErrors)를 둔다.
import type { ReactNode } from 'react';
import type { z } from 'zod';
import { Icon } from '../../components/Icon.tsx';

interface AuthLayoutProps {
  title: string;
  lead?: ReactNode;
  /** 카드 위쪽 작은 병원 표시(없으면 "바른송치과 원내 AX") */
  brand?: string | null;
  wide?: boolean;
  children: ReactNode;
  foot?: ReactNode;
}

/** 셸 없는 인증 화면 틀 */
export function AuthLayout({ title, lead, brand, wide, children, foot }: AuthLayoutProps) {
  return (
    <main className="auth" id="main">
      <div className={['auth-card', wide && 'wide'].filter(Boolean).join(' ')}>
        <div className="auth-brand">
          <span className="mark" aria-hidden="true">
            <Icon name="tooth" />
          </span>
          <span>{brand ? `${brand} · 원내 AX` : '바른송치과 원내 AX'}</span>
        </div>
        <div>
          <h1>{title}</h1>
          {lead ? <p className="lead">{lead}</p> : null}
        </div>
        {children}
        {foot ? <p className="auth-foot">{foot}</p> : null}
      </div>
    </main>
  );
}

/** zod 검사 실패를 { 항목: 첫 오류 문구 }로 바꾼다 */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? '_');
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/** 오류가 난 첫 입력칸으로 포커스를 옮긴다(키보드·화면 읽기 사용자용) */
export function focusFirstInvalid(form: HTMLFormElement | null): void {
  requestAnimationFrame(() => {
    const el = form?.querySelector<HTMLElement>('[aria-invalid="true"]');
    el?.focus();
  });
}
