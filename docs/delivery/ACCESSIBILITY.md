# Accessibility

Target: WCAG 2.2 level AA for the customer app and the staff app.

## How it's checked

`node tools/a11y-audit.cjs` runs axe-core (WCAG 2.0, 2.1 and 2.2 A/AA rules plus axe best
practices) over 18 screens: the customer welcome, menu, item options and checkout, and every staff
tab and owner Setup section. It needs the API and both apps running with the demo data. It exits
non-zero if anything is found.

Last run: no issues on any of the 18 screens.

## What was fixed in this pass

| Issue | Fix |
|---|---|
| Pop-ups (item options, counter order options, menu item editor, QR poster) didn't take keyboard focus, and Escape did nothing | Shared `useDialog` (packages/ui-react): focus moves in when the pop-up opens, Tab stays inside, Escape closes it, focus returns to the button that opened it |
| PIN dots and veg marks had labels screen readers ignore | Given `role="img"` so the label is read |
| Staff app had no page heading, and the tab bar wasn't a landmark | Café name is the page's `h1`; tabs sit inside a labelled `nav` |
| Setup headings skipped a level | Section headings are `h2`, sub-headings `h3`, with the same look as before |
| Unlabelled "actions" table columns | Screen-reader-only "Actions" header |

## Already in place

- Visible focus ring on everything that can be focused (brass outline).
- Reduced motion: animations are switched off, and the 3D café shows a still view, when the
  phone asks for reduced motion.
- Colour contrast meets AA throughout (checked by the audit).
- Form fields have labels; errors are announced (`role="alert"`) and status changes use
  `role="status"`.
- Veg and non-veg are shown by mark and by text, not by colour alone.

## Still worth doing with real users

Automated checks only catch some real problems. Before launch, run one session
with a screen reader user (TalkBack on Android, VoiceOver on iPhone) through ordering and
tracking, and one with staff on the actual counter tablet.
