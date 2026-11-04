@echo off
rem 이 파일이 하는 일: 치과 원내 AX 서버를 켜는 실제 순서(start.bat이 코드 페이지를 UTF-8로 바꾼 뒤 부른다). Node 버전 확인 →
rem 처음이면 패키지 설치 → data 폴더 준비 → 서버 실행·브라우저 열기 → 서버가 비정상 종료되면 5초 뒤 다시 시작(최대 5회).
rem 직접 실행하지 말고 start.bat을 실행한다. 이 파일 안에서는 chcp로 코드 페이지를 바꾸지 않는다(바꾸면 한국어 줄을 잘못 읽는다).
setlocal EnableExtensions EnableDelayedExpansion
rem 프로젝트 폴더(이 파일 기준 두 단계 위)로 이동한다
for %%i in ("%~dp0..\..") do set "APP_DIR=%%~fi"
cd /d "!APP_DIR!"
title 바른송치과 원내 AX 서버

echo.
echo  치과 원내 AX 서버를 켜는 중이에요...
echo.

rem ---- 1. Node.js 확인 ----
where node >nul 2>nul
if errorlevel 1 (
  echo [문제] Node.js가 설치되어 있지 않아요.
  echo [해결 방법] https://nodejs.org 에서 "Node.js 24 LTS" 설치 파일^(.msi^)을 받아 설치한 뒤, 이 창을 닫고 start.bat을 다시 실행해 주세요.
  echo            자세한 순서는 README.md의 "설치" 부분에 있어요.
  goto fail
)
set "NODE_MAJOR="
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR set "NODE_MAJOR=0"
if !NODE_MAJOR! LSS 24 (
  echo [문제] 설치된 Node.js 버전이 낮아요^(현재 메이저 버전 !NODE_MAJOR!, 필요 24 이상^).
  echo [해결 방법] https://nodejs.org 에서 "Node.js 24 LTS"를 설치한 뒤 다시 실행해 주세요.
  goto fail
)

rem ---- 2. 패키지 설치(처음 한 번, 또는 package-lock.json이 바뀌었을 때) ----
set "LOCK_HASH="
for /f "delims=" %%h in ('certutil -hashfile package-lock.json SHA256 ^| findstr /v ":"') do if not defined LOCK_HASH set "LOCK_HASH=%%h"
set "LOCK_HASH=!LOCK_HASH: =!"
set "OLD_HASH="
if exist "node_modules\.install-stamp" set /p OLD_HASH=<"node_modules\.install-stamp"
if not exist "node_modules\" set "OLD_HASH="
if not "!OLD_HASH!"=="!LOCK_HASH!" (
  rem 개발용 도구가 이미 있는 개발 폴더면 전체를, 설치 PC면 실행에 필요한 것만 받는다
  set "CI_ARGS=--omit=dev"
  if exist "node_modules\vitest\" set "CI_ARGS="
  echo 처음 실행이거나 프로그램이 바뀌어서 필요한 파일을 내려받아요. 인터넷 연결이 필요하고 몇 분 걸릴 수 있어요...
  call npm ci !CI_ARGS! --no-audit --no-fund
  if errorlevel 1 (
    echo [문제] 필요한 파일을 내려받지 못했어요.
    echo [해결 방법] 인터넷 연결을 확인한 뒤 start.bat을 다시 실행해 주세요. 계속 안 되면 node_modules 폴더를 지우고 다시 실행해 주세요.
    goto fail
  )
  >"node_modules\.install-stamp" echo !LOCK_HASH!
)

rem ---- 3. data 폴더 준비 ----
if not defined DATA_DIR set "DATA_DIR=!APP_DIR!\data"
if not exist "%DATA_DIR%\" mkdir "%DATA_DIR%"
set "STOP_FLAG=%DATA_DIR%\stop.flag"
if exist "%STOP_FLAG%" del /q "%STOP_FLAG%"

rem ---- 4. 서버 실행(처음 한 번만 브라우저 열기), 비정상 종료 시 5초 뒤 다시 시작(최대 5회) ----
set "RESTARTS=0"
set "OPEN_BROWSER=1"
:run
node --disable-warning=ExperimentalWarning server\main.ts
set "CODE=!ERRORLEVEL!"
set "OPEN_BROWSER=0"
if exist "%STOP_FLAG%" (
  del /q "%STOP_FLAG%"
  echo stop.bat 요청으로 서버를 껐어요.
  goto end
)
if "!CODE!"=="0" goto end
if "!CODE!"=="2" (
  echo [안내] 포트 문제는 다시 시작해도 해결되지 않아서 멈췄어요. 위 해결 방법을 확인해 주세요.
  goto fail
)
if "!CODE!"=="3" (
  echo [안내] 설정 문제는 다시 시작해도 해결되지 않아서 멈췄어요. 위 원인을 확인해 주세요.
  goto fail
)
set /a RESTARTS+=1
if !RESTARTS! GTR 5 (
  echo [문제] 서버가 5번 다시 시작했지만 계속 멈췄어요.
  echo [해결 방법] data\logs\server.log 내용을 확인하거나, PC를 다시 시작한 뒤 실행해 주세요.
  goto fail
)
echo 서버가 멈춰서 5초 뒤 다시 시작해요^(!RESTARTS!/5^)...
ping -n 6 127.0.0.1 >nul
goto run

:fail
echo.
echo 이 창의 내용을 확인한 뒤 아무 키나 누르면 닫혀요.
pause >nul
endlocal
exit /b 1

:end
endlocal
exit /b 0
