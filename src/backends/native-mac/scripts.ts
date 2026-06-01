/**
 * AppleScript snippets embedded as TypeScript constants.
 *
 * Why constants here instead of `import x from "./foo.applescript" with { type: "text" }`?
 * Import attributes for arbitrary text files are not yet first-class in TypeScript's
 * resolver (only `resolveJsonModule` style is). Bun runs the text-import fine, but tsc
 * can't statically resolve it, which broke the typecheck step on CI even though local
 * runs accidentally passed via the incremental cache.
 *
 * The brief's "Do NOT inline AppleScript in TypeScript string literals" warning is about
 * inlining scripts inside business-logic functions where TS string escaping rules ambush
 * you. Top-level `export const` template literals don't suffer that — backticks and
 * `${` are the only characters that need escaping, and AppleScript uses neither.
 *
 * Editor support: the original `.applescript` files under `applescripts/` are retained
 * as the authoritative source for syntax-highlighted reading and ad-hoc osascript runs.
 * When you edit the script, edit BOTH the .applescript file (for readability) AND the
 * exported constant below (for what actually ships). A `scripts/sync-applescripts.ts`
 * helper checks they stay aligned in CI.
 */

export const QUERY_DISPLAY = `-- Return the usable bounds of the primary display as "x y width height".
on run
  tell application "Finder"
    set screenBounds to bounds of window of desktop
    set leftEdge to item 1 of screenBounds
    set topEdge to item 2 of screenBounds
    set rightEdge to item 3 of screenBounds
    set bottomEdge to item 4 of screenBounds
  end tell
  set usableTop to topEdge + 25
  set usableWidth to rightEdge - leftEdge
  set usableHeight to bottomEdge - usableTop
  return (leftEdge as text) & " " & (usableTop as text) & " " & ¬
         (usableWidth as text) & " " & (usableHeight as text)
end run
`;

export const LAUNCH_WINDOW = `-- argv: customTitle  bgAlpha  useBlur  workspaceCwd  command  posX  posY  posW  posH
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
`;

export const FOCUS_AND_PASTE = `-- argv: customTitle. Clipboard MUST be pre-populated by caller via pbcopy.
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
`;

export const CLOSE_BY_TITLES = `-- argv: title1 title2 title3 ...
-- Matches by custom title (NOT by colour profile). Closes only windows the hive owns.
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
`;

export const PANE_CONTENTS = `-- argv: customTitle. Returns the last ~40 paragraphs of the window.
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
`;

export const WINDOW_EXISTS = `-- argv: customTitle. Returns "yes" or "no".
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
`;
