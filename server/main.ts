// 이 파일이 하는 일: 서버 진입점. 설정을 읽고 → 데이터 폴더를 준비하고 → app.db를 열어 마이그레이션을 적용하고 → buildApp으로 서버를 만들어 포트를 연 뒤,
// 이 PC와 원내 다른 기기에서 접속할 주소를 한국어로 안내한다. 포트 충돌은 두 단계로 찾는다: ① 열기 전 주소별로 미리 열어 보는 빠른 확인,
// ② 연 뒤 안내할 모든 주소(localhost·127.0.0.1·[::1]·원내 IP)로 직접 물어 이번 실행의 무작위 표식이 돌아오는지 보는 자기 확인(최종 판정).
// PID 파일을 남기고, stop.bat이 만든 종료 표시 파일을 보면 스스로 꺼진다. 종료 코드: 0 정상, 1 예기치 못한 오류(start.bat이 다시 시작), 2 포트 문제, 3 설정·데이터 파일 오류(2·3은 다시 시작 안 함).
import crypto from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ConfigError, loadConfig, type AppConfig } from './config.ts';
import { buildApp, HEALTH_PATH, INSTANCE_HEADER, readVersion } from './app.ts';
import { fixedClock, systemClock } from './lib/clock.ts';
import { appDbPath, type Db } from './db/index.ts';
import { openAppDb } from './db/migrate.ts';
import { defaultJobs, startScheduler } from './jobs/scheduler.ts';
import { backupScheduledJob, startupBackupCheck } from './jobs/backup-job.ts';

export const EXIT_OK = 0;
export const EXIT_CRASH = 1;
export const EXIT_PORT = 2;
export const EXIT_CONFIG = 3;

/** 사설망(원내) IPv4 주소인지: 10/8, 172.16/12, 192.168/16 */
export function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p as [number, number, number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * 이 PC의 원내 IP 주소 목록을 돌려준다(원내 다른 기기가 접속할 때 쓰는 주소).
 * 루프백과 가상 어댑터의 링크로컬(169.254) 주소는 빼고, 사설망 주소를 앞에 둔다.
 */
export function lanAddresses(ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string[] {
  const found: string[] = [];
  for (const list of Object.values(ifaces)) {
    for (const info of list ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (info.address.startsWith('169.254.')) continue;
      if (!found.includes(info.address)) found.push(info.address);
    }
  }
  return found.sort((x, y) => Number(isPrivateIPv4(y)) - Number(isPrivateIPv4(x)));
}

/** 서버가 켜졌을 때 콘솔에 보여 줄 안내 문구 */
export function startupMessage(port: number, addrs: string[], version: string): string {
  const lines = [
    '',
    '==================================================',
    `  바른송치과 원내 AX 서버가 켜졌어요 (버전 ${version})`,
    '==================================================',
    `  이 PC에서 열기:        http://localhost:${port}`,
  ];
  if (addrs.length) {
    lines.push('  원내 다른 기기(태블릿·휴대폰·다른 PC)에서 열기:');
    for (const a of addrs) lines.push(`                         http://${a}:${port}`);
    lines.push(`  (이 PC의 원내 IP 주소: ${addrs.join(', ')})`);
  } else {
    lines.push('  원내 IP 주소를 찾지 못했어요. 이 PC가 원내 네트워크(와이파이·랜선)에 연결됐는지 확인해 주세요.');
  }
  lines.push('');
  lines.push('  이 창을 닫거나 stop.bat을 실행하면 서버가 꺼져요.');
  lines.push('  다른 기기에서 열리지 않으면 Windows 방화벽에서 Node.js 허용이 필요할 수 있어요(README 참고).');
  lines.push('==================================================');
  return lines.join('\n');
}

/** 포트를 열 수 없을 때(이미 사용 중·권한 없음) 보여 줄 원인과 해결 방법 */
export function portProblemMessage(port: number, code: string | undefined): string {
  const cause =
    code === 'EACCES'
      ? `포트 ${port}을(를) 열 권한이 없어요. Windows가 이 번호를 예약해 두었을 수 있어요.`
      : `포트 ${port}이(가) 이미 사용 중이에요. 서버가 이미 켜져 있거나, 다른 프로그램이 이 포트를 쓰고 있어요.`;
  return [
    '',
    '[문제] 서버를 켜지 못했어요.',
    `[원인] ${cause}`,
    '[해결 방법]',
    `  1. 이미 켜진 서버 창이 있으면 그 창을 그대로 쓰거나, stop.bat을 실행해 끈 뒤 다시 켜 주세요.`,
    `  2. 다른 프로그램이 쓰는 중이면 data\\config.json 파일에 {"port": ${port === 8090 ? 8091 : port + 1}} 처럼 다른 번호를 적고 다시 실행해 주세요.`,
    `  3. 그래도 안 되면 PC를 다시 시작한 뒤 실행해 주세요.`,
    '',
  ].join('\n');
}

/** 포트 확인 결과: free(비어 있음), busy(다른 프로그램이 사용 중·권한 없음), unavailable(이 PC에 없는 주소·IPv6 꺼짐 등) */
export type ProbeResult = { state: 'free' } | { state: 'busy'; code: string } | { state: 'unavailable'; code: string };

/**
 * 주소 하나에 포트를 잠깐 열어 보고 바로 닫는다. 서버를 실제로 열기 전에 충돌을 미리 찾는 데 쓴다.
 * ipv6Only가 true면 '::'를 IPv6 전용으로 연다(다른 프로그램이 [::]를 IPv6 전용으로 쓰는 경우를 찾기 위해).
 */
export function probePort(port: number, host: string, ipv6Only = false): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', (e: NodeJS.ErrnoException) => {
      const code = e.code ?? 'UNKNOWN';
      resolve(code === 'EADDRINUSE' || code === 'EACCES' ? { state: 'busy', code } : { state: 'unavailable', code });
    });
    s.listen({ port, host, exclusive: true, ipv6Only }, () => s.close(() => resolve({ state: 'free' })));
  });
}

