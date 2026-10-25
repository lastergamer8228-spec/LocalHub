@echo off
:: Checks and prompts for Administrator privileges if not already elevated
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting Administrator privileges...
    powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

title LocalHub Hostname Setup for Windows
color 0b
echo ========================================================
echo         LocalHub PC Hostname Configuration
echo ========================================================
echo.

set TARGET_IP=192.168.0.101
echo Using Phone IP: %TARGET_IP%
echo.

:: Remove any old localhub entries and add clean one
powershell -NoProfile -Command "(Get-Content 'C:\Windows\System32\drivers\etc\hosts') | Where-Object { $_ -notmatch 'localhub' } | Set-Content 'C:\Windows\System32\drivers\etc\hosts'"
powershell -NoProfile -Command "Add-Content -Path 'C:\Windows\System32\drivers\etc\hosts' -Value ('%TARGET_IP%`tlocalhub.local`tlocalhub')"

:: Flush DNS
ipconfig /flushdns >nul 2>&1

echo.
echo ========================================================
echo [SUCCESS] Windows hosts configured!
echo.
echo You can now access LocalHub in Chrome/Edge via:
echo   http://localhub.local:8080
echo   http://localhub:8080
echo ========================================================
echo.

timeout /t 5
start http://localhub.local:8080
