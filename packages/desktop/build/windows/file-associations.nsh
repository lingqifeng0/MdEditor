; Preserve the user's default editor and quote the executable as well as %1.
!macroundef APP_ASSOCIATE
!macro APP_ASSOCIATE EXT FILECLASS DESCRIPTION ICON COMMANDTEXT COMMAND
  WriteRegNone SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${FILECLASS}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILECLASS}" "" "${DESCRIPTION}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILECLASS}\DefaultIcon" "" "${ICON}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILECLASS}\shell" "" "open"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILECLASS}\shell\open" "" "${COMMANDTEXT}"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${FILECLASS}\shell\open\command" "" '"$appExe" "%1"'
!macroend

!macroundef APP_UNASSOCIATE
!macro APP_UNASSOCIATE EXT FILECLASS
  ${ifNot} ${isUpdated}
    DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${FILECLASS}"
    Push $0
    ReadRegStr $0 SHELL_CONTEXT "Software\Classes\.${EXT}" ""
    ${if} $0 == "${FILECLASS}"
      DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}" ""
    ${endIf}
    Pop $0
    DeleteRegKey SHELL_CONTEXT "Software\Classes\${FILECLASS}"
  ${endIf}
!macroend
