// 이 파일이 하는 일: 출퇴근 기록 화면(AttendancePage, 바른송 추가 기능 D-B01)의 대화상자들.
// - 기록 넣기·고치기(실장 이상): 직원·날짜·출근·퇴근·이유. 퇴근이 출근보다 이르면 다음 날 퇴근으로 저장된다는 안내를 보여 준다.
// - 출퇴근 설정(원장): 출퇴근을 찍을 수 있는 병원 와이파이 대역(한 줄에 하나)과 지각 유예 분. "지금 이 기기의 와이파이 추가" 버튼이 있다.
// 서버가 돌려준 입력 오류(fields)는 칸 아래에, 그 밖의 오류는 대화상자 위쪽에 쉬운 문구로 보여 준다.
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/Button.tsx';
import { Dialog } from '../../components/Dialog.tsx';
import { DateInput, Field, NumberInput, Select, TextArea, TextInput } from '../../components/Field.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ErrorState, Skeleton } from '../../components/States.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { seoulParts } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';
import type { RosterView } from '../../../../shared/schemas/roster.ts';
import { subnet24Of, type AttendanceRecord, type AttendanceSettings } from '../../../../shared/schemas/attendance.ts';

/** 오류를 화면 문구로 */
export function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** ISO 시각 → 'HH:MM'(한국 시간) */
export function hhmm(iso: string | null): string {
  if (!iso) return '';
  const p = seoulParts(iso);
  return `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
}

function FormError({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="form-error" role="alert">
      <Icon name="alert" size="md" />
      {text}
    </div>
  );
}

/** 저장 오류를 칸 오류·위쪽 오류로 나눈다 */
function splitError(err: unknown, fallback: string): { fields: Record<string, string>; top: string | null } {
  if (err instanceof ApiError && err.fields) {
    const { _: root, ...rest } = err.fields;
    return { fields: rest, top: root ?? (Object.keys(rest).length ? null : err.message) };
  }
  return { fields: {}, top: messageOf(err, fallback) };
}

/** 기록 넣기·고치기 대화상자. record를 주면 그 기록을 고친다 */
export function AttendanceEditDialog({ record, today, onClose, onSaved }: { record: AttendanceRecord | null; today: string; onClose: () => void; onSaved: (r: AttendanceRecord) => void }) {
  const staff = useApi<RosterView>(record ? null : 'hr:attendance:staff', () => api.get('/api/roster'));
  const [form, setForm] = useState({
    userId: record ? String(record.user.id) : '',
    workDate: record?.workDate ?? today,
    clockIn: record ? hhmm(record.clockIn) : '09:30',
    clockOut: record ? hhmm(record.clockOut) : '',
    reason: '',
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [top, setTop] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const overnight = form.clockOut !== '' && form.clockOut <= form.clockIn;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFields({});
    setTop(null);
    try {
      const saved = await api.put<AttendanceRecord>('/api/attendance/records', {
        userId: Number(form.userId) || 0,
        workDate: form.workDate,
        clockIn: form.clockIn,
        clockOut: form.clockOut,
        reason: form.reason,
      });
      onSaved(saved);
    } catch (err) {
      const s = splitError(err, '저장하지 못했어요. 다시 시도해 주세요.');
      setFields(s.fields);
      setTop(s.top);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={record ? `${record.user.name} 님 ${record.workDate} 기록 고치기` : '출퇴근 기록 넣기'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            닫기
          </Button>
          <Button variant="primary" type="submit" form="attendance-edit-form" loading={saving}>
            저장
          </Button>
        </>
      }
    >
      <form id="attendance-edit-form" className="att-form" onSubmit={submit} noValidate>
        <FormError text={top} />
        {record ? null : (
          <Field label="직원" required error={fields.userId}>
            {staff.error && !staff.data ? (
              <ErrorState message={staff.error.message} onRetry={staff.reload} />
            ) : !staff.data ? (
              <Skeleton rows={1} label="직원 목록 불러오는 중" />
            ) : (
              <Select value={form.userId} onChange={set('userId')} options={[{ value: '', label: '직원을 골라 주세요' }, ...staff.data.users.map((u) => ({ value: String(u.id), label: u.name }))]} />
            )}
          </Field>
        )}
        <Field label="날짜" required error={fields.workDate}>
          <DateInput value={form.workDate} max={today} onChange={set('workDate')} disabled={Boolean(record)} />
        </Field>
        <div className="row2">
          <Field label="출근" required error={fields.clockIn}>
            <TextInput type="time" value={form.clockIn} onChange={set('clockIn')} />
          </Field>
          <Field label="퇴근" help="모르면 비워 두세요" error={fields.clockOut}>
            <TextInput type="time" value={form.clockOut} onChange={set('clockOut')} />
          </Field>
        </div>
        {overnight ? <p className="att-hint">퇴근이 출근보다 이르면 다음 날 {form.clockOut}에 퇴근한 것으로 저장해요.</p> : null}
        <Field label="고치는 이유" required error={fields.reason} help="활동 기록에 남아요. 예: 퇴근을 깜빡해서 근무표 보고 넣음">
          <TextArea value={form.reason} onChange={set('reason')} rows={2} maxLength={200} />
        </Field>
      </form>
    </Dialog>
  );
}

/** 출퇴근 설정 대화상자(원장) */
export function AttendanceSettingsDialog({ currentIp, onClose, onSaved }: { currentIp: string | null; onClose: () => void; onSaved: (s: AttendanceSettings) => void }) {
  const current = useApi<AttendanceSettings>('hr:attendance:settings', () => api.get('/api/settings/attendance'));
  const [draft, setDraft] = useState<{ networks: string; grace: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [top, setTop] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const form = draft ?? (current.data ? { networks: current.data.allowedNetworks.join('\n'), grace: String(current.data.lateGraceMin) } : null);
  // 서버 PC 자신(127.x·::1)에서 열었으면 와이파이 대역을 알 수 없다
  const onServerPc = !currentIp || currentIp === '::1' || currentIp.startsWith('127.');
  const mySubnet = currentIp && !onServerPc ? subnet24Of(currentIp) : null;
  const lines = (form?.networks ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

  const addMine = () => {
    if (!form || !mySubnet || lines.includes(mySubnet)) return;
    setDraft({ ...form, networks: [...lines, mySubnet].join('\n') });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setFields({});
    setTop(null);
    try {
      const saved = await api.put<AttendanceSettings>('/api/settings/attendance', { allowedNetworks: lines, lateGraceMin: Number(form.grace) });
      onSaved(saved);
    } catch (err) {
      const s = splitError(err, '저장하지 못했어요. 다시 시도해 주세요.');
      // 대역 칸 오류(allowedNetworks.0 등)는 한 칸으로 모아 보여 준다
      const netKey = Object.keys(s.fields).find((k) => k.startsWith('allowedNetworks'));
      const idx = netKey ? Number(netKey.split('.')[1]) : NaN;
      const netMsg = netKey ? `${Number.isNaN(idx) ? '' : `${idx + 1}번째 줄(${lines[idx] ?? ''}): `}${s.fields[netKey] ?? ''}` : undefined;
      setFields({ ...s.fields, ...(netMsg ? { allowedNetworks: netMsg } : {}) });
      setTop(s.top);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="출퇴근 설정"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            닫기
          </Button>
          <Button variant="primary" type="submit" form="attendance-settings-form" loading={saving} disabled={!form}>
            저장
          </Button>
        </>
      }
    >
      {current.error && !current.data ? (
        <ErrorState message={current.error.message} onRetry={current.reload} />
      ) : !form ? (
        <Skeleton rows={3} label="설정 불러오는 중" />
      ) : (
        <form id="attendance-settings-form" className="att-form" onSubmit={submit} noValidate>
          <FormError text={top} />
          <Field
            label="출퇴근을 찍을 수 있는 와이파이 대역"
            error={fields.allowedNetworks}
            help="한 줄에 하나씩 적어요(예: 192.168.0.0/24). 비워 두면 원내 네트워크 어디서나 찍을 수 있어요. 서버 PC에서는 늘 찍을 수 있어요."
          >
            <TextArea value={form.networks} onChange={(e) => setDraft({ ...form, networks: e.target.value })} rows={4} spellCheck={false} placeholder="192.168.0.0/24" />
          </Field>
          {mySubnet ? (
            <div className="att-mine">
              <span>
                지금 이 기기: <b className="num">{currentIp}</b>
              </span>
              <Button size="sm" icon="wifi" onClick={addMine} disabled={lines.includes(mySubnet)}>
                {lines.includes(mySubnet) ? `${mySubnet} 들어 있음` : `${mySubnet} 추가`}
              </Button>
            </div>
          ) : (
            <p className="att-mine muted">서버 PC에서 이 화면을 열었어요. 병원 와이파이에 연결한 직원 휴대폰·태블릿으로 이 화면을 열면 그 와이파이 대역을 버튼 하나로 추가할 수 있어요.</p>
          )}
          <Field label="지각 유예(분)" error={fields.lateGraceMin} help="근무 시작 뒤 이 시간까지는 지각으로 세지 않아요(0~60분).">
            <NumberInput value={form.grace} min={0} max={60} onChange={(e) => setDraft({ ...form, grace: e.target.value })} />
          </Field>
        </form>
      )}
    </Dialog>
  );
}
