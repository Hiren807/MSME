/* =========================================================================
   calculations.js
   -------------------------------------------------------------------------
   Pure business-logic / calculation functions: Udyam MSME classification,
   RBI-repo-linked bank spread & final lending rate, financial ratio
   analysis, the weighted credit score and risk categorisation, EMI and
   loan eligibility maths, and the rule-based AI Business Insights /
   Recommendation text generators.

   These functions take plain data in and return plain data/strings out —
   none of them touch the DOM or application state directly, which is what
   makes this file the natural home for unit tests once the project
   moves into backend development.
   ========================================================================= */

function classifyMSME(investment, turnover){
  investment = Number(investment)||0; turnover = Number(turnover)||0;
  for(const slab of MSME_SLABS){
    if(investment<=slab.maxInvestment && turnover<=slab.maxTurnover) return slab.type;
  }
  return "Above MSME Threshold";
}
function msmeSlab(type){ return MSME_SLABS.find(s=>s.type===type); }
function msmeLoanCap(type){ const s=msmeSlab(type); return s ? s.loanCap : null; }

/* Bank Segment table (ticket-size based) — reference data for product/tenure guidance */
function bankSegmentFor(ticketSize){
  return BANK_SEGMENTS.find(s=> ticketSize>=s.minTicket && ticketSize<=s.maxTicket) || BANK_SEGMENTS[BANK_SEGMENTS.length-1];
}

/* ===================== RBI-LINKED PRICING ENGINE ===================== */
// No official free public API is exposed by RBI for the Repo Rate, so a static HTML/JS
// prototype cannot call rbi.org.in directly from the browser (no public CORS-enabled
// endpoint exists). This value is therefore a manually-refreshable "external benchmark"
// input — RMs can update it here when the MPC changes the rate — everything downstream
// (indicative pricing) recalculates automatically off this single figure.
function creditRiskPremium(app, cs){
  const pd = PD_BY_RISK[cs.risk] || 0.05;
  const lgd = LGD_BY_LOANTYPE[app.loanType] || 0.5;
  const ead = app.loan.amount; // Exposure at Default ≈ sanctioned amount
  const expectedLoss = pd*lgd*ead;
  return (expectedLoss/ead)*100; // CRP as a % of loan
}
function tenorLiquidityPremium(tenureYears){
  if(tenureYears<=2) return 0.15;
  if(tenureYears<=5) return 0.40;
  if(tenureYears<=7) return 0.65;
  return 0.90;
}
function riskMitigantsDiscount(app){
  let discount = 0;
  if(app.loanType==="Secured") discount += 0.50;
  if(app.subsidyScheme==="CGTMSE (Credit Guarantee)") discount += 0.25;
  return discount;
}
function bankSpreadBreakup(app){
  const cs = calcCreditScore(app);
  const crp = creditRiskPremium(app, cs);
  const tlp = tenorLiquidityPremium(app.loan.tenure);
  const mitigants = riskMitigantsDiscount(app);
  const total = SPREAD_COMPONENTS.fundingCostAdj + SPREAD_COMPONENTS.operatingCost + crp + tlp + SPREAD_COMPONENTS.capitalCharge + SPREAD_COMPONENTS.profitMargin - mitigants;
  return {
    fundingCostAdj: SPREAD_COMPONENTS.fundingCostAdj,
    operatingCost: SPREAD_COMPONENTS.operatingCost,
    creditRiskPremium: +crp.toFixed(3),
    tenorLiquidityPremium: tlp,
    capitalCharge: SPREAD_COMPONENTS.capitalCharge,
    profitMargin: SPREAD_COMPONENTS.profitMargin,
    riskMitigants: mitigants,
    totalSpread: +total.toFixed(3)
  };
}
function finalLendingRate(app){
  const spread = bankSpreadBreakup(app);
  const rateTypeAdj = RATE_TYPE_ADJ[app.interestRateType] !== undefined ? RATE_TYPE_ADJ[app.interestRateType] : 0;
  return { repoRate: RBI_REPO_RATE, spread, rate: +(RBI_REPO_RATE + spread.totalSpread + rateTypeAdj).toFixed(2) };
}
function fmtINR(n){
  if(n===null||n===undefined||isNaN(n)) return "-";
  const r = Math.round(n);
  return "₹" + r.toLocaleString("en-IN");
}
function fmtNum(n, d){ if(n===null||n===undefined||isNaN(n)) return "-"; return Number(n).toFixed(d===undefined?1:d); }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function msmeTypeOf(app){ return classifyMSME(app.investmentPlantMachinery, app.fin.curRevenue); }
function loanCapCheck(app){
  const type = msmeTypeOf(app);
  const cap = msmeLoanCap(type);
  if(cap===null) return { type, cap:null, withinCap:true };
  return { type, cap, withinCap: app.loan.amount <= cap };
}
function financialDataQuality(fin){
  const issues = [];
  const curRevenue = Number(fin.curRevenue)||0;
  const prevRevenue = Number(fin.prevRevenue)||0;
  const curProfit = Number(fin.curProfit)||0;
  const prevProfit = Number(fin.prevProfit)||0;
  const currentAssets = Number(fin.currentAssets)||0;
  const currentLiabilities = Number(fin.currentLiabilities)||0;
  const totalDebt = Number(fin.totalDebt)||0;
  const equity = Number(fin.equity)||0;
  const annualDebtObligation = Number(fin.annualDebtObligation)||0;
  const cashFlow = Number(fin.cashFlow)||0;

  if(curRevenue<=0) issues.push("Current-year revenue must be greater than ₹0.");
  if(prevRevenue<0) issues.push("Previous-year revenue cannot be negative.");
  if(curProfit<0) issues.push("Current-year net profit is negative; the analysis will treat this as a loss.");
  if(prevProfit<0) issues.push("Previous-year net profit is negative; profit growth is not interpreted as a normal percentage.");
  if(curRevenue>0 && curProfit>curRevenue) issues.push("Current-year net profit is greater than revenue; check the entered figures.");
  if(prevRevenue>0 && prevProfit>prevRevenue) issues.push("Previous-year net profit is greater than revenue; check the entered figures.");
  if(currentAssets<0 || currentLiabilities<0) issues.push("Current assets and current liabilities should not be negative.");
  if(totalDebt<0) issues.push("Total debt cannot be negative.");
  if(equity<=0) issues.push("Positive equity is required to calculate a meaningful debt-to-equity ratio.");
  if(annualDebtObligation<0) issues.push("Annual debt obligation cannot be negative.");
  if(cashFlow<0) issues.push("Cash flow available for debt service is negative; this indicates a cash shortfall rather than normal repayment capacity.");

  return { valid: issues.filter(i => !i.startsWith("Current-year net profit is negative") && !i.startsWith("Previous-year net profit is negative") && !i.startsWith("Cash flow available for debt service is negative")).length===0, issues };
}

