!macro customCheckAppRunning
  StrCpy $R1 0

  app_check_loop:
    nsExec::ExecToStack `%SYSTEMROOT%\System32\cmd.exe /c tasklist /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO csv /NH | %SYSTEMROOT%\System32\findstr.exe /I /C:"${APP_EXECUTABLE_FILENAME}"`
    Pop $R0
    Pop $R2

    ${if} $R0 == 0
      IntOp $R1 $R1 + 1
      DetailPrint `Closing running "${PRODUCT_NAME}"...`
      nsExec::ExecToStack `%SYSTEMROOT%\System32\cmd.exe /c taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"`
      Pop $R0
      Pop $R2
      Sleep 1000

      ${if} $R1 > 10
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY app_check_loop
        Quit
      ${endif}

      Goto app_check_loop
    ${endif}
!macroend
