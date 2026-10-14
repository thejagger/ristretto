import type { ClientModule } from 'claude-code'

// A press area without a hover. A Button is always the desktop's own button: sized to its label,
// text only, and it lights up under the pointer. Claude's side pane presses a whole row, and folds
// a card by its title, with no highlight at all. This region draws nothing (one space, laid over
// the row by the board) and tells the board when it is clicked. Nothing here ticks or sets state,
// so it never makes the desktop repaint the pane.

type PressProps = { id: string }

const Press: ClientModule<PressProps> = (props, surface) => {
  const { Text } = surface.elements
  // One listener per instance; a later call replaces it, so registering on every call is safe.
  surface.onPointer(event => {
    if (event.type === 'up' && event.button === 'left') surface.post({ press: props.id })
  })
  return Text({ children: ' ' })
}

export default Press
