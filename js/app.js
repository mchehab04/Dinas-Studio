/* ========================= DATA & CONFIG ========================= */
const CATEGORIES = ["All","Matching Sets","Abayas","Kimonos","Accessories"];

const PALETTES = [
  ["#C55B54","#A63A3A"], ["#E89BA3","#D97C8B"], ["#CFA15C","#B4791C"],
  ["#8A6B63","#6B4D45"], ["#D97C8B","#832D8C"], ["#E4B8A0","#C58B6B"]
];

function formatPrice(amount) {
  return `AED ${amount}`;
}

// Hollow by default; .active on the containing button fills it (see .wish-btn.active / .heart-toggle.active).
function heartSVG(){
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 21s-7-4.35-9.5-8.5C.7 8.6 3 5 6.6 5 9 5 11 6.5 12 8c1-1.5 3-3 5.4-3 3.6 0 5.9 3.6 4.1 7.5C19 16.65 12 21 12 21z"/></svg>`;
}
function dressSVG(){
  return `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 2l3 2 3-2 1 5-2 1 3 14H8L11 8 9 7z"/></svg>`;
}

// Renders a product's photo when available, else the gradient + placeholder icon.
// fit "cover" fills and crops the box (grid/thumbs); "contain" shows the whole photo, letterboxed.
function productMedia(p, idx=0, fit='cover'){
  const src = p.images && p.images[idx];
  if(!src) return dressSVG();
  // "cover" fills a fixed thumbnail box; "contain" lets the box hug the photo's own
  // shape so there are no filler bars beside it.
  const style = fit === 'contain'
    ? 'position:relative; width:auto; max-width:100%; height:100%; object-fit:contain; border-radius:var(--radius-md); display:block;'
    : 'position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block;';
  return `<img src="${src}" alt="${p.name}" loading="lazy" style="${style}">`;
}
function productThumbStyle(p, idx=0){
  return (p.images && p.images[idx]) ? '' : gradientStyle(p);
}

let PRODUCTS = [];

/* ========================= STORAGE SERVICE ========================= */
// Handles all local persistence (ready to be swapped/augmented with BaaS)
const storageService = {
  getProducts() {
    try {
      const data = localStorage.getItem('dinas_products');
      return data ? JSON.parse(data) : null;
    } catch(e) { return null; }
  },
  saveProducts(list) {
    try { localStorage.setItem('dinas_products', JSON.stringify(list)); } catch(e){}
  },
  getProductsStamp() {
    try { return localStorage.getItem('dinas_products_stamp'); } catch(e) { return null; }
  },
  saveProductsStamp(stamp) {
    try { localStorage.setItem('dinas_products_stamp', stamp); } catch(e){}
  },
  getCart() {
    try {
      const data = localStorage.getItem('dinas_cart');
      return data ? JSON.parse(data) : [];
    } catch(e) { return []; }
  },
  saveCart(cart) {
    try { localStorage.setItem('dinas_cart', JSON.stringify(cart)); } catch(e){}
  },
  getWishlist() {
    try {
      const data = localStorage.getItem('dinas_wishlist');
      return data ? JSON.parse(data) : [];
    } catch(e) { return []; }
  },
  saveWishlist(list) {
    try { localStorage.setItem('dinas_wishlist', JSON.stringify(Array.from(list))); } catch(e){}
  },
  getUser() {
    try {
      const data = localStorage.getItem('dinas_user');
      return data ? JSON.parse(data) : null;
    } catch(e) { return null; }
  },
  saveUser(user) {
    try {
      if(user) localStorage.setItem('dinas_user', JSON.stringify(user));
      else localStorage.removeItem('dinas_user');
    } catch(e){}
  },
  getOrders() {
    try {
      const data = localStorage.getItem('dinas_orders');
      return data ? JSON.parse(data) : [];
    } catch(e) { return []; }
  },
  saveOrder(order) {
    try {
      const orders = storageService.getOrders();
      orders.unshift(order);
      localStorage.setItem('dinas_orders', JSON.stringify(orders));
      return order;
    } catch(e) { return null; }
  },
  updateOrderStatus(orderId, newStatus) {
    try {
      const orders = storageService.getOrders();
      const order = orders.find(o => o.id === orderId);
      if(order) {
        order.status = newStatus;
        localStorage.setItem('dinas_orders', JSON.stringify(orders));
      }
    } catch(e){}
  },
  getNotifyRequests() {
    try {
      const data = localStorage.getItem('dinas_notify_requests');
      return data ? JSON.parse(data) : [];
    } catch(e) { return []; }
  },
  saveNotifyRequest(productId, email) {
    try {
      const list = storageService.getNotifyRequests();
      list.unshift({ productId, email, date: new Date().toISOString() });
      localStorage.setItem('dinas_notify_requests', JSON.stringify(list));
    } catch(e){}
  }
};

