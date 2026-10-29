/**
 * End-to-end check against the running stack.
 *
 * Exercises the API exactly as the web client does — web client type, cookie
 * jar for the HttpOnly refresh token, bearer access token — and asserts the
 * response SHAPES the frontend reads. A green backend test suite does not
 * prove the frontend's field paths are right; this does.
 */
const API = 'http://localhost:4000/api/v1';

let cookieJar = '';
let accessToken = null;
let failures = 0;

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

async function call(method, path, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken && !opts.noAuth) headers.Authorization = `Bearer ${accessToken}`;
  if (cookieJar) headers.Cookie = cookieJar;

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookieJar = setCookie.split(';')[0];

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON (CSV) */ }
  return { status: res.status, json, text, headers: res.headers };
}

console.log('\n=== 1. Authentication (web client, cookie-based refresh) ===');
const login = await call('POST', '/auth/login', {
  email: 'owner@timex.test',
  password: 'OwnerPass123!',
  client: 'web',
});
check('login returns 200', login.status === 200, `got ${login.status}`);
check('refresh token NOT in body for web client', login.json?.data?.refreshToken === undefined);
check('refresh cookie is HttpOnly', (login.headers.get('set-cookie') ?? '').includes('HttpOnly'));
check('user shape matches frontend type', typeof login.json?.data?.user?.fullName === 'string');
check('memberships carry baseCurrency', typeof login.json?.data?.memberships?.[0]?.baseCurrency === 'string');
accessToken = login.json?.data?.accessToken;
check('access token issued', typeof accessToken === 'string' && accessToken.length > 20);

console.log('\n=== 2. Session restore via cookie (what a page reload does) ===');
const savedToken = accessToken;
accessToken = null;
const refreshed = await call('POST', '/auth/refresh', { client: 'web' }, { noAuth: true });
check('refresh succeeds with only the cookie', refreshed.status === 200, `got ${refreshed.status}`);
accessToken = refreshed.json?.data?.accessToken ?? savedToken;

const me = await call('GET', '/auth/me');
check('/auth/me returns the profile', me.status === 200);
check('profile exposes memberships[].company.baseCurrency',
  typeof me.json?.data?.memberships?.[0]?.company?.baseCurrency === 'string');
check('password hash never returned', !JSON.stringify(me.json).includes('passwordHash'));

console.log('\n=== 3. Dashboard contract (every field the UI reads) ===');
const dash = await call('GET', '/dashboard?preset=allTime');
check('dashboard returns 200', dash.status === 200);
const d = dash.json?.data;
for (const field of ['grossRevenue', 'totalRefunds', 'netRevenue', 'processingFees',
                     'eligibleExpenses', 'unpaidExpenses', 'netProfit', 'pendingPayments',
                     'disputedAmount']) {
  check(`summary.${field} is a decimal string`, typeof d?.summary?.[field] === 'string',
    `got ${typeof d?.summary?.[field]}`);
}
check('money is NOT a JSON number', typeof d?.summary?.grossRevenue !== 'number');
check('counts.activeProjects present', typeof d?.counts?.activeProjects === 'number');
check('dataQuality.hasUnconvertedRecords present', typeof d?.dataQuality?.hasUnconvertedRecords === 'boolean');
check('revenueByProject is an array', Array.isArray(d?.revenueByProject));
check('monthlyTrend is an array', Array.isArray(d?.monthlyTrend));
check('range.label present', typeof d?.range?.label === 'string');
console.log(`        net profit (all time): ${d?.summary?.currency} ${d?.summary?.netProfit}`);

console.log('\n=== 4. Record income, then confirm the dashboard moves ===');
const projects = await call('GET', '/projects?pageSize=5');
check('projects list returns items + meta', Array.isArray(projects.json?.data) && projects.json?.meta);
const projectId = projects.json?.data?.[0]?.id;

const before = Number(d?.summary?.grossRevenue ?? '0');
const created = await call('POST', '/transactions', {
  projectId,
  grossAmount: '1234.56',
  feeAmount: '34.56',
  currency: 'INR',
  occurredAt: new Date().toISOString(),
});
check('income recorded (201)', created.status === 201, `got ${created.status} ${created.text.slice(0,120)}`);
check('netAmount computed server-side', created.json?.data?.netAmount === '1200.00',
  `got ${created.json?.data?.netAmount}`);
