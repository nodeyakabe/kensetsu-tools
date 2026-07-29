@echo off
cd /d "%~dp0"
echo.
echo  ===================================
echo   建設業ツール工房  ローカル開発サーバー
echo  ===================================
echo.
echo  起動したら下記URLをブラウザで開いてください
echo  http://localhost:4321/
echo  http://localhost:4321/dev/        ← サンドボックス
echo  http://localhost:4321/products/koji-daicho/
echo  http://localhost:4321/products/anzen-daicho/
echo.
echo  停止するには Ctrl+C を押してください
echo.
npm run dev
pause
