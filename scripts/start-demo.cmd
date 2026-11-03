@echo off
rem Demo mode: one process serves the API and the built frontend at http://127.0.0.1:8000 and needs no internet.
rem Builds the frontend first if it has not been built. Opens the default browser; close this window to stop.
setlocal
set "ROOT=%~dp0.."

if not exist "%ROOT%\backend\.venv\Scripts\python.exe" (
  echo Backend virtual environment not found. Run scripts\setup.cmd first.
  exit /b 1
)
if not exist "%ROOT%\frontend\dist\index.html" (
  if not exist "%ROOT%\frontend\node_modules" (
    echo The frontend is not built and its dependencies are missing. Run scripts\setup.cmd first.
    exit /b 1
  )
  echo Building the frontend...
  pushd "%ROOT%\frontend"
  call npm run build || ( popd & exit /b 1 )
  popd
)

echo Starting NetSec 3D at http://127.0.0.1:8000  (Ctrl+C or close this window to stop)
start "" http://127.0.0.1:8000/simulation
cd /d "%ROOT%\backend"
.venv\Scripts\python app.py
endlocal
