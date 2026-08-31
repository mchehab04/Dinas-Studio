/* ========================= DATA ========================= */
const CATEGORIES = ["All","Matching Sets","Abayas","Kimonos","Accessories"];

const PALETTES = [
  ["#C55B54","#A63A3A"], ["#E89BA3","#D97C8B"], ["#CFA15C","#B4791C"],
  ["#8A6B63","#6B4D45"], ["#D97C8B","#832D2D"], ["#E4B8A0","#C58B6B"]
];

function heartSVG(){
  return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7-4.35-9.5-8.5C.7 8.6 3 5 6.6 5 9 5 11 6.5 12 8c1-1.5 3-3 5.4-3 3.6 0 5.9 3.6 4.1 7.5C19 16.65 12 21 12 21z"/></svg>`;
}
function dressSVG(){
  return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 2l3 2 3-2 1 5-2 1 3 14H8L11 8 9 7z"/></svg>`;
}

let PRODUCTS = [];

/* ========================= STATE ========================= */
let state = {
  category: "All",
  sort: "popularity",
  sortLabel: "Popularity",
  search: "",
  wishlist: new Set(),
  bag: [], // {productId, size, qty}
  user: null, // {name, email}
  filterAvail: new Set(),
  filterPrice: null,
  filtersOpen: false,
};

function paletteFor(id){ return PALETTES[id % PALETTES.length]; }
function gradientStyle(id){
  const [a,b] = paletteFor(id);
  return `background:linear-gradient(150deg, ${a}, ${b});`;
}

/* ========================= MAIN NAV: About / Shop / Socials ========================= */
const TABS = ["About","Shop","Socials"];
state.tab = "shop";

function renderTopTabs(){
  document.getElementById('topTabs').innerHTML = TABS.map(t => {
    const key = t.toLowerCase();
    return `<button class="toptab ${state.tab===key?'active':''}" data-tab="${key}" onclick="setView('${key}')">${t}</button>`;
  }).join('');
  document.getElementById('desktopNav').innerHTML = TABS.map(t => {
    const key = t.toLowerCase();
    return `<button class="${state.tab===key?'active':''}" data-tab="${key}" onclick="setView('${key}')">${t}</button>`;
  }).join('');
}

function setView(tab){
  if(tab === 'socials'){
    document.getElementById('socialsSection').scrollIntoView({behavior:'smooth', block:'start'});
    return;
  }
  state.tab = tab;
  document.getElementById('shopView').style.display = tab === 'shop' ? '' : 'none';
  document.getElementById('aboutView').style.display = tab === 'about' ? '' : 'none';
  renderTopTabs();
  window.scrollTo({top:0, behavior:'smooth'});
}

/* ========================= FILTER PANEL (category, availability, price) ========================= */
function toggleFilters(){
  state.filtersOpen = !state.filtersOpen;
  document.getElementById('filterPanel').style.display = state.filtersOpen ? 'block' : 'none';
}
function renderFilterPanel(){
  const categoryRow = document.getElementById('categoryRow');
  categoryRow.innerHTML = CATEGORIES.map(c => `
    <button class="chip ${state.category===c?'active':''}" onclick="setCategory('${c}')">${c}</button>
  `).join('');

  const availRow = document.getElementById('availRow');
  const opts = [["in","In Stock"],["low","Low Stock"],["out","Notify Me"]];
  availRow.innerHTML = opts.map(([k,label]) => `
    <button class="chip ${state.filterAvail.has(k)?'active':''}" onclick="toggleAvail('${k}')">${label}</button>
  `).join('');
  const priceRow = document.getElementById('priceRow');
  const ranges = [["under50","Under $50"],["50to120","$50–120"],["over120","$120+"]];
  priceRow.innerHTML = ranges.map(([k,label]) => `
    <button class="chip ${state.filterPrice===k?'active':''}" onclick="setPriceFilter('${k}')">${label}</button>
  `).join('');
}
function setCategory(c){
  state.category = c;
  document.getElementById('shopTitle').textContent = c === "All" ? "Shop All" : "Shop " + c;
  renderFilterPanel(); renderGrid();
}
function toggleAvail(k){
  state.filterAvail.has(k) ? state.filterAvail.delete(k) : state.filterAvail.add(k);
  renderFilterPanel(); renderGrid();
}
function setPriceFilter(k){
  state.filterPrice = state.filterPrice === k ? null : k;
  renderFilterPanel(); renderGrid();
}