/* ========================= API SERVICE LAYER (BaaS Ready) ========================= */
const apiService = {
  async fetchProducts() {
    // Always read the source catalogue so edits to products.json actually reach
    // returning visitors. The local cache only survives while the source is unchanged
    // (it exists to hold admin stock edits, not to shadow a new catalogue forever).
    let source = null;
    try {
      const res = await fetch('data/products.json', { cache: 'no-store' });
      if(res.ok) source = await res.json();
    } catch(e) { /* offline: fall through to whatever we cached */ }

    const sourceStamp = source ? JSON.stringify(source) : null;
    const cached = storageService.getProducts();

    if(cached && cached.length > 0 && (!sourceStamp || sourceStamp === storageService.getProductsStamp())) {
      let updated = false;
      cached.forEach(p => {
        if(!p.fabric) {
          p.fabric = getProductFabric(p);
          updated = true;
        }
      });
      if(updated) storageService.saveProducts(cached);
      return cached;
    }

    if(!source) throw new Error('Failed to load products');
    storageService.saveProducts(source);
    storageService.saveProductsStamp(sourceStamp);
    return source;
  },
  async updateProductStock(id, stockStatus) {
    const p = PRODUCTS.find(x => x.id === id);
    if(p) {
      p.stock = stockStatus;
      if(stockStatus === "out") {
        p.soldOut = [...p.sizes];
      } else {
        p.soldOut = [];
      }
      storageService.saveProducts(PRODUCTS);
      return p;
    }
    return null;
  },
  async addProduct(productData) {
    const maxId = PRODUCTS.length > 0 ? Math.max(...PRODUCTS.map(p => p.id)) : 0;
    const newProduct = {
      id: maxId + 1,
      name: productData.name,
      cat: productData.cat,
      price: Number(productData.price),
      stock: productData.stock || "in",
      sizes: ["One Size"],
      soldOut: productData.stock === "out" ? ["One Size"] : [],
      desc: productData.desc || "Handcrafted with premium fabrics and finished with signature tailoring.",
      fabric: productData.fabric || "Premium Crepe / Silk Blend",
      pop: 85,
      paletteIndex: productData.paletteIndex !== undefined ? productData.paletteIndex : (maxId + 1) % PALETTES.length,
      nw: true
    };
    PRODUCTS.unshift(newProduct);
    storageService.saveProducts(PRODUCTS);
    return newProduct;
  },
  async deleteProduct(id) {
    PRODUCTS = PRODUCTS.filter(p => p.id !== id);
    storageService.saveProducts(PRODUCTS);
    return true;
  },
  async createOrder(orderPayload) {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const order = {
      id: `DS-${randomNum}`,
      date: new Date().toISOString(),
      displayDate: new Date().toLocaleDateString('en-AE', { day:'numeric', month:'short', year:'numeric' }),
      status: 'pending',
      ...orderPayload
    };
    storageService.saveOrder(order);
    return order;
  },
  getOrders() {
    return storageService.getOrders();
  },
  getCustomerOrders(email) {
    if(!email) return [];
    return storageService.getOrders().filter(o => o.customer && o.customer.email.toLowerCase() === email.toLowerCase());
  },
  updateOrderStatus(orderId, status) {
    storageService.updateOrderStatus(orderId, status);
  }
};

/* ========================= STATE ========================= */
let state = {
  category: "All",
  sort: "popularity",
  sortLabel: "Popularity",
  search: "",
  wishlist: new Set(storageService.getWishlist()),
  bag: storageService.getCart(),
  user: storageService.getUser(),
  filterAvail: new Set(),
  filtersOpen: false,
  tab: "shop",
  paymentMethod: "cod"
};

function paletteFor(p){
  if(typeof p === 'object' && p !== null) {
    const idx = p.paletteIndex !== undefined ? p.paletteIndex : (p.id % PALETTES.length);
    return PALETTES[idx % PALETTES.length];
  }
  return PALETTES[Number(p) % PALETTES.length];
}

function gradientStyle(p){
  const [a,b] = paletteFor(p);
  return `background:linear-gradient(150deg, ${a}, ${b});`;
}

/* ========================= MAIN NAV: About / Shop / Socials ========================= */
const TABS = ["About","Shop","Socials"];

// Single source of truth for page-level nav: state.tab drives toptabs, desktopnav,
// and the bottom nav's Shop shortcut alike — one model, not three independent ones.
function renderTopTabs(){
  const tabsEl = document.getElementById('topTabs');
  if(tabsEl) {
    tabsEl.innerHTML = TABS.map(t => {
      const key = t.toLowerCase();
      return `<button class="toptab ${state.tab===key?'active':''}" data-tab="${key}" onclick="setView('${key}')">${t}</button>`;
    }).join('');
  }
  const deskNav = document.getElementById('desktopNav');
  if(deskNav) {
    deskNav.innerHTML = TABS.map(t => {
      const key = t.toLowerCase();
      return `<button class="${state.tab===key?'active':''}" data-tab="${key}" onclick="setView('${key}')">${t}</button>`;
    }).join('');
  }
  const bottomShop = document.querySelector('.bottomnav [data-tab="shop"]');
  if(bottomShop) bottomShop.classList.toggle('active', state.tab === 'shop');
}

function setView(tab){
  state.tab = tab;
  if(tab === 'shop' || tab === 'about'){
    document.getElementById('shopView').style.display = tab === 'shop' ? '' : 'none';
    document.getElementById('aboutView').style.display = tab === 'about' ? '' : 'none';
  }
  renderTopTabs();
  if(tab === 'socials'){
    document.getElementById('socialsSection').scrollIntoView({behavior:'smooth', block:'start'});
  } else {
    window.scrollTo({top:0, behavior:'smooth'});
  }
}

/* ========================= FILTER PANEL ========================= */
function toggleFilters(){
  state.filtersOpen = !state.filtersOpen;
  document.getElementById('filterPanel').style.display = state.filtersOpen ? 'block' : 'none';
}
function renderFilterPanel(){
  const categoryRow = document.getElementById('categoryRow');
  if(categoryRow) {
    categoryRow.innerHTML = CATEGORIES.map(c => `
      <button class="chip ${state.category===c?'active':''}" onclick="setCategory('${c}')">${c}</button>
    `).join('');
  }

  const availRow = document.getElementById('availRow');
  if(availRow) {
    const opts = [["in","In Stock"],["low","Low Stock"],["out","Notify Me"]];
    availRow.innerHTML = opts.map(([k,label]) => `
      <button class="chip ${state.filterAvail.has(k)?'active':''}" onclick="toggleAvail('${k}')">${label}</button>
    `).join('');
  }
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
  if(!e.target.closest('.sortbar')) {
    const sm = document.getElementById('sortMenu');
    if(sm) sm.classList.remove('open');
  }
});

/* ========================= GRID ========================= */
function stockRank(s){ return s==="in"?0:s==="low"?1:2; }

