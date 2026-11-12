/**
 * Accessibility audit (axe-core, WCAG 2.0-2.2 A/AA plus best practices) across the customer and
 * staff screens. Needs the API and both apps running with the demo seed, and Playwright installed.
 *   node tools/a11y-audit.cjs   (CUSTOMER_URL / STAFF_URL override the default dev ports)
 * Exits non-zero when anything is found.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const results = [];
let audited = 0;
const CUSTOMER = process.env.CUSTOMER_URL ?? 'http://localhost:5173';
const STAFF = process.env.STAFF_URL ?? 'http://localhost:5174';
async function audit(p, name) {
  audited++;
  await p.waitForTimeout(600);
  await p.addScriptTag({ content: AXE });
  const r = await p.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }));
  for (const v of r.violations) results.push({ page: name, id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, sample: v.nodes.slice(0, 3).map(n => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n').slice(1, 2).join('')) });
}
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto(CUSTOMER + '/400-coffee/tower-a?scene=2d'); await p.waitForSelector('h1'); await audit(p, 'customer welcome');
  await p.goto(CUSTOMER + '/400-coffee/tower-a/menu'); await p.waitForSelector('.menu-header'); await audit(p, 'customer menu');
  await p.locator('.add-btn').first().click(); await p.waitForSelector('.sheet'); await audit(p, 'customer item sheet');
  await p.locator('.sheet .btn-primary').first().click();
  await p.goto(CUSTOMER + '/400-coffee/tower-a/checkout'); await p.waitForSelector('.pay-bar'); await audit(p, 'customer checkout');
  const s = await ctx.newPage(); await s.setViewportSize({ width: 1280, height: 800 });
  await s.goto(STAFF + '/signup'); await s.waitForSelector('text=Start your café'); await audit(s, 'staff sign-up');
  await s.click('text=I already have an account');
  await s.goto(STAFF + '/'); await s.waitForSelector('text=Owner (Admin)'); await audit(s, 'staff login');
  await s.click('text=Owner (Admin)'); await audit(s, 'staff pin');
  for (const d of '1111') await s.click(`.pinpad button[aria-label="${d}"]`); await s.waitForSelector('.topbar');
  await audit(s, 'staff orders');
  for (const tab of ['Kitchen display', 'New counter order', 'Stock', 'Today', 'Setup']) { await s.click(`.tab:has-text("${tab}")`); await audit(s, 'staff ' + tab); }
  for (const sub of ['Payment checks', 'Inventory', 'Cafés & kitchens', 'Menu', 'Staff', 'Café settings', 'Customer messages', 'Activity']) { await s.click(`.subtabs button:has-text("${sub}")`); await audit(s, 'admin ' + sub); }
  if (!results.length) console.log('No WCAG 2.2 AA or best-practice issues found on', audited, 'screens.');
  const byRule = {};
  for (const r of results) (byRule[r.id] ??= { impact: r.impact, help: r.help, pages: [], n: 0, sample: r.sample }).pages.push(r.page), byRule[r.id].n += r.n;
  for (const [id, v] of Object.entries(byRule)) console.log(`${v.impact} ${id} (${v.n}) — ${v.help}\n   pages: ${v.pages.join(', ')}\n   ${v.sample.join('\n   ')}`);
  await b.close();
  process.exitCode = results.length ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
