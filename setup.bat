
@echo off
echo ========================================================
echo Ananya Privacy Vision Agent - Initial Setup
echo ========================================================
echo.

echo [1/4] Installing Root Dependencies...
call npm install
if %errorlevel% neq 0 (
    echo Error installing root dependencies.
    exit /b %errorlevel%
)
echo.

echo [2/4] Installing Extension Dependencies...
cd extension
call npm install
if %errorlevel% neq 0 (
    echo Error installing extension dependencies.
    cd ..
    exit /b %errorlevel%
)
echo.

echo [3/4] Building Chrome Extension...
call npx vite build
if %errorlevel% neq 0 (
    echo Error building the extension.
    cd ..
    exit /b %errorlevel%
)

echo Copying extension files to dist...
copy popup.js dist\popup.js
copy manifest.json dist\manifest.json
xcopy /E /I /Y icons dist\icons

cd ..
echo.

echo [4/4] Setup Complete!
echo ========================================================
echo HOW TO RUN:
echo 1. Start the React server and AI Agent:
echo    npm run dev
echo 2. Start the Local Agent API (port 3001):
echo    node local-agent.js
echo 3. Start the System Agent API (port 3002):
echo    node system-agent.js
echo.
echo HOW TO LOAD EXTENSION IN CHROME:
echo 1. Open Chrome and go to chrome://extensions/
echo 2. Enable "Developer mode" in the top right
echo 3. Click "Load unpacked"
echo 4. Select the "extension\dist" folder in this repository
echo ========================================================
pause
