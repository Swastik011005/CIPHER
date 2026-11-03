@echo off
rem First-time setup: creates the backend virtual environment, installs the backend and frontend dependencies
rem and builds the frontend (so demo mode works). Needs Python 3.12+ and Node.js 20.19+ on the PATH and an
rem internet connection for this one step. After it, everything runs offline.
setlocal
set "ROOT=%~dp0.."

where py >nul 2>nul
if %errorlevel%==0 ( set "PY=py -3" ) else ( set "PY=python" )
where node >nul 2>nul || ( echo Node.js was not found. Install Node.js 20.19 or newer from nodejs.org, then run this again. & exit /b 1 )
%PY% --version >nul 2>nul || ( echo Python was not found. Install Python 3.12 or newer from python.org, then run this again. & exit /b 1 )

echo [1/4] Creating the backend virtual environment...
cd /d "%ROOT%\backend" || exit /b 1
if not exist .venv\Scripts\python.exe ( %PY% -m venv .venv || exit /b 1 )

echo [2/4] Installing backend dependencies...
.venv\Scripts\python -m pip install --disable-pip-version-check -r requirements.txt || exit /b 1

echo [3/4] Installing frontend dependencies...
cd /d "%ROOT%\frontend" || exit /b 1
call npm ci --no-audit --no-fund || exit /b 1

echo [4/4] Building the frontend for demo mode...
call npm run build || exit /b 1

echo.
echo Setup finished. Next: scripts\start-demo.cmd (one window, works offline) or scripts\start-dev.cmd (two windows).
endlocal
