@echo off
rem Runs everything that can be checked without a browser: backend tests, the 93 scenario checks, frontend tests
rem and the production build. Prints one line per step and exits non-zero if any step fails.
setlocal
set "ROOT=%~dp0.."
set "FAILED=0"

echo === Backend tests (pytest)
pushd "%ROOT%\backend"
.venv\Scripts\python -m pytest -o addopts= -q -p no:cacheprovider
if errorlevel 1 set "FAILED=1"
popd

echo.
echo === Scenario checks (S1 to S7, shipped rules)
.\backend\.venv\Scripts\python "%ROOT%\scripts\run_scenario_checks.py"
if errorlevel 1 set "FAILED=1"

echo.
echo === Frontend tests (Vitest)
pushd "%ROOT%\frontend"
call npx vitest run
if errorlevel 1 set "FAILED=1"

echo.
echo === Production build
call npm run build
if errorlevel 1 set "FAILED=1"
popd

echo.
if "%FAILED%"=="0" ( echo ALL CHECKS PASSED ) else ( echo SOMETHING FAILED: see above )
exit /b %FAILED%
endlocal