/* ========================= SORT ========================= */
function toggleSort(){ document.getElementById('sortMenu').classList.toggle('open'); }
function setSort(key,label){
  state.sort = key; state.sortLabel = label;
  document.getElementById('sortLabel').textContent = label;
  document.getElementById('sortMenu').classList.remove('open');
  document.querySelectorAll('.sort-menu button').forEach(b=>b.classList.toggle('active', b.dataset.sort===key));
  renderGrid();
}
document.addEventListener('click', (e)=>{
  if(!e.target.closest('.sortbar')) document.getElementById('sortMenu').classList.remove('open');
});

/* ========================= GRID ========================= */
function priceMatch(p){
  if(!state.filterPrice) return true;
  if(state.filterPrice==="under50") return p.price < 50;
  if(state.filterPrice==="50to120") return p.price>=50 && p.price<=120;
  if(state.filterPrice==="over120") return p.price>120;
  return true;
}
function stockRank(s){ return s==="in"?0:s==="low"?1:2; }

function getFiltered(){
  let list = PRODUCTS.filter(p=>{
    if(state.category!=="All" && p.cat!==state.category) return false;
    if(state.search && !p.name.toLowerCase().includes(state.search.toLowerCase())) return false;
    if(state.filterAvail.size>0 && !state.filterAvail.has(p.stock)) return false;
    if(!priceMatch(p)) return false;
    return true;
  });
  switch(state.sort){
    case "price-asc": list.sort((a,b)=>a.price-b.price); break;
    case "price-desc": list.sort((a,b)=>b.price-a.price); break;
    case "popularity": list.sort((a,b)=>b.pop-a.pop); break;
    case "availability": list.sort((a,b)=>stockRank(a.stock)-stockRank(b.stock)); break;
    case "new": list.sort((a,b)=>(b.nw===true)-(a.nw===true)); break;
  }
  return list;
}

function stockLabel(s){ return s==="in"?"In Stock":s==="low"?"Low Stock":"Sold Out"; }

