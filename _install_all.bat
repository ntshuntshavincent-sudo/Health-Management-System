@echo off
rem Installs backend and frontend dependencies in sequence, logging to files.
cd /d "c:\Users\LENOVO\Downloads\MY SYSTEM\backend"
call npm.cmd install --no-fund --no-audit > npm_install.log 2>&1
echo BACKEND-EXIT %errorlevel% >> npm_install.log
cd /d "c:\Users\LENOVO\Downloads\MY SYSTEM\frontend"
call npm.cmd install --no-fund --no-audit > npm_install.log 2>&1
echo FRONTEND-EXIT %errorlevel% >> npm_install.log
echo ALL-DONE > "c:\Users\LENOVO\Downloads\MY SYSTEM\_install_done.txt"
