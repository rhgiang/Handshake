/**
 * Button label that slides up to reveal a copy of itself on hover or keyboard focus (CSS in settings.css).
 * Inspired by Kokonut UI "Slide Text Button" (MIT), https://github.com/kokonut-labs/kokonutui.
 * The copy is aria-hidden so the accessible name stays one label.
 */
export function SlideLabel({ children }: { children: string }) {
  return (
    <span className="set-slide">
      <span className="set-slide-track">
        <span>{children}</span>
        <span aria-hidden="true">{children}</span>
      </span>
    </span>
  );
}
