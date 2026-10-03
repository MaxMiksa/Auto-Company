(function () {
  "use strict";
  for (const type of ["pageswap", "pagereveal"]) {
    window.addEventListener(type, (event) => {
      if (!event.viewTransition) return;
      // Cross-document transitions may be skipped on timeout, rapid navigation
      // or reduced motion. Navigation itself must remain an ordinary link.
      event.viewTransition.ready.catch(() => {});
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) event.viewTransition.skipTransition();
    });
  }
})();
