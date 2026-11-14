@echo off
rem ============================================================
rem  LaserCut Studio - запуск на Windows
rem  Кладёт рядом с проектом, двойной клик. Нужен Node.js 18+.
rem ============================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ошибка] Не найден Node.js.
  echo Установите LTS с https://nodejs.org/ru и запустите файл снова.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do set NODE_VER=%%v
echo Node.js %NODE_VER%

if not exist "node_modules" (
  echo Устанавливаю зависимости ^(один раз^)...
  call npm install
  if errorlevel 1 (
    echo [ошибка] npm install не удался.
    pause
    exit /b 1
  )
)

echo Собираю приложение...
call npm run build
if errorlevel 1 (
  echo [ошибка] Сборка не удалась.
  pause
  exit /b 1
)

set PORT=8084
echo.
echo ============================================================
echo   LaserCut Studio: http://localhost:%PORT%
echo   Остановить: Ctrl+C в этом окне
echo ============================================================
echo.

start "" "http://localhost:%PORT%"
call npm run serve

pause