function calcRatios(fin){
  const curRevenue = Number(fin.curRevenue)||0;
  const prevRevenue = Number(fin.prevRevenue)||0;
  const curProfit = Number(fin.curProfit)||0;
  const prevProfit = Number(fin.prevProfit)||0;
  const currentAssets = Number(fin.currentAssets)||0;
  const currentLiabilities = Number(fin.currentLiabilities)||0;
  const totalDebt = Number(fin.totalDebt)||0;
  const equity = Number(fin.equity)||0;
  const annualDebtObligation = Number(fin.annualDebtObligation)||0;
  const cashFlow = Number(fin.cashFlow)||0;

  const revenueGrowth = prevRevenue>0 && curRevenue>=0 ? ((curRevenue-prevRevenue)/prevRevenue)*100 : null;
  const revenueBasedInputsSane = curRevenue>0 && curProfit<=curRevenue;
  const profitMargin = revenueBasedInputsSane ? (curProfit/curRevenue)*100 : null;
  const profitGrowth = prevProfit>0 && curProfit>=0 && prevProfit<=prevRevenue ? ((curProfit-prevProfit)/prevProfit)*100 : null;
  const currentRatio = currentLiabilities>0 ? (currentAssets/currentLiabilities) : null;
  const debtEquity = equity>0 ? (totalDebt/equity) : null;
  const dscr = annualDebtObligation>0 ? (cashFlow/annualDebtObligation) : null;
  const workingCapital = currentAssets-currentLiabilities;
  const cashFlowMargin = revenueBasedInputsSane ? (cashFlow/curRevenue)*100 : null;
  const dataQuality = financialDataQuality(fin);

  return { revenueGrowth, profitMargin, profitGrowth, currentRatio, debtEquity, dscr, workingCapital, cashFlowMargin, dataQuality };
}

