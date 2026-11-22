/**
 * Captures every screen of the customer app, staff app and Brew Haven console as PNGs (2x).
 * Needs the API and both apps running on a freshly seeded database (it places a few demo orders).
 *   node tools/screenshots.cjs <output-folder>
 * CUSTOMER_URL / STAFF_URL override the dev ports. PLATFORM_EMAIL and PLATFORM_PASSWORD sign in to
 * the console (create the login with the platform-admin script; run the API with
 * PLATFORM_REQUIRE_TWO_STEP=false). index.json in the folder lists the screens.
 */
const { chromium } = require('playwright');
const OUT = process.argv[2] ?? 'screenshots'; require('fs').mkdirSync(OUT, { recursive: true });
const C = process.env.CUSTOMER_URL ?? 'http://localhost:5173', S = process.env.STAFF_URL ?? 'http://localhost:5174';
const log = [];
let n = 0;
async function shot(p, group, name, full = true) {
  await p.waitForTimeout(900);
  const file = `${group}-${String(++n).padStart(2, '0')}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
  await p.screenshot({ path: `${OUT}/${file}`, fullPage: full });
  log.push({ group, name, file });
  console.log('ok', file);
}
async function step(label, fn) { try { await fn(); } catch (e) { console.log('FAIL', label, e.message.split('\n')[0]); } }
async function order(ctx, items, pay = true, group = null) {
  const p = await ctx.newPage();
  await p.goto(C + '/400-coffee/tower-a/menu'); await p.waitForSelector('.menu-header');
  for (const i of items) { await p.locator('.add-btn').nth(i).click(); await p.waitForTimeout(300); if (await p.locator('.sheet').count()) await p.locator('.sheet .btn-primary').first().click(); await p.waitForTimeout(300); }
  await p.goto(C + '/400-coffee/tower-a/checkout'); await p.waitForSelector('.pay-bar');
  await p.locator('input[autocomplete="given-name"]').fill(['Riya','Kabir','Meera','Arjun'][items.length % 4]);
  await p.locator('input[autocomplete="tel-national"]').fill('98765 4321' + items.length);
  await p.locator('.pay-bar button.btn-primary, button.btn-primary.btn-lg').last().click();
  await p.waitForURL(/\/order\//); await p.waitForTimeout(800);
  if (pay) { await p.locator('button:has-text("UPI")').first().click(); await p.waitForTimeout(1200); }
  return p;
}
(async () => {
  const b = await chromium.launch();
  const phone = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const p = await phone.newPage();
  // ---------- Customer ----------
  await step('welcome', async () => { await p.goto(C + '/400-coffee/tower-a'); await p.waitForSelector('h1'); await p.waitForTimeout(2500); await shot(p, 'customer', 'Welcome', false); });
  await step('menu', async () => { await p.goto(C + '/400-coffee/tower-a/menu'); await p.waitForSelector('.menu-header'); await shot(p, 'customer', 'Menu'); });
  await step('sheet', async () => { await p.locator('.add-btn').nth(1).click(); await p.waitForSelector('.sheet'); await shot(p, 'customer', 'Item options', false); await p.locator('.sheet .btn-primary').first().click(); });
  await step('basket', async () => { await p.locator('.add-btn').nth(4).click(); await p.waitForTimeout(400); if (await p.locator('.sheet').count()) await p.locator('.sheet .btn-primary').first().click(); await p.waitForTimeout(500); await shot(p, 'customer', 'Menu with basket', false); });
  await step('checkout', async () => { await p.goto(C + '/400-coffee/tower-a/checkout'); await p.waitForSelector('.pay-bar'); await p.locator('input[autocomplete="given-name"]').fill('Riya'); await p.locator('input[autocomplete="tel-national"]').fill('98765 43210'); await shot(p, 'customer', 'Checkout'); });
  let token;
  await step('pay', async () => { await p.locator('button.btn-primary.btn-lg').last().click(); await p.waitForURL(/\/order\//); await p.waitForTimeout(1000); token = p.url().split('/order/')[1]; await shot(p, 'customer', 'Payment (demo gateway)'); });
  await step('placed', async () => { await p.locator('button:has-text("UPI")').first().click(); await p.waitForTimeout(1500); await shot(p, 'customer', 'Order placed, live tracking'); });
  // more orders for the staff boards
  const extra = [];
  await step('extra orders', async () => { extra.push(await order(phone, [0, 2])); extra.push(await order(phone, [3])); extra.push(await order(phone, [5, 6, 7])); extra.push(await order(phone, [1], false)); });

  // ---------- Staff / café owner ----------
  const desk = await b.newContext({ viewport: { width: 1366, height: 860 }, deviceScaleFactor: 2 });
  const s = await desk.newPage();
  await step('signup', async () => { await s.goto(S + '/signup'); await s.waitForSelector('text=Start your café'); await shot(s, 'owner', 'Sign up a new café'); });
  await step('login', async () => { await s.goto(S + '/'); await s.waitForSelector('text=Owner (Admin)'); await shot(s, 'owner', 'Staff sign-in'); });
  await step('pin', async () => { await s.click('text=Owner (Admin)'); await shot(s, 'owner', 'PIN pad'); for (const d of '1111') await s.click(`.pinpad button[aria-label="${d}"]`); await s.waitForSelector('.topbar'); });
  await step('orders', async () => { await shot(s, 'owner', 'Orders board'); });
  await step('kitchen', async () => { await s.click('.tab:has-text("Kitchen display")'); await shot(s, 'owner', 'Kitchen display');
    const start = s.locator('button:has-text("Start")').first(); if (await start.count()) { await start.click(); await s.waitForTimeout(800); }
    const ready = s.locator('button:has-text("ready")').first(); if (await ready.count()) { await ready.click(); await s.waitForTimeout(800); }
    await shot(s, 'owner', 'Kitchen display, orders in progress'); });
  await step('customer tracking ready', async () => { await p.reload(); await p.waitForTimeout(1500); await shot(p, 'customer', 'Order ready for pickup'); });
  await step('receipt', async () => { if (token) { await p.goto(C + `/order/${token}/receipt`); await p.waitForTimeout(1200); await shot(p, 'customer', 'Receipt'); } });
  await step('terms', async () => { await p.goto(C + '/legal/terms'); await shot(p, 'customer', 'Terms of service', false); });
  await step('privacy', async () => { await p.goto(C + '/legal/privacy'); await shot(p, 'customer', 'Privacy policy', false); });
  await step('orders2', async () => { await s.click('.tab:has-text("Orders")'); await shot(s, 'owner', 'Orders board with ready order'); });
  await step('help', async () => { await s.click('.help-btn'); await s.waitForSelector('.help-modal'); await shot(s, 'owner', 'Help', false); await s.click('.help-modal button:has-text("Close")'); });
  await step('new', async () => { await s.click('.tab:has-text("New counter order")'); await shot(s, 'owner', 'New counter order'); });
  await step('stock', async () => { await s.click('.tab:has-text("Stock")'); await shot(s, 'owner', 'Stock'); });
  await step('today', async () => { await s.click('.tab:has-text("Today")'); await shot(s, 'owner', 'Today'); });
  await step('setup', async () => { await s.click('.tab:has-text("Setup")'); await s.waitForTimeout(800); });
  for (const sub of ['Reports', 'Payment checks', 'Inventory', 'Cafés & kitchens', 'Menu', 'Staff', 'Café settings', 'Customer messages', 'Activity']) {
    await step('sub ' + sub, async () => { await s.click(`.subtabs button:has-text("${sub}")`); await shot(s, 'owner', 'Setup: ' + sub); });
  }
  await step('kitchen login', async () => { const k = await desk.newPage(); await k.goto(S + '/'); await k.waitForSelector('text=Owner (Admin)'); const btn = k.locator('button:has-text("Kitchen")').first(); await btn.click(); for (const d of '3333') await k.click(`.pinpad button[aria-label="${d}"]`); await k.waitForSelector('.topbar'); await shot(k, 'owner', 'Kitchen staff view'); });
  await step('cashier login', async () => { const k = await desk.newPage(); await k.goto(S + '/'); await k.waitForSelector('text=Owner (Admin)'); const btn = k.locator('button:has-text("Cashier")').first(); await btn.click(); for (const d of '2222') await k.click(`.pinpad button[aria-label="${d}"]`); await k.waitForSelector('.topbar'); await shot(k, 'owner', 'Cashier view'); });

  // ---------- Brew Haven console ----------
  const t = await desk.newPage();
  await step('platform signin', async () => { await t.goto(S + '/platform'); await t.waitForSelector('text=Team sign-in'); await shot(t, 'admin', 'Team sign-in'); });
  await step('platform list', async () => { await t.fill('input[type=email]', process.env.PLATFORM_EMAIL ?? ''); await t.fill('input[type=password]', process.env.PLATFORM_PASSWORD ?? ''); await t.click('button:has-text("Sign in")'); await t.waitForSelector('.platform-table'); await shot(t, 'admin', 'All businesses'); });
  await step('platform pay', async () => { await t.locator('button[aria-label^="Record a payment"]').first().click(); await t.waitForSelector('.modal'); await shot(t, 'admin', 'Record a payment', false); await t.locator('.modal button:has-text("Cancel")').first().click().catch(() => t.keyboard.press('Escape')); });
  await step('platform 2fa', async () => { const btn = t.locator('button:has-text("Turn on")').first(); if (await btn.count()) { await btn.click(); await t.waitForTimeout(1000); await shot(t, 'admin', 'Two-step sign-in setup'); } });
  require('fs').writeFileSync(`${OUT}/index.json`, JSON.stringify(log, null, 1));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