function getFiltered(){
  let list = PRODUCTS.filter(p=>{
    if(state.category!=="All" && p.cat!==state.category) return false;
    if(state.search && !p.name.toLowerCase().includes(state.search.toLowerCase())) return false;
    if(state.filterAvail.size>0 && !state.filterAvail.has(p.stock)) return false;
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

let searchDebounceTimer;
function onSearchInput(){
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(renderGrid, 180);
}

let lastGridSignature = null;
function renderGrid(){
  const searchInput = document.getElementById('searchInput');
  state.search = searchInput ? searchInput.value : "";
  const list = getFiltered();
  const resCount = document.getElementById('resultCount');
  if(resCount) resCount.textContent = `${list.length} piece${list.length!==1?'s':''}`;

  const grid = document.getElementById('productGrid');
  if(!grid) return;

  // Skip the (expensive, image-reflowing) rebuild when the visible set + order hasn't actually changed.
  const signature = list.map(p=>p.id).join(',');
  if(signature === lastGridSignature) return;
  lastGridSignature = signature;

  if(list.length===0){
    grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px 10px; color:var(--ink-soft); font-size:13.5px;">No pieces match yet — try a different filter.</div>`;
    return;
  }
  grid.innerHTML = list.map(p => `
    <div class="card">
      <div class="card-img" style="${productThumbStyle(p)}">
        ${productMedia(p)}
        <span class="stock-tag ${p.stock}">${stockLabel(p.stock)}</span>
        <button class="wish-btn ${state.wishlist.has(p.id)?'active':''}" data-wish-id="${p.id}" aria-pressed="${state.wishlist.has(p.id)}" aria-label="Save ${p.name} to wishlist" onclick="event.stopPropagation(); toggleWish(${p.id})">${heartSVG()}</button>
      </div>
      <a class="card-link" href="#" aria-label="View ${p.name}, ${formatPrice(p.price)}" onclick="event.preventDefault(); openProduct(${p.id});"></a>
      <div class="card-body">
        <span class="card-cat" aria-hidden="true">${p.cat}</span>
        <span class="card-name" aria-hidden="true">${p.name}</span>
        <div class="card-bottom">
          <span class="card-price" aria-hidden="true">${formatPrice(p.price)}</span>
          <button class="add-btn" aria-label="Choose quantity for ${p.name}, ${formatPrice(p.price)}" onclick="event.stopPropagation(); quickAdd(${p.id})">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function quickAdd(id){
  const p = PRODUCTS.find(x=>x.id===id);
  if(!p) return;
  if(p.stock === "out") {
    showToast("This piece is currently sold out");
    return;
  }
  // Never add straight to the bag from the grid — open the piece so the shopper
  // picks quantity (and size, where there's a choice) deliberately.
  openProduct(id);
  showToast("Choose your quantity to add");
}

/* ========================= WISHLIST ========================= */
function popHeart(btn){
  btn.classList.remove('animate-heart');
  void btn.offsetWidth; // restart the animation if it's tapped again mid-play
  btn.classList.add('animate-heart');
}

function toggleWish(id){
  const added = !state.wishlist.has(id);
  added ? state.wishlist.add(id) : state.wishlist.delete(id);
  storageService.saveWishlist(state.wishlist);
  document.querySelectorAll(`[data-wish-id="${id}"]`).forEach(btn=>{
    btn.classList.toggle('active', added);
    btn.setAttribute('aria-pressed', added);
    if(added) popHeart(btn);
  });
  if(currentProduct && currentProduct.id===id){
    const heartBtn = document.querySelector('.heart-toggle');
    if(heartBtn){
      heartBtn.classList.toggle('active', added);
      if(added) popHeart(heartBtn);
    }
  }
  if(document.getElementById('wishSheet').classList.contains('open')) renderWishlist();
  showToast(added ? "Saved to your favorites ♥" : "Removed from favorites");
}

function openWishlist(){ renderWishlist(); openSheet('wishSheet'); }
function renderWishlist(){
  const el = document.getElementById('wishContent');
  if(state.wishlist.size===0){
    el.innerHTML = emptyState("Your saved items list is empty","Tap the heart on any piece to save it for later.");
    return;
  }
  const items = PRODUCTS.filter(p=>state.wishlist.has(p.id));
  el.innerHTML = items.map(p=>`
    <div class="wish-item" onclick="openProduct(${p.id})">
      <div class="wish-thumb" style="${productThumbStyle(p)}">${productMedia(p)}</div>
      <div class="wish-info">
        <span class="wish-cat">${p.cat}</span>
        <span class="wish-name">${p.name}</span>
        <span class="wish-price">${formatPrice(p.price)}</span>
      </div>
      <button class="wish-action" onclick="event.stopPropagation(); quickAdd(${p.id})">Move to Bag</button>
    </div>
  `).join('');
}

/* ========================= PRODUCT DETAIL ========================= */
let currentProduct = null;
let currentSize = null;
let currentQty = 1;
let currentSlide = 0;

function openProduct(id){
  currentProduct = PRODUCTS.find(x=>x.id===id);
  if(!currentProduct) return;
  currentSize = currentProduct.sizes.find(s=>!currentProduct.soldOut.includes(s)) || currentProduct.sizes[0];
  currentQty = 1;
  currentSlide = 0;
  renderProductDetail();
  openSheet('pdSheet');
}


function getProductFabric(p) {
  if (p && p.fabric) return p.fabric;
  if (!p) return "Premium Tailored Fabric";
  switch(p.cat) {
    case "Matching Sets": return "Premium Soft Linen & Cotton Blend";
    case "Abayas": return "Lightweight Flowing Korean Crepe";
    case "Kimonos": return "Soft Silk-Satin with Subtle Sheen";
    case "Accessories": return "Delicate Silk-Touch Chiffon";
    default: return "Premium Tailored Modest Fabric";
  }
}

function renderProductDetail(){
  const p = currentProduct;
  const el = document.getElementById('pdContent');
  const [a,b] = paletteFor(p);

  const pdImages = p.images || [];
  el.innerHTML = `
    <div class="pd-gallery">
      <div class="pd-slide" style="${pdImages.length ? '' : `background:linear-gradient(150deg, ${a}, ${b});`}">
        ${pdImages.length ? productMedia(p, currentSlide, 'contain') : dressSVG()}
      </div>
      ${pdImages.length > 1 ? `
      <div class="pd-dots">
        ${pdImages.map((_,i)=>`<span class="pd-dot ${i===currentSlide?'active':''}" onclick="setSlide(${i})"></span>`).join('')}
      </div>` : ''}
    </div>
    <div class="pd-body">
      <span class="pd-cat">${p.cat}</span>
      <h2 class="pd-title">${p.name}</h2>
      <div class="pd-price">${formatPrice(p.price)}</div>
      <p class="pd-desc">${p.desc}</p>

      <div class="pd-section-label">Size</div>
      <div class="size-row">
        ${p.sizes.map(s=>{
          const sold = p.soldOut.includes(s);
          const sel = currentSize===s;
          return `<button class="size-pill ${sel?'selected':''} ${sold?'soldout':''}" data-size="${s}" ${sold?'disabled':''} onclick="selectSize('${s}')">${s}${sold?' (Sold)':''}</button>`;
        }).join('')}
      </div>

      <div class="pd-section-label">Quantity</div>
      <div class="qty-row">
        <button class="qty-btn" onclick="changeQty(-1)">−</button>
        <span class="qty-val" id="qtyVal">${currentQty}</span>
        <button class="qty-btn" onclick="changeQty(1)">+</button>
      </div>

      <div class="spec-list">
        <div class="spec-item">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>
          ${getProductFabric(p)}
        </div>
        <div class="spec-item">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Gentle dry clean or hand wash cold
        </div>
        <div class="spec-item">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
          Delivery in 1–2 business days across the UAE
        </div>
      </div>
    </div>
    <div class="pd-footer">
      <button class="heart-toggle ${state.wishlist.has(p.id)?'active':''}" aria-label="Toggle wishlist" onclick="toggleWish(${p.id})">${heartSVG()}</button>
      <button class="primary-btn" onclick="${p.stock==='out' ? 'notifyMeForCurrentProduct()' : 'addCurrentToBag()'}">
        ${p.stock==="out" ? "Notify Me When Available" : `Add to Bag · ${formatPrice(p.price)}`}
      </button>
    </div>
  `;
}
function setSlide(i){
  currentSlide = i;
  const slideEl = document.querySelector('.pd-slide');
  if(slideEl) slideEl.innerHTML = productMedia(currentProduct, i, 'contain');
  document.querySelectorAll('.pd-dot').forEach((dot, idx)=>dot.classList.toggle('active', idx===i));
}
function selectSize(s){
  currentSize = s;
  document.querySelectorAll('.size-pill').forEach(btn=>{
    btn.classList.toggle('selected', btn.dataset.size===s);
  });
}
function changeQty(d){ currentQty = Math.max(1, currentQty+d); document.getElementById('qtyVal').textContent = currentQty; }
function addCurrentToBag(){
  addToBag(currentProduct.id, currentSize, currentQty);
  closeAllSheets();
}

function notifyMeForCurrentProduct(){
  const p = currentProduct;
  if(!p) return;
  const defaultEmail = state.user ? state.user.email : "";
  const email = prompt(`Enter your email and we'll let you know when "${p.name}" is back in stock:`, defaultEmail);
  if(!email) return;
  storageService.saveNotifyRequest(p.id, email.trim());
  showToast("We'll email you when it's back ♥");
  closeAllSheets();
}

/* ========================= BAG ========================= */
function addToBag(id, size, qty){
  const existing = state.bag.find(i=>i.productId===id && i.size===size);
  if(existing){ existing.qty += qty; }
  else { state.bag.push({productId:id, size, qty}); }
  storageService.saveCart(state.bag);
  updateBagBadge();
  showToast("Added to your bag ✓");
  
  const b1 = document.getElementById('bagBadge');
  const b2 = document.getElementById('navBagBadge');
  [b1, b2].forEach(b => {
    if(b) {
      b.classList.remove('animate-badge');
      void b.offsetWidth;
      b.classList.add('animate-badge');
    }
  });
}

function updateBagBadge(){
  const count = state.bag.reduce((s,i)=>s+i.qty,0);
  const b1 = document.getElementById('bagBadge');
  const b2 = document.getElementById('navBagBadge');
  [b1,b2].forEach(b=>{
    if(b) {
      b.style.display = count>0 ? 'flex':'none';
      b.textContent = count;
    }
  });
}
function bagQtyChange(idx, d){
  state.bag[idx].qty += d;
  if(state.bag[idx].qty<=0) state.bag.splice(idx,1);
  storageService.saveCart(state.bag);
  updateBagBadge(); renderBag();
}
function removeBagItem(idx){
  state.bag.splice(idx,1);
  storageService.saveCart(state.bag);
  updateBagBadge(); renderBag();
}

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
    if(!p) return '';
    subtotal += p.price * item.qty;
    return `
      <div class="bag-item">
        <div class="bag-thumb" style="${productThumbStyle(p)}">${productMedia(p)}</div>
        <div class="bag-info">
          <span class="bag-name">${p.name}</span>
          <span class="bag-meta">Size ${item.size}</span>
          <div class="bag-bottom">
            <div class="bag-qty">
              <button onclick="bagQtyChange(${idx},-1)">−</button>
              <span>${item.qty}</span>
              <button onclick="bagQtyChange(${idx},1)">+</button>
            </div>
            <span class="bag-price">${formatPrice(p.price*item.qty)}</span>
          </div>
          <button class="remove-x" onclick="removeBagItem(${idx})">Remove</button>
        </div>
      </div>
    `;
  }).join('');

  const shipping = subtotal >= 350 ? 0 : 25;
  const total = subtotal + shipping;

  el.innerHTML = itemsHtml + `
    <div class="bag-summary">
      <div class="sum-row"><span>Subtotal</span><span>${formatPrice(subtotal)}</span></div>
      <div class="sum-row"><span>UAE Delivery</span><span>${shipping===0?'Free':formatPrice(shipping)}</span></div>
      ${shipping > 0 ? `<div style="font-size:11px; color:var(--ink-faint); margin-top:-6px; margin-bottom:6px;">Add ${formatPrice(350 - subtotal)} more for free delivery</div>` : ''}
      <div class="sum-row total"><span>Total</span><span>${formatPrice(total)}</span></div>
      <button class="primary-btn" style="width:100%; margin-top:14px;" onclick="openCheckout()">Proceed to Checkout</button>
    </div>
  `;
}

/* ========================= CHECKOUT ========================= */
function openCheckout() {
  if(state.bag.length === 0) {
    showToast("Your bag is empty");
    return;
  }
  closeAllSheets();
  renderCheckout();
  openSheet('checkoutSheet');
}

function setPaymentMethod(method) {
  state.paymentMethod = method;
  document.querySelectorAll('.payment-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.method === method);
  });
}