/** 미리 열어 볼 주소 하나. ipv6Only는 '::'를 IPv6 전용으로 열어 볼 때 true */
export interface ProbeTarget {
  host: string;
  ipv6Only: boolean;
}

/**
 * 같은 포트를 미리 열어 볼 주소 목록(빠른 1차 확인). Windows는 주소가 정확히 같을 때만 "이미 사용 중"을 알려 준다.
 * 예: 다른 프로그램이 [::]:8090을 쓰고 있어도 0.0.0.0:8090은 따로 열려 버리고, localhost(::1) 접속은 그 프로그램으로 간다.
 * 그래서 IPv6 전체(::, 이중 스택과 IPv6 전용 둘 다)·IPv4 전체(0.0.0.0)·루프백(127.0.0.1, ::1)·이 PC의 원내 IP를 하나씩 확인한다.
 * 이것으로도 놓치는 경우가 있을 수 있어서, 최종 판정은 연 뒤의 자기 확인(selfCheck)이 한다.
 */
export function probeTargets(listenHost: string, lan: string[]): ProbeTarget[] {
  const hosts = [listenHost, '::', '0.0.0.0', '127.0.0.1', '::1', ...lan];
  const list: ProbeTarget[] = [];
  for (const h of hosts.filter((x, i) => hosts.indexOf(x) === i)) {
    list.push({ host: h, ipv6Only: false });
    if (h === '::') list.push({ host: '::', ipv6Only: true });
  }
  return list;
}

/** 로그에 남길 주소 이름(IPv6 전용 확인은 표시를 붙인다) */
function targetLabel(t: ProbeTarget): string {
  return t.ipv6Only ? `${t.host}(IPv6 전용)` : t.host;
}

/** 포트 확인 결과를 보고 실제로 열 주소를 정한다. 결과가 conflict면 포트 문제로 멈춰야 한다 */
export interface ListenPlan {
  /** 실제로 열 주소('::'를 쓸 수 없으면 '0.0.0.0') */
  host: string;
  /** 이미 사용 중인 주소와 오류 코드(없으면 null) */
  conflict: { host: string; code: string } | null;
}

