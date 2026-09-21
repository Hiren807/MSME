/* =========================================================================
   app.js
   -------------------------------------------------------------------------
   Application state, persistence (localStorage + optional Firebase cloud
   sync), authentication (simulated), and every screen's render function
   plus its event handlers. This file wires dummy-data.js and
   calculations.js together into the interactive single-page app and
   boots the app at the very bottom (loadData() + render()).
   ========================================================================= */

function setRepoRate(newRate, date){
  const r = parseFloat(newRate);
  if(!isNaN(r) && r>0 && r<25){ RBI_REPO_RATE = r; RBI_REPO_LAST_UPDATED = date || new Date().toISOString().slice(0,10); saveData(); }
}

/* ===================== ICONS (inline SVG, stroke-based) ===================== */
const ICON_PATHS = {
  home:'<path d="M3 10.5 12 4l9 6.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  user:'<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1.3-3.6 4.2-5.4 7.5-5.4s6.2 1.8 7.5 5.4"/>',
  folder:'<path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9a1.5 1.5 0 0 0-1.5-1.5H12L10 5H4.5A1.5 1.5 0 0 0 3 6.5z"/>',
  chart:'<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  gauge:'<path d="M4.5 17a8 8 0 1 1 15 0"/><path d="M12 13l3.5-3.5"/><circle cx="12" cy="13" r="1"/>',
  calc:'<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8.5 7h7M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M8.5 15h.01M12 15h.01M15.5 15h.01M8.5 18h.01M12 18h3.5"/>',
  note:'<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9 12h7M9 16h5"/>',
  target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".6"/>',
  check:'<path d="M20 6 9.5 17 4 11.5"/>',
  cloud:'<path d="M7 18.5h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 9.5a4.5 4.5 0 0 0 0 9z"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  bell:'<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
  chevron:'<path d="m9 6 6 6-6 6"/>',
  eye:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  logout:'<path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M10 8l-4 4 4 4M6 12h10"/>'
};
function icon(name){ return '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">'+(ICON_PATHS[name]||'')+'</svg>'; }

/* ===================== AUTH (prototype login — no real backend) ===================== */
let AUTH = { loggedIn:false, role:null, username:null, customerAppId:null };
function freshDocs(pattern){
  // pattern: object of key->status overrides; default Pending
  const d = {};
  DOC_LIST.forEach(doc=>{ d[doc.key] = (pattern && pattern[doc.key]) || "Pending"; });
  return d;
}

/* ===================== CLOUD STORAGE (pluggable — local by default, Firebase optional) ===================== */
// Honesty note: a static HTML file cannot securely hold real database credentials or run
// server logic, so "true" cloud storage needs an actual backend or a client-safe cloud DB.
// Firebase Firestore is the standard no-backend option for prototypes like this one — its
// config is not a secret (access is controlled by Firestore Security Rules on your project),
// so it's safe to use directly from this file once an RM pastes in their own free project's
// config. Until that's done, the toolkit transparently falls back to this browser's local
// storage, so the app keeps working exactly as before.
const FIREBASE_APP_NAME = "msmeToolkitApp";
let CLOUD = { provider:"local", firebaseConfig:null, connected:false, db:null, syncing:false, lastSync:null, unsub:null, applyingRemote:false, auth:null, authReady:false, authUnsub:null, lastError:null, fbApp:null };

function clearFirebaseListeners(){
  if(CLOUD.unsub){ try{ CLOUD.unsub(); }catch(err){} }
  CLOUD.unsub = null;
  if(CLOUD.authUnsub){ try{ CLOUD.authUnsub(); }catch(err){} }
  CLOUD.authUnsub = null;
}

function firebaseConfigsMatch(a,b){
  if(!a || !b) return false;
  return ["apiKey","authDomain","projectId","appId"].every(k => String(a[k] || "") === String(b[k] || ""));
}

async function connectFirebase(configObj){
  try{
    const appMod = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
    const fsMod = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const { initializeApp, getApps, deleteApp } = appMod;

    // This app used to call initializeApp() every time the user clicked
    // "Connect Cloud Storage". Because boot already initialized Firebase,
    // Firebase then threw "already exists" for the [DEFAULT] app and the
    // manual connect button could never reconnect to a project. Use one
    // named app for this toolkit and reuse/rebuild it safely instead.
    let fbApp = getApps().find(app => app.name === FIREBASE_APP_NAME) || null;
    if(fbApp && !firebaseConfigsMatch(fbApp.options, configObj)){
      clearFirebaseListeners();
      try{ await deleteApp(fbApp); }catch(err){ console.warn("Could not delete previous Firebase app:", err); }
      fbApp = null;
    }
    if(!fbApp) fbApp = initializeApp(configObj, FIREBASE_APP_NAME);

    // Stop listeners owned by the previous CLOUD connection before replacing
    // the references. This also prevents duplicate realtime callbacks.
    clearFirebaseListeners();

    CLOUD.fbApp = fbApp;
    CLOUD.db = fsMod.getFirestore(fbApp);
    CLOUD._fs = fsMod;
    CLOUD.provider = "firebase";
    CLOUD.firebaseConfig = configObj;
    CLOUD.connected = true;
    CLOUD.lastError = null;
    // Deliberately does NOT push here — connecting must never silently overwrite
    // whatever's already in the project. Callers decide pull-vs-push.
    startRealtimeSync();
    return true;
  }catch(err){
    console.error("Firebase connection failed:", err);
    CLOUD.connected = false;
    CLOUD.lastError = err;
    return false;
  }
}
async function initFirebaseAuth(){
  // Real backend authentication: sets up Firebase Auth on the same Firebase app
  // used for Firestore. Called once at boot. Falls back gracefully — RM login
  // stays on the old simulated form if this can't initialize (e.g. offline).
  try{
    if(!CLOUD.fbApp) return false;
    const authMod = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
    CLOUD._auth = authMod;
    CLOUD.auth = authMod.getAuth(CLOUD.fbApp);
    CLOUD.authReady = true;
    if(CLOUD.authUnsub){ try{ CLOUD.authUnsub(); }catch(err){} }
    CLOUD.authUnsub = authMod.onAuthStateChanged(CLOUD.auth, (user)=>{
      if(user && !AUTH.loggedIn){
        // Restores a real, persisted Firebase session on page reload — the RM
        // never has to log in again on the same browser until they explicitly log out.
        AUTH.loggedIn = true; AUTH.role = "rm"; AUTH.username = user.email; AUTH.customerAppId = null;
        UI.view = UI.view==="dashboard" ? UI.view : UI.view;
        render();
      }
    });
    return true;
  }catch(err){
    console.error("Firebase Auth init failed — RM login will use the local fallback:", err);
    CLOUD.authReady = false;
    return false;
  }
}
async function signUpRM(email, password){
  const { createUserWithEmailAndPassword } = CLOUD._auth;
  return createUserWithEmailAndPassword(CLOUD.auth, email, password);
}
async function signInRM(email, password){
  const { signInWithEmailAndPassword } = CLOUD._auth;
  return signInWithEmailAndPassword(CLOUD.auth, email, password);
}
function authErrorMessage(err){
  const code = (err && err.code) || "";
  const map = {
    "auth/email-already-in-use":"That email is already registered — try Log In instead.",
    "auth/invalid-email":"That doesn't look like a valid email address.",
    "auth/weak-password":"Password must be at least 6 characters.",
    "auth/user-not-found":"No account found with that email — try Sign Up instead.",
    "auth/wrong-password":"Incorrect password.",
    "auth/invalid-credential":"Incorrect email or password.",
    "auth/too-many-requests":"Too many attempts — please wait a moment and try again."
  };
  return map[code] || ("Authentication error: "+(err && err.message ? err.message : "please try again."));
}
function startRealtimeSync(){
  // Live listener: picks up changes from any other browser/session connected to the
  // same Firebase project (e.g. a customer uploading a document) without needing a
  // manual "Sync now" click. CLOUD.applyingRemote guards against an infinite loop of
  // receiving our own writes back and re-pushing them.
  if(CLOUD.provider!=="firebase" || !CLOUD.connected || !CLOUD._fs) return;
  if(CLOUD.unsub){ try{ CLOUD.unsub(); }catch(err){} }
  const { doc, onSnapshot } = CLOUD._fs;
  CLOUD.unsub = onSnapshot(doc(CLOUD.db, "msmeToolkit", "applications"), (snap)=>{
    if(!snap.exists()) return;
    const d = snap.data();
    try{
      CLOUD.applyingRemote = true;
      applications = JSON.parse(d.data || "[]");
      if(d.nextAppSeq) nextAppSeq = d.nextAppSeq;
      if(d.notifications) notifications = JSON.parse(d.notifications);
      CLOUD.lastSync = new Date().toISOString();
      render();
    }catch(err){ console.error("Realtime sync parse failed:", err); }
    finally{ CLOUD.applyingRemote = false; }
  }, (err)=>{ console.error("Realtime listener error:", err); });
}
async function cloudPush(){
  if(CLOUD.provider!=="firebase" || !CLOUD.connected) return false;
  CLOUD.lastError = null;
  try{
    CLOUD.syncing = true;
    const { doc, setDoc } = CLOUD._fs;
    await setDoc(doc(CLOUD.db, "msmeToolkit", "applications"), { data: JSON.stringify(applications), nextAppSeq, notifications: JSON.stringify(notifications), updatedAt: new Date().toISOString() });
    CLOUD.lastSync = new Date().toISOString();
    return true;
  }catch(err){ console.error("Cloud push failed:", err); CLOUD.lastError = err; return false; }
  finally{ CLOUD.syncing = false; }
}
async function cloudPull(){
  if(CLOUD.provider!=="firebase" || !CLOUD.connected) return false;
  CLOUD.lastError = null;
  try{
    const { doc, getDoc } = CLOUD._fs;
    const snap = await getDoc(doc(CLOUD.db, "msmeToolkit", "applications"));
    if(snap.exists()){
      const d = snap.data();
      applications = JSON.parse(d.data);
      if(d.nextAppSeq) nextAppSeq = d.nextAppSeq;
      if(d.notifications) notifications = JSON.parse(d.notifications);
      return true;
    }
  }catch(err){ console.error("Cloud pull failed:", err); CLOUD.lastError = err; }
  return false;
}
function disconnectCloud(){
  clearFirebaseListeners();
  CLOUD = { provider:"local", firebaseConfig:null, connected:false, db:null, syncing:false, lastSync:null, unsub:null, applyingRemote:false, auth:null, authReady:false, authUnsub:null, lastError:null, fbApp:null };
  saveData(); render();
}

let nextAppSeq = 1006;

/* ===================== LOCAL PERSISTENCE (fallback "data saving option") ===================== */
const STORAGE_KEY = "msmeOriginationToolkit.v1";
function saveData(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ applications, nextAppSeq, notifications, UI, AUTH, cloudProvider:CLOUD.provider, firebaseConfig:CLOUD.firebaseConfig }));
  }catch(err){ /* storage unavailable — fail silently in this prototype */ }
  if(CLOUD.provider==="firebase" && CLOUD.connected && !CLOUD.applyingRemote){ cloudPush(); }
}
function loadData(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return false;
    const saved = JSON.parse(raw);
    if(saved.applications && saved.applications.length){ applications = saved.applications; }
    if(saved.nextAppSeq) nextAppSeq = saved.nextAppSeq;
    if(saved.notifications) notifications = saved.notifications;
    if(saved.UI) UI = Object.assign(UI, saved.UI);
    if(saved.AUTH) AUTH = Object.assign(AUTH, saved.AUTH);
    if(saved.cloudProvider==="firebase" && saved.firebaseConfig && saved.firebaseConfig.projectId!==FIREBASE_CONFIG.projectId){
      // Only reconnects here if the user had manually pointed this browser at a
      // DIFFERENT Firebase project via the Cloud Storage paste-in box. The
      // default project (FIREBASE_CONFIG) is already connected at boot, below.
      connectFirebase(saved.firebaseConfig).then(async ()=>{
        await initFirebaseAuth();
        // Safety: never let reconnecting on page load silently overwrite this
        // browser's local data with a smaller (or empty) remote copy. Only
        // adopt remote data if it has at least as much as we already have
        // locally; otherwise treat local as the source of truth and push it
        // up instead. This is exactly the scenario that caused real data
        // loss before this fix — a stale/empty cloud doc auto-overwriting a
        // browser that actually had the real data.
        const remoteCount = await peekCloud();
        if(remoteCount === null){ render(); return; }
        if(remoteCount >= applications.length){
          await cloudPull();
        } else if(applications.length > 0){
          await cloudPush();
        }
        render();
      });
    }
    return true;
  }catch(err){ return false; }
}
function resetDemoData(){
  try{ localStorage.removeItem(STORAGE_KEY); }catch(err){}
  location.reload();
}

let applications = [];
let notifications = []; // {id, text, time, read}
function pushNotification(text){
  notifications.unshift({ id:"N"+Date.now()+Math.random().toString(36).slice(2,6), text, time:new Date().toISOString(), read:false });
  if(notifications.length>40) notifications = notifications.slice(0,40);
}
function unreadCount(){ return notifications.filter(n=>!n.read).length; }
function toggleNotifPanel(){ UI.notifPanelOpen = !UI.notifPanelOpen; UI.profileMenuOpen=false; render(); }
function closeNotifPanel(){ UI.notifPanelOpen = false; render(); }
function markAllNotifsRead(){ notifications.forEach(n=>n.read=true); saveData(); render(); }
function relTime(iso){
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs/60000);
  if(mins < 1) return "just now";
  if(mins < 60) return mins+"m ago";
  const hrs = Math.round(mins/60);
  if(hrs < 24) return hrs+"h ago";
  return Math.round(hrs/24)+"d ago";
}

