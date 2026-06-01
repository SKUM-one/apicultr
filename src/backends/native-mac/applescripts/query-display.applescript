-- Return the usable bounds of the primary display as "x y width height".
-- Subtracts the menu bar (top ~25 px) so callers can lay out windows directly.
-- The Dock is intentionally NOT subtracted: AppleScript can't reliably query
-- the Dock's bounds across user configurations, and Terminal windows
-- positioned over the Dock still render correctly (they just overlap visually).
-- Callers wanting to avoid the Dock can subtract `target_window_size_px[1]` worth
-- of margin from the bottom themselves.

on run
  tell application "Finder"
    set screenBounds to bounds of window of desktop
    -- bounds = {left, top, right, bottom} in points
    set leftEdge to item 1 of screenBounds
    set topEdge to item 2 of screenBounds
    set rightEdge to item 3 of screenBounds
    set bottomEdge to item 4 of screenBounds
  end tell

  -- Subtract menu bar (25 pts on most displays)
  set usableTop to topEdge + 25
  set usableWidth to rightEdge - leftEdge
  set usableHeight to bottomEdge - usableTop

  return (leftEdge as text) & " " & (usableTop as text) & " " & ¬
         (usableWidth as text) & " " & (usableHeight as text)
end run
