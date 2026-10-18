!define MARKTEXT_TOOLBAR_ASSOCIATIONS "${__FILEDIR__}\file-associations.nsh"
!ifdef APP_INSTALLER_STORE_FILE
  !undef APP_INSTALLER_STORE_FILE
  !define APP_INSTALLER_STORE_FILE "MarkTextToolbar-updater\installer.exe"
!endif
; The workspace package name stays marktext, but uninstall must only remove this fork's data.
!ifdef APP_PACKAGE_NAME
  !undef APP_PACKAGE_NAME
!endif
!define APP_PACKAGE_NAME "MarkTextToolbar"

; This hook runs after electron-builder defines its file-association macros.
!macro customHeader
  !include "${MARKTEXT_TOOLBAR_ASSOCIATIONS}"
!macroend

!macro customInstall
  System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO "Delete MarkText Toolbar settings? Your Markdown files will be kept." /SD IDNO IDNO SkipRemoval
      SetShellVarContext current
      RMDir /r "$APPDATA\MarkTextToolbar"
      ${if} $installMode == "all"
        SetShellVarContext all
      ${endIf}
    SkipRemoval:
  ${endIf}
!macroend