function interpretRatio(key, val){
  if(val===null || val===undefined || Number.isNaN(Number(val))){
    const missing = {
      revenueGrowth:"N/A — previous-year revenue is required",
      profitMargin:"N/A — current-year revenue is required",
      currentRatio:"N/A — current liabilities are required",
      debtEquity:"N/A — positive equity is required",
      dscr:"N/A — annual debt service is required"
    };
    return {tag:missing[key] || "N/A", tone:"warn"};
  }
  switch(key){
    case "revenueGrowth":
      if(val>=15) return {tag:"Strong growth momentum", tone:"good"};
      if(val>=5) return {tag:"Steady, moderate growth", tone:"ok"};
      if(val>=0) return {tag:"Flat / slow growth", tone:"warn"};
      return {tag:"Declining revenue trend", tone:"bad"};
    case "profitMargin":
      if(val>=15) return {tag:"Strong profitability", tone:"good"};
      if(val>=8) return {tag:"Healthy profitability", tone:"good"};
      if(val>=4) return {tag:"Moderate profitability", tone:"ok"};
      if(val>0) return {tag:"Thin profitability", tone:"warn"};
      return {tag:"Loss / no profit", tone:"bad"};
    case "currentRatio":
      if(val>=1.5) return {tag:"Good short-term liquidity", tone:"good"};
      if(val>=1.1) return {tag:"Adequate liquidity", tone:"ok"};
      if(val>=0.9) return {tag:"Tight liquidity", tone:"warn"};
      return {tag:"Weak liquidity position", tone:"bad"};
    case "debtEquity":
      if(val===0) return {tag:"No reported debt", tone:"good"};
      if(val<=0.75) return {tag:"Conservative leverage", tone:"good"};
      if(val<=1.25) return {tag:"Moderate leverage", tone:"ok"};
      if(val<=2) return {tag:"Elevated leverage", tone:"warn"};
      return {tag:"High leverage", tone:"bad"};
    case "dscr":
      if(val>=1.5) return {tag:"Comfortable debt repayment capacity", tone:"good"};
      if(val>=1.2) return {tag:"Adequate repayment capacity", tone:"ok"};
      if(val>=1) return {tag:"Tight repayment coverage", tone:"warn"};
      return {tag:"Insufficient repayment coverage", tone:"bad"};
  }
  return {tag:"-", tone:"ok"};
}

function financialHealth(r){
  if(!r.dataQuality.valid || r.revenueGrowth===null || r.profitMargin===null || r.currentRatio===null || r.debtEquity===null){
    return "Incomplete Data";
  }
  let score = 0;
  let maxScore = 0;
  score += r.revenueGrowth>=10 ? 2 : (r.revenueGrowth>=0 ? 1 : 0); maxScore += 2;
  score += r.profitMargin>=12 ? 2 : (r.profitMargin>=6 ? 1 : 0); maxScore += 2;
  score += r.currentRatio>=1.4 ? 2 : (r.currentRatio>=1.1 ? 1 : 0); maxScore += 2;
  score += r.debtEquity<=1 ? 2 : (r.debtEquity<=1.75 ? 1 : 0); maxScore += 2;
  if(r.dscr!==null){
    score += r.dscr>=1.4 ? 2 : (r.dscr>=1.1 ? 1 : 0);
    maxScore += 2;
  }
  const ratio = score/maxScore;
  if(ratio>=0.80) return "Excellent";
  if(ratio>=0.60) return "Good";
  if(ratio>=0.40) return "Moderate";
  return "Weak";
}

function financialDataQualityTone(r){
  if(r.dataQuality.valid && r.revenueGrowth!==null && r.profitMargin!==null && r.currentRatio!==null && r.debtEquity!==null && r.dscr!==null) return "good";
  return "warn";
}

function debtScoreFromDE(de){
  if(de<=0.5) return 10;
  if(de<=1) return 8;
  if(de<=1.5) return 6;
  if(de<=2) return 4;
  if(de<=3) return 2;
  return 0;
}

function calcCreditScore(app){
  const r = calcRatios(app.fin);
  const creditHistory = clamp(app.creditInputs.creditHistory,0,25);
  const revenueGrowthScore = r.revenueGrowth===null ? 0 : clamp(r.revenueGrowth,0,20);
  const profitabilityScore = r.profitMargin===null ? 0 : clamp(r.profitMargin*0.75,0,15);
  const bankingBehaviour = clamp(app.creditInputs.bankingBehaviour,0,15);
  const vintageScore = clamp(app.yearsInBusiness,0,10);
  const existingDebtScore = r.debtEquity===null ? 0 : debtScoreFromDE(r.debtEquity);
  const complianceCount = (app.udyam==="Registered"?1:0) + (app.gst==="Registered"?1:0);
  const complianceScore = complianceCount===2?5:(complianceCount===1?2.5:0);
  const total = creditHistory+revenueGrowthScore+profitabilityScore+bankingBehaviour+vintageScore+existingDebtScore+complianceScore;
  let risk = "High Risk";
  if(total>=75) risk="Low Risk"; else if(total>=50) risk="Moderate Risk";
  return {
    breakdown:{
      creditHistory:{score:creditHistory, max:25, label:"Credit History"},
      revenueGrowthScore:{score:revenueGrowthScore, max:20, label:"Revenue Stability / Growth"},
      profitabilityScore:{score:profitabilityScore, max:15, label:"Profitability"},
      bankingBehaviour:{score:bankingBehaviour, max:15, label:"Banking Behaviour"},
      vintageScore:{score:vintageScore, max:10, label:"Business Vintage"},
      existingDebtScore:{score:existingDebtScore, max:10, label:"Existing Debt"},
      complianceScore:{score:complianceScore, max:5, label:"GST / Udyam Compliance"}
    },
    total: Math.round(total*10)/10,
    risk
  };
}

