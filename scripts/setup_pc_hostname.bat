@echo off
setlocal EnableDelayedExpansion

:: Check Administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [LocalHub] Administrator privileges required. Requesting elevation...
    powershell -NoProfile -Command "Start-Process cmd -ArgumentList '/k \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

title LocalHub Hostname Setup
color 0b
echo ========================================================
echo         LocalHub PC Hostname Configuration
echo ========================================================
echo.

set TARGET_IP=192.168.0.101
echo Mapping localhub.local and localhub to %TARGET_IP%...

:: Native append to Windows hosts file
echo.>> C:\Windows\System32\drivers\etc\hosts
echo %TARGET_IP% localhub.local localhub >> C:\Windows\System32\drivers\etc\hosts

:: Flush Windows DNS Cache
echo Flushing DNS cache...
ipconfig /flushdns >nul 2>&1

echo.
echo ========================================================
echo [SUCCESS] Windows hosts file configured successfully!
echo.
echo Testing connection:
ping -n 1 localhub.local
echo.
echo You can now open LocalHub in your browser using:
echo   http://localhub.local:8080
echo   http://localhub:8080
echo ========================================================
echo.
echo Press any key to open http://localhub.local:8080 in Chrome...
pause >nul
start http://localhub.local:8080
