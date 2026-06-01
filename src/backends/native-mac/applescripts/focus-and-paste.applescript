-- Focus a persona window by custom title, settle, run the legacy focus-steal guard,
-- then paste the clipboard with Cmd+V and send Enter.
-- argv: customTitle
-- The clipboard MUST already contain the brief text (the caller is expected to
-- have pbcopy'd it before invoking this script).
-- On focus-steal (the user Cmd-Tabbed during the 0.5s settle), aborts with the
-- clipboard PRESERVED so the caller can retry without losing content.

on run argv
  set customTitle to item 1 of argv

  tell application "Terminal"
    activate
    try
      set targetWindow to first window whose custom title is customTitle
    on error
      return "not_found: " & customTitle
    end try
    set frontmost of targetWindow to true
    set index of targetWindow to 1
  end tell

  delay 0.5

  tell application "System Events"
    if not (frontmost of process "Terminal") then
      return "aborted: focus left Terminal during settle for " & customTitle & ¬
             " (clipboard preserved; rerun the dispatch)"
    end if
    keystroke "v" using {command down}
    delay 0.25
    keystroke return
  end tell

  return "dispatched: " & customTitle
end run
