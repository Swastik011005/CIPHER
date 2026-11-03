@echo off
rem Runs the backend tests, the scenario checks, the frontend tests and the production build.
rem Windows wrapper: the work is done by scripts\tasks.py, which also runs on macOS and Linux:
rem     python scripts/tasks.py verify
setlocal
where py >nul 2>nul
if %errorlevel%==0 ( set "PY=py -3" ) else ( set "PY=python" )
%PY% --version >nul 2>nul || ( echo Python was not found. Install Python 3.12 or newer from python.org, then run this again. & exit /b 1 )
%PY% "%~dp0tasks.py" verify %*
exit /b %errorlevel%
