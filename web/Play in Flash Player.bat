@echo off
rem Opens the patched game in the bundled Adobe Flash Player projector.
rem Saves are stored by Flash Player itself (in %APPDATA%\Macromedia\Flash Player\#SharedObjects).
cd /d "%~dp0"
start "" "flashplayer_32_sa.exe" "%~dp0hookup.swf"