/**
 * 서버를 열기 전에 포트가 모든 주소에서 비었는지 확인하고 열 주소를 정한다.
 * - 한 곳이라도 사용 중이면 conflict를 돌려준다(start.bat은 다시 시작하지 않는다).
 * - 기본 주소 '::'가 이 PC에서 안 되면(IPv6 꺼짐) '0.0.0.0'으로 바꾼다. 이때도 위 확인으로 IPv6 쪽 충돌을 놓치지 않는다.
 * probe를 바꿔 넣으면 테스트에서 IPv6가 꺼진 PC를 흉내 낼 수 있다.
 */
export async function planListen(
  port: number,
  host: string,
  lan: string[] = lanAddresses(),
  probe: (port: number, host: string, ipv6Only: boolean) => Promise<ProbeResult> = probePort,
): Promise<ListenPlan> {
  let listenHost = host;
  for (const t of probeTargets(host, lan)) {
    const r = await probe(port, t.host, t.ipv6Only);
    if (r.state === 'busy') return { host: listenHost, conflict: { host: targetLabel(t), code: r.code } };
    if (r.state === 'unavailable' && t.host === '::' && !t.ipv6Only && listenHost === '::') listenHost = '0.0.0.0';
  }
  return { host: listenHost, conflict: null };
}

// ---------------------------------------------------------------------------
// 자기 확인: 서버를 연 뒤, 안내할 모든 주소로 직접 물어서 "이번 실행의 표식"이 돌아오는지 본다.
// 다른 프로그램이 같은 포트를 다른 방식(IPv6 전용 등)으로 쓰고 있으면, 그 주소로 간 요청은 그 프로그램이 받으므로 표식이 다르거나 답이 없다.
// ---------------------------------------------------------------------------

/** 이번 실행만의 무작위 표식을 만든다(키·개인정보 아님) */
export function makeInstanceId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** 자기 확인 대상 주소 하나 */
export interface SelfCheckTarget {
  /** 접속할 IP 주소 */
  address: string;
  /** 사람이 읽을 이름(예: "localhost(::1)") */
  label: string;
  /** loopback: 이 PC 안 주소(답이 없어도 충돌), lan: 원내 IP(방화벽 때문에 답이 없을 수 있음) */
  kind: 'loopback' | 'lan';
  /** 이 서버가 연 주소로 받아야 하는 곳인지(예: 0.0.0.0으로 열었으면 ::1은 받지 않음) */
  covered: boolean;
}

/** 주소 하나에 물어본 결과: self(이 서버), other(다른 프로그램이 답함), none(답 없음·연결 거부·시간 초과) */
export type SelfCheckOutcome = { state: 'self' } | { state: 'other'; detail: string } | { state: 'none'; detail: string };

/** 열린 주소(listenHost)가 이 주소로 오는 접속을 받는지 */
export function listenCovers(listenHost: string, address: string): boolean {
  if (listenHost === '::') return true; // 이중 스택: IPv4·IPv6 모두
  if (listenHost === '0.0.0.0') return net.isIPv4(address);
  return listenHost === address;
}

/** 이 PC에서 localhost가 실제로 가리키는 주소들(보통 ::1과 127.0.0.1). 못 찾으면 빈 목록 */
export async function localhostAddresses(): Promise<string[]> {
  try {
    const found = await dns.promises.lookup('localhost', { all: true, order: 'verbatim' });
    return found.map((a) => a.address);
  } catch {
    return [];
  }
}

/**
 * 자기 확인 대상 목록을 만든다: localhost가 가리키는 주소, 127.0.0.1, ::1(루프백)과 원내 IP.
 * 같은 주소는 한 번만 묻고, localhost가 가리키는 주소면 이름에 그 사실을 적는다.
 */
