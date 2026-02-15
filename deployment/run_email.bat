@echo off
REM ETA Automation - Email Workflow (Windows Task Scheduler)
cd /d C:\Users\tim-k\OneDrive\Dokumente\eta-automation
call venv\Scripts\activate.bat
python main.py email --debug >> logs\scheduler.log 2>&1
deactivate
