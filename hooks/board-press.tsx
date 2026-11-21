import type { ClientModule } from 'claude-code'

// A press area without a hover, laid over the chip above the prompt: a click there opens or
// closes the board's pane. A Button is always the desktop's own button: sized to its label,
// text only, and it lights up under the pointer. Claude's side pane presses a whole row, and folds
// a card by its title, with no highlight at all. This region draws nothing (one space, laid over
// the row by the board; in the terminal not even that, as a space there covers the cell under it)
// and tells the board when it is clicked. Nothing here ticks or sets state, so it never makes the
// desktop repaint the pane.

// `rows`: how tall the blank area is. The desktop sizes a Client by what it draws, not by the
// height it is given: an empty Box left a two-row chip clickable on its top row only (2026-11-21).
type PressProps = { id: string; blank?: boolean; rows?: number }

const Press: ClientModule<PressProps> = (props, surface) => {
  const { Box, Text } = surface.elements
  // One listener per instance; a later call replaces it, so registering on every call is safe.
  surface.onPointer(event => {
    if (event.type === 'up' && event.button === 'left') surface.post({ press: props.id })
  })
  return props.blank ? Box({ height: props.rows ?? 1, width: '100%' }) : Text({ children: ' ' })
}

export default Press
