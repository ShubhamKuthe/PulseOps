@echo off
setlocal
cd /d "%~dp0"
echo Starting PulseOps on http://localhost:5501/pulseops-ui.html
start "" "http://localhost:5501/pulseops-ui.html"
where py >nul 2>nul
if %errorlevel%==0 (
  py -m http.server 5501
) else (
  python -m http.server 5501
)
endlocal
