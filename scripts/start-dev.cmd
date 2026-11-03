@echo off
rem Starts the backend (http://127.0.0.1:8000) and the frontend (http://127.0.0.1:5173) in two windows.
rem First-time setup: scripts\setup.cmd (see README.md).
setlocal
set "ROOT=%~dp0.."

if not exist "%ROOT%\backend\.venv\Scripts\python.exe" (
  echo Backend virtual environment not found. Run scripts\setup.cmd first.
  exit /b 1
)
if not exist "%ROOT%\frontend\node_modules" (
  echo Frontend dependencies not found. Run scripts\setup.cmd first.
  exit /b 1
)

start "NetSec backend" cmd /k "cd /d %ROOT%\backend && .venv\Scripts\python app.py"
start "NetSec frontend" cmd /k "cd /d %ROOT%\frontend && npm run dev"

echo Backend:  http://127.0.0.1:8000  (API docs at /docs)
echo Frontend: http://127.0.0.1:5173
endlocal
