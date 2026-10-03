# Dashboard shared UI

Follow [UI/UX specification](../../docs/design/UI-UX-SPEC.md): business layout remains project-specific; general controls use official shadcn components and their standard behavior/styles.

## Build

Run `npm ci --prefix dashboard/ui`, `npm run check --prefix dashboard/ui`, and `npm run build --prefix dashboard/ui`. Source and generated `../ui-assets/` ship together. Python serves the allowlisted assets; users need no Node server, CDN or remote fonts. The lockfile pins dependencies. Component sources come from the official `new-york-v4` registry under [MIT](SHADCN-LICENSE.md). Local adaptations: utility/import aliases, light-only Sonner theme (no Next.js provider).

## Ownership

- `center.js` and `app.js` own API records, sorting/filtering rules, form submission and language dictionaries. They do not implement generic widget keyboard behavior.
- The HTML shell renders once through real React primitives. Dynamic stateless controls render through the same components with `renderToStaticMarkup`, including NativeSelect wrappers and SVGs. No style-decoration fallback exists. Native values/events remain controller-owned.
- `mountControls` is an explicit render boundary. It wraps freshly rendered native selects, mounts Checkbox/Switch/RadioGroup and Collapsible islands, and disposes removed islands. It runs before restoring focus. There is no document-wide observer.
- Hidden native choice fields preserve `form.elements`, FormData and reset behavior. They are inaccessible and never serve as visible controls. Property writes synchronize the real Radix control. Radix's own internal fields must never be re-mounted by this adapter.
- Dialog/AlertDialog/Sheet own modal behavior. A stable slot moves controller-owned forms into the portal and parks them when closed. Content identity, entered values and native listeners survive. Business initial-focus and removed-trigger fallbacks are retained. Cloned disclosure icons prevent stale shell React ancestry from intercepting pointer events.
- Product menus, both tab sets and the Command product switcher are actual interactive React components. Controller callbacks carry only domain actions and selected identities. Sonner owns success notifications; errors remain persistent Alert/field content.
- Official Table renders both product and usage tables. Current sorting is one column and exact domain filters; a second table state store is unnecessary. If column visibility, multiple sorts or pagination UI becomes complex, adopt the official TanStack Data Table composition.

## Styles and retained custom content

Official utility styles override the `legacy` layer; replaced control declarations were removed. `theme.css` contains brand tokens, shared touch minimums and business layout/portal scrolling. Do not add page-specific button/input/arrow overrides.

Custom content is limited to the page frame, responsive columns, recent/other grouping, continuous cycle report/record layout, media fallback and backend state/permission interpretation. The cycle disclosure heading needs a grid to align the cycle rail with its report; its open state and keyboard behavior still belong to Collapsible. All controls within these views use the shared primitives.

See the [interface specification](../../docs/design/UI-UX-SPEC.md). Run `npm ci --prefix dashboard/ui`, `npm run check --prefix dashboard/ui`, and `npm run build --prefix dashboard/ui` from the repository root; commit the updated `dashboard/ui-assets` with its source. Browser contracts live in `tests/browser`.
