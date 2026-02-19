@echo off
setlocal
REM ETA Sea Tracker - Full Pipeline (Windows Task Scheduler)
REM Uses script location as source of truth (no hard-coded absolute paths).

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%\.."

if not exist "venv\Scripts\activate.bat" (
  echo [ERROR] venv not found at "%CD%\venv\Scripts\activate.bat"
  popd
  exit /b 1
)

call "venv\Scripts\activate.bat"
python main.py --debug run >> logs\scheduler.log 2>&1
set "EXIT_CODE=%ERRORLEVEL%"
call deactivate

popd
exit /b %EXIT_CODE%
