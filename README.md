<<<<<<< HEAD
# MSME Origination Toolkit

An academic prototype built for MBA coursework in Microfinance & Banking. It
simulates how a bank Relationship Manager (RM) and an MSME customer would
jointly move a loan application through the origination pipeline — from
first data capture through document collection, financial analysis, credit
assessment, RBI-repo-linked pricing, and a final origination recommendation.

**This is a frontend-only simulation.** There is no real backend, no real
database, no real credit bureau connection and no real money movement.
Every score, rate and eligible amount the app produces is an illustrative,
rule-based calculation meant to demonstrate *how* a bank's origination
logic works conceptually — not a validated credit model.

---

## Project structure

```
MSME-Origination-Toolkit/
│
├── index.html              → entry point: page shell, loads css/ and js/
├── css/
│   └── styles.css          → all visual styling, incl. mobile breakpoints
├── js/
│   ├── dummy-data.js       → static reference data (Udyam slabs, bank segments,
│   │                         RBI repo rate, document checklist, nav items...)
│   ├── calculations.js     → pure business-logic functions (credit score,
│   │                         DSCR, eligibility, RBI-linked pricing, Udyam
│   │                         classification, AI insights text generation)
│   └── app.js              → state, persistence (localStorage + optional
│                              Firebase), auth, and every screen's render
│                              logic + event handlers. Boots the app at
│                              the bottom of the file.
├── assets/                 → reserved for future images/icons (currently
│                              empty — all icons today are emoji + CSS)
├── .gitignore
└── README.md                → you are here
```

Load order in `index.html` matters: `dummy-data.js` and `calculations.js`
declare constants/functions that `app.js` depends on. All three are classic
(non-module) scripts sharing one global scope, so keep this order if you
add more files.

## Running it locally

No build step, no dependencies, no server required:

1. Open `index.html` directly in a browser, **or**
2. Serve the folder with any static server, e.g. `npx serve .` or Python's
   `python3 -m http.server`, and open the printed localhost URL.

## Demo login credentials

Login is fully simulated — **any** username/password is accepted, nothing
is transmitted anywhere. These are just the values used consistently across
the project's documentation:

| Role | Username | Password |
|---|---|---|
| Relationship Manager | `rm.priya` | `Demo@123` |
| Customer | `9876543210` | `Demo@123` |

The Customer Login tab only shows a business to select once an RM has
created at least one application.

## Data storage

- **Default:** everything is saved to the browser's `localStorage` — works
  immediately with zero setup, but stays private to that one browser.
- **Optional:** connect a free Firebase Firestore project from the **Cloud
  Storage** page in the RM workstation so multiple people opening the same
  hosted link see shared data. Disconnecting reverts to local-only storage
  with no data loss.

## RBI Repo Rate

The RBI does not publish a public, CORS-enabled API a static browser page
can call directly, so the Repo Rate is treated as an externally-sourced,
RM-editable benchmark (`RBI_REPO_RATE` in `js/dummy-data.js`) rather than a
live feed. Update it from the **Loan Eligibility** page whenever the RBI's
Monetary Policy Committee announces a change — every application's pricing
recalculates instantly.

## Deploying (frontend only)

Because this is fully static, it deploys to **Netlify** with zero
configuration:

- **Fastest:** drag-and-drop this folder (or a zip of it) onto Netlify's
  "Deploy manually" screen for an instant `.netlify.app` URL.
- **Recommended for a group project:** push this repo to GitHub and use
  Netlify's "Import an existing project" so every push auto-redeploys.

No build command or environment variables are needed — the publish
directory is the folder containing `index.html`.

---

## Roadmap: from frontend prototype to a real backend

This repository is meant to be developed in stages, not all at once:

1. **Finish the frontend** — confirm every screen, navigation path,
   calculation and the demo data flow works end-to-end. *(current stage)*
2. **Push this stable version to GitHub** as the `v1.0-frontend` baseline.
3. **Get faculty/professor review and approval** on that baseline before
   writing any backend code.
4. **Build the backend in a separate branch**, keeping `main` as the
   approved/stable frontend and doing all backend integration work in a
   `backend-development` branch:
   - `main` → approved/stable frontend
   - `backend-development` → backend integration
5. **Gradually replace the static data with a real backend**, in this
   order: `Dummy/static data → API → Database → Real/Anonymized data`.
   Concretely, that mostly means replacing the constants in
   `js/dummy-data.js` with `fetch()` calls to your new API, one dataset at
   a time, while `js/calculations.js` and the rendering logic in
   `js/app.js` stay largely unchanged.

### Before pushing to GitHub — important

**Never commit** real student/borrower data, passwords, API keys, Supabase
or Firebase service credentials, or `.env` files. The `.gitignore` in this
repo already excludes the common cases — double-check before every push,
especially once a real backend and real credentials exist.

## Known limitations (disclose these in your report/viva)

- All credit scoring, eligibility and pricing logic is illustrative and
  rule-based — not a validated statistical credit model.
- The RBI Repo Rate is a manually-refreshed benchmark, not a live feed.
- Cloud storage is optional and requires your own free Firebase project;
  without it, data lives only in the browser that created it.
- Login has no real authentication, encryption, or backend — never use it
  with real customer data or real credentials.
=======
# MSME
>>>>>>> 61be53ecbd0ec78b6a01d955b3d3ed33527c39a2