function renderCheckout() {
  const el = document.getElementById('checkoutContent');
  let subtotal = 0;
  state.bag.forEach(item => {
    const p = PRODUCTS.find(x => x.id === item.productId);
    if(p) subtotal += p.price * item.qty;
  });
  const shipping = subtotal >= 350 ? 0 : 25;
  const total = subtotal + shipping;

  const defaultName = state.user ? state.user.name : "";
  const defaultEmail = state.user ? state.user.email : "";

  el.innerHTML = `
    <div class="checkout-section">
      <div style="background:var(--surface-alt); border:1px solid var(--line); border-radius:var(--radius-sm); padding:10px 14px; margin-bottom:18px; font-size:12.5px; color:var(--ink-soft); display:flex; justify-content:space-between; align-items:center;">
        <span>Ordering ${state.bag.reduce((s,i)=>s+i.qty,0)} items</span>
        <strong style="color:var(--primary);">${formatPrice(total)}</strong>
      </div>

      <h4 style="margin-top:0;">Contact Details</h4>
      <div class="form-group">
        <label class="form-label" for="coName">Full Name *</label>
        <input class="form-input" id="coName" placeholder="e.g. Dina Amari" value="${defaultName}">
      </div>
      <div class="form-row-2">
        <div class="form-group">
          <label class="form-label" for="coEmail">Email Address *</label>
          <input class="form-input" id="coEmail" type="email" placeholder="you@email.com" value="${defaultEmail}">
        </div>
        <div class="form-group">
          <label class="form-label" for="coPhone">Phone / WhatsApp *</label>
          <input class="form-input" id="coPhone" type="tel" placeholder="+971 50 123 4567">
        </div>
      </div>

      <h4>Delivery Address</h4>
      <div class="form-group">
        <label class="form-label" for="coEmirate">Emirate *</label>
        <select class="form-select" id="coEmirate">
          <option value="Dubai">Dubai</option>
          <option value="Abu Dhabi">Abu Dhabi</option>
          <option value="Sharjah">Sharjah</option>
          <option value="Ajman">Ajman</option>
          <option value="Ras Al Khaimah">Ras Al Khaimah</option>
          <option value="Fujairah">Fujairah</option>
          <option value="Umm Al Quwain">Umm Al Quwain</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="coAddress">Street & Villa / Apartment *</label>
        <input class="form-input" id="coAddress" placeholder="e.g. Villa 14, Al Wasl Road, Jumeirah 2">
      </div>
      <div class="form-group">
        <label class="form-label" for="coNotes">Delivery Instructions (Optional)</label>
        <input class="form-input" id="coNotes" placeholder="e.g. Ring bell or leave with concierge">
      </div>

      <h4>Payment Method</h4>
      <div class="payment-methods">
        <div class="payment-pill ${state.paymentMethod==='cod'?'active':''}" data-method="cod" onclick="setPaymentMethod('cod')">
          <div class="payment-pill-title">Cash on Delivery</div>
          <div class="payment-pill-sub">Pay courier in cash / card</div>
        </div>
        <div class="payment-pill ${state.paymentMethod==='card'?'active':''}" data-method="card" onclick="setPaymentMethod('card')">
          <div class="payment-pill-title">Card / Apple Pay</div>
          <div class="payment-pill-sub">Online checkout ready</div>
        </div>
      </div>

      <div class="bag-summary" style="padding:14px; margin-top:16px; border:1px solid var(--line); border-radius:var(--radius-sm); background:var(--surface);">
        <div class="sum-row"><span>Subtotal</span><span>${formatPrice(subtotal)}</span></div>
        <div class="sum-row"><span>UAE Delivery</span><span>${shipping===0?'Free':formatPrice(shipping)}</span></div>
        <div class="sum-row total"><span>Total</span><span>${formatPrice(total)}</span></div>
      </div>

      <button class="primary-btn" style="width:100%; margin-top:16px; padding:15px;" onclick="placeOrder()">
        Place Order (${formatPrice(total)})
      </button>
    </div>
  `;
}

