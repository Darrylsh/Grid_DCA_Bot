@echo off
echo ==========================================
echo Algobot GitHub Token Setup
echo ==========================================
echo.
echo This script helps set the GH_TOKEN environment variable
echo required for publishing new releases.
echo.
echo 1. Generate token at: https://github.com/settings/tokens
echo    - Required scope: 'repo' (full control of private repositories)
echo.
echo 2. Enter your GitHub token below (it will not be displayed):
echo.

set /p GH_TOKEN="Enter GitHub token: "

if "%GH_TOKEN%"=="" (
    echo Error: No token entered!
    pause
    exit /b 1
)

echo.
echo Setting GH_TOKEN environment variable for current session...
set GH_TOKEN=%GH_TOKEN%

echo.
echo Token set (first 8 chars): %GH_TOKEN:~0,8%...
echo.
echo Testing GitHub API access...

:: Simple test using curl if available
where curl >nul 2>nul
if %errorlevel% equ 0 (
    curl -s -H "Authorization: token %GH_TOKEN%" https://api.github.com/user | findstr "login" >nul
    if %errorlevel% equ 0 (
        echo ✅ GitHub API access successful!
    ) else (
        echo ❌ GitHub API authentication failed!
        echo Check your token permissions and network connection.
    )
) else (
    echo ℹ️  curl not found. Cannot test API automatically.
    echo Run: npm run publish:win to test token.
)

echo.
echo ==========================================
echo Next steps:
echo 1. To publish a new release:
echo    npm run version:ui:minor
echo    npm run publish:win
echo.
echo 2. This token is set for current CMD session only.
echo    For permanent setup:
echo    - Right-click "This PC" -> Properties
echo    - Advanced system settings -> Environment Variables
echo    - Add new User variable: GH_TOKEN
echo.
echo 3. For more detailed testing, run:
echo    powershell -ExecutionPolicy Bypass -File scripts\setup-github-token.ps1
echo ==========================================
echo.
pause