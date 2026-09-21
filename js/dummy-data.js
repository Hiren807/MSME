/* =========================================================================
   dummy-data.js
   -------------------------------------------------------------------------
   Static reference/configuration data for the MSME Origination Toolkit
   prototype: MSME classification slabs, bank ticket-size segments, the
   RBI Repo Rate benchmark + bank-spread components, document checklists,
   pipeline stages, loan product mapping and sidebar navigation.

   MIGRATION NOTE (per the frontend -> backend roadmap): everything in
   this file is exactly the kind of configuration that should eventually
   be served from an admin-managed database/API instead of being
   hardcoded here. When wiring up the backend, replace these constants
   with fetch() calls to your API and keep the rest of the app unchanged.
   ========================================================================= */

const RM = { name:"Priya Deshmukh", role:"MSME Relationship Manager", branch:"Andheri (E) Branch, Mumbai", initials:"PD" };
// Baked in deliberately: these Firebase config values are not secret credentials —
// access is governed by Firestore Security Rules and Firebase Auth on the project
// itself, not by hiding this object. Baking it in means the app has a real,
// working cloud backend (Firestore + Firebase Authentication) the moment it loads,
// with no manual "paste your config" step required.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBVny-ZC05YNv3Vw_Iv4fjUxMw8N2aKWXA",
  authDomain: "msme-toolkit-demo.firebaseapp.com",
  projectId: "msme-toolkit-demo",
  storageBucket: "msme-toolkit-demo.firebasestorage.app",
  messagingSenderId: "39872321784",
  appId: "1:39872321784:web:ded7c28d1e13a99ad7830d"
};

/* ===================== MSME CLASSIFICATION (Udyam, revised w.e.f. 01-Apr-2025) ===================== */
// Composite criteria: investment in plant & machinery/equipment AND annual turnover.
// Per Notification S.O. 1364(E) dated 21-Mar-2025 (Union Budget 2025-26 revision).
const MSME_SLABS = [
  { type:"Micro",  maxInvestment:25000000,   maxTurnover:100000000,   loanCap:5000000 },    // ≤₹2.5 Cr / ≤₹10 Cr
  { type:"Small",  maxInvestment:250000000,  maxTurnover:1000000000,  loanCap:50000000 },   // ≤₹25 Cr / ≤₹100 Cr
  { type:"Medium", maxInvestment:1250000000, maxTurnover:5000000000,  loanCap:100000000 }   // ≤₹125 Cr / ≤₹500 Cr
];
const BANK_SEGMENTS = [
  { segment:"Nano / Very Small Business", minTicket:100000, maxTicket:500000, category:"Micro", purpose:"Inventory, small equipment, business expansion", products:"Micro Business Loan, OD, Small Term Loan", tenure:"1–5 years", assessment:"Banking, GST, bureau, cash flow, promoter" },
  { segment:"Micro Enterprise", minTicket:500000, maxTicket:2000000, category:"Micro", purpose:"Working capital, machinery, expansion", products:"Cash Credit, Term Loan, Composite Loan", tenure:"1–5 years", assessment:"Banking, GST, DSCR, bureau, WC" },
  { segment:"Micro / Small Enterprise", minTicket:2000000, maxTicket:5000000, category:"Micro or Small", purpose:"Machinery, WC, expansion", products:"Term Loan + WC, Equipment Finance", tenure:"2–7 years", assessment:"Financials, DSCR, leverage, WC" },
  { segment:"Small Enterprise – Growth", minTicket:5000000, maxTicket:20000000, category:"Small", purpose:"Capex, working capital, expansion", products:"Term Loan, CC, OD, Invoice Finance", tenure:"3–7 years", assessment:"Financials, cash flow, DSCR, concentration" },
  { segment:"Established Small Enterprise", minTicket:20000000, maxTicket:100000000, category:"Small", purpose:"Capacity expansion, plant & machinery, WC", products:"Term Loan, CC, Supply Chain Finance", tenure:"3–10 years", assessment:"Financials, leverage, DSCR, industry, resilience" },
  { segment:"Medium Enterprise", minTicket:100000000, maxTicket:250000000, category:"Medium", purpose:"Expansion, project finance, large WC", products:"Project Loan, WC, Structured Finance", tenure:"5–10 years", assessment:"CFADS, DSCR, leverage, industry, stress tests" },
  { segment:"Upper SME / Larger Mid-Market", minTicket:250000000, maxTicket:500000000, category:"Small or Medium", purpose:"Large capex, structured WC, expansion", products:"Project Finance, Structured Lending, WC", tenure:"5–12 years", assessment:"Detailed CFADS, leverage, concentration, stress testing" },
  { segment:"Outside MSME", minTicket:500000000, maxTicket:Infinity, category:"Depends on criteria", purpose:"Large corporate/project requirements", products:"Corporate/Structured Finance", tenure:"Case-specific", assessment:"Corporate credit framework" }
];
let RBI_REPO_RATE = 5.25; // % p.a. — matches RBI MPC rate as of the last update below
let RBI_REPO_LAST_UPDATED = "2025-12-05"; // date of the last MPC decision this figure reflects

