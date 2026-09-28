type OverlayDocument = { body: { style: { overflow: string } } };
type Stack = { previousOverflow: string; entries: symbol[]; nextLayer: number };
const stacks = new WeakMap<OverlayDocument, Stack>();

export function acquireViewportOverlay(document: OverlayDocument) {
  let stack = stacks.get(document);
  if (!stack) {
    stack = { previousOverflow: document.body.style.overflow, entries: [], nextLayer: 300 };
    stacks.set(document, stack);
  }
  const token = Symbol("viewport-overlay");
  const layer = stack.nextLayer++;
  stack.entries.push(token);
  document.body.style.overflow = "hidden";
  return {
    layer,
    isTop: () => stack.entries.at(-1) === token,
    release: () => {
      const index = stack.entries.indexOf(token);
      if (index < 0) return;
      stack.entries.splice(index, 1);
      if (!stack.entries.length) {
        document.body.style.overflow = stack.previousOverflow;
        stacks.delete(document);
      }
    }
  };
}