check('refundableRemaining computed', created.json?.data?.refundableRemaining === '1234.56');

const after = await call('GET', '/dashboard?preset=allTime');
const delta = Number(after.json?.data?.summary?.grossRevenue) - before;
check('dashboard gross revenue increased by exactly 1234.56', Math.abs(delta - 1234.56) < 0.001,
  `delta was ${delta}`);

console.log('\n=== 5. Refund flow ===');
const txnId = created.json?.data?.id;
const refund = await call('POST', `/transactions/${txnId}/refunds`, { amount: '234.56' });
check('refund accepted (201)', refund.status === 201, `got ${refund.status}`);
check('transaction marked PARTIALLY_REFUNDED',
  refund.json?.data?.transaction?.status === 'PARTIALLY_REFUNDED');
check('refundable remaining updated', refund.json?.data?.transaction?.refundableRemaining === '1000.00',
  `got ${refund.json?.data?.transaction?.refundableRemaining}`);

const over = await call('POST', `/transactions/${txnId}/refunds`, { amount: '99999.00' });
check('over-refund rejected with 422', over.status === 422, `got ${over.status}`);
check('error carries refundableRemaining detail',
  typeof over.json?.error?.details?.refundableRemaining === 'string');

console.log('\n=== 6. Profit sharing contract ===');
const split = await call('GET', '/profit-sharing?preset=allTime');
check('profit sharing returns 200', split.status === 200);
check('configured flag present', typeof split.json?.data?.configured === 'boolean');
if (split.json?.data?.configured) {
  const p = split.json.data.partners?.[0];
  check('partner has calculatedShare', typeof p?.calculatedShare === 'string');
  check('partner has actuallyPaid (separate from owed)', typeof p?.actuallyPaid === 'string');
  check('partner has outstanding', typeof p?.outstanding === 'string');
  const total = split.json.data.partners.reduce((s, x) => s + Number(x.calculatedShare), 0);
  check('shares sum to net profit exactly',
    Math.abs(total - Number(split.json.data.netProfit)) < 0.005,
    `shares ${total} vs profit ${split.json.data.netProfit}`);
}

console.log('\n=== 7. CSV export ===');
const csv = await call('GET', '/reports/export/transactions?preset=allTime');
check('export returns 200', csv.status === 200);
check('content-type is CSV', (csv.headers.get('content-type') ?? '').includes('text/csv'));
// Checked on the RAW BYTES: fetch().text() decodes UTF-8 and silently strips
// a leading BOM, so a text-level assertion here would always fail even though
// the bytes are correct.
const csvBytes = Buffer.from(await (await fetch(`${API}/reports/export/transactions?preset=allTime`, {
  headers: { Authorization: `Bearer ${accessToken}` },
})).arrayBuffer());
check('has UTF-8 BOM for Excel (raw bytes ef bb bf)',
  csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf,
  `got ${[...csvBytes.subarray(0, 3)].map((b) => b.toString(16)).join(' ')}`);
check('includes project_code header', csv.text.includes('project_code'));

console.log('\n=== 8. Security boundaries ===');
const noAuth = await fetch(`${API}/dashboard`);
check('dashboard requires auth (401)', noAuth.status === 401, `got ${noAuth.status}`);

const badToken = await fetch(`${API}/dashboard`, { headers: { Authorization: 'Bearer forged.token.here' } });
check('forged token rejected (401)', badToken.status === 401);

const providers = await call('GET', '/payment-providers');
check('providers never return secrets',
  !JSON.stringify(providers.json ?? {}).includes('Ciphertext'));

const badWebhook = await fetch(`${API}/webhooks/stripe/00000000-0000-0000-0000-000000000000`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: 'evt_forged', type: 'charge.succeeded', data: { object: { amount: 9999999 } } }),
});
check('unsigned webhook does not create income', badWebhook.status >= 400, `got ${badWebhook.status}`);

console.log('\n=== 9. Frontend serves ===');
const page = await fetch('http://localhost:3000/login');
const html = await page.text();
check('login page returns 200', page.status === 200);
check('renders the product name', html.includes('Ledger'));
check('no backend secret in the HTML',
  !/DATABASE_URL|ACCESS_TOKEN_SECRET|APP_ENCRYPTION_KEY|cmspass/.test(html));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