let UI = {
  view:"dashboard",
  appId:null,
  search:"",
  trackerFilters:{status:"All", risk:"All", industry:"All"},
  eligOverride:{},   // per app id: {amount, rate, tenure}
  sidebarOpen:false, // mobile nav drawer state
  profileMenuOpen:false, // account/logout dropdown state
  notifPanelOpen:false // notification bell dropdown state
};

/* ===================== CALCULATION ENGINE ===================== */

function getApp(id){ return applications.find(a=>a.id===id); }

function render(){
  saveData();
  const root = document.getElementById("root");
  if(!AUTH.loggedIn){ root.innerHTML = loginHTML(); return; }
  root.innerHTML = sidebarHTML() + '<div class="sidebar-overlay'+(UI.sidebarOpen?" show":"")+'" onclick="closeSidebar()"></div>' + mainHTML();
}
function toggleSidebar(){ UI.sidebarOpen = !UI.sidebarOpen; render(); }
function closeSidebar(){ UI.sidebarOpen = false; render(); }

function visibleApps(){
  if(AUTH.role==="customer") return applications.filter(a=>a.id===AUTH.customerAppId);
  return applications;
}

function sidebarHTML(){
  const roleItems = NAV_ITEMS.filter(it=> it.roles.indexOf(AUTH.role)!==-1 );
  const item = it=>{
    const active = UI.view===it.view ? " active":"";
    return '<div class="nav-item'+active+'" role="link" tabindex="0" onclick="navigate(\''+it.view+'\')" onkeydown="if(event.key===\'Enter\')navigate(\''+it.view+'\')"><span class="ico">'+icon(it.ico)+'</span><span>'+it.label+'</span></div>';
  };
  const group = g => roleItems.filter(it=>it.group===g).map(item).join("");
  const cur = UI.appId ? getApp(UI.appId) : null;
  const fileHead = cur
    ? '<div class="nav-file" title="Open profile" onclick="navigate(\'profile\')"><div class="f-name">'+escapeHtml(cur.businessName)+'</div><div class="f-id">'+cur.id+'</div></div>'
    : '<div class="nav-empty">No application open</div>';
  const isCustomer = AUTH.role==="customer";
  return '<div class="sidebar'+(UI.sidebarOpen?" open":"")+'">' +
    '<div class="sidebar-brand"><div class="mark"><div class="mark-icon">&#8377;</div><div><div class="mark-text">MSME Origination</div><div class="mark-sub">'+(isCustomer?"Customer portal":"Relationship manager desk")+'</div></div></div></div>' +
    '<nav class="sidebar-nav">'+
      (isCustomer ? '' : '<div class="nav-section-label">Pipeline</div>'+group("pipeline"))+
      '<div class="nav-section-label">'+(isCustomer?"Your application":"Application file")+'</div>'+
      (isCustomer ? '' : fileHead)+
      group("file")+
      (isCustomer ? '' : '<div class="nav-section-label">Settings</div>'+group("settings"))+
    '</nav>'+
    '<div class="sidebar-foot">Academic prototype for Microfinance &amp; Banking coursework. Figures are illustrative.'+
      '<div class="foot-links">'+
      (AUTH.role==="rm" ? '<button onclick="loadTestData()">Load 60 test applications</button>' : '')+
      (AUTH.role==="rm" ? '<button onclick="if(confirm(\'Reset all demo data back to the original sample applications? This clears anything saved in this browser.\'))resetDemoData();">Reset demo data</button>' : '')+
      '<button onclick="logout()">Log out</button>'+
      '</div>'+
    '</div>'+
  '</div>';
}

/* ===================== LOGIN (prototype only — no real authentication) ===================== */
function loginHTML(){
  const tab = UI.loginTab || "rm";
  const custOptions = applications.map(a=>'<option value="'+a.id+'">'+escapeHtml(a.businessName)+' ('+a.id+')</option>').join("");
  const realAuth = tab==="rm" && CLOUD.authReady;
  let form;
  if(tab==="rm" && realAuth){
    form = '<form onsubmit="doLogin(event,\'rm\')">'+
      '<div class="field"><label for="loginUser">Work email</label><input id="loginUser" type="email" autocomplete="username" placeholder="you@bank.in" required/></div>'+
      '<div class="field"><label for="loginPass">Password</label><input id="loginPass" type="password" autocomplete="current-password" placeholder="At least 6 characters" required minlength="6"/></div>'+
      '<label class="check"><input type="checkbox" id="loginSignup"/> This is my first time here, create an account</label>'+
      '<button type="submit" class="btn btn-primary btn-block">Sign in</button>'+
    '</form>';
  } else if(tab==="rm"){
    form = '<form onsubmit="doLogin(event,\'rm\')">'+
      '<div class="field"><label for="loginUser">Username</label><input id="loginUser" type="text" autocomplete="username" placeholder="rm.priya" required/></div>'+
      '<div class="field"><label for="loginPass">Password</label><input id="loginPass" type="password" autocomplete="current-password" required/></div>'+
      '<button type="submit" class="btn btn-primary btn-block" style="margin-top:6px;">Sign in</button>'+
    '</form>';
  } else {
    form = '<form onsubmit="doLogin(event,\'customer\')">'+
      (applications.length===0 ? '<div class="callout callout-warn">There are no applications yet. Your relationship manager needs to open one for your business first.</div>' :
      '<div class="field"><label for="loginAppId">Your business</label><select id="loginAppId">'+custOptions+'</select></div>'+
      '<div class="field"><label for="loginUser">Mobile number</label><input id="loginUser" type="text" inputmode="numeric" placeholder="98765 43210" required/></div>'+
      '<div class="field"><label for="loginPass">Password</label><input id="loginPass" type="password" required/></div>'+
      '<button type="submit" class="btn btn-primary btn-block" style="margin-top:6px;">Sign in</button>')+
    '</form>';
  }
  return '<div class="login">'+
    '<aside class="login-side">'+
      '<div class="brand"><div class="mark-icon">&#8377;</div>MSME Origination</div>'+
      '<div>'+
        '<h2>Every MSME loan file, from first visit to sanction.</h2>'+
        '<p>Capture the business, collect documents, read the financials, score the credit and price the loan against the RBI repo rate, all in one file your customer can follow too.</p>'+
        '<div class="stages"><span>Intake</span><span>Documents</span><span>Financials</span><span class="hl">Credit</span><span>Pricing</span><span>Decision</span></div>'+
      '</div>'+
      '<div class="fine">Academic prototype built for Microfinance &amp; Banking coursework. Scores, rates and amounts are illustrative and must not be used for real lending.</div>'+
    '</aside>'+
    '<main class="login-main"><div class="login-box">'+
      '<h1>Sign in</h1>'+
      '<p class="lead">'+(tab==="rm" ? "Relationship managers see the full pipeline." : "Customers see their own application and can upload documents.")+'</p>'+
      '<div class="tabbar" role="tablist">'+
        '<button type="button" role="tab" class="tab-btn'+(tab==="rm"?" active":"")+'" onclick="setLoginTab(\'rm\')">Relationship manager</button>'+
        '<button type="button" role="tab" class="tab-btn'+(tab==="customer"?" active":"")+'" onclick="setLoginTab(\'customer\')">Customer</button>'+
      '</div>'+
      form+
      '<div class="note">'+(realAuth
        ? "Relationship manager accounts use Firebase sign-in. Tick the box the first time to create yours."
        : "This is a simulated sign-in. Any username and password is accepted and nothing is sent anywhere.")+'</div>'+
    '</div></main>'+
  '</div>';
}
function setLoginTab(tab){ UI.loginTab = tab; render(); }
function doLogin(e, role){
  e.preventDefault();
  const f = e.target;
  if(role==="rm" && CLOUD.authReady){
    const email = f.querySelector("#loginUser").value.trim();
    const password = f.querySelector("#loginPass").value;
    const signupBox = f.querySelector("#loginSignup");
    const isSignup = signupBox && signupBox.checked;
    showToast(isSignup ? "Creating your account..." : "Signing in...");
    const action = isSignup ? signUpRM(email, password) : signInRM(email, password);
    action.then(()=>{
      AUTH.loggedIn = true; AUTH.role = "rm"; AUTH.username = email; AUTH.customerAppId = null;
      UI.view = "dashboard";
      render();
      showToast(isSignup ? "Account created — welcome!" : "Welcome back!");
    }).catch(err=>{
      showToast(authErrorMessage(err));
    });
    return;
  }
  const username = f.querySelector("#loginUser").value || (role==="rm" ? RM.name : "Customer");
  AUTH.loggedIn = true;
  AUTH.role = role;
  AUTH.username = username;
  if(role==="customer"){
    const sel = f.querySelector("#loginAppId");
    AUTH.customerAppId = sel ? sel.value : (applications[0] && applications[0].id);
    UI.appId = AUTH.customerAppId;
    UI.view = "profile";
  } else {
    AUTH.customerAppId = null;
    UI.view = "dashboard";
  }
  render();
}
function logout(){
  if(CLOUD.authReady && CLOUD.auth && AUTH.role==="rm"){
    try{ CLOUD._auth.signOut(CLOUD.auth); }catch(err){ console.error(err); }
  }
  AUTH = { loggedIn:false, role:null, username:null, customerAppId:null };
  UI.view="dashboard"; UI.profileMenuOpen=false; render();
}

function topbarHTML(){
  const custName = AUTH.role==="customer" ? (getApp(AUTH.customerAppId)?getApp(AUTH.customerAppId).businessName:"Customer") : null;
  const chipName = AUTH.role==="customer" ? custName : RM.name;
  const chipRole = AUTH.role==="customer" ? "Customer portal" : RM.branch;
  const chipInitials = AUTH.role==="customer" ? String(custName||"C").split(/\s+/).map(w=>w[0]||"").join("").slice(0,2).toUpperCase() : RM.initials;
  const menu = UI.profileMenuOpen ?
    '<div class="profile-menu" onclick="event.stopPropagation()">'+
      '<div class="profile-menu-head"><div class="rm-avatar">'+chipInitials+'</div><div><div class="rm-name">'+chipName+'</div><div class="rm-role">'+chipRole+'</div></div></div>'+
      '<div class="profile-menu-sep"></div>'+
      '<button class="profile-menu-item" onclick="logout()">'+icon("logout")+' Log out</button>'+
    '</div>' : '';
  const unread = unreadCount();
  const notifList = notifications.length ?
    notifications.slice(0,12).map(n=>'<div class="notif-row'+(n.read?'':' unread')+'"><div class="notif-text">'+escapeHtml(n.text)+'</div><div class="notif-time">'+relTime(n.time)+'</div></div>').join("")
    : '<div class="notif-empty">No notifications yet.</div>';
  const notifPanel = UI.notifPanelOpen ?
    '<div class="profile-menu notif-panel" onclick="event.stopPropagation()">'+
      '<div class="profile-menu-head" style="justify-content:space-between;"><div class="rm-name">Notifications</div>'+(unread?'<button class="notif-markread" onclick="markAllNotifsRead()">Mark all read</button>':'')+'</div>'+
      '<div class="profile-menu-sep"></div>'+
      '<div class="notif-list">'+notifList+'</div>'+
    '</div>' : '';
  return '<div class="topbar">'+
    '<button class="menu-toggle" onclick="toggleSidebar()" aria-label="Open menu">'+icon("menu")+'</button>'+
    '<div class="search-wrap"><span class="sico">'+icon("search")+'</span><input id="globalSearch" aria-label="Search applications" placeholder="Search by business, owner, industry or ID" value="'+escapeHtml(UI.search)+'" oninput="onGlobalSearch(this.value)"/></div>'+
    '<div class="topbar-right">'+
      '<div class="profile-menu-wrap">'+
        '<div class="bell" role="button" tabindex="0" aria-label="Notifications" onclick="toggleNotifPanel()" title="Notifications">'+icon("bell")+''+(unread?'<span class="dot"></span>':'')+'</div>'+
        notifPanel+
      '</div>'+
      '<div class="profile-menu-wrap">'+
        '<div class="rm-chip" role="button" tabindex="0" onclick="toggleProfileMenu()" title="Account"><div class="rm-avatar">'+chipInitials+'</div><div><div class="rm-name">'+chipName+'</div><div class="rm-role">'+chipRole+'</div></div></div>'+
        menu+
      '</div>'+
    '</div>'+
  (UI.profileMenuOpen ? '<div class="profile-menu-overlay" onclick="closeProfileMenu()"></div>' : '')+
  (UI.notifPanelOpen ? '<div class="profile-menu-overlay" onclick="closeNotifPanel()"></div>' : '')+
  '</div>';
}
function toggleProfileMenu(){ UI.profileMenuOpen = !UI.profileMenuOpen; UI.notifPanelOpen=false; render(); }
function closeProfileMenu(){ UI.profileMenuOpen = false; render(); }

function mainHTML(){
  return '<div class="main">'+ topbarHTML() + '<div class="content">' + viewHTML() + '</div></div>';
}

function viewHTML(){
  const navMeta = NAV_ITEMS.find(n=>n.view===UI.view);
  if(navMeta && navMeta.needsApp && !UI.appId){
    return appPickerHTML(navMeta.label);
  }
  switch(UI.view){
    case "dashboard": return dashboardHTML();
    case "newapp": return newAppHTML();
    case "profile": return profileHTML();
    case "documents": return documentsHTML();
    case "financials": return financialsHTML();
    case "credit": return creditHTML();
    case "eligibility": return eligibilityHTML();
    case "aiinsights": return aiInsightsHTML();
    case "recommendation": return recommendationHTML();
    case "decision": return decisionHTML();
    case "tracking": return trackingHTML();
    case "cloudsettings": return cloudSettingsHTML();
    default: return dashboardHTML();
  }
}

