-- Return the recent visible contents of a persona's Terminal window for health probes.
-- argv: customTitle
-- We return the last ~40 paragraphs (visible-ish region) so the caller can scan for
-- the claude REPL prompt, plan-mode approval prompts, or extended silence.

on run argv
  set customTitle to item 1 of argv
  tell application "Terminal"
    try
      set targetWindow to first window whose custom title is customTitle
    on error
      return "not_found"
    end try
    set tabContents to contents of selected tab of targetWindow
  end tell
  set paragraphCount to count of paragraphs of tabContents
  if paragraphCount > 40 then
    set startIndex to paragraphCount - 39
    set tail to paragraphs startIndex thru paragraphCount of tabContents
  else
    set tail to paragraphs of tabContents
  end if
  set AppleScript's text item delimiters to linefeed
  set joined to tail as text
  set AppleScript's text item delimiters to ""
  return joined
end run
