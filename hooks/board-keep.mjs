// Buttons that survive a redraw.
//
// The engine routes a press by the handle a Button gets when it is built, and each drawing lets
// go of the handles the one before it held: a click on the drawing just replaced carried a handle
// nobody held and ran nothing. A Button built once and handed back on every draw keeps its
// handle, and its press runs the action of the draw that is current. The board's Buttons are the
// band's board toggle and, where a surface has no press area (Client), a row's ID.

export function buttonKeeper(now = () => Date.now(), idleMs = 60000) {
  const kept = new Map()
  return {
    // id: where it is drawn and its key; look: everything that changes how it looks (a change
    // builds it anew); onPress: this draw's action; build: makes the element around a press.
    keep(id, look, onPress, build) {
      const at = now()
      const was = kept.get(id)
      if (was && was.look === look) {
        was.onPress = onPress
        was.at = at
        return was.element
      }
      const entry = { look, onPress, at, element: null }
      entry.element = build(() => entry.onPress())
      kept.set(id, entry)
      for (const [key, e] of kept) if (at - e.at > idleMs) kept.delete(key)
      return entry.element
    },
    size: () => kept.size,
  }
}
