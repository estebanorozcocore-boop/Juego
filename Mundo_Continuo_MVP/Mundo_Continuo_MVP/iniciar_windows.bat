@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
    set "PY=py"
) else (
    set "PY=python"
)
echo Instalando dependencias (solo es necesario la primera vez)...
%PY% -m pip install -r requirements.txt
if errorlevel 1 (
    echo No se pudo instalar aiohttp. Comprueba que Python esta instalado.
    pause
    exit /b 1
)
echo.
echo Abre http://localhost:8000 en tu navegador.
echo Abre otra pestana para probar el mundo compartido.
echo Pulsa Ctrl+C para detener el servidor.
echo.
%PY% server.py
pause
