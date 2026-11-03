@echo off
rem Development mode: the backend on :8000 and the Vite dev server on :5173 with hot reload.
rem Windows wrapper: the work is done by scripts\tasks.py, which also runs on macOS and Linux:
rem     python scripts/tasks.py dev
setlocal
where py >nul 2>nul
if %errorlevel%==0 ( set "PY=py -3" ) else ( set "PY=python" )
%PY% --version >nul 2>nul || ( echo Python was not found. Install Python 3.12 or newer from python.org, then run this again. & exit /b 1 )
%PY% "%~dp0tasks.py" dev %*
exit /b %errorlevel%