async function placeOrder() {
  const name = document.getElementById('coName').value.trim();
  const email = document.getElementById('coEmail').value.trim();
  const phone = document.getElementById('coPhone').value.trim();
  const emirate = document.getElementById('coEmirate').value;
  const address = document.getElementById('coAddress').value.trim();
  const notes = document.getElementById('coNotes') ? document.getElementById('coNotes').value.trim() : "";

  if(!name || !email || !phone || !address) {
    showToast("Please fill in all required fields *");
    return;
  }

  let subtotal = 0;
  const items = state.bag.map(item => {
    const p = PRODUCTS.find(x => x.id === item.productId);
    const itemSub = (p ? p.price : 0) * item.qty;
    subtotal += itemSub;
    return {
      productId: item.productId,
      name: p ? p.name : 'Custom Piece',
      cat: p ? p.cat : 'Collection',
      size: item.size,
      qty: item.qty,
      price: p ? p.price : 0,
      total: itemSub
    };
  });

  const shipping = subtotal >= 350 ? 0 : 25;
  const total = subtotal + shipping;

  const orderPayload = {
    customer: { name, email, phone },
    shippingAddress: { emirate, address, notes },
    paymentMethod: state.paymentMethod,
    items,
    subtotal,
    shipping,
    total
  };

  const order = await apiService.createOrder(orderPayload);

  state.bag = [];
  storageService.saveCart([]);
  updateBagBadge();

  closeAllSheets();
  renderOrderSuccess(order);
  openSheet('orderSuccessSheet');
}