function appPickerHTML(label){
  const rows = visibleApps().map(a=> '<div class="app-picker-item" onclick="selectApp(\''+a.id+'\',\''+UI.view+'\')">'+
      '<div><div class="tbl-name">'+escapeHtml(a.businessName)+'</div><div class="tbl-sub">'+a.id+', '+escapeHtml(a.industry)+', '+fmtINR(a.loan.amount)+' requested</div></div>'+
      stageBadge(a.stage) +
    '</div>').join("");
  return pageHead("Open an application", label+" works on one application at a time. Pick the file you want to work on.") +
    '<div class="card">'+
    rows +
    (AUTH.role==="rm" ? '<button class="btn btn-outline btn-block" style="margin-top:6px;" onclick="navigate(\'newapp\')">Start a new application</button>' : '')+
    '</div>';
}

function pageHead(title, sub, crumb){
  return '<div class="page-head"><div>'+(crumb?'<div class="crumb">'+crumb+'</div>':'')+'<h1>'+title+'</h1><div class="sub">'+sub+'</div></div></div>';
}

function escapeHtml(s){ if(s===undefined||s===null) return ""; return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function stageBadge(stage){
  const cls = {
    "New":"badge-New","Documents Pending":"badge-Pending","Documents Verified":"badge-Verified",
    "Financial Analysis":"badge-neutral","Credit Assessment":"badge-neutral","Recommended":"badge-Recommended",
    "Approved":"badge-Approved","Rejected":"badge-Rejected","Disbursed":"badge-Disbursed"
  }[stage] || "badge-neutral";
  return '<span class="badge '+cls+'">'+stage+'</span>';
}

/* ===================== DISCLAIMER FOOTER ===================== */
function disclaimerHTML(){
  return '<div class="footer-disclaimer"><strong>Prototype for academic demonstration.</strong> Credit scores, eligibility amounts, interest rates, risk ratings and recommendations shown in this toolkit are illustrative and computed from sample data only. They should not be used for actual lending decisions and do not reflect any real bank\'s underwriting policy.</div>';
}

/* ===================== DASHBOARD ===================== */
function filteredForSearch(list){
  if(!UI.search.trim()) return list;
  const q = UI.search.trim().toLowerCase();
  return list.filter(a => a.businessName.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || a.industry.toLowerCase().includes(q) || a.owner.name.toLowerCase().includes(q));
}

function fmtCrore(n){
  if(n===null||n===undefined||isNaN(n)) return "-";
  if(Math.abs(n)>=1e7) return "&#8377;"+(n/1e7).toLocaleString("en-IN",{maximumFractionDigits:2})+'<small>Cr</small>';
  if(Math.abs(n)>=1e5) return "&#8377;"+(n/1e5).toLocaleString("en-IN",{maximumFractionDigits:1})+'<small>L</small>';
  return fmtINR(n);
}
function openTrackingFor(stage){ UI.trackerFilters = {status:stage, risk:"All", industry:"All"}; navigate("tracking"); }

function dashboardHTML(){
  const list = filteredForSearch(applications);
  const total = applications.length;
  const underReview = applications.filter(a=>["Documents Pending","Documents Verified","Financial Analysis","Credit Assessment"].includes(a.stage)).length;
  const approved = applications.filter(a=>["Approved","Disbursed"].includes(a.stage)).length;
  const pendingDocs = applications.filter(a=>docCompletion(a)<100).length;
  const totalRequested = applications.reduce((s,a)=>s+a.loan.amount,0);
  const totalEligible = applications.reduce((s,a)=>s+calcEligibility(a).eligible,0);
  const coverage = totalRequested>0 ? Math.round(totalEligible/totalRequested*100) : 0;

  const statusCounts = {};
  STAGES.forEach(s=>statusCounts[s]=0);
  applications.forEach(a=>{ if(statusCounts[a.stage]!==undefined) statusCounts[a.stage]++; });

  const riskCounts = {"Low Risk":0,"Moderate Risk":0,"High Risk":0};
  applications.forEach(a=>{ riskCounts[calcCreditScore(a).risk]++; });
  const riskColors = {"Low Risk":"var(--good)","Moderate Risk":"#C69522","High Risk":"var(--bad)"};

  // Pipeline strip: each stage gets width proportional to its count (with a floor so empty stages stay readable)
  const pipe = STAGES.map(st=>{
    const n = statusCounts[st];
    const grow = Math.max(n, total ? total*0.03 : 1);
    const short = {"Documents Pending":"Docs pending","Documents Verified":"Docs verified","Financial Analysis":"Financials","Credit Assessment":"Credit review"}[st] || st;
    const cls = "seg"+(n===0?" zero":"")+(st==="Rejected"?" rej":"")+(st==="Disbursed"?" closed":"");
    return '<div class="'+cls+'" style="flex:'+grow+' 1 auto;" role="button" tabindex="0" title="Show '+st+' applications" onclick="openTrackingFor(\''+st+'\')" onkeydown="if(event.key===\'Enter\')openTrackingFor(\''+st+'\')">'+
      '<div class="n">'+n+'</div><div class="bar"></div><div class="l">'+short+'</div></div>';
  }).join("");

  const riskBar = total ? Object.keys(riskCounts).filter(k=>riskCounts[k]>0).map(k=>'<span style="flex:'+riskCounts[k]+';background:'+riskColors[k]+';"></span>').join("") : '<span style="flex:1;background:var(--line-soft);"></span>';
  const riskRows = Object.keys(riskCounts).map(k=>{
    const pct = total ? Math.round(riskCounts[k]/total*100) : 0;
    return '<div class="rr"><span class="k"><i style="background:'+riskColors[k]+';"></i>'+k.replace(" Risk","")+' risk</span><span class="v">'+riskCounts[k]+'<small>'+pct+'%</small></span></div>';
  }).join("");

  const recent = list.slice().sort((a,b)=> (b.date||"").localeCompare(a.date||"")).slice(0, UI.search.trim() ? 50 : 8);
  const tableRows = recent.map(a=>{
    const cs = calcCreditScore(a);
    return '<tr>'+
      '<td><button class="tbl-link" onclick="selectApp(\''+a.id+'\',\'profile\')"><div class="tbl-name">'+escapeHtml(a.businessName)+'</div><div class="tbl-sub">'+escapeHtml(a.owner.name)+', '+escapeHtml(a.location||"")+'</div></button></td>'+
      '<td class="id">'+a.id+'</td>'+
      '<td>'+escapeHtml(a.industry)+'</td>'+
      '<td class="mono num">'+fmtINR(a.loan.amount)+'</td>'+
      '<td class="mono num">'+fmtNum(cs.total,0)+'</td>'+
      '<td><span class="badge '+riskBadgeClass(cs.risk)+'">'+riskWord(cs.risk)+'</span></td>'+
      '<td>'+stageBadge(a.stage)+'</td>'+
      '<td class="tbl-sub">'+a.date+'</td>'+
    '</tr>';
  }).join("");

  const hello = (new Date().getHours()<12 ? "Good morning" : (new Date().getHours()<17 ? "Good afternoon" : "Good evening"))+", "+RM.name.split(" ")[0];

  const emptyState = '<div class="card empty-state">'+
      '<div class="section-title" style="font-size:17px;">No applications yet</div>'+
      '<p style="margin:6px auto 18px;max-width:46ch;">Open a file for the first MSME customer, or load sample applications to explore the pipeline.</p>'+
      '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;"><button class="btn btn-primary" onclick="navigate(\'newapp\')">'+icon("plus")+' New application</button><button class="btn btn-outline" onclick="loadTestData()">Load 60 test applications</button></div>'+
    '</div>';

  return '<div class="page-head"><div><div class="crumb">'+hello+'</div><h1>Origination pipeline</h1><div class="sub">'+RM.branch+'. '+(total ? total+' application'+(total===1?'':'s')+' on the desk, '+underReview+' in review.' : 'Nothing on the desk yet.')+'</div></div>'+
    '<div class="actions"><button class="btn btn-primary" onclick="navigate(\'newapp\')">'+icon("plus")+' New application</button></div></div>'+
  (total===0 ? emptyState :
  '<div class="ledger">'+
    '<div class="cell"><div class="kpi-label">Applications</div><div class="fig">'+total+'</div><div class="note">All stages</div></div>'+
    '<div class="cell"><div class="kpi-label">In review</div><div class="fig">'+underReview+'</div><div class="note">Documents to credit</div></div>'+
    '<div class="cell"><div class="kpi-label">Approved</div><div class="fig">'+approved+'</div><div class="note">Including disbursed</div></div>'+
    '<div class="cell"><div class="kpi-label">Missing documents</div><div class="fig">'+pendingDocs+'</div><div class="note">Checklist not complete</div></div>'+
    '<div class="cell money">'+
      '<div class="row"><div><div class="kpi-label">Requested</div><div class="fig">'+fmtCrore(totalRequested)+'</div></div>'+
      '<div style="text-align:right;"><div class="kpi-label">Indicative eligible</div><div class="sm">'+fmtCrore(totalEligible)+'</div></div></div>'+
      '<div class="cov" title="Eligible as a share of requested"><span style="width:'+Math.min(100,coverage)+'%;"></span></div>'+
      '<div class="note" style="color:#A9C4B6;margin-top:6px;">Eligible amounts cover '+coverage+'% of what was asked for</div>'+
    '</div>'+
  '</div>'+

  '<div class="card board" style="margin-bottom:16px;">'+
    '<div class="board-main"><div class="section-title">Where the files are</div><div class="section-sub">Applications at each stage. Select a stage to see its files.</div>'+
      '<div class="pipe-wrap"><div class="pipe">'+pipe+'</div></div></div>'+
    '<div class="board-side"><div class="section-title">Credit risk mix</div><div class="section-sub" style="margin-bottom:6px;">From the prototype scoring model</div>'+
      '<div class="riskbar">'+riskBar+'</div><div class="risk-rows">'+riskRows+'</div></div>'+
  '</div>'+

  '<div class="card">'+
    '<div class="card-row"><div><div class="section-title">'+(UI.search.trim() ? 'Search results' : 'Recently opened files')+'</div><div class="section-sub" style="margin-bottom:0;">'+(UI.search.trim() ? list.length+' match'+(list.length===1?'':'es')+' for &ldquo;'+escapeHtml(UI.search.trim())+'&rdquo;' : 'The eight most recent applications')+'</div></div></div>'+
    '<div class="table-scroll"><table><thead><tr><th>Business</th><th>ID</th><th>Industry</th><th class="num">Requested</th><th class="num">Score</th><th>Risk</th><th>Stage</th><th>Opened</th></tr></thead><tbody>'+
    (tableRows || '<tr><td colspan="8" style="text-align:center;color:var(--ink-3);padding:28px;">No applications match your search.</td></tr>')+
    '</tbody></table></div>'+
    (!UI.search.trim() && total>8 ? '<div class="table-foot"><span>Showing 8 of '+total+'</span><button class="btn btn-ghost btn-sm" onclick="navigate(\'tracking\')">See all applications</button></div>' : '')+
  '</div>')+
  disclaimerHTML();
}

function kpiCard(label, value, ico, bg, fg, foot){
  return '<div class="card kpi-card"><div class="kpi-top"><div class="kpi-label">'+label+'</div><div class="kpi-icon" style="background:'+bg+';color:'+fg+';">'+ico+'</div></div><div class="kpi-value">'+value+'</div><div class="kpi-foot">'+foot+'</div></div>';
}

/* ===================== NEW MSME APPLICATION ===================== */
function newAppHTML(){
  return pageHead("New application", "Record the business, its owner, the latest financials and what the customer wants to borrow. You can correct any figure later.") +
  '<div class="callout callout-info" style="margin-bottom:16px;">Opened by <b>'+RM.name+'</b>, '+RM.branch+', on '+new Date().toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric"})+'.</div>'+
  '<form class="card" onsubmit="submitNewApp(event)">'+

  '<div class="fieldset-title"><span class="step-num">1</span>Business</div>'+
  '<div class="form-grid">'+
    field("Business name","bizName","text","e.g. Om Sai Textiles",true)+
    selectField("Business type","bizType",["Proprietorship","Partnership","LLP","Private Limited"])+
    field("Industry","industry","text","e.g. Manufacturing, Trading, Services",true)+
    field("Business location","location","text","City, State",true)+
    field("Years in business","years","number","e.g. 6",true)+
    field("Number of employees","employees","number","e.g. 15",true)+
    selectField("Udyam registration status","udyam",["Registered","Not Registered"],"onUdyamChange(this)")+
    field("Udyam registration number","udyamId","text","e.g. UDYAM-MH-03-0012345",false)+
    selectField("GST registration status","gst",["Registered","Not Registered"])+
    field("Investment in plant &amp; Machinery/Equipment (&#8377;)","investment","number","e.g. 6500000",true)+
  '</div>'+
  '<div class="callout callout-warn" id="udyamNudge" style="margin-top:2px;display:none;">This business is not Udyam registered yet. Most MSME loan schemes, subsidies and priority-sector benefits require Udyam registration. Advise the customer to register for free at <a href="https://udyamregistration.gov.in" target="_blank" rel="noopener">udyamregistration.gov.in</a> &mdash; it typically takes under 15 minutes with just Aadhaar and PAN. You can still continue this application, but flag this to the customer before final disbursal.</div>'+
  '<div class="callout callout-info" id="msmeTypePreview" style="margin-top:2px;">MSME category (Micro/Small/Medium) is auto-classified from investment and turnover per Udyam norms once the application is created.</div>'+

  '<div class="fieldset-title"><span class="step-num">2</span>Owner</div>'+
  '<div class="form-grid">'+
    field("Owner / promoter name","ownerName","text","Full name",true)+
    field("Age","ownerAge","number","e.g. 42",true)+
    field("Experience in business (years)","ownerExp","number","e.g. 12",true)+
    field("Years of management experience","ownerMgmt","number","e.g. 8",true)+
  '</div>'+

  '<div class="fieldset-title"><span class="step-num">3</span>Financials <span style="font-family:var(--font-body);font-size:13px;color:var(--ink-3);font-weight:400;">from the latest statements</span></div>'+
  '<div class="form-grid">'+
    field("Annual turnover &mdash; current year (&#8377;)","curRevenue","number","e.g. 6300000",true)+
    field("Annual turnover &mdash; previous year (&#8377;)","prevRevenue","number","e.g. 5400000",true)+
    field("Net profit &mdash; current year (&#8377;)","curProfit","number","e.g. 693000",true)+
    field("Current assets (&#8377;)","currentAssets","number","e.g. 1512000",true)+
    field("Current liabilities (&#8377;)","currentLiabilities","number","e.g. 1008000",true)+
    field("Existing total debt / borrowings (&#8377;)","totalDebt","number","e.g. 1350000 (0 if none)",false)+
    field("Owner's net worth / equity (&#8377;)","equity","number","e.g. 1890000",true)+
    field("Existing annual debt obligation (&#8377;)","annualDebtObligation","number","e.g. 420000 (0 if none)",false)+
    field("Net cash accruals for debt servicing (&#8377;)","cashFlow","number","e.g. 588000",true)+
  '</div>'+
  '<div class="callout callout-info" style="margin-top:2px;">These figures directly drive the Financial Analysis, Credit Score and Risk Category on the next steps &mdash; enter the customer&#39;s real numbers rather than round estimates for a meaningful assessment.</div>'+

  '<div class="fieldset-title"><span class="step-num">4</span>Loan requirement</div>'+
  '<div class="form-grid">'+
    field("Loan amount requested (&#8377;)","loanAmount","number","e.g. 1500000",true)+
    selectField("Purpose of loan","purpose",["Working Capital","Machinery Purchase","Business Expansion","Inventory Purchase","Commercial Vehicle","Other"])+
    field("Preferred tenure (years)","tenure","number","e.g. 5",true)+
    selectField("Loan type","loanType",["Secured","Unsecured"])+
    selectField("Interest rate type","interestRateType",["Floating","Fixed"])+
    selectField("Subsidy scheme (if applicable)","subsidyScheme",Object.keys(SUBSIDY_SCHEMES))+
  '</div>'+

  '<div class="fieldset-title"><span class="step-num">5</span>Notes</div>'+
  '<div class="form-grid">'+
    '<div class="field field-span2"><label>Notes / additional data</label><textarea id="notes" name="notes" rows="3" placeholder="Any other context about the business, collateral, or special requirement..."></textarea></div>'+
  '</div>'+

  '<div class="callout callout-info" style="margin-top:18px;">The MSME category and the applicable indicative loan cap are auto-computed from your Investment and Turnover figures. Credit score, risk category and DSCR are computed live from the Financial Details you enter above.</div>'+

  '<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;">'+
    '<button type="button" class="btn btn-outline" onclick="navigate(\'dashboard\')">Cancel</button>'+
    '<button type="submit" class="btn btn-primary">Create application</button>'+
  '</div>'+
  '</form>';
}
function onUdyamChange(sel){
  const el = document.getElementById("udyamNudge");
  if(el) el.style.display = (sel.value==="Not Registered") ? "block" : "none";
}

function field(label, id, type, placeholder, required){
  return '<div class="field"><label>'+label+(required?' *':'')+'</label><input id="'+id+'" name="'+id+'" type="'+type+'" placeholder="'+(placeholder||"")+'" '+(required?"required":"")+'/></div>';
}
function selectField(label, id, options, onchange){
  const opts = options.map(o=>'<option value="'+o+'">'+o+'</option>').join("");
  return '<div class="field"><label>'+label+'</label><select id="'+id+'" name="'+id+'"'+(onchange?' onchange="'+onchange+'"':'')+'>'+opts+'</select></div>';
}

function submitNewApp(e){
  e.preventDefault();
  const f = e.target;
  const val = (id)=> f.querySelector("#"+id).value;
  const num = (id, fallback)=> { const v = parseFloat(val(id)); return isNaN(v) ? (fallback||0) : v; };
  const loanAmount = num("loanAmount", 1000000);
  const curRevenue = num("curRevenue", 0);
  const prevRevenue = num("prevRevenue", 0);
  const curProfit = num("curProfit", 0);
  // Previous year profit isn't asked separately to keep the form shorter — approximate it
  // using this year's actual profit margin applied to last year's actual revenue, which is
  // far more realistic than a fixed guess and still driven entirely by real user input.
  const marginNow = curRevenue>0 ? (curProfit/curRevenue) : 0;
  const prevProfit = Math.round(prevRevenue * marginNow);
  const id = "MSME-"+(nextAppSeq++);
  const app = {
    id,
    businessName: val("bizName"),
    businessType: val("bizType"),
    industry: val("industry"),
    location: val("location"),
    yearsInBusiness: parseInt(val("years"))||1,
    employees: parseInt(val("employees"))||1,
    udyam: val("udyam"),
    udyamId: val("udyamId"),
    investmentPlantMachinery: parseFloat(val("investment"))||0,
    gst: val("gst"),
    owner:{ name: val("ownerName"), age: parseInt(val("ownerAge"))||30, experience: parseInt(val("ownerExp"))||1, managementYears: parseInt(val("ownerMgmt"))||1 },
    loan:{ amount: loanAmount, purpose: val("purpose"), tenure: parseFloat(val("tenure"))||5 },
    loanType: val("loanType"), interestRateType: val("interestRateType"), subsidyScheme: val("subsidyScheme"), notes: val("notes"),
    fin:{
      curRevenue: Math.round(curRevenue), prevRevenue: Math.round(prevRevenue),
      curProfit: Math.round(curProfit), prevProfit: prevProfit,
      currentAssets: Math.round(num("currentAssets",0)), currentLiabilities: Math.round(num("currentLiabilities",0)),
      totalDebt: Math.round(num("totalDebt",0)), equity: Math.round(num("equity",0)),
      annualDebtObligation: Math.round(num("annualDebtObligation",0)), cashFlow: Math.round(num("cashFlow",0))
    },
    creditInputs:{ creditHistory: 18, bankingBehaviour: 11 },
    documents: freshDocs({}),
    docFiles:{},
    stage:"New",
    rm: RM.name,
    date: new Date().toISOString().slice(0,10),
    decision: null
  };
  applications.unshift(app);
  UI.appId = app.id;
  UI.view = "profile";
  pushNotification("New application "+id+" created for "+app.businessName+".");
  saveData();
  render();
  const cap = loanCapCheck(app);
  if(!cap.withinCap){
    showToast("Application "+id+" created — but requested amount exceeds the indicative "+cap.type+" MSME cap of "+fmtINR(cap.cap)+".");
  } else {
    showToast("Application "+id+" created for "+app.businessName+" (classified: "+cap.type+")");
  }
}

/* ===================== CLOUD STORAGE SETTINGS ===================== */
function cloudSettingsHTML(){
  const connected = CLOUD.provider==="firebase" && CLOUD.connected;
  return pageHead("Cloud storage", "Keep applications in a shared Firebase database so everyone using the hosted link sees the same files.", "Settings") +
  '<div class="grid grid-2">'+
    '<div class="card">'+
      '<div class="section-title">Connection status</div>'+
      statLine("Storage backend", connected ? '<span class="badge badge-Verified">Firebase Cloud (connected)</span>' : '<span class="badge badge-neutral">Local Browser Storage</span>')+
      statLine("Last synced", CLOUD.lastSync ? new Date(CLOUD.lastSync).toLocaleString() : "&mdash;")+
      statLine("Applications stored", applications.length)+
      (connected ? '<button class="btn btn-outline" style="margin-top:12px;" onclick="syncCloudNow()">Sync now (pull latest)</button>' : '')+
      (connected ? '<button class="btn btn-outline" style="margin-top:8px;" onclick="pushLocalToCloudNow()">Push local data to Firebase (overwrite cloud)</button>' : '')+
      (connected ? '<button class="btn btn-outline" style="margin-top:8px;" onclick="disconnectCloud()">Disconnect &amp; revert to local storage</button>' : '')+
    '</div>'+
    '<div class="card">'+
      '<div class="section-title">Connect a Firebase project</div>'+
      '<div class="section-sub">Paste the config object from your Firebase Console &rarr; Project Settings &rarr; General &rarr; Your apps.</div>'+
      '<textarea id="fbConfigInput" rows="7" style="width:100%;border:1px solid var(--border);border-radius:7px;padding:9px 11px;font-family:var(--font-mono);font-size:12.5px;" placeholder=\'{\n  "apiKey": "...",\n  "authDomain": "...",\n  "projectId": "...",\n  "storageBucket": "...",\n  "messagingSenderId": "...",\n  "appId": "..."\n}\'></textarea>'+
      '<button class="btn btn-primary" style="margin-top:10px;" onclick="submitFirebaseConfig()">Connect Cloud Storage</button>'+
      '<div class="callout callout-warn" style="margin-top:12px;">Remember to set Firestore Security Rules on your project so only your RM team can read/write this data &mdash; a default-open project is publicly writable.</div>'+
    '</div>'+
  '</div>'+
  disclaimerHTML();
}
function parseFirebaseConfigInput(raw){
  // Firebase Console commonly shows the config as a JavaScript object:
  // const firebaseConfig = { apiKey: "...", ... };
  // That is valid JavaScript but NOT strict JSON because of the optional
  // variable declaration, unquoted property names, and trailing semicolon.
  // Accept both formats without using eval/new Function.
  let text = String(raw || "").trim();
  if(!text) throw new Error("empty");

  // Remove markdown code fences when someone pastes a fenced snippet.
  text = text.replace(/^```(?:json|javascript|js)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // Keep only the object portion if Firebase copied the declaration around it.
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if(firstBrace >= 0 && lastBrace > firstBrace){
    text = text.slice(firstBrace, lastBrace + 1).trim();
  }

  // Convert the common Firebase JS object shape to JSON-safe text.
  text = text.replace(/,\s*$/, "");
  if(text.endsWith(";")) text = text.slice(0, -1).trim();
  text = text.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":');

  const cfg = JSON.parse(text);
  if(!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw new Error("not-object");
  return cfg;
}

function submitFirebaseConfig(){
  const raw = document.getElementById("fbConfigInput").value.trim();
  if(!raw){ showToast("Paste your Firebase config first."); return; }
  let cfg;
  try{ cfg = parseFirebaseConfigInput(raw); }catch(err){
    showToast("Couldn't read that Firebase config. Paste the config object from Firebase Console, with or without the final semicolon.");
    return;
  }
  const required = ["apiKey","authDomain","projectId","appId"];
  const missing = required.filter(k => !cfg[k]);
  if(missing.length){ showToast("Config is missing: " + missing.join(", ") + ". Copy the full object from Firebase Console \u2192 Project Settings."); return; }
  showToast("Connecting to Firebase...");
  connectFirebase(cfg).then(async ok=>{
    if(!ok){ showToast("Couldn't connect. Check the config values and your network, then try again."); return; }
    // Re-initialize Auth against the newly selected Firebase project. This is
    // important when the RM switches from the baked-in demo project to their
    // own project from this screen.
    await initFirebaseAuth();

    // Pull first so connecting never clobbers data another RM already pushed.
    // Only seed the project with this browser's local data if it's genuinely empty.
    const hadRemoteData = await cloudPull();
    if(CLOUD.lastError){
      const msg = CLOUD.lastError.code === "permission-denied"
        ? "Firebase connected, but Firestore denied access. Check your Firestore Security Rules."
        : "Firebase connected, but Firestore could not be read: " + (CLOUD.lastError.message || "check the project and network.");
      showToast(msg);
      return;
    }
    if(!hadRemoteData) await cloudPush();
    if(CLOUD.lastError){
      showToast("Firebase connected, but the initial data could not be saved: " + (CLOUD.lastError.message || "check your Firestore rules."));
      return;
    }
    saveData();
    render();
    showToast(hadRemoteData
      ? "Connected — loaded the existing applications already saved in your Firebase project."
      : "Connected — this project was empty, so this browser's data has been pushed as the starting point.");
  });
}
function syncCloudNow(){
  if(CLOUD.provider!=="firebase" || !CLOUD.connected){ showToast("Connect Firebase first."); return; }
  showToast("Checking Firebase for the latest data...");
  peekCloud().then(remoteCount=>{
    if(remoteCount !== null && remoteCount < applications.length){
      const proceed = confirm(
        "Firebase currently has " + remoteCount + " application(s), but this browser has " + applications.length + ". " +
        "Pulling now will REPLACE this browser's " + applications.length + " application(s) with Firebase's " + remoteCount + ". " +
        "If you're not sure Firebase is up to date, click Cancel and use \"Push local data to Firebase\" instead.\n\nPull anyway?"
      );
      if(!proceed){ showToast("Cancelled — nothing changed."); return; }
    }
    cloudPull().then(found=>{
      render();
      showToast(found ? "Synced — showing the latest data from Firebase." : "No data found in Firebase yet.");
    });
  });
}
async function peekCloud(){
  // Read-only check of how many applications are currently in Firestore,
  // WITHOUT touching local state — used to warn before an overwriting pull.
  if(CLOUD.provider!=="firebase" || !CLOUD.connected) return null;
  try{
    const { doc, getDoc } = CLOUD._fs;
    const snap = await getDoc(doc(CLOUD.db, "msmeToolkit", "applications"));
    if(!snap.exists()) return 0;
    const d = snap.data();
    const arr = JSON.parse(d.data || "[]");
    return Array.isArray(arr) ? arr.length : 0;
  }catch(err){ console.error("Cloud peek failed:", err); return null; }
}
function pushLocalToCloudNow(){
  if(CLOUD.provider!=="firebase" || !CLOUD.connected){ showToast("Connect Firebase first."); return; }
  const proceed = confirm(
    "This will OVERWRITE Firebase with this browser's " + applications.length + " application(s), " +
    "discarding whatever is currently saved in Firebase. Use this to restore/repair cloud data from this browser. Continue?"
  );
  if(!proceed){ showToast("Cancelled — nothing changed."); return; }
  showToast("Pushing this browser's data to Firebase...");
  cloudPush().then(ok=>{
    render();
    showToast(ok ? "Done — Firebase now matches this browser (" + applications.length + " application(s))." : "Push failed — check your network/rules and try again.");
  });
}

/* ===================== CUSTOMER PROFILE ===================== */
function progressStagesFor(app){
  // 6 milestone view distinct from raw pipeline STAGES
  const dc = docCompletion(app);
  const milestones = [
    {key:"Registration", done:true},
    {key:"Documents", done: dc===100, current: dc>0 && dc<100},
    {key:"Financial analysis", done: ["Credit Assessment","Recommended","Approved","Disbursed"].includes(app.stage), current: app.stage==="Financial Analysis"},
    {key:"Credit assessment", done: ["Recommended","Approved","Disbursed"].includes(app.stage), current: app.stage==="Credit Assessment"},
    {key:"Recommendation", done: ["Approved","Disbursed"].includes(app.stage), current: app.stage==="Recommended"},
    {key:"Final decision", done: ["Approved","Disbursed"].includes(app.stage), current: app.stage==="Rejected"}
  ];
  return milestones;
}

function railHTML(milestones, labelKey, currentKey){
  return '<div class="rail">' + milestones.map(m=>{
    let cls="rail-node";
    if(m.done) cls+=" done"; else if(m.current) cls+=" current";
    const mark = m.done ? '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" style="stroke:#fff;fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;"><path d="M20 6 9.5 17 4 11.5"/></svg>' : "";
    return '<div class="'+cls+'"><div class="line"></div><div class="dot">'+mark+'</div><div class="lbl"><span>'+m.key+'</span></div></div>';
  }).join("") + '</div>';
}

function profileHTML(){
  const app = getApp(UI.appId);
  const r = calcRatios(app.fin);
  const cs = calcCreditScore(app);
  const seg = segmentOf(app);
  const dc = docCompletion(app);
  const milestones = progressStagesFor(app);
  const cap = loanCapCheck(app);
  const rate = indicativeRate(cs.risk, app);

  return pageHead(escapeHtml(app.businessName), escapeHtml(app.businessType)+" in "+escapeHtml(app.industry)+", "+escapeHtml(app.location)+". Owned by "+escapeHtml(app.owner.name)+".", "Application "+app.id) +

  '<div class="card" style="margin-bottom:16px;">'+
    '<div class="card-row"><div class="section-title" style="margin-bottom:0;">Where this file is</div>'+stageBadge(app.stage)+'</div>'+
    railHTML(milestones)+
  '</div>'+

  (!cap.withinCap ? '<div class="callout callout-warn" style="margin-bottom:16px;">Requested amount ('+fmtINR(app.loan.amount)+') exceeds the illustrative loan cap of '+fmtINR(cap.cap)+' for a <strong>'+cap.type+'</strong> enterprise under this prototype\'s Udyam-linked limits.</div>' : '')+

  '<div class="grid grid-3" style="margin-bottom:16px;">'+
    '<div class="card"><div class="section-title">Business overview</div>'+
      statLine("Business type", app.businessType)+
      statLine("MSME category (Udyam)", '<span class="badge badge-neutral">'+cap.type+'</span>')+
      statLine("Industry", app.industry)+
      statLine("Location", app.location)+
      statLine("Business vintage", app.yearsInBusiness+" years")+
      statLine("Employees", app.employees)+
      statLine("Annual turnover", fmtINR(app.fin.curRevenue))+
      statLine("Investment in P&amp;M/Equipment", fmtINR(app.investmentPlantMachinery))+
      statLine("Segment", seg.maturity+", "+seg.size.toLowerCase())+
    '</div>'+
    '<div class="card"><div class="section-title">Loan requirement</div>'+
      statLine("Requested amount", fmtINR(app.loan.amount))+
      statLine("Indicative cap for "+cap.type, cap.cap?fmtINR(cap.cap):"-")+
      statLine("Loan purpose", app.loan.purpose)+
      statLine("Loan type", app.loanType||"-")+
      statLine("Interest rate type", app.interestRateType||"-")+
      statLine("Indicative interest rate", rate+"% p.a.")+
      statLine("Proposed tenure", app.loan.tenure+" years")+
      statLine("Subsidy scheme", app.subsidyScheme && app.subsidyScheme!=="None" ? app.subsidyScheme : "Not applicable")+
    '</div>'+
    '<div class="card"><div class="section-title">Credit snapshot</div>'+
      statLine("Credit risk score", fmtNum(cs.total,0)+" / 100")+
      statLine("Risk category", '<span class="badge '+riskBadgeClass(cs.risk)+'">'+riskWord(cs.risk)+'</span>')+
      statLine("Existing debt", fmtINR(app.fin.totalDebt))+
      statLine("Repayment capacity (DSCR)", fmtNum(r.dscr,2)+"x")+
      statLine("Document completion", dc+"%")+
      statLine("GST registration", app.gst)+
      statLine("Udyam registration", app.udyam+(app.udyamId?" ("+app.udyamId+")":""))+
    '</div>'+
  '</div>'+

  (app.notes ? '<div class="card" style="margin-bottom:16px;"><div class="section-title">Additional notes</div><div style="font-size:12.6px;color:var(--text-muted);">'+escapeHtml(app.notes)+'</div></div>' : '')+

  '<div class="grid grid-2" style="margin-bottom:16px;">'+
    '<div class="card"><div class="section-title">Financial snapshot</div>'+
      statLine("Revenue (current year)", fmtINR(app.fin.curRevenue))+
      statLine("Profit (current year)", fmtINR(app.fin.curProfit))+
      statLine("Existing debt", fmtINR(app.fin.totalDebt))+
      statLine("Cash flow for debt service", fmtINR(app.fin.cashFlow))+
      statLine("Profit margin", fmtNum(r.profitMargin)+"%")+
      statLine("Revenue growth", fmtNum(r.revenueGrowth)+"%")+
    '</div>'+
    '<div class="card">'+
      '<div class="section-title">Continue the file</div><div class="section-sub">Each step of the origination workflow, in order</div>'+
      '<div class="steps">'+
        stepLink("1","Review documents","documents")+
        stepLink("2","Run financial analysis","financials")+
        stepLink("3","Credit assessment","credit")+
        stepLink("4","Eligibility and pricing","eligibility")+
        stepLink("5","AI business insights","aiinsights")+
        stepLink("6","Loan recommendation","recommendation")+
        stepLink("7","Decision","decision")+
      '</div>'+
    '</div>'+
  '</div>'+
  disclaimerHTML();
}

function statLine(k,v){ return '<div class="stat-line"><span class="k">'+k+'</span><span class="v">'+v+'</span></div>'; }
function stepLink(n,label,view){
  return '<button type="button" class="step-link" onclick="navigate(\''+view+'\')"><span><span class="s-n">'+n+'</span>'+label+'</span>'+icon("chevron")+'</button>';
}

/* ===================== DOCUMENTS ===================== */
function documentsHTML(){
  const app = getApp(UI.appId);
  const dc = docCompletion(app);
  const isCustomer = AUTH.role==="customer";
  const rows = DOC_LIST.map(doc=>{
    const status = app.documents[doc.key];
    const badgeCls = {"Pending":"badge-Pending","Uploaded":"badge-Uploaded","Under Verification":"badge-UnderVerification","Verified":"badge-Verified"}[status];
    const hasFile = app.docFiles && app.docFiles[doc.key];
    const viewBtn = hasFile ? '<button type="button" class="btn btn-outline btn-sm doc-view-btn" title="View uploaded document" aria-label="View uploaded document" onclick="viewDocFile(\''+app.id+'\',\''+doc.key+'\')"><span aria-hidden="true" style="display:flex;">'+icon("eye")+'</span></button>' : '';
    let actionBtn;
    const canUpload = status === "Pending" || status === "Uploaded";
    const uploadDisabled = canUpload ? "" : "disabled";
    const uploadLabel = hasFile ? "Replace file" : "Upload";
    actionBtn = canUpload ? '<input type="file" id="fileInput_'+doc.key+'" style="display:none" accept="image/*,.pdf" onchange="handleDocUpload(event,\''+app.id+'\',\''+doc.key+'\')"/>'+
      '<button type="button" class="btn btn-outline btn-sm" onclick="document.getElementById(\'fileInput_'+doc.key+'\').click()" style="min-width:120px;justify-content:center;">'+uploadLabel+'</button>' : '';
    return '<div class="doc-row">'+
      '<div class="doc-ico" aria-hidden="true">'+doc.ico+'</div>'+
      '<div class="doc-info"><div class="doc-name">'+doc.label+'</div><div class="doc-desc">'+doc.desc+(hasFile?'. Uploaded: <span style="color:var(--teal-600);">'+escapeHtml(hasFile.name)+'</span>':'')+'</div></div>'+
      '<span class="badge '+badgeCls+'">'+status+'</span>'+
      '<div style="display:flex;gap:8px;align-items:center;">'+actionBtn+viewBtn+(status==="Uploaded" ? '<button type="button" class="btn btn-primary btn-sm" onclick="advanceDoc(\''+app.id+'\',\''+doc.key+'\')" style="min-width:150px;justify-content:center;">Send for verification</button>' : '')+(status==="Under Verification" ? '<button type="button" class="btn btn-primary btn-sm" onclick="advanceDoc(\''+app.id+'\',\''+doc.key+'\')" style="min-width:150px;justify-content:center;">Mark verified</button>' : '')+'</div>'+
    '</div>';
  }).join("");

  return pageHead("Documents", "Eight documents are needed before credit review. Each moves from uploaded, to under verification, to verified.", escapeHtml(app.businessName)+", "+app.id) +
  '<div class="card" style="margin-bottom:16px;">'+
    '<div class="card-row"><div><div class="section-title" style="margin-bottom:6px;">Checklist '+dc+'% complete</div><div class="section-sub" style="margin-bottom:0;">'+(isCustomer?"Upload each required document below. Your RM will verify them once received.":"Move each document along once you have checked it. Use the eye icon to open a file the customer uploaded.")+'</div></div></div>'+
    '<div class="meter-track" style="height:10px;"><div class="meter-fill" style="width:'+dc+'%;"></div></div>'+
  '</div>'+
  '<div class="card">'+rows+'</div>'+
  '<div class="callout callout-info" style="margin-top:16px;">Files are read directly in your browser and stored alongside the application data (locally, or in your connected Firebase project) &mdash; kept under ~700KB per file to fit this prototype\'s storage. This is a functional demo upload, not a production document-management system.</div>'+
  disclaimerHTML();
}

function handleDocUpload(evt, appId, key){
  const file = evt.target.files[0];
  if(!file) return;
  const MAX = 700*1024; // keep comfortably under Firestore's 1MB per-document limit
  if(file.size > MAX){
    showToast("That file is too large for this prototype (max ~700KB) — please choose a smaller file.");
    evt.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = function(){
    const app = getApp(appId);
    app.docFiles = app.docFiles || {};
    app.docFiles[key] = { name:file.name, dataUrl:reader.result, uploadedAt:new Date().toISOString() };
    if(app.documents[key]==="Pending") app.documents[key] = "Uploaded";
    const label = DOC_LIST.find(d=>d.key===key).label;
    const who = AUTH.role==="customer" ? "the customer" : RM.name;
    pushNotification(app.businessName+": "+label+" uploaded by "+who+".");
    render();
    showToast("Uploaded "+file.name);
  };
  reader.onerror = function(){ showToast("Couldn't read that file — please try again."); };
  reader.readAsDataURL(file);
}

function viewDocFile(appId, key){
  const app = getApp(appId);
  const f = app.docFiles && app.docFiles[key];
  if(!f){ showToast("No file uploaded for this document yet."); return; }
  const w = window.open("", "_blank");
  if(!w){ showToast("Your browser blocked the popup — allow popups for this page to view files."); return; }
  const isImg = f.dataUrl.indexOf("data:image")===0;
  w.document.write('<title>'+f.name+'</title>'+
    (isImg
      ? '<body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="'+f.dataUrl+'" style="max-width:100%;max-height:100vh;"/></body>'
      : '<body style="margin:0;"><iframe src="'+f.dataUrl+'" style="border:none;width:100vw;height:100vh;"></iframe></body>'));
}

function advanceDoc(appId, key){
  const app = getApp(appId);
  const cur = app.documents[key];
  const next = DOC_NEXT[cur];
  app.documents[key] = next;
  if(next==="Verified"){ pushNotification(app.businessName+": "+DOC_LIST.find(d=>d.key===key).label+" verified."); }
  render();
}

/* ===================== FINANCIAL ANALYSIS ===================== */
function financialsHTML(){
  const app = getApp(UI.appId);
  const r = calcRatios(app.fin);
  const health = financialHealth(r);
  const healthColor = {
    "Excellent":"var(--green-600)","Good":"var(--teal-600)","Moderate":"var(--amber-600)","Weak":"var(--red-600)","Incomplete Data":"var(--amber-600)"
  }[health] || "var(--text-muted)";
  const healthBg = {
    "Excellent":"var(--green-100)","Good":"var(--teal-100)","Moderate":"var(--amber-100)","Weak":"var(--red-100)","Incomplete Data":"var(--amber-100)"
  }[health] || "var(--bg)";
  const qualityTone = financialDataQualityTone(r);
  const seg = bankSegmentFor(app.loan.amount || 0);

  const inputRows = FIN_FIELDS.map(fld=>{
    const numericValue = Number(app.fin[fld.key]);
    const value = Number.isFinite(numericValue) ? numericValue : 0;
    const negativeAllowed = ["cashFlow"].includes(fld.key);
    return '<div class="field"><label>'+fld.label+'</label><input min="'+(negativeAllowed?'-999999999999':'0')+'" step="1" type="number" value="'+value+'" onchange="updateFinField(\''+app.id+'\',\''+fld.key+'\',this.value)"/></div>';
  }).join("");

  const ratioCard = (title, value, tooltip, interp) => {
    const toneColor = {good:"var(--green-600)", ok:"var(--teal-600)", warn:"var(--amber-600)", bad:"var(--red-600)"}[interp.tone] || "var(--text-muted)";
    return '<div class="card">'+
      '<div class="tip" style="font-size:12.5px;font-weight:500;color:var(--text-muted);">'+title+'<span class="tt">'+tooltip+'</span></div>'+
      '<div class="mono" style="font-size:22px;font-weight:500;color:var(--navy-950);margin:6px 0 4px 0;">'+value+'</div>'+
      '<div style="font-size:11.5px;font-weight:500;color:'+toneColor+';">'+interp.tag+'</div>'+
    '</div>';
  };

  const qualityCallout = r.dataQuality.issues.length ?
    '<div class="callout callout-warn" style="margin-bottom:14px;"><strong>Data quality check</strong><div style="margin-top:6px;">'+r.dataQuality.issues.map(x=>'<div style="margin-top:4px;">&bull; '+escapeHtml(x)+'</div>').join('')+'</div><div style="margin-top:8px;font-size:11.5px;color:var(--text-muted);">Correct the highlighted financial inputs to get a reliable ratio interpretation. A loss or negative cash flow is shown as a financial signal rather than treated as an input error.</div></div>' :
    '<div class="callout callout-info" style="margin-bottom:14px;"><strong>Financial inputs are internally consistent.</strong> The ratios below are calculated from the values entered for this application.</div>';

  return pageHead("Financial analysis", "Liquidity, leverage and repayment capacity, calculated from the figures on the right.", escapeHtml(app.businessName)+", "+app.id) +

  qualityCallout +

  '<div class="two-col">'+
    '<div>'+
      '<div class="grid grid-3" style="margin-bottom:14px;">'+
        ratioCard("Revenue growth", r.revenueGrowth===null?"N/A":fmtNum(r.revenueGrowth)+"%", "Year-on-year change in current revenue versus previous-year revenue.", interpretRatio("revenueGrowth",r.revenueGrowth))+
        ratioCard("Profit margin", r.profitMargin===null?"N/A":fmtNum(r.profitMargin)+"%", "Current-year net profit as a percentage of current-year revenue.", interpretRatio("profitMargin",r.profitMargin))+
        ratioCard("Current ratio", r.currentRatio===null?"N/A":fmtNum(r.currentRatio,2)+"x", "Current assets divided by current liabilities — short-term liquidity.", interpretRatio("currentRatio",r.currentRatio))+
      '</div>'+
      '<div class="grid grid-3" style="margin-bottom:14px;">'+
        ratioCard("Debt / equity", r.debtEquity===null?"N/A":fmtNum(r.debtEquity,2)+"x", "Total debt divided by owners’ equity — a measure of financial leverage.", interpretRatio("debtEquity",r.debtEquity))+
        ratioCard("DSCR", r.dscr===null?"N/A":fmtNum(r.dscr,2)+"x", "Cash flow available for debt service divided by existing annual debt obligation. A higher value means more repayment headroom.", interpretRatio("dscr",r.dscr))+
        '<div class="card" style="display:flex;flex-direction:column;justify-content:center;align-items:center;background:'+healthBg+';border-color:'+healthBg+';">'+
          '<div style="font-size:12.5px;font-weight:500;color:'+healthColor+';">Financial health</div>'+
          '<div style="font-family:var(--font-display);font-weight:600;font-size:19px;color:'+healthColor+';margin-top:4px;">'+health+'</div>'+
          '<div style="font-size:10.5px;color:'+healthColor+';margin-top:6px;text-align:center;">Prototype composite indicator</div>'+
        '</div>'+
      '</div>'+

      '<div class="grid grid-3" style="margin-bottom:16px;">'+
        '<div class="card"><div class="section-title">Working capital</div><div class="section-sub">Current assets minus current liabilities</div><div class="mono" style="font-size:21px;font-weight:500;margin-top:8px;">'+fmtINR(r.workingCapital)+'</div><div style="font-size:11.5px;font-weight:500;color:'+(r.workingCapital>=0?'var(--green-600)':'var(--red-600)')+';margin-top:4px;">'+(r.workingCapital>=0?'Positive working-capital buffer':'Working-capital deficit')+'</div></div>'+
        '<div class="card"><div class="section-title">Profit growth</div><div class="section-sub">Change in net profit versus previous year</div><div class="mono" style="font-size:21px;font-weight:500;margin-top:8px;">'+(r.profitGrowth===null?'N/A':fmtNum(r.profitGrowth)+"%")+'</div><div style="font-size:11.5px;font-weight:500;color:'+(r.profitGrowth===null?'var(--amber-600)':(r.profitGrowth>=0?'var(--teal-600)':'var(--red-600)'))+';margin-top:4px;">'+(r.profitGrowth===null?'Both years need valid profit data':(r.profitGrowth>=0?'Profit improving':'Profit declining'))+'</div></div>'+
        '<div class="card"><div class="section-title">Cash flow margin</div><div class="section-sub">CFADS as % of current-year revenue</div><div class="mono" style="font-size:21px;font-weight:500;margin-top:8px;">'+(r.cashFlowMargin===null?'N/A':fmtNum(r.cashFlowMargin)+"%")+'</div><div style="font-size:11.5px;font-weight:500;color:'+(r.cashFlowMargin===null?'var(--amber-600)':(r.cashFlowMargin>0?'var(--teal-600)':'var(--red-600)'))+';margin-top:4px;">'+(r.cashFlowMargin===null?'Correct revenue inputs first':(r.cashFlowMargin>0?'Positive cash generation':'Negative cash generation'))+'</div></div>'+
      '</div>'+

      '<div class="card" style="margin-bottom:16px;">'+
        '<div class="section-title">How this application is being assessed</div>'+
        '<div class="section-sub">The reference bank-segment document emphasizes different financial evidence as ticket size increases.</div>'+
        '<div class="grid grid-2" style="margin-top:10px;">'+
          statLine("Bank segment", seg.segment)+
          statLine("Typical tenure", seg.tenure)+
          statLine("Key credit focus", escapeHtml(seg.assessment))+
          statLine("Typical products", escapeHtml(seg.products))+
        '</div>'+
      '</div>'+

      '<div class="callout callout-warn">Thresholds in this prototype are illustrative indicators for academic demonstration. The attached reference specifies <strong>Financials, DSCR, leverage, working capital, cash flow and stress-test focus areas</strong> by segment, but does not prescribe universal ratio cut-offs.</div>'+
    '</div>'+
    '<div class="card">'+
      '<div class="section-title">Financial inputs</div><div class="section-sub">Use the latest financial statements. Ratios recalculate automatically after each change.</div>'+
      '<div style="display:flex;flex-direction:column;gap:12px;">'+inputRows+'</div>'+
      '<div class="divider"></div>'+
      '<div class="section-title" style="font-size:13px;">Input guidance</div>'+
      '<div class="section-sub" style="line-height:1.65;">Revenue and profit should come from the same reporting period. Current assets/liabilities drive working capital and the current ratio. Existing debt and owners’ equity drive leverage. Cash flow available for debt service and annual debt obligation drive DSCR.</div>'+
    '</div>'+
  '</div>'+
  disclaimerHTML();
}

function updateFinField(appId, key, value){
  const app = getApp(appId);
  const parsed = Number(value);
  app.fin[key] = Number.isFinite(parsed) ? parsed : 0;
  render();
}

/* ===================== CREDIT ASSESSMENT ===================== */
function creditHTML(){
  const app = getApp(UI.appId);
  const cs = calcCreditScore(app);
  const insights = aiInsights(app);
  const pct = clamp(cs.total,0,100);
  const angle = (pct/100)*180;
  const gaugeColor = cs.risk==="Low Risk" ? "#2F7A4C" : (cs.risk==="Moderate Risk" ? "#C69522" : "#AE3A2F");

  const breakdownRows = Object.values(cs.breakdown).map(b=>{
    const w = Math.round((b.score/b.max)*100);
    return '<div style="margin-bottom:11px;"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;"><span>'+b.label+'</span><span class="mono" style="font-weight:500;">'+fmtNum(b.score,1)+' / '+b.max+'</span></div><div class="meter-track"><div class="meter-fill" style="width:'+w+'%;"></div></div></div>';
  }).join("");

  return pageHead("Credit assessment", "A 100-point score built from seven weighted factors, and the risk band it puts this business in.", escapeHtml(app.businessName)+", "+app.id) +
  '<div class="callout callout-disclaimer" style="margin-bottom:16px;"><strong>Prototype scoring model for academic demonstration.</strong> Weights and thresholds are illustrative and not based on any actual bank policy.</div>'+

  '<div class="two-col">'+
    '<div class="card" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">'+
      '<div class="section-title">Credit risk score</div>'+
      '<svg viewBox="0 0 200 110" style="width:220px;margin:8px 0 4px 0;">'+
        '<path d="M15 100 A85 85 0 0 1 185 100" fill="none" stroke="#EBEFEA" stroke-width="12" stroke-linecap="butt"/>'+
        '<path d="M15 100 A85 85 0 0 1 185 100" fill="none" stroke="'+gaugeColor+'" stroke-width="12" stroke-linecap="butt" stroke-dasharray="'+(angle/180*267)+' 267"/>'+
        '<text x="100" y="90" text-anchor="middle" font-family="Source Serif 4, Georgia, serif" font-size="38" font-weight="500" fill="#17211C">'+fmtNum(cs.total,0)+'</text>'+
        '<text x="100" y="106" text-anchor="middle" font-family="IBM Plex Sans, sans-serif" font-size="10.5" fill="#88938C">out of 100</text>'+
      '</svg>'+
      '<span class="badge '+riskBadgeClass(cs.risk)+'" style="font-size:13px;padding:4px 12px;margin-top:8px;">'+cs.risk+'</span>'+
      '<div class="divider" style="width:100%;"></div>'+
      '<div style="text-align:left;width:100%;">'+
        '<div class="section-sub" style="margin-bottom:8px;">Risk bands: 75 to 100 is low, 50 to 74 is moderate, below 50 is high.</div>'+
      '</div>'+
    '</div>'+
    '<div class="card">'+
      '<div class="section-title">Score breakdown</div><div class="section-sub">Seven weighted factors adding up to 100 points. Weights are illustrative.</div>'+
      breakdownRows+
    '</div>'+
  '</div>'+

  '<div class="grid grid-2" style="margin-top:16px;">'+
    '<div class="card"><div class="section-title">Positive factors</div><ul class="list-strengths">'+insights.strengths.map(s=>'<li>'+s+'</li>').join("")+'</ul></div>'+
    '<div class="card"><div class="section-title">Risk factors</div><ul class="list-concerns">'+insights.concerns.map(s=>'<li>'+s+'</li>').join("")+'</ul></div>'+
  '</div>'+

  '<div class="card" style="margin-top:16px;">'+
    '<div class="section-title">Adjust manual inputs</div><div class="section-sub">Credit History and Banking Behaviour are relationship-manager assessed inputs in this prototype (bureau/banking data would feed these in a real system)</div>'+
    '<div class="form-grid">'+
      '<div class="field"><label>Credit history score (out of 25)</label><input type="number" min="0" max="25" value="'+app.creditInputs.creditHistory+'" onchange="updateCreditInput(\''+app.id+'\',\'creditHistory\',this.value,25)"/></div>'+
      '<div class="field"><label>Banking behaviour score (out of 15)</label><input type="number" min="0" max="15" value="'+app.creditInputs.bankingBehaviour+'" onchange="updateCreditInput(\''+app.id+'\',\'bankingBehaviour\',this.value,15)"/></div>'+
    '</div>'+
  '</div>'+
  disclaimerHTML();
}

function updateCreditInput(appId, key, value, max){
  const app = getApp(appId);
  app.creditInputs[key] = clamp(parseFloat(value)||0,0,max);
  render();
}

/* ===================== LOAN ELIGIBILITY ===================== */
function eligibilityHTML(){
  const app = getApp(UI.appId);
  const cs = calcCreditScore(app);
  const base = calcEligibility(app);

  return pageHead("Eligibility and pricing", "How much this business can indicatively borrow, and the rate built up from the RBI repo rate.", escapeHtml(app.businessName)+", "+app.id) +
  '<div class="two-col">'+
    '<div class="card">'+
      '<div class="section-title">Indicative eligibility calculator</div>'+
      '<div class="section-sub">Adjust the loan amount, interest rate or tenure below to see the EMI update instantly.</div>'+
      '<div class="grid grid-2" style="margin-bottom:14px;">'+
        '<div class="stat-line"><span class="k">Loan requested</span><span class="v">'+fmtINR(app.loan.amount)+'</span></div>'+
        '<div class="stat-line"><span class="k">Indicative eligible amount</span><span class="v" style="color:var(--teal-600);">'+fmtINR(base.eligible)+'</span></div>'+
      '</div>'+
      '<div class="form-grid">'+
        '<div class="field"><label>Loan amount (&#8377;)</label><input id="emiAmount" type="number" value="'+base.eligible+'" oninput="liveEMI(\''+app.id+'\')"/></div>'+
        '<div class="field"><label>Interest rate (% p.a.)</label><input id="emiRate" type="number" step="0.05" value="'+base.rate+'" oninput="liveEMI(\''+app.id+'\')"/></div>'+
        '<div class="field field-span2"><label>Tenure (years)</label><input id="emiTenure" type="number" step="1" min="1" value="'+base.tenure+'" oninput="liveEMI(\''+app.id+'\')"/></div>'+
      '</div>'+
      '<div class="divider"></div>'+
      '<div class="grid grid-3">'+
        '<div class="card" style="background:var(--bg);"><div class="kpi-label">Estimated EMI</div><div id="emiResult" class="mono" style="font-size:20px;font-weight:500;margin-top:4px;">'+fmtINR(base.emi)+'</div></div>'+
        '<div class="card" style="background:var(--bg);"><div class="kpi-label">Total payment</div><div id="emiTotal" class="mono" style="font-size:20px;font-weight:500;margin-top:4px;">'+fmtINR(base.totalPayment)+'</div></div>'+
        '<div class="card" style="background:var(--bg);"><div class="kpi-label">Total interest</div><div id="emiInterest" class="mono" style="font-size:20px;font-weight:500;margin-top:4px;">'+fmtINR(base.totalPayment-base.eligible)+'</div></div>'+
      '</div>'+
      '<div class="callout callout-warn" style="margin-top:14px;">This is an <strong>Indicative Eligibility</strong> estimate for demonstration purposes, not an actual credit sanction or lending decision.</div>'+
    '</div>'+
    '<div class="card">'+
      '<div class="section-title">Basis of calculation</div><div class="section-sub">How the indicative eligible amount was derived (prototype logic)</div>'+
      statLine("Credit risk category", '<span class="badge '+riskBadgeClass(cs.risk)+'">'+riskWord(cs.risk)+'</span>')+
      statLine("Annual profit", fmtINR(app.fin.curProfit))+
      statLine("Profit-based cap (4x profit)", fmtINR(app.fin.curProfit*4))+
      statLine("Cash flow for debt service", fmtINR(app.fin.cashFlow))+
      statLine("Target minimum DSCR", "1.25x")+
      statLine("Indicative rate (risk-based)", fmtNum(indicativeRate(cs.risk, app))+"%")+
      '<div class="divider"></div>'+
      '<div class="section-sub">Eligible amount = lower of (a) requested amount, (b) ~4&times; annual profit, and (c) the loan size the business cash flow can service at a minimum 1.25x DSCR over the chosen tenure.</div>'+
    '</div>'+
  '</div>'+
  rbiPricingCardHTML(app)+
  disclaimerHTML();
}

function rbiPricingCardHTML(app){
  const fr = finalLendingRate(app);
  const seg = bankSegmentFor(app.loan.amount);
  return '<div class="card" style="margin-top:16px;">'+
    '<div class="card-row"><div><div class="section-title" style="margin-bottom:0;">RBI-Linked rate build-up</div><div class="section-sub" style="margin-bottom:0;">External benchmark (RBI Repo Rate) + bank spread, per the Bank Spread framework</div></div>'+
    (AUTH.role==="rm" ? '<button class="btn btn-outline btn-sm" onclick="promptRepoRate()">Update RBI Repo Rate</button>' : '')+
    '</div>'+
    '<div class="callout callout-info" style="margin:10px 0 14px 0;">RBI does not expose a public, CORS-enabled API for the Repo Rate, so this prototype cannot poll rbi.org.in directly from the browser. The Repo Rate below is a manually-refreshed benchmark (RM-editable) that every calculation on this page is linked to &mdash; change it once and pricing recalculates everywhere.</div>'+
    '<div class="grid grid-2">'+
      '<div>'+
        statLine("RBI repo rate (external benchmark)", fr.repoRate+"% <span style=\"font-weight:400;color:var(--text-faint);\">as of "+RBI_REPO_LAST_UPDATED+"</span>")+
        statLine("Funding/Cost of funds adj.", "+"+fr.spread.fundingCostAdj+"%")+
        statLine("Operating cost", "+"+fr.spread.operatingCost+"%")+
        statLine("Credit risk premium (PD&times;LGD&times;EAD/Loan)", "+"+fmtNum(fr.spread.creditRiskPremium,2)+"%")+
        statLine("Tenor/Liquidity premium", "+"+fr.spread.tenorLiquidityPremium+"%")+
        statLine("Capital charge", "+"+fr.spread.capitalCharge+"%")+
        statLine("Profit margin", "+"+fr.spread.profitMargin+"%")+
        statLine("Risk mitigants (secured/CGTMSE)", "&minus;"+fr.spread.riskMitigants+"%")+
      '</div>'+
      '<div>'+
        '<div class="card" style="background:var(--bg);text-align:center;">'+
          '<div class="kpi-label">Final indicative lending rate</div>'+
          '<div class="mono" style="font-size:26px;font-weight:500;color:var(--navy-950);margin-top:6px;">'+fr.rate+'% p.a.</div>'+
          '<div style="font-size:11px;color:var(--text-faint);margin-top:4px;">Repo ('+fr.repoRate+'%) + Total Spread ('+fr.spread.totalSpread+'%) '+(app.interestRateType==="Fixed"?"+ fixed-rate loading (0.5%)":"")+'</div>'+
        '</div>'+
        '<div class="divider"></div>'+
        statLine("Bank segment (by ticket size)", seg.segment)+
        statLine("MSME category for segment", seg.category)+
        statLine("Typical products for segment", seg.products)+
        statLine("Indicative tenure band", seg.tenure)+
      '</div>'+
    '</div>'+
  '</div>';
}
function promptRepoRate(){
  const v = prompt("Enter the new RBI Repo Rate (%), per the latest MPC announcement:", RBI_REPO_RATE);
  if(v===null) return;
  const d = prompt("Effective date of this MPC decision (YYYY-MM-DD):", new Date().toISOString().slice(0,10));
  setRepoRate(v, d);
  render();
  showToast("RBI Repo Rate updated to "+RBI_REPO_RATE+"% — all indicative pricing recalculated.");
}

function liveEMI(appId){
  const app = getApp(appId);
  const amount = parseFloat(document.getElementById("emiAmount").value)||0;
  const rate = parseFloat(document.getElementById("emiRate").value)||0;
  const tenure = parseFloat(document.getElementById("emiTenure").value)||1;
  const emi = calcEMI(amount, rate, tenure);
  const total = emi*Math.round(tenure*12);
  document.getElementById("emiResult").textContent = fmtINR(emi);
  document.getElementById("emiTotal").textContent = fmtINR(total);
  document.getElementById("emiInterest").textContent = fmtINR(total-amount);
  UI.eligOverride[appId] = {amount, rate, tenure};
}

/* ===================== AI BUSINESS INSIGHTS ===================== */
function aiInsightsHTML(){
  const app = getApp(UI.appId);
  const ins = aiInsights(app);
  return pageHead("AI business insights", "A written read of the business, generated by rules from the figures entered so far.", escapeHtml(app.businessName)+", "+app.id) +
  '<div class="callout callout-disclaimer" style="margin-bottom:16px;"><strong>AI-generated prototype insight.</strong> This is a rules-based illustrative summary for demonstration, not an actual credit approval or underwriting output.</div>'+
  '<div class="card" style="margin-bottom:16px;">'+
    '<div class="section-title">AI business assessment</div>'+
    '<p style="font-family:var(--font-display);font-size:17px;line-height:1.65;color:var(--text);margin:12px 0 4px;max-width:68ch;">'+escapeHtml(ins.paragraph)+'</p>'+
  '</div>'+
  '<div class="grid grid-2" style="margin-bottom:16px;">'+
    '<div class="card"><div class="section-title">Strengths</div><ul class="list-strengths">'+ins.strengths.map(s=>'<li>'+s+'</li>').join("")+'</ul></div>'+
    '<div class="card"><div class="section-title">Concerns</div><ul class="list-concerns">'+ins.concerns.map(s=>'<li>'+s+'</li>').join("")+'</ul></div>'+
  '</div>'+
  '<div class="grid grid-2">'+
    '<div class="card"><div class="kpi-label">Suggested loan purpose</div><div style="font-family:var(--font-display);font-weight:600;font-size:16px;margin-top:6px;">'+ins.suggestedPurpose+'</div></div>'+
    '<div class="card"><div class="kpi-label">Suggested customer segment</div><div style="font-family:var(--font-display);font-weight:600;font-size:16px;margin-top:6px;">'+ins.segment.maturity+' ('+ins.segment.size+')</div></div>'+
  '</div>'+
  disclaimerHTML();
}

/* ===================== LOAN RECOMMENDATION ===================== */
function recommendationHTML(){
  const app = getApp(UI.appId);
  const rec = recommendation(app);
  return pageHead("Loan recommendation", "The product that fits the stated purpose, sized to the indicative eligible amount.", escapeHtml(app.businessName)+", "+app.id) +
  '<div class="card" style="margin-bottom:16px;border-color:var(--ledger);box-shadow:inset 3px 0 0 var(--ledger);">'+
    '<div class="crumb">Recommended product</div>'+
    '<div style="font-family:var(--font-display);font-size:22px;font-weight:600;color:var(--navy-950);margin:4px 0 10px 0;">'+rec.primary+'</div>'+
    '<div style="font-size:13px;color:var(--text-muted);margin-bottom:16px;">'+rec.why+'</div>'+
    '<div class="grid grid-4">'+
      '<div class="stat-line" style="flex-direction:column;align-items:flex-start;gap:4px;"><span class="k">Recommended amount</span><span class="v" style="font-size:16px;">'+fmtINR(rec.amount)+'</span></div>'+
      '<div class="stat-line" style="flex-direction:column;align-items:flex-start;gap:4px;"><span class="k">Suggested tenure</span><span class="v" style="font-size:16px;">'+rec.tenure+' years</span></div>'+
      '<div class="stat-line" style="flex-direction:column;align-items:flex-start;gap:4px;"><span class="k">Indicative interest rate</span><span class="v" style="font-size:16px;">'+fmtNum(rec.rate)+'%</span></div>'+
      '<div class="stat-line" style="flex-direction:column;align-items:flex-start;gap:4px;"><span class="k">Estimated EMI</span><span class="v" style="font-size:16px;">'+fmtINR(rec.emi)+'</span></div>'+
    '</div>'+
  '</div>'+
  '<div class="card">'+
    '<div class="section-title">Alternative product options</div><div class="section-sub">Other MSME products the RM may also consider</div>'+
    '<div class="chip-row">'+rec.alternatives.map(a=>'<span class="chip">'+a+'</span>').join("")+'</div>'+
  '</div>'+
  disclaimerHTML();
}

/* ===================== APPLICATION DECISION ===================== */
function decisionHTML(){
  const app = getApp(UI.appId);
  const r = calcRatios(app.fin);
  const cs = calcCreditScore(app);
  const dc = docCompletion(app);
  const rec = recommendation(app);
  const elig = calcEligibility(app);

  let finalReco = "Recommended for credit review";
  let finalColor = "var(--teal-600)"; let finalBg="var(--teal-100)";
  if(cs.risk==="High Risk" || dc<50){ finalReco = "Not recommended at this stage"; finalColor="var(--red-600)"; finalBg="var(--red-100)"; }
  else if(cs.risk==="Low Risk" && dc>=90){ finalReco = "Recommended for approval"; finalColor="var(--green-600)"; finalBg="var(--green-100)"; }

  const decisionBanner = app.decision ? '<div class="callout callout-info" style="margin-bottom:16px;">Latest workflow action recorded: <strong>'+app.decision+'</strong></div>' : "";

  return pageHead("Decision", "Everything the credit committee would look at, on one page.", escapeHtml(app.businessName)+", "+app.id) +
  decisionBanner+
  '<div class="grid grid-2" style="margin-bottom:16px;">'+
    '<div class="card">'+
      '<div class="section-title">Application summary</div>'+
      statLine("Customer", app.businessName)+
      statLine("Loan requested", fmtINR(app.loan.amount))+
      statLine("Indicative eligible amount", fmtINR(elig.eligible))+
      statLine("Credit risk score", fmtNum(cs.total,0)+"/100")+
      statLine("Risk category", '<span class="badge '+riskBadgeClass(cs.risk)+'">'+riskWord(cs.risk)+'</span>')+
      statLine("Document completion", dc+"%")+
      statLine("DSCR (repayment capacity)", fmtNum(r.dscr,2)+"x")+
      statLine("Recommended product", rec.primary)+
    '</div>'+
    '<div class="verdict" style="background:'+finalBg+';color:'+finalColor+';border:1px solid '+finalBg+';">'+
      '<div class="kpi-label" style="color:inherit;">Prototype recommendation</div>'+
      '<div class="v-title">'+finalReco+'</div>'+
      '<div class="v-note">Based on a '+riskWord(cs.risk).toLowerCase()+' risk score of '+fmtNum(cs.total,0)+' and a document checklist that is '+dc+'% complete. Final sanction still needs verification and underwriting.</div>'+
    '</div>'+
  '</div>'+
  (AUTH.role==="rm" ?
  '<div class="card">'+
    '<div class="section-title">Record a decision</div><div class="section-sub">These update the application\'s pipeline stage in this demo &mdash; they are not real loan approvals.</div>'+
    '<div style="display:flex;gap:10px;flex-wrap:wrap;">'+
      '<button class="btn btn-primary" onclick="makeDecision(\''+app.id+'\',\'approve\')">Recommend for approval</button>'+
      '<button class="btn btn-outline" onclick="makeDecision(\''+app.id+'\',\'review\')">Send for further review</button>'+
      '<button class="btn btn-outline" onclick="makeDecision(\''+app.id+'\',\'docs\')">Mark documents pending</button>'+
      '<button class="btn btn-danger" onclick="makeDecision(\''+app.id+'\',\'reject\')">Reject application</button>'+
    '</div>'+
  '</div>' : '<div class="callout callout-info">Your Relationship Manager will update this status as your application progresses. This view is read-only.</div>')+
  disclaimerHTML();
}

function makeDecision(appId, action){
  const app = getApp(appId);
  if(action==="approve"){ app.stage="Approved"; app.decision="Recommended for Approval"; }
  else if(action==="review"){ app.stage="Credit Assessment"; app.decision="Sent for Further Review"; }
  else if(action==="docs"){ app.stage="Documents Pending"; app.decision="Marked Documents Pending"; }
  else if(action==="reject"){ app.stage="Rejected"; app.decision="Application Rejected"; }
  pushNotification(app.businessName+": "+app.decision+".");
  render();
  showToast("Prototype workflow action recorded: "+app.decision);
}

/* ===================== APPLICATION TRACKING ===================== */
function trackingHTML(){
  const industries = Array.from(new Set(applications.map(a=>a.industry)));
  let list = filteredForSearch(applications);
  const f = UI.trackerFilters;
  if(f.status!=="All") list = list.filter(a=>a.stage===f.status);
  if(f.risk!=="All") list = list.filter(a=>calcCreditScore(a).risk===f.risk);
  if(f.industry!=="All") list = list.filter(a=>a.industry===f.industry);

  const nextActionFor = (a)=>{
    const dc = docCompletion(a);
    if(a.stage==="New") return "Collect documents";
    if(a.stage==="Documents Pending") return dc<100 ? "Complete document verification" : "Move to Documents Verified";
    if(a.stage==="Documents Verified") return "Run financial analysis";
    if(a.stage==="Financial Analysis") return "Proceed to credit assessment";
    if(a.stage==="Credit Assessment") return "Generate recommendation";
    if(a.stage==="Recommended") return "Take application decision";
    if(a.stage==="Approved") return "Proceed to disbursement";
    if(a.stage==="Rejected") return "Closed";
    if(a.stage==="Disbursed") return "Completed";
    return "-";
  };

  const rows = list.map(a=>{
    const cs = calcCreditScore(a);
    const stageOptions = STAGES.map(s=>'<option value="'+s+'" '+(s===a.stage?"selected":"")+'>'+s+'</option>').join("");
    return '<tr>'+
      '<td><button class="tbl-link" onclick="selectApp(\''+a.id+'\',\'profile\')"><div class="tbl-name">'+escapeHtml(a.businessName)+'</div><div class="tbl-sub">'+a.id+', '+escapeHtml(a.industry)+'</div></button></td>'+
      '<td class="mono num">'+fmtINR(a.loan.amount)+'</td>'+
      '<td><select onchange="advanceStage(\''+a.id+'\',this.value)" style="border:1px solid var(--border);border-radius:6px;padding:5px 7px;font-size:11.5px;">'+stageOptions+'</select></td>'+
      '<td><span class="badge '+riskBadgeClass(cs.risk)+'">'+riskWord(cs.risk)+'</span></td>'+
      '<td class="tbl-sub">'+a.rm+'</td>'+
      '<td class="tbl-sub">'+a.date+'</td>'+
      '<td style="font-size:11.5px;color:var(--text-muted);">'+nextActionFor(a)+'</td>'+
    '</tr>';
  }).join("");

  const statusOpts = ["All"].concat(STAGES).map(s=>'<option value="'+s+'" '+(UI.trackerFilters.status===s?"selected":"")+'>'+(s==="All"?"All stages":s)+'</option>').join("");
  const riskOpts = ["All","Low Risk","Moderate Risk","High Risk"].map(s=>'<option value="'+s+'" '+(UI.trackerFilters.risk===s?"selected":"")+'>'+(s==="All"?"All risk levels":s)+'</option>').join("");
  const indOpts = ["All"].concat(industries).map(s=>'<option value="'+escapeHtml(s)+'" '+(UI.trackerFilters.industry===s?"selected":"")+'>'+(s==="All"?"All industries":escapeHtml(s))+'</option>').join("");

  return pageHead("Application tracking", list.length+" of "+applications.length+" applications shown. Change a stage directly from the table.") +
  '<div class="filter-bar">'+
    '<select aria-label="Filter by stage" onchange="setTrackerFilter(\'status\',this.value)">'+statusOpts+'</select>'+
    '<select onchange="setTrackerFilter(\'risk\',this.value)">'+riskOpts+'</select>'+
    '<select onchange="setTrackerFilter(\'industry\',this.value)">'+indOpts+'</select>'+
    (f.status!=="All"||f.risk!=="All"||f.industry!=="All" ? '<button class="btn btn-ghost btn-sm" onclick="clearTrackerFilters()">Clear filters</button>' : "")+
  '</div>'+
  '<div class="card">'+
    '<div style="overflow-x:auto;"><table><thead><tr><th>Business</th><th class="num">Requested</th><th>Stage</th><th>Risk</th><th>RM</th><th>Opened</th><th>Next action</th></tr></thead><tbody>'+
    (rows || '<tr><td colspan="7" style="text-align:center;color:var(--text-faint);padding:28px;">No applications match these filters.</td></tr>')+
    '</tbody></table></div>'+
  '</div>'+
  disclaimerHTML();
}

function setTrackerFilter(key, value){ UI.trackerFilters[key]=value; render(); }
function clearTrackerFilters(){ UI.trackerFilters={status:"All",risk:"All",industry:"All"}; render(); }
function advanceStage(appId, stage){ const app=getApp(appId); app.stage=stage; render(); showToast(app.businessName+" moved to \""+stage+"\""); }

/* ===================== NAV / GLOBAL HANDLERS ===================== */
function navigate(view){ UI.view = view; UI.sidebarOpen = false; UI.profileMenuOpen = false; render(); window.scrollTo(0,0); }
function selectApp(id, thenView){ UI.appId = id; UI.view = thenView; render(); window.scrollTo(0,0); }
function onGlobalSearch(v){ UI.search = v; render(); document.getElementById("globalSearch").focus(); document.getElementById("globalSearch").selectionStart = document.getElementById("globalSearch").selectionEnd = v.length; }

let toastTimer=null;
function showToast(msg){
  const host = document.getElementById("toastHost");
  host.innerHTML = '<div class="toast" role="status">'+msg+'</div>';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ host.innerHTML=""; }, 3200);
}

/* ===================== TEST DATA GENERATOR ===================== */
function rand(min, max){ return min + Math.random()*(max-min); }
function randInt(min, max){ return Math.floor(rand(min, max+1)); }
function pick(arr){ return arr[randInt(0, arr.length-1)]; }

const TEST_NAME_PREFIXES = ["Om Sai","Shree Ganesh","New India","Sunrise","Green Valley","Star","Om","Krishna","National","City","Bharat","Royal","Sai Baba","Metro","Sunshine","Global","United","Prime","Deccan","Heritage","Modern","Vishnu","Lakshmi","Everest","Rising","Coastal","Silver","Golden","Unity","Progressive"];
const TEST_NAME_SUFFIXES = ["Textiles","Traders","Foods","Engineering Works","Enterprises","Industries","Agro","Motors","Constructions","Apparels","Electricals","Plastics","Furniture","Logistics","Pharma","Print & Packaging","Bakers","Chemicals","Handicrafts","Solutions","Exports","Fabricators","Mills","Stores","Services"];
const TEST_INDUSTRIES = ["Textiles","Manufacturing","Trading","Food Processing","Retail","Services","Construction","Agriculture","Auto Components","Handicrafts","Electronics","Pharmaceuticals","Logistics","Hospitality","IT Services","Printing & Packaging","Chemicals","Furniture","Plastics","Education Services"];
const TEST_LOCATIONS = ["Mumbai, Maharashtra","Pune, Maharashtra","Nashik, Maharashtra","Ahmedabad, Gujarat","Surat, Gujarat","Jaipur, Rajasthan","Ludhiana, Punjab","Coimbatore, Tamil Nadu","Chennai, Tamil Nadu","Bengaluru, Karnataka","Hyderabad, Telangana","Indore, Madhya Pradesh","Nagpur, Maharashtra","Kanpur, Uttar Pradesh","Rajkot, Gujarat","Vadodara, Gujarat","Kolhapur, Maharashtra","Salem, Tamil Nadu"];
const TEST_OWNER_FIRST = ["Ramesh","Suresh","Amit","Priya","Anjali","Vikram","Sunita","Rajesh","Kavita","Manoj","Deepak","Pooja","Arjun","Neha","Sanjay","Meena","Vinod","Shweta","Ganesh","Rekha"];
const TEST_OWNER_LAST = ["Sharma","Patel","Kumar","Singh","Reddy","Iyer","Deshmukh","Joshi","Verma","Gupta","Nair","Chauhan","Mehta","Agarwal","Rao","Kulkarni"];

function generateTestApplications(n){
  const out = [];
  for(let i=0;i<n;i++){
    const loanAmount = randInt(3,120) * 100000; // 3L to 1.2Cr
    const turnoverMultiplier = rand(2.2, 6.5);
    const curRevenue = Math.round(loanAmount*turnoverMultiplier);
    const growthPct = rand(-8, 28);
    const prevRevenue = Math.round(curRevenue/(1+growthPct/100));
    const marginPct = rand(2, 18);
    const curProfit = Math.round(curRevenue*marginPct/100);
    const prevProfit = Math.round(prevRevenue*(marginPct/100)*rand(0.85,1.05));
    const currentLiabilities = Math.round(curRevenue*rand(0.10,0.22));
    const currentRatioTarget = rand(0.7,2.2);
    const currentAssets = Math.round(currentLiabilities*currentRatioTarget);
    const equity = Math.round(curRevenue*rand(0.18,0.42));
    const debtEquityTarget = rand(0.3,2.4);
    const totalDebt = Math.round(equity*debtEquityTarget);
    const annualDebtObligation = Math.round(loanAmount*rand(0.18,0.35));
    const dscrTarget = rand(0.75,2.3);
    const cashFlow = Math.round(annualDebtObligation*dscrTarget);
    const investment = Math.round(loanAmount*rand(1.5,4));
    const years = randInt(1,25);
    const stage = pick(["New","New","Documents Pending","Documents Pending","Documents Verified","Financial Analysis","Credit Assessment","Credit Assessment","Recommended","Approved","Approved","Rejected","Disbursed"]);
    const docProgress = {"New":0,"Documents Pending":0.3,"Documents Verified":1,"Financial Analysis":1,"Credit Assessment":1,"Recommended":1,"Approved":1,"Rejected":0.6,"Disbursed":1}[stage];
    const docPattern = {};
    DOC_LIST.forEach(d=>{
      const r = Math.random();
      docPattern[d.key] = r < docProgress*0.4 ? "Pending" : r < docProgress*0.7 ? "Uploaded" : r < docProgress*0.9 ? "Under Verification" : "Verified";
    });
    let decision = null;
    if(stage==="Approved" || stage==="Disbursed") decision = "Recommended for Approval";
    else if(stage==="Rejected") decision = "Application Rejected";
    else if(stage==="Credit Assessment") decision = Math.random()<0.4 ? "Sent for Further Review" : null;
    const daysAgo = randInt(0,120);
    const date = new Date(Date.now()-daysAgo*86400000).toISOString().slice(0,10);
    const app = {
      id: "MSME-"+(nextAppSeq++),
      businessName: pick(TEST_NAME_PREFIXES)+" "+pick(TEST_NAME_SUFFIXES),
      businessType: pick(["Proprietorship","Partnership","LLP","Private Limited"]),
      industry: pick(TEST_INDUSTRIES),
      location: pick(TEST_LOCATIONS),
      yearsInBusiness: years,
      employees: randInt(2,150),
      udyam: Math.random()<0.75 ? "Registered" : "Not Registered",
      udyamId: Math.random()<0.75 ? "UDYAM-"+pick(["MH","GJ","RJ","TN","KA","TG"])+"-"+randInt(1,33)+"-"+String(randInt(1000,9999)).padStart(7,"0") : "",
      investmentPlantMachinery: investment,
      gst: Math.random()<0.85 ? "Registered" : "Not Registered",
      owner:{ name: pick(TEST_OWNER_FIRST)+" "+pick(TEST_OWNER_LAST), age: randInt(24,62), experience: Math.min(years, randInt(1,30)), managementYears: randInt(1,20) },
      loan:{ amount: loanAmount, purpose: pick(["Working Capital","Machinery Purchase","Business Expansion","Inventory Purchase","Commercial Vehicle","Other"]), tenure: randInt(1,10) },
      loanType: pick(["Secured","Unsecured"]), interestRateType: pick(["Floating","Fixed"]), subsidyScheme: pick(Object.keys(SUBSIDY_SCHEMES)), notes:"",
      fin:{ curRevenue, prevRevenue, curProfit, prevProfit, currentAssets, currentLiabilities, totalDebt, equity, annualDebtObligation, cashFlow },
      creditInputs:{ creditHistory: randInt(0,24), bankingBehaviour: randInt(0,15) },
      documents: docPattern,
      docFiles:{},
      stage, rm: RM.name, date, decision
    };
    out.push(app);
  }
  return out;
}
function loadTestData(){
  const proceed = confirm("This adds 60 realistic test applications spanning every stage and risk category, on top of whatever you already have. Continue?");
  if(!proceed) return;
  const batch = generateTestApplications(60);
  applications = batch.concat(applications);
  pushNotification("Loaded 60 test applications for demo/testing.");
  render();
  showToast("Added 60 test applications across all stages and risk categories.");
}

/* ===================== INIT ===================== */
(async function boot(){
  // Firebase (Firestore + Auth) is the app's real backend from the moment it
  // loads — no manual "connect" step required for the default project.
  await connectFirebase(FIREBASE_CONFIG);
  await initFirebaseAuth();
  loadData();
  render();
})();
