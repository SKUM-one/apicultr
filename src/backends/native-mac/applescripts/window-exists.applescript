-- Return "yes" if a Terminal window with the given custom title exists, else "no".
-- argv: customTitle

on run argv
  set customTitle to item 1 of argv
  tell application "Terminal"
    try
      set targetWindow to first window whose custom title is customTitle
      return "yes"
    on error
      return "no"
    end try
  end tell
end run