// Bank Spread components, per the toolkit's Bank Spread formula:
// Bank Spread = Funding/Cost adjustment + Operating Cost + Credit Risk Premium (PD*LGD*EAD/Loan)
//   + Tenor/Liquidity Premium + Capital Charge + Profit Margin – Risk Mitigants
// Final Lending Rate = External Benchmark (Repo Rate) + Bank Spread
const SPREAD_COMPONENTS = {
  fundingCostAdj: 1.25,      // cost of funds adjustment over repo
  operatingCost: 1.50,       // branch/RM/underwriting/KYC/monitoring cost load
  capitalCharge: 0.75,       // regulatory/economic capital allocation
  profitMargin: 1.00         // target bank margin
};
const PD_BY_RISK = { "Low Risk":0.015, "Moderate Risk":0.035, "High Risk":0.08 };  // Probability of Default
const LGD_BY_LOANTYPE = { "Secured":0.35, "Unsecured":0.65 };                     // Loss Given Default
const RATE_TYPE_ADJ = { "Fixed":0.5, "Floating":0 };
const SUBSIDY_SCHEMES = {
  "None": null,
  "CGTMSE (Credit Guarantee)": "Collateral-free guarantee cover; no direct rate subsidy, but improves eligibility for unsecured limits.",
  "PMEGP (Margin Money Subsidy)": "15–35% capital subsidy on project cost for new units, routed through the bank.",
  "CLCSS (Technology Upgradation)": "15% capital subsidy (capped) on institutional finance for approved plant & machinery.",
  "Interest Subvention Scheme": "2% p.a. interest subvention on incremental credit for eligible MSME borrowers."
};

const DOC_LIST = [
  {key:"PAN", label:"PAN card", desc:"Permanent Account Number of the business/owner", ico:"PAN"},
  {key:"GST", label:"GST certificate", desc:"Goods & Services Tax registration certificate", ico:"GST"},
  {key:"UDYAM", label:"Udyam registration", desc:"MSME Udyam registration certificate", ico:"UDY"},
  {key:"ITR", label:"ITR (last 2 years)", desc:"Income tax returns of the business", ico:"ITR"},
  {key:"BANKSTMT", label:"Bank statement (12M)", desc:"Last 12 months current account statement", ico:"BNK"},
  {key:"FINSTMT", label:"Financial statements", desc:"Audited/provisional P&L and balance sheet", ico:"FIN"},
  {key:"BIZREG", label:"Business registration certificate", desc:"Partnership deed / COI / Shop Act license", ico:"REG"},
  {key:"ADDRESS", label:"Address proof", desc:"Business premises address proof / utility bill", ico:"ADR"}
];
const DOC_WEIGHT = { "Pending":0, "Uploaded":0.5, "Under Verification":0.75, "Verified":1 };
const DOC_NEXT = { "Pending":"Uploaded", "Uploaded":"Under Verification", "Under Verification":"Verified", "Verified":"Verified" };
const DOC_ACTION_LABEL = { "Pending":"Upload Document", "Uploaded":"Send for Verification", "Under Verification":"Mark Verified", "Verified":"Verified" };

