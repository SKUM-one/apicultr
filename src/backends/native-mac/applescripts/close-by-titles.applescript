-- Close every Terminal window whose custom title matches one of the provided titles.
-- argv: title1 title2 title3 ...
-- Critical: matches on `custom title`, NOT on `name of current settings` (the colour
-- profile). The legacy swarm-sleep bug closed windows by profile and accidentally
-- killed unrelated sibling swarms; we explicitly avoid that here.

on run argv
  set closedCount to 0
  tell application "Terminal"
    repeat with titleArg in argv
      set titleText to titleArg as text
      try
        set matchingWindows to every window whose custom title is titleText
        repeat with w in matchingWindows
          try
            close w saving no
            set closedCount to closedCount + 1
          end try
        end repeat
      end try
    end repeat
  end tell
  return "closed: " & closedCount
end run