function renderGrid(){
  state.search = document.getElementById('searchInput').value;
  const list = getFiltered();
  document.getElementById('resultCount').textContent = `${list.length} piece${list.length!==1?'s':''}`;
  const grid = document.getElementById('productGrid');
  if(list.length===0){
    grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px 10px; color:var(--ink-soft); font-size:13.5px;">No pieces match yet — try a different filter.</div>`;
    return;
  }
  grid.innerHTML = list.map(p => `
    <div class="card">
      <div class="card-img" style="${gradientStyle(p.id)}" onclick="openProduct(${p.id})">
        ${dressSVG()}
        <button class="wish-btn ${state.wishlist.has(p.id)?'active':''}" aria-label="Add to wishlist" onclick="event.stopPropagation(); toggleWish(${p.id})">${heartSVG()}</button>
        <span class="stock-tag ${p.stock}">${stockLabel(p.stock)}</span>
      </div>
      <div class="card-body" onclick="openProduct(${p.id})">
        <span class="card-cat">${p.cat}</span>
        <span class="card-name">${p.name}</span>
        <div class="card-bottom">
          <span class="card-price">$${p.price}</span>
          <button class="add-btn" onclick="event.stopPropagation(); quickAdd(${p.id})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function quickAdd(id){
  const p = PRODUCTS.find(x=>x.id===id);
  const size = p.sizes.find(s=>!p.soldOut.includes(s)) || p.sizes[0];
  addToBag(id, size, 1);
}

/* ========================= WISHLIST ========================= */

function toggleWish(id){
  const added = !state.wishlist.has(id);
  added ? state.wishlist.add(id) : state.wishlist.delete(id);
  renderGrid();
  if(document.getElementById('wishSheet').classList.contains('open')) renderWishlist();
  showToast(added ? "Saved to your favorites ♥" : "Removed from favorites");
  
  if (added) {
    // Try to find the button that was just clicked and animate it
    setTimeout(() => {
      document.querySelectorAll(`.wish-btn`).forEach(btn => {
        if(btn.innerHTML.includes(heartSVG()) && btn.classList.contains('active')) {
          btn.classList.add('animate-heart');
          setTimeout(() => btn.classList.remove('animate-heart'), 400);
        }
      });
      document.querySelectorAll(`.heart-toggle`).forEach(btn => {
        if(btn.classList.contains('active')) {
          btn.classList.add('animate-heart');
          setTimeout(() => btn.classList.remove('animate-heart'), 400);
        }
      });
    }, 10);
  }
}
function openWishlist(){
  renderWishlist();
  openSheet('wishSheet');
}
function renderWishlist(){
  const items = PRODUCTS.filter(p=>state.wishlist.has(p.id));
  const el = document.getElementById('wishContent');
  if(items.length===0){
    el.innerHTML = emptyState("Nothing saved yet","Tap the heart on any piece to save it here.");
    return;
  }
  el.innerHTML = `<div class="grid" style="padding:6px 20px 24px;">` + items.map(p=>`
    <div class="card">
      <div class="card-img" style="${gradientStyle(p.id)}" onclick="closeAllSheets(); setTimeout(()=>openProduct(${p.id}),260)">
        ${dressSVG()}
        <button class="wish-btn active" aria-label="Remove from wishlist" onclick="event.stopPropagation(); toggleWish(${p.id})">${heartSVG()}</button>
      </div>
      <div class="card-body">
        <span class="card-cat">${p.cat}</span>
        <span class="card-name">${p.name}</span>
        <div class="card-bottom"><span class="card-price">$${p.price}</span></div>
      </div>
    </div>
  `).join('') + `</div>`;
}

/* ========================= PRODUCT DETAIL ========================= */
let currentProduct = null;
let currentSize = null;
let currentQty = 1;

function openProduct(id){
  currentProduct = PRODUCTS.find(p=>p.id===id);
  currentSize = currentProduct.sizes.find(s=>!currentProduct.soldOut.includes(s)) || currentProduct.sizes[0];
  currentQty = 1;
  renderProductDetail();
  openSheet('pdSheet');
}
function renderProductDetail(){
  const p = currentProduct;
  document.getElementById('pdContent').innerHTML = `
    <div class="pd-gallery" style="${gradientStyle(p.id)}">
      ${dressSVG()}
    </div>
    <div class="pd-dots"><span class="active"></span><span></span><span></span></div>
    <div class="pd-body">
      <div class="pd-cat">${p.cat}${p.nw?' · New':''}</div>
      <h2 class="pd-name">${p.name}</h2>
      <div class="pd-price">$${p.price}</div>
      <p class="pd-desc">${p.desc}</p>

      <div class="pd-label">Size</div>
      <div class="size-row" id="sizeRow">
        ${p.sizes.map(s=>`
          <button class="size-pill ${currentSize===s?'active':''} ${p.soldOut.includes(s)?'disabled':''}"
            onclick="${p.soldOut.includes(s)?'':`selectSize('${s}')`}">${s}</button>
        `).join('')}
      </div>

      <div class="pd-label">Quantity</div>
      <div class="qty-row">
        <button class="qty-btn" onclick="changeQty(-1)">−</button>
        <span id="qtyVal" style="font-weight:700; font-size:15px;">${currentQty}</span>
        <button class="qty-btn" onclick="changeQty(1)">+</button>
      </div>
    </div>
    <div class="pd-footer">
      <button class="heart-toggle ${state.wishlist.has(p.id)?'active':''}" aria-label="Toggle wishlist" onclick="toggleWish(${p.id})">${heartSVG()}</button>
      <button class="primary-btn" onclick="addCurrentToBag()">
        ${p.stock==="out" ? "Notify When Available" : "Add to Bag — $"+p.price}
      </button>
    </div>
  `;
}
function selectSize(s){ currentSize = s; renderProductDetail(); }
function changeQty(d){ currentQty = Math.max(1, currentQty+d); document.getElementById('qtyVal').textContent = currentQty; }
function addCurrentToBag(){
  if(currentProduct.stock==="out"){
    showToast("We'll email you when it's back ✓");
    return;
  }
  addToBag(currentProduct.id, currentSize, currentQty);
  closeAllSheets();
}

/* ========================= BAG ========================= */

function addToBag(id, size, qty){
  const existing = state.bag.find(i=>i.productId===id && i.size===size);
  if(existing){ existing.qty += qty; }
  else { state.bag.push({productId:id, size, qty}); }
  updateBagBadge();
  showToast("Added to your bag ✓");
  
  // Animate bag badge
  const b1 = document.getElementById('bagBadge');
  const b2 = document.getElementById('navBagBadge');
  [b1, b2].forEach(b => {
    b.classList.remove('animate-badge');
    void b.offsetWidth; // trigger reflow
    b.classList.add('animate-badge');
  });
}
function updateBagBadge(){
  const count = state.bag.reduce((s,i)=>s+i.qty,0);
  const b1 = document.getElementById('bagBadge');
  const b2 = document.getElementById('navBagBadge');
  [b1,b2].forEach(b=>{
    b.style.display = count>0 ? 'flex':'none';
    b.textContent = count;
  });
}
function bagQtyChange(idx, d){
  state.bag[idx].qty += d;
  if(state.bag[idx].qty<=0) state.bag.splice(idx,1);
  updateBagBadge(); renderBag();
}
function removeBagItem(idx){ state.bag.splice(idx,1); updateBagBadge(); renderBag(); }

function openBag(){ renderBag(); openSheet('bagSheet'); }
function renderBag(){
  const el = document.getElementById('bagContent');
  if(state.bag.length===0){
    el.innerHTML = emptyState("Your bag is empty","Add a few favorites and they'll show up here.");
    return;
  }
  let subtotal = 0;
  const itemsHtml = state.bag.map((item, idx)=>{
    const p = PRODUCTS.find(x=>x.id===item.productId);
    subtotal += p.price * item.qty;
    return `
      <div class="bag-item">
        <div class="bag-thumb" style="${gradientStyle(p.id)}">${dressSVG()}</div>
        <div class="bag-info">
          <span class="bag-name">${p.name}</span>
          <span class="bag-meta">Size ${item.size}</span>
          <div class="bag-bottom">
            <div class="bag-qty">
              <button onclick="bagQtyChange(${idx},-1)">−</button>
              <span>${item.qty}</span>
              <button onclick="bagQtyChange(${idx},1)">+</button>
            </div>
            <span class="bag-price">$${p.price*item.qty}</span>
          </div>
          <button class="remove-x" onclick="removeBagItem(${idx})">Remove</button>
        </div>
      </div>
    `;
  }).join('');
  const shipping = subtotal >= 100 ? 0 : 8;
  const total = subtotal + shipping;
  el.innerHTML = itemsHtml + `
    <div class="bag-summary">
      <div class="sum-row"><span>Subtotal</span><span>$${subtotal}</span></div>
      <div class="sum-row"><span>Shipping</span><span>${shipping===0?'Free':'$'+shipping}</span></div>
      <div class="sum-row total"><span>Total</span><span>$${total}</span></div>
      <button class="primary-btn" style="width:100%; margin-top:12px;" onclick="showToast('Checkout coming soon ♥')">Checkout</button>
    </div>
  `;
}

/* ========================= ACCOUNT ========================= */
let authTab = "signin";
function openAccount(){
  renderAccount();
  openSheet('accountSheet');
}
function setAuthTab(t){ authTab = t; renderAccount(); }

function renderAccount(){
  const title = document.getElementById('accountTitle');
  const el = document.getElementById('accountContent');

  if(state.user){
    title.textContent = "My Account";
    el.innerHTML = `
      <div class="account-hero">
        <div class="avatar-circle">${state.user.name.charAt(0).toUpperCase()}</div>
        <div>
          <div style="font-weight:800; font-size:16px;">${state.user.name}</div>
          <div style="font-size:12px; color:var(--ink-faint);">${state.user.email}</div>
        </div>
      </div>
      <div class="account-menu">
        <div class="account-row">Orders <span class="sub"></span></div>
        <div class="account-row">Saved Items (${state.wishlist.size}) <span class="sub"></span></div>
        <div class="account-row">Shipping Addresses <span class="sub"></span></div>
        <div class="account-row">Payment Methods <span class="sub"></span></div>
        <div class="account-row">Notification Preferences <span class="sub"></span></div>
        <button class="signout-btn" onclick="signOut()">Sign Out</button>
      </div>
    `;
    return;
  }

  title.textContent = "Welcome";
  el.innerHTML = `
    <div class="auth-tabs">
      <button class="auth-tab ${authTab==='signin'?'active':''}" onclick="setAuthTab('signin')">Sign In</button>
      <button class="auth-tab ${authTab==='signup'?'active':''}" onclick="setAuthTab('signup')">Create Account</button>
    </div>
    <div class="auth-body">
      <button class="google-btn" onclick="mockGoogleAuth()">
        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.9 32.6 29.4 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34 5.1 29.3 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.4-.1-2.7-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34 5.1 29.3 3 24 3 16.3 3 9.7 7.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 45c5.2 0 9.9-2 13.5-5.2l-6.2-5.3C29.3 36.4 26.8 37 24 37c-5.3 0-9.8-3.4-11.4-8.1l-6.5 5C9.6 40.6 16.2 45 24 45z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.2 5.3C40.9 36.6 44 30.9 44 24c0-1.4-.1-2.7-.4-3.5z"/></svg>
        Continue with Google
      </button>
      <div class="divider-row"><div class="line"></div><span>OR</span><div class="line"></div></div>
      ${authTab==='signup' ? `
      <div class="field"><label>Full Name</label><input id="authName" placeholder="Dina Amari"></div>
      ` : ``}
      <div class="field"><label>Email</label><input id="authEmail" type="email" placeholder="you@email.com"></div>
      <div class="field"><label>Password</label><input id="authPass" type="password" placeholder="••••••••"></div>
      <button class="primary-btn" style="width:100%;" onclick="mockManualAuth()">${authTab==='signin' ? 'Sign In' : 'Create Account'}</button>
      ${authTab==='signin' ? `<div style="text-align:center; margin-top:14px; font-size:12.5px; color:var(--ink-faint);">Forgot password?</div>` : ``}
    </div>
  `;
}
function mockGoogleAuth(){
  state.user = {name:"Dina Amari", email:"dina@gmail.com"};
  renderAccount();
  showToast("Signed in with Google ✓");
}
function mockManualAuth(){
  const emailEl = document.getElementById('authEmail');
  const nameEl = document.getElementById('authName');
  const email = emailEl ? emailEl.value : "";
  if(!email){ showToast("Enter an email to continue"); return; }
  const name = (nameEl && nameEl.value) ? nameEl.value : email.split('@')[0];
  state.user = {name, email};
  renderAccount();
  showToast(authTab==='signin' ? "Welcome back ✓" : "Account created ✓");
}
function signOut(){ state.user = null; renderAccount(); showToast("Signed out"); }

/* ========================= SHEETS ========================= */
function openSheet(id){
  document.getElementById('overlay').classList.add('open');
  document.getElementById(id).classList.add('open');
}
function closeAllSheets(){
  document.getElementById('overlay').classList.remove('open');
  ['pdSheet','bagSheet','accountSheet','wishSheet'].forEach(id=>{
    document.getElementById(id).classList.remove('open');
  });
}

/* ========================= NAV / MISC ========================= */
function setTab(tab){
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  if(tab==='home'){ setView('shop'); }
  if(tab==='shop'){ state.tab='shop'; document.getElementById('shopView').style.display=''; document.getElementById('aboutView').style.display='none'; renderTopTabs(); scrollToShop(); }
}
function scrollToShop(){
  document.getElementById('shopAnchor').scrollIntoView({behavior:'smooth', block:'start'});
}
function emptyState(title, sub){
  return `<div class="empty-state">
    <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#D97C8B" stroke-width="1.5"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>
    <h3 style="font-size:16px;">${title}</h3>
    <p>${sub}</p>
  </div>`;
}
let toastTimer;
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 2200);
}


/* ========================= INIT ========================= */
async function initApp() {
  try {
    const res = await fetch('data/products.json');
    PRODUCTS = await res.json();
  } catch (e) {
    console.error('Failed to load products', e);
  }
  renderTopTabs();
  renderFilterPanel();
  renderGrid();
  updateBagBadge();
}

initApp();