const STAGES = ["New","Documents Pending","Documents Verified","Financial Analysis","Credit Assessment","Recommended","Approved","Rejected","Disbursed"];

const PRODUCT_MAP = {
  "Working Capital": {name:"MSME Working Capital Facility", why:"Provides a revolving cash-credit / overdraft limit to fund day-to-day operations, inventory and receivables cycles."},
  "Machinery Purchase": {name:"MSME Term Loan", why:"A fixed-tenure term loan structured to match the useful life and cash flows generated by new machinery/equipment."},
  "Business Expansion": {name:"MSME Business Expansion Loan", why:"Longer-tenure funding designed for capacity addition, new premises or market expansion."},
  "Inventory Purchase": {name:"MSME Working Capital Facility", why:"Short-term funding aligned to the inventory holding and conversion cycle."},
  "Commercial Vehicle": {name:"Commercial Vehicle Finance", why:"Asset-backed financing secured against the commercial vehicle, with tenure matched to the asset life."},
  "Other": {name:"MSME Term Loan", why:"A flexible general-purpose term loan suited to varied business funding needs."}
};
const PURPOSE_DEFAULT_TENURE = { "Working Capital":3, "Machinery Purchase":5, "Business Expansion":7, "Inventory Purchase":2, "Commercial Vehicle":5, "Other":4 };

const FIN_FIELDS = [
  {key:"curRevenue", label:"Current year revenue (&#8377;)"},
  {key:"prevRevenue", label:"Previous year revenue (&#8377;)"},
  {key:"curProfit", label:"Current year profit (&#8377;)"},
  {key:"prevProfit", label:"Previous year profit (&#8377;)"},
  {key:"currentAssets", label:"Current assets (&#8377;)"},
  {key:"currentLiabilities", label:"Current liabilities (&#8377;)"},
  {key:"totalDebt", label:"Total debt (&#8377;)"},
  {key:"equity", label:"Equity (&#8377;)"},
  {key:"annualDebtObligation", label:"Annual debt obligation (&#8377;)"},
  {key:"cashFlow", label:"Cash flow available for debt service (&#8377;)"}
];

const NAV_ITEMS = [
  {view:"dashboard", label:"Dashboard", ico:"home", group:"pipeline", roles:["rm"]},
  {view:"tracking", label:"Application tracking", ico:"list", group:"pipeline", roles:["rm"]},
  {view:"newapp", label:"New application", ico:"plus", group:"pipeline", roles:["rm"]},
  {view:"profile", label:"Customer profile", ico:"user", group:"file", needsApp:true, roles:["rm","customer"]},
  {view:"documents", label:"Documents", ico:"folder", group:"file", needsApp:true, roles:["rm","customer"]},
  {view:"financials", label:"Financial analysis", ico:"chart", group:"file", needsApp:true, roles:["rm"]},
  {view:"credit", label:"Credit assessment", ico:"gauge", group:"file", needsApp:true, roles:["rm"]},
  {view:"eligibility", label:"Eligibility & pricing", ico:"calc", group:"file", needsApp:true, roles:["rm","customer"]},
  {view:"aiinsights", label:"AI business insights", ico:"note", group:"file", needsApp:true, roles:["rm"]},
  {view:"recommendation", label:"Loan recommendation", ico:"target", group:"file", needsApp:true, roles:["rm","customer"]},
  {view:"decision", label:"Decision", ico:"check", group:"file", needsApp:true, roles:["rm","customer"]},
  {view:"cloudsettings", label:"Cloud storage", ico:"cloud", group:"settings", roles:["rm"]}
];

/* ===================== SHELL RENDER ===================== */