export function selfCheckTargets(listenHost: string, lan: string[], localhostAddrs: string[]): SelfCheckTarget[] {
  const list: SelfCheckTarget[] = [];
  const add = (address: string, kind: SelfCheckTarget['kind']) => {
    if (list.some((t) => t.address === address)) return;
    const label = localhostAddrs.includes(address) ? `localhost(${address})` : address;
    list.push({ address, label, kind, covered: listenCovers(listenHost, address) });
  };
  for (const a of localhostAddrs) add(a, 'loopback');
  add('127.0.0.1', 'loopback');
  add('::1', 'loopback');
  for (const a of lan) add(a, 'lan');
  return list;
}

/** 연결 자체가 안 된 오류(답 없음으로 본다). 그 밖의 오류(HTTP 형식이 아닌 답 등)는 다른 프로그램의 답으로 본다 */
const NO_ANSWER_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL', 'EAFNOSUPPORT', 'ECONNRESET', 'EPIPE']);

/**
 * 주소 하나에 GET /api/health를 보내고, 응답의 X-Instance 헤더가 이번 표식과 같은지 본다.
 * timeoutMs 안에 답이 없으면 none(시간 초과)으로 본다.
 */
export function askInstance(address: string, port: number, instanceId: string, timeoutMs: number): Promise<SelfCheckOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const hostHeader = net.isIPv6(address) ? `[${address}]:${port}` : `${address}:${port}`;
    const req = http.request({ host: address, port, path: HEALTH_PATH, method: 'GET', agent: false, headers: { host: hostHeader, connection: 'close' } }, (res) => {
      const got = res.headers[INSTANCE_HEADER];
      res.resume();
      if (got === instanceId) finish({ state: 'self' });
      else finish({ state: 'other', detail: `HTTP ${res.statusCode ?? '?'} 응답, 표식 ${got ? '다름' : '없음'}` });
    });
    const timer = setTimeout(() => finish({ state: 'none', detail: `${timeoutMs}ms 안에 답 없음` }), timeoutMs);
    function finish(o: SelfCheckOutcome) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      resolve(o);
    }
    req.on('error', (e: NodeJS.ErrnoException) => {
      const code = e.code ?? 'UNKNOWN';
      if (NO_ANSWER_CODES.has(code)) finish({ state: 'none', detail: code });
      else finish({ state: 'other', detail: `HTTP가 아닌 답(${code})` });
    });
    req.end();
  });
}

/** 자기 확인 판정 결과 */
export interface SelfCheckVerdict {
  /** 다른 프로그램이 가로챈 주소(첫 번째). 없으면 null */
  conflict: { label: string; detail: string } | null;
  /** 충돌은 아니지만 로그에 남길 경고(원내 IP 답 없음 등) */
  warnings: string[];
}

/**
 * 주소별 결과로 충돌 여부를 정한다.
 * - 어느 주소든 다른 표식(또는 HTTP가 아닌 답)이 오면 충돌.
 * - 이 서버가 받아야 하는 루프백(localhost·127.0.0.1·::1)에서 답이 없으면 충돌(다른 프로그램이 받고 답하지 않는 경우).
 * - 원내 IP의 답 없음은 방화벽 때문일 수 있어 경고만 남긴다. 이 서버가 받지 않는 주소(0.0.0.0으로 열었을 때 ::1)의 답 없음도 경고.
 */
export function judgeSelfCheck(results: Array<{ target: SelfCheckTarget; outcome: SelfCheckOutcome }>): SelfCheckVerdict {
  const warnings: string[] = [];
  let conflict: SelfCheckVerdict['conflict'] = null;
  for (const { target, outcome } of results) {
    if (outcome.state === 'self') continue;
    const isConflict = outcome.state === 'other' || (target.kind === 'loopback' && target.covered);
    if (isConflict) conflict ??= { label: target.label, detail: outcome.detail };
    else warnings.push(`${target.label}: ${outcome.detail}`);
  }
  return { conflict, warnings };
}

/** 안내할 모든 주소에 동시에 물어보고 판정한다 */
export async function selfCheck(port: number, targets: SelfCheckTarget[], instanceId: string, timeoutMs = 2000): Promise<SelfCheckVerdict> {
  const results = await Promise.all(targets.map(async (target) => ({ target, outcome: await askInstance(target.address, port, instanceId, timeoutMs) })));
  return judgeSelfCheck(results);
}