function riskBadgeClass(risk){
  if(risk==="Low Risk"||risk==="Low") return "badge-low";
  if(risk==="Moderate Risk"||risk==="Moderate") return "badge-moderate";
  return "badge-high";
}
function riskWord(risk){ return risk.replace(" Risk",""); }

function calcEMI(P, annualRatePct, years){
  const r = (annualRatePct/12)/100;
  const n = Math.round(years*12);
  if(r<=0) return n>0 ? P/n : 0;
  const emi = P * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1);
  return emi;
}

function indicativeRate(risk, app){
  if(!app) return RBI_REPO_RATE + SPREAD_COMPONENTS.operatingCost + SPREAD_COMPONENTS.profitMargin;
  return finalLendingRate(app).rate;
}

function calcEligibility(app, override){
  const r = calcRatios(app.fin);
  const cs = calcCreditScore(app);
  const suggTenure = (override&&override.tenure) || app.loan.tenure || PURPOSE_DEFAULT_TENURE[app.loan.purpose] || 5;
  const rate = (override&&override.rate) || indicativeRate(cs.risk, app);
  // profit based cap
  const profitCap = app.fin.curProfit * 4;
  // DSCR based repayment capacity cap (maintain minimum DSCR 1.25 after new loan)
  const maxAnnualInstallmentCapacity = Math.max(0, (app.fin.cashFlow/1.25) - 0); // simplistic: available annual capacity
  const monthlyCapacity = maxAnnualInstallmentCapacity/12;
  const rMonthly = (rate/12)/100;
  const nMonths = Math.round(suggTenure*12);
  let capacityCap;
  if(rMonthly<=0){ capacityCap = monthlyCapacity*nMonths; }
  else { capacityCap = monthlyCapacity * (Math.pow(1+rMonthly,nMonths)-1) / (rMonthly*Math.pow(1+rMonthly,nMonths)); }
  const requested = (override&&override.amount) || app.loan.amount;
  let eligible = Math.min(requested, profitCap, capacityCap);
  eligible = Math.max(0, Math.round(eligible/10000)*10000);
  const emi = calcEMI(eligible, rate, suggTenure);
  return { requested, eligible, tenure:suggTenure, rate, emi, totalPayment: emi*Math.round(suggTenure*12), riskUsed:cs.risk };
}

function docCompletion(app){
  const keys = Object.keys(app.documents);
  const sum = keys.reduce((s,k)=> s + (DOC_WEIGHT[app.documents[k]]||0), 0);
  return Math.round((sum/keys.length)*100);
}

function segmentOf(app){
  const turnover = app.fin.curRevenue;
  let size = "Micro Enterprise";
  if(turnover>=100000000) size="Medium Enterprise"; else if(turnover>=20000000) size="Small Enterprise";
  const maturity = app.yearsInBusiness>=5 ? "Established MSME" : "Emerging MSME";
  return { size, maturity };
}

