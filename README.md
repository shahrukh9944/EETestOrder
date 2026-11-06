# Order Management Dashboard (Node.js + Express + EJS)

Server-rendered, single-page dashboard with four actions (Create / Shipped / Cancel / Return), a login page
(credentials from `.env`, no database) and a separate **Authentication panel** on the right for JWT renewal.
All EasyEcom calls, credentials and business logic live on the Node.js backend.

## 1. Technical analysis of the attached code (`EE_Orders.zip`)

| File | What it is |
|---|---|
| `server/app.js` | Express API on :5000. Endpoints `/api/getCount` (create), `/api/confirm`, `/api/manifest`, `/api/return`. Hard-coded Bearer JWT and `x-api-key`. |
| `server/app2.js` | One-off script that creates a single hard-coded order (`NIKE55`). Not wired to anything; its payload equals the one in `TestPage.js`. |
| `client/src/pages/TestPage.js` | React page. Generates random order data in the browser and calls the server. Buttons: Create, Process Orders, Manifest, Return Process. |

Issues found in the original (all addressed or flagged):
- JWTs and the API key were hard-coded in source, and the browser could trigger calls (now: server-side only).
- `/api/confirm` replied before doing any work, so the UI never saw results.
- In the manifest/return `catch` blocks `invoice_id` is undefined -> a ReferenceError inside the error handler.
- Return URL was malformed: `...&?end_date=${Date}&start_date=${Date}` (stray `?`, raw `Date.toString()` values). The window (-4d / -3d) and parameter names are kept; the stray `?` is removed and dates are formatted `yyyy-MM-dd HH:mm:ss` (the format the source itself uses for `orderDate`). **This is the one deliberate deviation - please confirm the format the API expects.**
- `slice(0, 2)` limit on returns (variable named `firstTenReturns`) is preserved as `RETURN_LIMIT_PER_MARKETPLACE=2`.

## 2. Existing API workflow (base `https://api.easyecom.io`)

| Step | Call | Headers | Payload / query |
|---|---|---|---|
| Create | `POST /webhook/v2/createOrder` | Bearer + `x-api-key` (docs; source omitted the key) | order JSON (orderType, marketplaceId, orderNumber, orderDate, expDeliveryDate, items[{OrderItemId,Sku,Quantity,Price}], customer[{billing,shipping}]). Success = body `Status===200` and an `InvoiceID` (top-level or under `.data`). |
| List | `GET /orders/V2/getAllOrders` | Bearer + `x-api-key` | `status_id` (2 confirm, 3 manifest, 7 returns), `marketplaceId` |
| Confirm | `POST /orders/confirm_order` | Bearer + `x-api-key` | `{height:"10",width:"3",length:"3",weight:"100",invoice_id}` |
| Manifest ("Shipped order") | `POST /Manifest/Generate` | Bearer + `x-api-key` |  `{carrier_id:"35249", marketplace_id, awb_numbers:[awb]}` |
| Return | `POST /orders/markReturn` | Bearer + `x-api-key` | `{invoice_id, return_date, items:[{sku, quantity, qc_pass:0, inventory_status:"13"}]}` |

Marketplace ids looped: 114, 946, 894, 659, 537.

### What is missing from the source
- **Cancel Order: there is no cancel API anywhere in the source.** Nothing was invented. The button is present and returns a clear "not available" message listing what is needed: endpoint + method, payload (which identifier), required headers, and which orders to cancel. Send me that and it is a ~20-line addition in `services/orderService.js`.
- "Shipped Order" is not a literal name in the source; it is mapped to the source's confirm -> manifest flow (see below).
- The "XPI key" is sent as `x-api-key`, the only key header in the source.

## 3. Project structure

```
server.js                    app wiring, security headers, sessions
config/apiConfig.js          ALL config + credentials (reads .env)
routes/authRoutes.js         /login, /logout, /api/auth/status, /api/auth/token
routes/orderRoutes.js        /api/orders/{create,ship,cancel,return} (+ duplicate-run lock)
services/authService.js      JWT state, expiry detection, token replacement
services/easyecomClient.js   the only module that calls EasyEcom; maps HTTP errors
services/orderService.js     the four actions' business logic
services/dataGenerator.js    random order data (ported from TestPage.js, new SKU list)
middleware/authMiddleware.js login guard, CSRF, login throttle
middleware/errorHandler.js   centralised error -> response
utils/{errors,jwt,logger}.js AppError, JWT decode/mask, secret-redacting logger
views/{login,dashboard}.ejs  server-rendered pages
public/{css,js}              plain CSS / JS
test/services.test.js        service tests against a local mock EasyEcom API
```

## 4. Install and run

Requires **Node.js >= 20.12**.

```bash
cd order-management
npm install
cp .env.example .env     # a ready-to-use .env is already included; edit it
npm start                # http://localhost:3000
npm test                 # service-layer tests (no network needed)
```

Change `LOGIN_PASSWORD` and `SESSION_SECRET` in `.env` before using this anywhere but your own machine.