function renderOrderSuccess(order) {
  const el = document.getElementById('orderSuccessContent');
  el.innerHTML = `
    <div class="order-success-card">
      <div class="success-icon-wrap">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h2 style="font-size:20px; margin:0 0 4px;">Thank you for your order!</h2>
      <p style="font-size:13.5px; color:var(--ink-soft); margin:0;">We are preparing your handcrafted pieces with care.</p>
      
      <div class="order-number-badge">Order ID: ${order.id}</div>

      <div class="order-summary-box">
        <div class="order-detail-row">
          <span>Customer:</span>
          <strong>${order.customer.name}</strong>
        </div>
        <div class="order-detail-row">
          <span>Phone:</span>
          <strong>${order.customer.phone}</strong>
        </div>
        <div class="order-detail-row">
          <span>Delivery to:</span>
          <strong>${order.shippingAddress.emirate}, UAE</strong>
        </div>
        <div class="order-detail-row">
          <span>Address:</span>
          <span>${order.shippingAddress.address}</span>
        </div>
        <div class="order-detail-row">
          <span>Payment:</span>
          <strong style="text-transform:uppercase;">${order.paymentMethod === 'cod' ? 'Cash on Delivery' : 'Card / Online'}</strong>
        </div>
        <div class="order-detail-row" style="border-top:1px dashed var(--line); padding-top:8px; margin-top:8px;">
          <span>Items Ordered:</span>
          <strong>${order.items.reduce((s,i)=>s+i.qty,0)} pcs</strong>
        </div>
        <div class="order-detail-row" style="font-size:15px; color:var(--primary); font-weight:800;">
          <span>Total:</span>
          <span>${formatPrice(order.total)}</span>
        </div>
      </div>

      <p style="font-size:12px; color:var(--ink-faint); margin:12px 0 20px;">Estimated delivery: 1–2 business days. A courier will call prior to delivery.</p>

      <div style="display:flex; flex-direction:column; gap:10px;">
        <button class="primary-btn" onclick="closeAllSheets()">Continue Shopping</button>
        <button class="sort-btn" style="width:100%; justify-content:center;" onclick="closeAllSheets(); openAccount();">View in My Account</button>
      </div>
    </div>
  `;
}

/* ========================= ACCOUNT & AUTH ========================= */
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
    const myOrders = apiService.getCustomerOrders(state.user.email);

    el.innerHTML = `
      <div class="account-hero">
        <div class="avatar-circle">${state.user.name.charAt(0).toUpperCase()}</div>
        <div>
          <div style="font-weight:800; font-size:16px;">${state.user.name}</div>
          <div style="font-size:12px; color:var(--ink-faint);">${state.user.email}</div>
        </div>
      </div>

      <div class="account-menu">
        <div style="padding:16px 20px 4px;">
          <h4 style="font-size:14px; margin:0 0 10px; font-weight:700;">My Placed Orders (${myOrders.length})</h4>
          ${myOrders.length === 0 ? `
            <div style="font-size:12.5px; color:var(--ink-soft); padding:12px 0;">You haven't placed any orders with this email yet.</div>
          ` : myOrders.map(o => `
            <div class="order-row-card">
              <div class="order-row-header">
                <div>
                  <strong style="font-size:13px; color:var(--ink);">${o.id}</strong>
                  <div style="font-size:11px; color:var(--ink-faint);">${o.displayDate}</div>
                </div>
                <span class="order-status-pill status-${o.status}">${o.status.toUpperCase()}</span>
              </div>
              <div style="font-size:12.5px; color:var(--ink-soft); margin-bottom:6px;">
                ${o.items.map(i=>`${i.qty}x ${i.name} (${i.size})`).join(', ')}
              </div>
              <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700; color:var(--primary);">
                <span>Total</span>
                <span>${formatPrice(o.total)}</span>
              </div>
            </div>
          `).join('')}
        </div>

        <div class="account-row" onclick="closeAllSheets(); openWishlist();">Saved Items (${state.wishlist.size}) <span class="sub">→</span></div>
        <button class="signout-btn" onclick="signOut()">Sign Out</button>
      </div>
    `;
    return;
  }

  title.textContent = "Welcome";
  el.innerHTML = `
    <div class="auth-tabs" style="margin-top:12px;">
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
    </div>
  `;
}

function mockGoogleAuth(){
  state.user = {name:"Dina Amari", email:"dina@gmail.com"};
  storageService.saveUser(state.user);
  renderAccount();
  showToast("Signed in as Dina Amari ✓");
}

function mockManualAuth(){
  const emailEl = document.getElementById('authEmail');
  const nameEl = document.getElementById('authName');
  const email = emailEl ? emailEl.value.trim() : "";
  if(!email){ showToast("Enter an email to continue"); return; }
  const name = (nameEl && nameEl.value.trim()) ? nameEl.value.trim() : email.split('@')[0];
  state.user = {name, email};
  storageService.saveUser(state.user);
  renderAccount();
  showToast(authTab==='signin' ? "Welcome back ✓" : "Account created ✓");
}

function signOut(){
  state.user = null;
  storageService.saveUser(null);
  renderAccount();
  showToast("Signed out");
}

/* ========================= STORE OWNER & INVENTORY DASHBOARD ========================= */
let adminTab = "orders"; // "orders" | "inventory" | "add"
let newProductPaletteIndex = 0;

function openAdmin() {
  closeAllSheets();
  renderAdmin();
  openSheet('adminSheet');
}

function setAdminTab(tab) {
  adminTab = tab;
  renderAdmin();
}

