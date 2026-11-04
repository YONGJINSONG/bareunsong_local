// 이 파일이 하는 일: 첫 설정 화면(/setup, FR-001). 사용자가 0명일 때 병원 이름·관리자 이름·아이디·비밀번호(확인 일치)를 받아 관리자 계정을 만들고,
// 바로 로그인된 상태로 대시보드에 들어간다. "데모 데이터 넣기"를 고를 수 있다. 이미 설정이 끝났으면(409 SETUP_DONE) 로그인 화면으로 보낸다.
import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { setupSchema, type LoginResult } from '../../../../shared/schemas/auth.ts';
import { Button } from '../../components/Button.tsx';
import { Checkbox, Field, PasswordInput, TextInput } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { useSession } from '../../lib/session.tsx';
import { AuthLayout, fieldErrors, focusFirstInvalid } from './AuthLayout.tsx';

/** 첫 설정 화면 */
export default function SetupPage() {
  const { signedIn } = useSession();
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState({ clinicName: '바른송치과의원', name: '', username: '', password: '', confirm: '', withDemo: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: { target: { value: string; checked?: boolean } }) =>
    setForm((f) => ({ ...f, [k]: k === 'withDemo' ? !!e.target.checked : e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = setupSchema.safeParse(form);
    const errs = parsed.success ? {} : fieldErrors(parsed.error);
    if (!errs.password && form.password !== form.confirm) errs.confirm = '비밀번호 확인이 맞지 않아요. 같은 비밀번호를 한 번 더 적어 주세요.';
    if (!form.confirm && !errs.confirm) errs.confirm = '비밀번호를 한 번 더 적어 주세요.';
    setErrors(errs);
    if (!parsed.success || Object.keys(errs).length > 0) {
      focusFirstInvalid(formRef.current);
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<LoginResult>('/api/setup', parsed.data);
      signedIn(r, { clinicName: parsed.data.clinicName, demoMode: parsed.data.withDemo });
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SETUP_DONE') {
        navigate('/login', { replace: true });
        return;
      }
      if (err instanceof ApiError && err.fields) {
        setErrors(err.fields);
        focusFirstInvalid(formRef.current);
      }
      setFormError(err instanceof Error ? err.message : '첫 설정을 마치지 못했어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="첫 설정"
      lead="처음 한 번만 하는 설정이에요. 병원 이름과 관리자(원장님) 계정을 만들어 주세요."
      wide
      foot="기본 계정이나 기본 비밀번호는 없어요. 여기서 만든 계정으로만 들어올 수 있어요."
    >
      <form ref={formRef} className="auth-form" onSubmit={submit} noValidate aria-label="첫 설정">
        {formError ? (
          <div className="form-error" role="alert">
            <Icon name="alert" size="md" />
            {formError}
          </div>
        ) : null}
        <Field label="병원 이름" required error={errors.clinicName}>
          <TextInput value={form.clinicName} onChange={set('clinicName')} autoComplete="organization" maxLength={50} autoFocus />
        </Field>
        <Field label="관리자 이름" required error={errors.name} help="화면 위쪽과 활동 기록에 보이는 이름이에요.">
          <TextInput value={form.name} onChange={set('name')} autoComplete="name" maxLength={30} />
        </Field>
        <Field label="아이디" required error={errors.username} help="영문과 숫자로 4~20자">
          <TextInput value={form.username} onChange={set('username')} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={20} />
        </Field>
        <Field label="비밀번호" required error={errors.password} help="8자 이상">
          <PasswordInput value={form.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
        <Field label="비밀번호 확인" required error={errors.confirm}>
          <PasswordInput value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
        </Field>
        <Checkbox
          checked={form.withDemo}
          onChange={set('withDemo')}
          label="데모 데이터 넣기"
          hint="가상의 '하늘숲치과' 재고·공지·근무 자료로 미리 써 볼 수 있어요. 나중에 관리 메뉴에서 지울 수 있어요."
        />
        <Button type="submit" variant="primary" block loading={busy}>
          설정 마치고 시작하기
        </Button>
      </form>
    </AuthLayout>
  );
}
