-- Launch a new Terminal.app window for a persona.
-- argv: customTitle  bgAlpha  useBlur  workspaceCwd  command  posX  posY  posW  posH
-- bgAlpha is "1.0" for opaque, "0.5" for overlay personas.
-- useBlur is "yes" or "no".
-- The window's `custom title` is the persona's canonical address; the close-by-titles
-- and focus-and-paste scripts use this title to locate the window later.

on run argv
  set customTitle to item 1 of argv
  set bgAlphaText to item 2 of argv
  set useBlur to item 3 of argv
  set workspaceCwd to item 4 of argv
  set theCommand to item 5 of argv
  set posX to (item 6 of argv) as integer
  set posY to (item 7 of argv) as integer
  set posW to (item 8 of argv) as integer
  set posH to (item 9 of argv) as integer

  tell application "Terminal"
    activate
    -- `do script` returns the tab; the front window contains it.
    set theTab to do script ("cd " & quoted form of workspaceCwd & " && clear && " & theCommand)
    delay 0.3
    set theWindow to front window
    set custom title of theWindow to customTitle
    set bounds of theWindow to {posX, posY, posX + posW, posY + posH}
    try
      set background alpha of current settings of theWindow to (bgAlphaText as real)
    end try
    if useBlur is "yes" then
      try
        set blur radius of current settings of theWindow to 20
      end try
    end if
    return "launched: " & customTitle
  end tell
end run
