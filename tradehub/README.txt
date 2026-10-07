LOOP

Run it:    npm install     then     npm start     (open http://localhost:3000)
Settings:  copy .env.example to .env, fill it in, then run   npm run start:env   (Node 20.6 or newer)

FOLDERS
  server.js          the whole back end
  public/            the site: index.html, app.js, style.css, favicons
  public/legal/      Terms, Privacy, Refunds and shipping, Prohibited items (TEMPLATES, see below)
  data/db.json       all accounts, listings, orders and payments
  data/uploads/      listing photos
  data/backups/      automatic copy of db.json every hour, newest 168 kept (one week)
  data/logs/         payments.log: one line per money event
Back up the whole data/ folder somewhere else too (a second disk or cloud storage).

DATA SAVER (how your data stays safe)
  - Every change is written to a temp file and swapped in, so a crash can't leave half a file.
  - A backup is made every hour. If db.json is ever damaged, the server restores the newest good backup on start,
    keeps the damaged copy next to it, and refuses to start if there is no backup (so it never wipes your data).
  - Shutdown (Ctrl+C or a host restart) saves first.
  - This is fine to launch with. When you get busy, move to a real database like Postgres.

KNOWING WHEN A CARD GOES THROUGH
  There is no card reader to install. Cards are entered on Stripe's page, Stripe checks fraud and asks the bank, then
  Stripe sends your server a signed message (the webhook). The order only goes live when that message says "paid" for the
  right amount. Every step is written to data/logs/payments.log (payment.created, payment.paid, payment.declined,
  payment.blocked, payment.expired, order.refunded, payout.paid, payout.failed, webhook.rejected)
  and shown live on the Admin page.

ADMIN PAGE
  Run  npm run make-admin  once and put the two lines it prints (ADMIN_USERNAME and ADMIN_PASSWORD) in .env. That is your private admin
  login: sign in with it and an ADMIN badge and an Admin link appear. Only that one account is ever admin. Nobody can sign up with that
  username or with admin-like names (admin, support, staff, loop...). Five wrong passwords from one place locks that place out of the account
  for 15 minutes. Keep the password in a password manager. If you change ADMIN_PASSWORD and restart, the new one replaces the old and all
  old admin sign-ins are logged out. If you change ADMIN_USERNAME, the old account loses admin. (ADMIN_USERNAMES from older versions is gone,
  because anyone could register that name first.) The Admin page shows payments, orders, failed payouts, listings and the
  payment log, and lets you cancel and refund an order, retry a failed payout, or remove a listing.

ACCOUNTS AND EMAIL
  Signup needs an email, being 18+, and agreeing to the Terms. A confirmation email goes out, and in production people must confirm
  before they can buy or list. "Forgot your password?" sends a reset link that works for one hour.
  Emails are sent with Resend (resend.com): make an account, verify your domain, set RESEND_API_KEY and MAIL_FROM.
  Without those (local testing) the emails are printed in the terminal instead.

HOW MONEY MOVES
  1. Buyer checks out. The order is held (stock reserved 30 minutes) until Stripe says the card was paid.
  2. Paid: the order goes live for the seller. Cancelled before shipping: full refund and the stock goes back.
  3. Fee: 9% of the item price for items under $100, 13% for items at $100 or more (FEE_LOW_PERCENT, FEE_HIGH_PERCENT,
     FEE_THRESHOLD). The fee is saved on each order when it is placed, so changing it later does not touch orders already placed.
     If you change the numbers, change them in public/legal/terms.html too.
  4. Payout: 14 days after the buyer paid (PAYOUT_DAYS), and only if the order has shipped, the seller is paid through
     Stripe Connect: sale price minus the fee. A paid-but-unshipped order waits, and you can refund it from the Admin page.
     Each payout has an idempotency key so it cannot double-pay. Buyers tapping "Mark as received" does not speed it up.
  5. You pay Stripe's processing fees, and refunds and chargebacks come out of your Stripe balance. Card disputes can arrive
     weeks after the 14 days, so keep some money in your Stripe balance.

THE LOOP DISCOUNT (HIDDEN FROM BUYERS)
  Items priced at DEAL_MIN_PRICE ($200) or more are quietly sold for DEAL_OFF ($100) less. There is no banner, tag or "discount"
  wording for buyers: the lower price is simply the price they see and pay. The buyer pages and the public listing data only
  contain the price the buyer pays. Sellers are told on their own pages (their item page, the sell form, their orders) and
  in the Terms that Loop may lower buyers' prices with its own money, because it is their listing and their payout.
  LOOP pays the discount, not the seller: a seller lists at $500, the buyer pays $400, the seller is still paid $500 minus the fee.
  That costs you real money. Example at the 13% fee: the buyer pays $400, Stripe's card fee is about $12, the seller is paid
  $435, so you are about $47 down on that sale. It only breaks even around $1,000 items. The $100 you give away is paid out
  of your own Stripe balance, so keep money in it or seller payouts will fail (they retry every hour).
  DEAL_BUDGET is a safety brake: once that many dollars of discounts have been given, the discount switches off by itself.
  The Admin page shows how much has been used. Raise the budget, lower DEAL_OFF, or set DEAL_OFF=0 to stop it.
  Items under DEAL_MIN_PRICE get no discount, because $100 off a $60 item would be free.

DELIVERY TIMER, FOOTER AND INFO PAGES
  Orders show a live countdown instead of status words: "Seller ships within" (SHIP_DAYS after payment), then "Arrives in" and
  the estimated delivery date. Set ORS_API_KEY to enable road-distance estimates, using seller and buyer U.S. ZIP codes plus current
  National Weather Service alerts along the route. Without a key or usable U.S. ZIP codes, the seller's selected number of days is used.
  Transit time is a rough estimate (500 road miles per day); alerts and estimates do not come from the selected carrier. Buyers should
  use tracking for carrier updates. Add OPEN_METEO_API_KEY if required for commercial ZIP geocoding, and set NWS_USER_AGENT with a
  contact address.
  The footer has four columns (Get to Know Us, Make Money with Us, Loop Payments, Let Us Help You) and every link opens a real page.
  Pages live in public/info/ and public/legal/. Search them for [SUPPORT EMAIL], [COMPANY NAME] and [ADDRESS] and fill those in.
  The pages quote the fees (9% / 13%) and the 14-day payout. If you change the settings, edit public/info/about.html,
  seller-fees.html, seller-guide.html, help.html and public/legal/terms.html to match.
  Newsletter signups are stored in db.json and shown on the Admin page. Nothing sends newsletters yet.

SNAP & SELL (PHOTO TO LISTING)
  The Snap & Sell page: snap a photo, type a price, post. The photo is shrunk in the browser, then the server asks Claude (Anthropic API,
  ANTHROPIC_API_KEY, model AI_MODEL) to read it and write a title, description, category and condition. If REMOVEBG_API_KEY is set,
  remove.bg also swaps the background for clean white. The seller sees the draft and can edit it before posting.
  It is not magic: the AI only names a brand or model when it can see it, and says what to double-check. Sellers are responsible
  for what they post (the Terms say so). Banned items (weapons, counterfeits and so on) are refused before the photo is saved.
  Costs: every photo is one paid AI call (about a cent or two) plus one remove.bg credit if you turned that on. SNAP_DAILY_LIMIT caps
  one person per day and SNAP_GLOBAL_DAILY caps the whole site per day. The Admin page shows how many were used today.
  With no keys the Sell page still works: it just shows the details boxes for typing. The Sell page is the normal form; Snap & Sell is its own page at /#/snap (linked in the top bar).
  Photos go to Anthropic and remove.bg, and the Privacy page says so.

REFUNDS
  Every refund needs a written reason (at least a few words). The buyer always gets the FULL amount they paid back.
  Buyer: can cancel until the order ships. Seller: can refund before shipping and after shipping until the seller has been paid.
  Admin: can refund any paid order from the Admin page. If the seller was already paid, the buyer is still refunded and LOOP covers
  the loss (the seller keeps the money; pull it back by hand in the Stripe dashboard if you want it).
  Loop sends the refund to Stripe immediately and emails the buyer the amount and reason. How fast it shows in the buyer's bank is up
  to the bank: Stripe says 5 to 10 business days. It is NOT a few hours, and the site never promises that.
  Stripe keeps its original card fee on refunded payments, and a refund can sit "pending" if your Stripe balance is too low to cover it.
  Every refund is written to data/logs/payments.log with the reason and who did it.

GO LIVE CHECKLIST
  1. Stripe Dashboard: activate your account, then turn on Connect and finish the platform profile.
  2. Stripe > Developers > Webhooks: add  https://YOUR-DOMAIN/api/stripe/webhook  with the events
     checkout.session.completed and checkout.session.expired. Copy the signing secret (whsec_...).
  3. Resend: verify your sending domain and make an API key.
  4. Host it somewhere with HTTPS and a disk that survives restarts (it must keep the data/ folder). Keep it running with a
     process manager (pm2, or your host's own). Point an uptime monitor at https://YOUR-DOMAIN/health.
  5. Fill in .env (see .env.example). In production the server refuses to start without live Stripe keys, an https BASE_URL,
     and email settings, so demo payments can never run on the public site.
  6. Fill in the [BRACKETS] in public/legal/*.html and have a lawyer read them. They are templates, not legal advice.
  7. Your first real run: start once with PAYOUT_DAYS=0 so the payout happens right after shipping. Make three accounts (you as admin,
     a seller, a buyer). Seller: Payouts, real bank details on Stripe's page. List a $1 item, buy it with your own card, ship it, wait a
     minute, and check the transfer in Stripe. Then cancel and refund another. Then set PAYOUT_DAYS back to 14 and restart.

Without NODE_ENV=production and keys the site runs in DEMO MODE with test cards (4242 4242 4242 4242 approved,
4000 0000 0000 0002 declined, 4100 0000 0000 0019 fraud-blocked). No money moves in demo mode.

NOT BUILT YET
  Sales tax collection, a real database (Postgres), photos in cloud storage, seller ratings and reviews, messaging between
  buyer and seller, and a form for card entry inside your own page (Stripe's hosted page is used instead: safer and less to maintain).
