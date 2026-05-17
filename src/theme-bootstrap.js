// Loaded synchronously from <head> before paint to prevent light/dark flash.
// Emitted to the renderer output dir by CopyPlugin (webpack.renderer.config.ts).
(function () {
  var mode = localStorage.getItem('lychee-theme') || 'light';
  var dark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
})();
