# Dé Pitch website

A static site (plain HTML, CSS and JavaScript) built from the Carrd export. It has no build step and no add-ons.

## Pages

| File | URL on Vercel |
|---|---|
| index.html | / |
| about.html | /about |
| cv-revamp.html | /cv-revamp |
| interview-prep.html | /interview-prep |
| recruitment.html | /recruitment |
| enterprise.html | /enterprise |
| free-consultation.html | /free-consultation |
| scoop.html | /scoop |
| contact.html | /contact |
| thank-you.html, youre-in.html | shown after a form is sent |
| privacy-policy.html, terms.html, refund-policy.html, cookie-policy.html | legal pages |
| 404.html | page not found |
| portal.html | /portal (the sign-in portal) |

Shared files: `assets/style.css` (design), `assets/app.js` (menu, forms, cookie banner, popup), `assets/images/`.

Old Carrd links still work. For example, `depitchhq.com/#cvrevamp` sends people to `/cv-revamp`.

## The portal (/portal)

Everyone uses one sign-in page, and each person sees a dashboard for their role:

- **Employees:** announcement bar, monthly earnings, payslips (any paid month), weekly reports, time-off and reimbursement requests, and their documents.
- **Clients:** talents placed, monthly payroll per talent, invoices, talent requests, talent reviews and removal requests, and documents.
- **People Ops (peopleops@depitchhq.com):** approves reports and requests, adds pay and marks it paid, creates and sends invoices, handles talent requests and removals, uploads documents and posts announcements.

There is no public sign-up. People Ops creates every account and shares a temporary password, and each person sets their own password the first time they sign in.

### Files
- `portal.html`, `assets/portal.js`, `assets/portal.css`: the portal pages
- `api/portal.js`: the server code. It runs as a Vercel function.
- `api/_lib/`: database and sign-in helpers
- `tools/portal-admin.mjs`: lets Claude push documents and announcements for you
- `tools/dev-server.mjs`: runs the site on your own computer for testing (optional)

### One-time portal setup in Vercel (after the first deploy)
1. **Add the database.** Go to your project → **Storage** → **Create Database** → **Neon** (free Postgres) → connect it to the project. Vercel adds `DATABASE_URL` for you.
2. **Add three secret values.** Go to **Settings → Environment Variables** and add these. Each should be a long random string, and you can use the ones in `vercel-env-values.txt`, which is saved next to this folder and is not part of the website.
   - `SESSION_SECRET`: signs people's sign-ins
   - `SETUP_KEY`: used once to create the People Ops account
   - `PORTAL_API_KEY`: lets Claude push documents and announcements
   - Optional: `SITE_URL` = `https://www.depitchhq.com`
3. **Redeploy.** Go to **Deployments**, open the ⋯ menu on the latest deployment and choose **Redeploy**.
4. **Create the People Ops account.** Open `/portal`. The first visit shows "Set up the portal". Enter the `SETUP_KEY` and choose a password. This creates the account for peopleops@depitchhq.com.
5. In the portal, add your **Clients** first, then add **People** (employees, client users and other admins).

### Email alerts to People Ops
Every report, request, talent request and removal also emails peopleops@depitchhq.com through FormSubmit. The first alert sends an **Activate** email to that inbox, and you need to click it once. To turn alerts off, add `NOTIFY_HR` = `off`.

### Letting Claude push documents and announcements
Claude runs these commands for you, with `PORTAL_URL` and `PORTAL_API_KEY` set:
```
node tools/portal-admin.mjs people
node tools/portal-admin.mjs announce "Salaries will be paid on the 28th" --to employees
node tools/portal-admin.mjs upload --email ada@example.com --title "Employment letter" --type "Employment letter" ./letter.pdf
node tools/portal-admin.mjs upload --client "Tmed Media" --title "Service agreement" --type Agreement ./agreement.pdf
```

### Limits
- Uploads can be up to 3 MB each (PDF, Word, Excel, CSV, PNG or JPG). Files are stored privately in the database, and each person can open only their own files.
- Payslips and invoices open as a printable page, where "Print / Save as PDF" makes the PDF.
- Weekly reports download as a CSV file in the same layout as your Excel template.
- Passwords are hashed, sessions last 12 hours, and an account locks for 15 minutes after 5 wrong passwords.

## Deploy to Vercel

**Option A: GitHub (recommended)**
1. Create a new GitHub repo and upload everything in this folder. Upload the folder's contents, not the folder itself.
2. In Vercel, click **Add New → Project** and import the repo.
3. Set Framework Preset to **Other**. Leave the Build Command and Output Directory empty. Vercel installs the one package in `package.json` automatically.
4. Click **Deploy**.

**Option B: Vercel CLI**
Open a terminal in this folder and run `npx vercel`. Run `npx vercel --prod` to go live.

**Custom domain:** in your Vercel project, go to Settings → Domains, add `depitchhq.com` and `www.depitchhq.com`, then update DNS at your domain registrar as Vercel shows you.

## Turn on the forms (one time)

After the site is live, submit any form yourself. FormSubmit will email office@depitchhq.com an **Activate Form** link. Click it, and from then on every form, including CV uploads, arrives in that inbox.

To use a different form service, change `formEndpoint` at the top of `assets/app.js`.

## Easy edits (top of assets/app.js)

- `formEndpoint`: where forms are sent
- `analyticsIds`: your Google tags. They load only after a visitor accepts cookies.
- `promoDelay`: how long before the 10%-off popup appears (set to 0 to turn it off)

To change wording, open the page's `.html` file, search for the sentence and edit it.

## What replaced the Carrd add-ons

| Old add-on | Now |
|---|---|
| Common Ninja services, reviews, FAQ | Built-in cards, review cards and accordion |
| Elfsight cookie consent | Built-in cookie banner |
| Elfsight blog | Scoop page with a sign-up form |
| Chatway live chat | Floating contact button (WhatsApp, email, phone) |
| EmailOctopus popup | Built-in 10%-off popup |
| Carrd forms | FormSubmit, which emails office@depitchhq.com |