function renderAdmin() {
  const el = document.getElementById('adminContent');
  const orders = apiService.getOrders();
  
  const totalRevenue = orders.reduce((sum, o) => sum + (o.total || 0), 0);
  const totalOrders = orders.length;
  const pendingOrders = orders.filter(o => o.status === 'pending').length;
  
  const customerEmails = new Set(orders.map(o => o.customer ? o.customer.email.toLowerCase() : ''));
  customerEmails.delete('');
  const customerCount = customerEmails.size;

  let bodyContent = '';

  if(adminTab === 'orders') {
    bodyContent = `
      <!-- KPI Metric Cards -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-title">Total Revenue</div>
          <div class="kpi-value">${formatPrice(totalRevenue)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Total Orders</div>
          <div class="kpi-value">${totalOrders}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Customers</div>
          <div class="kpi-value">${customerCount}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Pending Orders</div>
          <div class="kpi-value" style="color:#B4791C;">${pendingOrders}</div>
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 style="font-size:15px; margin:0;">Customer Orders (${orders.length})</h3>
        ${orders.length === 0 ? `
          <button class="filter-btn" onclick="seedSampleOrders()" style="font-size:11.5px; padding:5px 10px;">+ Load Sample Orders</button>
        ` : ''}
      </div>

      ${orders.length === 0 ? `
        <div class="order-summary-box" style="text-align:center; padding:30px 14px;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D97C8B" stroke-width="1.5" style="margin:0 auto 10px; display:block;"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>
          <div style="font-weight:700; font-size:14px; margin-bottom:4px;">No customer orders yet</div>
          <p style="font-size:12px; color:var(--ink-soft); margin-bottom:14px;">Orders placed on the website will automatically appear here.</p>
          <button class="primary-btn" style="font-size:12px; padding:8px 16px;" onclick="seedSampleOrders()">Load Sample Orders to Preview</button>
        </div>
      ` : `
        <div class="orders-list">
          ${orders.map(o => `
            <div class="order-row-card">
              <div class="order-row-header">
                <div>
                  <strong style="font-size:13.5px; color:var(--ink);">${o.id}</strong>
                  <span style="font-size:11.5px; color:var(--ink-faint); margin-left:6px;">${o.displayDate || 'Recent'}</span>
                </div>
                <div>
                  <select class="form-select" style="padding:3px 8px; font-size:11.5px; width:auto; display:inline-block;" onchange="updateStatus('${o.id}', this.value)">
                    <option value="pending" ${o.status==='pending'?'selected':''}>Pending</option>
                    <option value="preparing" ${o.status==='preparing'?'selected':''}>Preparing</option>
                    <option value="shipped" ${o.status==='shipped'?'selected':''}>Shipped</option>
                    <option value="delivered" ${o.status==='delivered'?'selected':''}>Delivered</option>
                  </select>
                </div>
              </div>

              <div style="font-size:12.5px; color:var(--ink); margin-bottom:4px;">
                <strong>${o.customer ? o.customer.name : 'Guest'}</strong> 
                <span style="color:var(--ink-soft);">· ${o.customer ? o.customer.phone : ''}</span>
              </div>

              <div style="font-size:12px; color:var(--ink-soft); margin-bottom:8px;">
                📍 ${o.shippingAddress ? `${o.shippingAddress.emirate} (${o.shippingAddress.address})` : 'UAE'}
              </div>

              <div style="background:var(--surface-alt); border-radius:6px; padding:8px 10px; font-size:12px; color:var(--ink-soft); margin-bottom:8px;">
                ${o.items ? o.items.map(i => `<div>${i.qty}x ${i.name} <span style="font-weight:700;">(${i.size})</span></div>`).join('') : 'Items'}
              </div>

              <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px;">
                <span style="color:var(--ink-faint); text-transform:uppercase; font-size:11px;">Payment: ${o.paymentMethod || 'COD'}</span>
                <strong style="color:var(--primary); font-size:14px;">${formatPrice(o.total)}</strong>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    `;
  } else if(adminTab === 'inventory') {
    bodyContent = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <span style="font-size:13px; color:var(--ink-soft);">Manage stock for <strong>${PRODUCTS.length} pieces</strong></span>
        <button class="primary-btn" style="font-size:11.5px; padding:6px 12px;" onclick="setAdminTab('add')">+ Add Piece</button>
      </div>

      <div class="inventory-list">
        ${PRODUCTS.map(p => `
          <div class="inventory-item">
            <div class="inventory-thumb" style="${productThumbStyle(p)}">
              ${productMedia(p)}
            </div>
            <div class="inventory-info">
              <span class="inventory-name">${p.name}</span>
              <div class="inventory-meta">
                <span>${p.cat}</span>
                <span>•</span>
                <strong style="color:var(--primary);">${formatPrice(p.price)}</strong>
              </div>
            </div>
            <div class="stock-btn-group">
              <button class="stock-toggle-btn ${p.stock==='in'?'active-in':''}" onclick="setProductStock(${p.id}, 'in')">In Stock</button>
              <button class="stock-toggle-btn ${p.stock==='low'?'active-low':''}" onclick="setProductStock(${p.id}, 'low')">Low</button>
              <button class="stock-toggle-btn ${p.stock==='out'?'active-out':''}" onclick="setProductStock(${p.id}, 'out')">Sold Out</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } else if(adminTab === 'add') {
    bodyContent = `
      <div style="background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-md); padding:16px;">
        <h3 style="font-size:16px; margin:0 0 14px; color:var(--ink);">Add New Piece to Collection</h3>

        <div class="form-group">
          <label class="form-label" for="npName">Piece Name *</label>
          <input class="form-input" id="npName" placeholder="e.g. Sage Green Embroidered Abaya">
        </div>

        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label" for="npCat">Category *</label>
            <select class="form-select" id="npCat">
              <option value="Matching Sets">Matching Sets</option>
              <option value="Abayas">Abayas</option>
              <option value="Kimonos">Kimonos</option>
              <option value="Accessories">Accessories</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="npPrice">Price in AED *</label>
            <input class="form-input" id="npPrice" type="number" placeholder="380">
          </div>
        </div>

        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label" for="npStock">Initial Stock *</label>
            <select class="form-select" id="npStock">
              <option value="in">In Stock</option>
              <option value="low">Low Stock</option>
              <option value="out">Sold Out</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="npFabric">Fabric / Material</label>
            <input class="form-input" id="npFabric" placeholder="e.g. 100% Textured Linen">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="npDesc">Description</label>
          <textarea class="form-input" id="npDesc" rows="2" style="resize:vertical;" placeholder="Flowing silhouette with soft gathered cuffs..."></textarea>
        </div>

        <div class="form-group">
          <label class="form-label">Color Theme / Visual Gradient</label>
          <div class="palette-swatches">
            ${PALETTES.map(([a,b], idx) => `
              <div class="palette-swatch ${newProductPaletteIndex===idx?'selected':''}" 
                   style="background:linear-gradient(135deg, ${a}, ${b});" 
                   onclick="selectPalette(${idx})"></div>
            `).join('')}
          </div>
        </div>

        <button class="primary-btn" style="width:100%; margin-top:16px; padding:14px;" onclick="saveNewProduct()">
          Publish to Storefront
        </button>
      </div>
    `;
  }

  el.innerHTML = `
    <!-- Top Admin Tabs Navigation -->
    <div class="admin-nav">
      <button class="admin-tab ${adminTab==='orders'?'active':''}" onclick="setAdminTab('orders')">Orders & Stats</button>
      <button class="admin-tab ${adminTab==='inventory'?'active':''}" onclick="setAdminTab('inventory')">Inventory & Stock</button>
      <button class="admin-tab ${adminTab==='add'?'active':''}" onclick="setAdminTab('add')">+ Add Piece</button>
    </div>

    ${bodyContent}
  `;
}

function selectPalette(idx) {
  newProductPaletteIndex = idx;
  renderAdmin();
}

async function setProductStock(productId, stockStatus) {
  await apiService.updateProductStock(productId, stockStatus);
  const p = PRODUCTS.find(x => x.id === productId);
  showToast(`Updated "${p.name}" to ${stockStatus.toUpperCase()} ✓`);
  renderAdmin();
  renderGrid();
  if(currentProduct && currentProduct.id === productId) {
    currentProduct.stock = stockStatus;
    renderProductDetail();
  }
}

async function saveNewProduct() {
  const name = document.getElementById('npName').value.trim();
  const cat = document.getElementById('npCat').value;
  const price = document.getElementById('npPrice').value.trim();
  const stock = document.getElementById('npStock').value;
  const fabric = document.getElementById('npFabric').value.trim();
  const desc = document.getElementById('npDesc').value.trim();

  if(!name || !price) {
    showToast("Please enter piece name and price *");
    return;
  }

  const newP = await apiService.addProduct({
    name,
    cat,
    price,
    stock,
    fabric,
    desc,
    paletteIndex: newProductPaletteIndex
  });

  showToast(`"${name}" published to storefront ✓`);
  setAdminTab('inventory');
  renderGrid();
}

function updateStatus(orderId, newStatus) {
  apiService.updateOrderStatus(orderId, newStatus);
  showToast(`Order ${orderId} updated to ${newStatus} ✓`);
  renderAdmin();
}

function seedSampleOrders() {
  const sampleOrders = [
    {
      id: "DS-1021",
      date: new Date().toISOString(),
      displayDate: "Today",
      status: "pending",
      customer: { name: "Fatima Al Mansoori", email: "fatima@example.com", phone: "+971 50 234 5678" },
      shippingAddress: { emirate: "Dubai", address: "Villa 22, Umm Suqeim 2", notes: "Leave at door" },
      paymentMethod: "cod",
      items: [
        { productId: 1, name: "Silk Satin Kimono Set", size: "One Size", qty: 1, price: 420, total: 420 },
        { productId: 4, name: "Textured Linen Abaya", size: "One Size", qty: 1, price: 380, total: 380 }
      ],
      subtotal: 800,
      shipping: 0,
      total: 800
    },
    {
      id: "DS-1020",
      date: new Date(Date.now() - 86400000).toISOString(),
      displayDate: "Yesterday",
      status: "preparing",
      customer: { name: "Mariam Al Nuaimi", email: "mariam@example.com", phone: "+971 55 987 6543" },
      shippingAddress: { emirate: "Abu Dhabi", address: "Al Bateen Street, Apt 402", notes: "" },
      paymentMethod: "card",
      items: [
        { productId: 2, name: "Crepe Flowing Two-Piece", size: "One Size", qty: 1, price: 390, total: 390 }
      ],
      subtotal: 390,
      shipping: 0,
      total: 390
    }
  ];

  sampleOrders.forEach(o => storageService.saveOrder(o));
  showToast("Sample orders loaded ✓");
  renderAdmin();
}

/* ========================= SHEETS ========================= */
function openSheet(id){
  document.getElementById('overlay').classList.add('open');
  const sheet = document.getElementById(id);
  if(sheet) sheet.classList.add('open');
}
function closeAllSheets(){
  document.getElementById('overlay').classList.remove('open');
  ['pdSheet','bagSheet','accountSheet','wishSheet','checkoutSheet','orderSuccessSheet','adminSheet'].forEach(id=>{
    const s = document.getElementById(id);
    if(s) s.classList.remove('open');
  });
}

/* ========================= NAV / MISC ========================= */
function scrollToShop(){
  const anchor = document.getElementById('shopAnchor');
  if(anchor) anchor.scrollIntoView({behavior:'smooth', block:'start'});
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
  if(!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 2200);
}

/* ========================= INIT ========================= */
async function initApp() {
  try {
    PRODUCTS = await apiService.fetchProducts();
  } catch (e) {
    console.error('Failed to load products', e);
  }
  renderTopTabs();
  renderFilterPanel();
  renderGrid();
  updateBagBadge();
  // Admin isn't linked from customer-facing UI; the store owner reaches it via #admin.
  if(location.hash === '#admin') openAdmin();
}

initApp();