/** 데이터 폴더 안의 실행 관련 파일 위치 */
export function runtimePaths(dataDir: string) {
  return {
    pidFile: path.join(dataDir, 'server.pid'),
    stopFlag: path.join(dataDir, 'stop.flag'),
    logFile: path.join(dataDir, 'logs', 'server.log'),
  };
}

/** 서버 로그 한 줄을 남긴다(키·비밀번호는 절대 넣지 않는다, TD-008) */
function writeLog(logFile: string, message: string): void {
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // 로그를 못 남겨도 서버는 계속 동작한다
  }
}

/** 기본 브라우저로 주소를 연다(Windows 전용, start.bat이 OPEN_BROWSER=1을 줄 때만) */
function openBrowser(url: string): void {
  if (process.platform !== 'win32') return;
  const child = spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

/**
 * 서버를 실행한다. 정상 종료되면 종료 코드를 돌려주고, 켜진 동안에는 끝나지 않는다.
 * env를 바꿔 넣으면 테스트에서 다른 포트·데이터 폴더로 띄울 수 있다.
 */
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let config: AppConfig;
  try {
    config = loadConfig(env);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`\n[문제] 설정을 읽지 못했어요.\n[원인] ${e.message}\n`);
      return EXIT_CONFIG;
    }
    throw e;
  }

  const paths = runtimePaths(config.dataDir);
  fs.mkdirSync(path.dirname(paths.logFile), { recursive: true });
  fs.mkdirSync(config.backupDir, { recursive: true });
  // 지난번에 남은 종료 표시가 있으면 지운다(켜자마자 꺼지는 것 방지)
  fs.rmSync(paths.stopFlag, { force: true });

  const clock = config.testNow ? fixedClock(config.testNow) : systemClock;

  // DB 열기 → 마이그레이션(이미 적용한 번호는 건너뜀). 실패하면 다시 시작해도 똑같으므로 종료 코드 3(다시 시작 안 함)으로 끝낸다.
  let db: Db;
  try {
    const opened = openAppDb(config.dataDir, { clock });
    db = opened.db;
    const m = opened.migration;
    const note = m.applied.length ? `새로 적용: ${m.applied.join(', ')}` : '새로 적용한 것 없음';
    writeLog(paths.logFile, `DB 준비 ${appDbPath(config.dataDir)} schema_version=${m.version} (${note})`);
    if (m.applied.length) console.log(`데이터 구조를 준비했어요(버전 ${m.version}, ${m.applied.length}개 적용).`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n[문제] 데이터 파일(app.db)을 준비하지 못했어요.\n[원인] ${msg}\n[해결 방법] 서버 창이 이미 켜져 있으면 닫고 다시 실행해 주세요. 계속되면 backups 폴더의 최근 백업으로 복원이 필요할 수 있어요.\n`);
    writeLog(paths.logFile, `DB 준비 실패: ${msg}`);
    return EXIT_CONFIG;
  }

  // ① 포트를 열기 전에 모든 주소(IPv4·IPv6·루프백·원내 IP)에서 비었는지 먼저 확인한다(빠른 1차 확인).
  // TEST_SKIP_PORT_PRECHECK=1(테스트 전용, production에서는 무시)이면 건너뛰어 ② 자기 확인만으로 찾는지 시험할 수 있다.
  const skipPrecheck = env.TEST_SKIP_PORT_PRECHECK === '1' && env.NODE_ENV !== 'production';
  const plan: ListenPlan = skipPrecheck ? { host: config.host, conflict: null } : await planListen(config.port, config.host);
  if (plan.conflict) {
    db.close();
    console.error(portProblemMessage(config.port, plan.conflict.code));
    writeLog(paths.logFile, `포트 사용 중 port=${config.port} host=${plan.conflict.host} code=${plan.conflict.code}`);
    return EXIT_PORT;
  }
  if (plan.host !== config.host) writeLog(paths.logFile, `주소 ${config.host}을(를) 쓸 수 없어 ${plan.host}로 열어요(IPv6 꺼짐)`);

  const instanceId = makeInstanceId();
  const app = await buildApp({ dataDir: config.dataDir, backupDir: config.backupDir, clock, db, allowExternal: config.allowExternal, instanceId });
  // 자동 백업: 포트를 열기 전에 "오늘 백업이 있는지" 먼저 확인해 없으면 바로 만든다(놓친 날 따라잡기, FR-006 AC1).
  // 열기 전에 하므로 준비 상태 확인(/api/health)이 ok면 오늘 백업은 이미 있다. 그 뒤 매시 정각 확인은 아래 scheduler가 한다.
  startupBackupCheck(app, (m) => writeLog(paths.logFile, m));

  try {
    await app.listen({ port: config.port, host: plan.host });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    await app.close().catch(() => {});
    db.close();
    if (code === 'EADDRINUSE' || code === 'EACCES') {
      console.error(portProblemMessage(config.port, code));
      writeLog(paths.logFile, `listen 실패 port=${config.port} code=${code}`);
      return EXIT_PORT;
    }
    throw e;
  }

  // ② 자기 확인: 안내할 모든 주소로 직접 물어 이번 표식이 돌아오는지 본다. 다른 프로그램이 가로챈 주소가 있으면 서버를 닫고 포트 문제로 끝낸다.
  const lan = lanAddresses();
  const verdict = await selfCheck(config.port, selfCheckTargets(plan.host, lan, await localhostAddresses()), instanceId);
  for (const w of verdict.warnings) writeLog(paths.logFile, `자기 확인 경고(충돌 아님) ${w}`);
  if (verdict.conflict) {
    await app.close().catch(() => {});
    db.close();
    console.error(portProblemMessage(config.port, 'EADDRINUSE'));
    writeLog(paths.logFile, `포트 사용 중(자기 확인) port=${config.port} host=${verdict.conflict.label} ${verdict.conflict.detail}`);
    return EXIT_PORT;
  }

  fs.writeFileSync(paths.pidFile, String(process.pid));
  console.log(startupMessage(config.port, lan, readVersion()));
  writeLog(paths.logFile, `서버 시작 pid=${process.pid} host=${plan.host} port=${config.port}`);
  if (env.OPEN_BROWSER === '1' && env.NO_BROWSER !== '1') openBrowser(`http://localhost:${config.port}`);
  // 예약 작업(세션 정리·기한형 알림·자동 백업 확인): 지금 한 번, 그 뒤 매시 정각(server/jobs/scheduler.ts). 타이머는 이 scheduler 하나다.
  // db는 복원 때 바꿔 끼워지는 app.db 래퍼를 넘긴다(02-05: 원래 연결을 넘기면 복원 뒤 닫힌 연결을 쓰게 됨)
  const jobLog = (m: string) => writeLog(paths.logFile, m);
  const scheduler = startScheduler({ db: app.db, clock, log: jobLog, jobs: [...defaultJobs(), backupScheduledJob(app, jobLog)] });

  // 끄기: stop.bat이 stop.flag를 만들거나, Ctrl+C·종료 신호를 받으면 정리하고 0으로 끝낸다
  return await new Promise<number>((resolve) => {
    let closing = false;
    const shutdown = async (why: string) => {
      if (closing) return;
      closing = true;
      clearInterval(timer);
      await scheduler.stop();
      console.log(`\n서버를 끄는 중이에요(${why})...`);
      await app.close().catch(() => {});
      db.close();
      fs.rmSync(paths.pidFile, { force: true });
      writeLog(paths.logFile, `서버 종료 (${why})`);
      console.log('서버가 꺼졌어요.');
      resolve(EXIT_OK);
    };
    const timer = setInterval(() => {
      if (fs.existsSync(paths.stopFlag)) void shutdown('stop.bat 요청');
    }, 500);
    process.once('SIGINT', () => void shutdown('Ctrl+C'));
    process.once('SIGTERM', () => void shutdown('종료 신호'));
  });
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      console.error('\n[문제] 예기치 못한 오류로 서버가 멈췄어요. 잠시 뒤 자동으로 다시 시작해요.');
      console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
      process.exit(EXIT_CRASH);
    });
}
