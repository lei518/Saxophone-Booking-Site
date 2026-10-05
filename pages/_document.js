import { Html, Head, Main, NextScript } from 'next/document';

// Runs before React hydrates. Reads the saved theme and sets it on <html>
// immediately, so the page never flashes light-then-dark (or the reverse)
// on load. Wrapped in try/catch because localStorage can throw in some
// privacy modes, and a theme flash is a far smaller problem than a crash.
const THEME_SCRIPT = `
(function () {
  try {
    var saved = localStorage.getItem('sax-theme');
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (e) {}
  // Scroll-reveal animations start elements hidden and fade them in via JS
  // (IntersectionObserver). That's only safe to do once we know JS is
  // actually running - this class is how the CSS tells the difference, so a
  // failed script or disabled JS never leaves content permanently invisible.
  document.documentElement.classList.add('js');
})();
`;

export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}