function aiInsights(app){
  const r = calcRatios(app.fin);
  const cs = calcCreditScore(app);
  const dc = docCompletion(app);
  const seg = segmentOf(app);
  const strengths = [];
  const concerns = [];

  if(r.revenueGrowth!==null && r.revenueGrowth>=10) strengths.push("Stable / strong revenue growth (" + fmtNum(r.revenueGrowth) + "%)");
  if(r.profitMargin!==null && r.profitMargin>=8) strengths.push("Healthy profitability (" + fmtNum(r.profitMargin) + "% margin)");
  if(app.yearsInBusiness>=5) strengths.push("Established operating track record (" + app.yearsInBusiness + " years)");
  if(app.udyam==="Registered" && app.gst==="Registered") strengths.push("Fully compliant on GST & Udyam registration");
  if(r.currentRatio!==null && r.currentRatio>=1.5) strengths.push("Positive short-term liquidity position (" + fmtNum(r.currentRatio,2) + "x current ratio)");
  if(r.dscr!==null && r.dscr>=1.4) strengths.push("Comfortable debt repayment capacity (" + fmtNum(r.dscr,2) + "x DSCR)");
  if(cs.total>=75) strengths.push("Strong overall credit risk profile");
  if(strengths.length===0) strengths.push("Business information is available for further financial and credit review");

  if(r.debtEquity!==null && r.debtEquity>1.5) concerns.push("Elevated existing debt relative to equity");
  if(dc<100) concerns.push("Pending / unverified documents (" + dc + "% complete)");
  if(r.revenueGrowth!==null && r.revenueGrowth<5) concerns.push("Slow or declining revenue growth trend");
  if(r.profitMargin!==null && r.profitMargin<4) concerns.push("Thin or negative profitability");
  if(app.gst!=="Registered") concerns.push("GST registration not yet completed");
  if(app.udyam!=="Registered") concerns.push("Udyam registration not yet completed");
  if(r.currentRatio!==null && r.currentRatio<1.1) concerns.push("Tight short-term liquidity position");
  if(r.dscr!==null && r.dscr<1.2) concerns.push("Limited buffer in debt repayment coverage");
  if(r.cashFlowMargin!==null && r.cashFlowMargin<0) concerns.push("Negative cash flow available for debt servicing");
  if(r.dataQuality.issues.some(x=>x.includes("revenue must be greater") || x.includes("net profit is greater than revenue") || x.includes("Positive equity"))) concerns.push("Core financial inputs need correction before ratio interpretation");
  if(concerns.length===0) concerns.push("No material concerns identified from the available information");

  const growthQ = r.revenueGrowth===null ? "not yet measurable" : (r.revenueGrowth>=10 ? "stable and healthy" : (r.revenueGrowth>=0 ? "modest" : "declining"));
  const marginQ = r.profitMargin===null ? "not yet measurable" : (r.profitMargin>=10 ? "healthy" : (r.profitMargin>=5 ? "satisfactory" : "thin"));
  let suitability;
  if(!r.dataQuality.valid || r.revenueGrowth===null || r.profitMargin===null || r.currentRatio===null || r.debtEquity===null) suitability = "requires completion or correction of core financial inputs before the ratios can be interpreted reliably";
  else if(cs.risk==="Low Risk" && dc>=75) suitability = "can proceed to further MSME credit evaluation, subject to document verification and final underwriting";
  else if(cs.risk==="Moderate Risk") suitability = "requires closer review of the flagged risk factors during the next credit stage, subject to document verification and final underwriting";
  else suitability = "requires the flagged risk factors to be reviewed before the next credit stage, subject to full underwriting review";

  const paragraph = app.businessName + " has demonstrated " + growthQ + " revenue growth" + (r.revenueGrowth===null ? " based on the available figures" : " of " + fmtNum(r.revenueGrowth) + "% over the previous year") + ", with a " + marginQ + " profit margin" + (r.profitMargin===null ? " based on the available figures" : " of " + fmtNum(r.profitMargin) + "%") + ". " +
    "The business has an operating history of " + app.yearsInBusiness + " years and is classified as a" + (seg.maturity==="Established MSME"?"n ":" ") + seg.maturity.toLowerCase() + " (" + seg.size.toLowerCase() + "). " +
    "Existing debt levels are reflected in a debt-to-equity ratio of " + (r.debtEquity===null ? "N/A" : fmtNum(r.debtEquity,2)+"x") + ", and the debt service coverage ratio is " + (r.dscr===null ? "not applicable because no annual debt obligation is reported" : fmtNum(r.dscr,2)+"x") + ". " +
    "Based on the available information, " + suitability + ".";

  return { paragraph, strengths, concerns, suggestedPurpose: app.loan.purpose, segment: seg };
}

function recommendation(app){
  const primary = PRODUCT_MAP[app.loan.purpose] || PRODUCT_MAP["Other"];
  const elig = calcEligibility(app);
  const allKeys = Object.keys(PRODUCT_MAP).filter(k=>k!=="Other");
  const altKeys = allKeys.filter(k=>PRODUCT_MAP[k].name!==primary.name);
  const seen = new Set(); const alternatives=[];
  altKeys.forEach(k=>{ if(!seen.has(PRODUCT_MAP[k].name) && alternatives.length<2){ seen.add(PRODUCT_MAP[k].name); alternatives.push(PRODUCT_MAP[k].name); } });
  return { primary: primary.name, why: primary.why, amount: elig.eligible, tenure: elig.tenure, rate: elig.rate, emi: elig.emi, alternatives };
}

/* ===================== NAV CONFIG ===================== */