### Environment variables
| Variable | Purpose |
|---|---|
| `LOGIN_USERNAME` / `LOGIN_PASSWORD` | dashboard login (required, no DB) |
| `SESSION_SECRET` | signs the session cookie (required) |
| `EE_JWT` | initial Bearer token |
| `EE_API_KEY` | sent as `x-api-key` (required) |
| `EE_BASE_URL`, `API_TIMEOUT_MS` | API host, request timeout (default 20 s) |
| `SKU_LIST` | `S1-BL-S,S2-WH-S,S1-RD-M` |
| `MARKETPLACE_IDS`, `CARRIER_ID` | values from the source |
| `CONFIRM_BEFORE_SHIP` | `true` = Shipped Order also runs `confirm_order` first (default `false`) |
| `MAX_ORDERS_PER_REQUEST`, `RETURN_LIMIT_PER_MARKETPLACE` | safety limits |
| `PERSIST_TOKEN` | keep a replaced JWT in `.runtime/jwt.json` (mode 600) across restarts |
| `COOKIE_SECURE`, `TRUST_PROXY` | set `true` / `1` behind HTTPS / a proxy |

## 5. How each button works

- **Create Order** - validates the count (1..20), builds each order exactly like `TestPage.js` (random order id, customer, address, marketplace, quantity; SKU picked from the three configured SKUs), validates SKU/payload, POSTs to `createOrder`, counts it as created only if `Status===200` and an `InvoiceID` is returned. Returns per-order results and the running invoice total.
- **Shipped Order** - for each marketplace, lists `status_id=3` orders and calls `Manifest/Generate` for each AWB. With `CONFIRM_BEFORE_SHIP=true` it first runs `confirm_order` for `status_id=2` orders. Per-item failures are collected and the run continues. Asks for confirmation first.
- **Cancel Order** - takes the order number from the text box next to the button (blank = the latest order created from this dashboard that is not yet cancelled) and calls `POST /orders/cancelOrder {"reference_code": ...}`. Asks for confirmation first.
- **Return Order** - per marketplace, lists `status_id=7` orders for the date window, flattens suborders, and calls `markReturn` for the first N. Asks for confirmation first.

Each action shows a spinner, disables every action button while running, and the server independently rejects a second concurrent run of the same action (HTTP 409).

## 6. JWT expiry detection and replacement

1. **Before every call**: the server decodes the token's `exp` claim (decoding only - *not* signature verification). If expired, the API is not called and `TOKEN_EXPIRED` is returned.
2. **API is authoritative**: any upstream **401** marks the token unusable (`TOKEN_EXPIRED` if `exp` has passed, otherwise `TOKEN_INVALID`). The panel unlocks.
3. **403 is not expiry**: shown as a permission error; the token stays valid and the panel stays locked.
4. **Browser**: the panel is server-rendered in the right state, a countdown runs locally, and `/api/auth/status` is polled every 30 s. When unusable: the panel unlocks, shows **"JWT Token Expired. Please Enter a New Token."** and the four actions are disabled.
5. **Update Token**: structure check -> `exp` must be in the future -> a read-only `getAllOrders` call proves the API accepts it -> only then is it installed (memory, plus `.runtime/jwt.json` if enabled). Actions re-enable immediately.
6. The full token is never sent to the browser, never logged (logger redacts JWT patterns and the API key), and only a masked hint like `eyJ0eX…GcqM` is displayed.

### Error codes (shown as friendly text; technical detail only in server logs)
`TOKEN_EXPIRED`, `TOKEN_INVALID`, `FORBIDDEN`, `INVALID_SKU`, `INVALID_PAYLOAD`, `UPSTREAM_ERROR` (5xx), `TIMEOUT`, `NETWORK_ERROR`, `UNEXPECTED_RESPONSE`, `BUSY`, `LOGIN_REQUIRED`, `CSRF`, `RATE_LIMITED`.

## 7. Example requests / responses (internal API; all need a login session + `X-CSRF-Token`)

```http
POST /api/orders/create        {"count": 2}
-> 200 {"ok":true,"message":"2 of 2 order(s) created.","data":{"action":"create","outcome":"success",
        "created":2,"failed":0,"totalInvoicesSoFar":2,
        "results":[{"orderNumber":"QK2026110642","sku":"S1-RD-M","ok":true,"invoiceId":"..."}]},
        "auth":{"state":"valid","authenticated":true,"message":"Authenticated","expiresAt":"2027-02-05T13:25:15.000Z"}}

POST /api/orders/cancel        {"reference_code": "QK2026110642"}
-> 200 {"ok":true,"message":"Cancel request accepted for order QK2026110642.","data":{"action":"cancel","outcome":"success",
        "reference_code":"QK2026110642","response":{...EasyEcom response...}}}

POST /api/orders/ship          (token expired)
-> 401 {"ok":false,"code":"TOKEN_EXPIRED","message":"JWT Token Expired. Please Enter a New Token."}

POST /api/auth/token           {"token":"<new jwt>"}
-> 200 {"ok":true,"message":"Token updated. Order actions are enabled again.","auth":{"state":"valid",...}}
-> 401 {"ok":false,"code":"TOKEN_INVALID","message":"The API did not accept this JWT (HTTP 401). Please enter a valid token."}
```

## 8. Implementation decisions
- **Express 5 + EJS + express-session only** (3 dependencies). `.env` is loaded with Node's built-in loader.
- **Secrets**: only in `.env`/server memory; the CSP forbids inline scripts, so nothing secret can be templated into JS.
- **Sessions** use the in-memory store (fine for one process; use a shared store if you run several instances). Cookies are `HttpOnly` + `SameSite=Strict`; state-changing requests also need a CSRF token; login is throttled (5 failures / 15 min / IP) and compared in constant time.
- **Partial failures** return HTTP 200 with `outcome: success | partial | failed | nothing` so the UI can show details instead of a bare error.
- Real orders are affected by Shipped and Return, so both ask for confirmation.
