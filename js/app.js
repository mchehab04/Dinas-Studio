/* ========================= DATA & CONFIG ========================= */
const CATEGORIES = ["All","Matching Sets","Abayas","Kimonos","Accessories"];

const PALETTES = [
  ["#C55B54","#A63A3A"], ["#E89BA3","#D97C8B"], ["#CFA15C","#B4791C"],
  ["#8A6B63","#6B4D45"], ["#D97C8B","#832D8C"], ["#E4B8A0","#C58B6B"]
];

// The dirham is pegged to the dollar, fixed since 1997 — a constant, not a rate
// that needs refreshing. AED is the only currency ever stored; USD is display.
const AED_PER_USD = 3.6725;

const COUNTRIES = {
  AE: {
    name: "United Arab Emirates",
    regionLabel: "Emirate",
    regions: ["Dubai","Abu Dhabi","Sharjah","Ajman","Ras Al Khaimah","Fujairah","Umm Al Quwain"],
    shipping: 25,
    freeOver: 350,
    delivery: "1–2 business days",
    cod: true,
    dial: "971",
    localDigits: [9, 10],
    phoneExample: "050 123 4567",
    addressExample: "e.g. Villa 14, Al Wasl Road, Jumeirah 2"
  },
  LB: {
    name: "Lebanon",
    regionLabel: "Governorate",
    regions: ["Beirut","Mount Lebanon","North","Akkar","Bekaa","Baalbek-Hermel","South","Nabatieh"],
    shipping: 10.98,  // $2.99 at the peg
    freeOver: 551,    // $150 at the peg
    delivery: "3–5 business days",
    cod: false,       // shipped from local stock, settled by Whish transfer
    dial: "961",
    // 8 covers landlines and the 03 mobile prefix; 9 covers 70/71/76/78/79/81.
    localDigits: [8, 9],
    phoneExample: "03 123 456",
    addressExample: "e.g. Hamra Street, Bldg 12, Floor 3"
  }
};
// Orders placed before Lebanon existed carry no country and stored the region
// under `emirate`; they were all UAE, so both fall back rather than render blank.
function countryOf(code){ return COUNTRIES[code] || COUNTRIES.AE; }
function regionOf(order){
  const a = (order && order.shippingAddress) || {};
  return a.region || a.emirate || '';
}

function formatPrice(amount) {
  return `AED ${amount} · $${(amount / AED_PER_USD).toFixed(2)}`;
}

function shippingFor(subtotal, countryCode){
  const c = countryOf(countryCode);
  return subtotal >= c.freeOver ? 0 : c.shipping;
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
  // Only the cropped thumbnail boxes are small enough to want the -sm variant;
  // the detail gallery is large, so it always takes -lg.
  const sm = fit === 'contain' ? null : smallVariant(src);
  const srcset = sm ? ` srcset="${sm} 600w, ${src} 1200w" sizes="(max-width:640px) 50vw, 300px"` : '';
  return `<img src="${src}" alt="${p.name}" loading="lazy"${srcset} style="${style}">`;
}
// Uploaded photos are stored as a -lg/-sm pair. Where a URL follows that
// convention the small variant can be offered to the browser for grid-sized
// boxes; the seeded products point at repo JPEGs with no pair, so they get no
// srcset and render exactly as before.
function smallVariant(src){
  return /-lg\.webp($|\?)/.test(src) ? src.replace('-lg.webp', '-sm.webp') : null;
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
    try {
      const { data, error } = await supabaseClient.from('products').select('*').order('id', { ascending: true });
      if(error) throw error;
      storageService.saveProducts(data);
      return data;
    } catch(e) {
      const cached = storageService.getProducts();
      if(cached && cached.length > 0) return cached;
      throw e;
    }
  },
  async updateProductStock(id, stockStatus) {
    const existing = PRODUCTS.find(x => x.id === id);
    if(!existing) return null;
    const soldOut = stockStatus === 'out' ? [...existing.sizes] : [];
    const { data, error } = await supabaseClient
      .from('products')
      .update({ stock: stockStatus, soldOut })
      .eq('id', id)
      .select()
      .single();
    if(error) { console.error(error); return null; }
    const idx = PRODUCTS.findIndex(x => x.id === id);
    if(idx !== -1) PRODUCTS[idx] = data;
    storageService.saveProducts(PRODUCTS);
    return data;
  },
  async addProduct(productData) {
    const { data, error } = await supabaseClient
      .from('products')
      .insert({
        name: productData.name,
        cat: productData.cat,
        price: Number(productData.price),
        stock: productData.stock || "in",
        sizes: ["One Size"],
        soldOut: productData.stock === "out" ? ["One Size"] : [],
        desc: productData.desc || "Handcrafted with premium fabrics and finished with signature tailoring.",
        fabric: productData.fabric || "Premium Crepe / Silk Blend",
        pop: 85,
        paletteIndex: productData.paletteIndex,
        images: productData.images || [],
        nw: true
      })
      .select()
      .single();
    if(error) { console.error(error); return null; }
    PRODUCTS.unshift(data);
    storageService.saveProducts(PRODUCTS);
    return data;
  },
  async updateProductImages(id, images) {
    const { data, error } = await supabaseClient
      .from('products')
      .update({ images })
      .eq('id', id)
      .select()
      .single();
    if(error) { console.error(error); return null; }
    const idx = PRODUCTS.findIndex(x => x.id === id);
    if(idx !== -1) PRODUCTS[idx] = data;
    storageService.saveProducts(PRODUCTS);
    return data;
  },
  async createOrder(orderPayload) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const order = {
      id: `DS-${randomNum}`,
      userId: user.id,
      displayDate: new Date().toLocaleDateString('en-AE', { day:'numeric', month:'short', year:'numeric' }),
      status: 'pending',
      ...orderPayload
    };
    const { data, error } = await supabaseClient.from('orders').insert(order).select().single();
    if(error) throw error;
    return data;
  },
  async getOrders() {
    const { data, error } = await supabaseClient.from('orders').select('*').order('date', { ascending: false });
    if(error) { console.error(error); return []; }
    return data;
  },
  async getCustomerOrders(userId) {
    if(!userId) return [];
    const { data, error } = await supabaseClient.from('orders').select('*').eq('userId', userId).order('date', { ascending: false });
    if(error) { console.error(error); return []; }
    return data;
  },
  async updateOrderStatus(orderId, status) {
    const { error } = await supabaseClient.from('orders').update({ status }).eq('id', orderId);
    if(error) console.error(error);
  }
};

async function loadCurrentUser() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if(!user) { state.user = null; return; }
  const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', user.id).single();
  state.user = {
    id: user.id,
    email: user.email,
    name: (profile && profile.name) || user.email.split('@')[0],
    phone: profile ? profile.phone : null,
    role: (profile && profile.role) || 'customer'
  };
}

/* ========================= STATE ========================= */
let state = {
  category: "All",
  sort: "popularity",
  sortLabel: "Popularity",
  search: "",
  wishlist: new Set(storageService.getWishlist()),
  bag: storageService.getCart(),
  user: null,
  filterAvail: new Set(),
  filtersOpen: false,
  tab: "shop",
  paymentMethod: "cod",
  country: "AE"
};

let postAuthRedirect = null; // null | 'checkout' | 'admin' — set before sending someone to sign in

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
    // An empty catalogue and an over-tight filter look identical here but need
    // opposite messages: telling someone to change a filter they never set
    // blames them for an outage and offers a remedy that does nothing.
    grid.innerHTML = PRODUCTS.length === 0
      ? `<div class="grid-message">
           <strong>We couldn't load the collection.</strong>
           <p>This is usually a connection problem. Your bag and saved items are safe.</p>
           <button class="primary-btn" onclick="retryProducts()">Try again</button>
         </div>`
      : `<div class="grid-message">No pieces match yet — try a different filter.</div>`;
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
  updateWishBadge();
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
  // Same row structure and classes as the bag list, so the two sheets read as
  // one component rather than two lookalikes drifting apart.
  el.innerHTML = items.map(p=>`
    <div class="bag-item" onclick="openProduct(${p.id})">
      <div class="bag-thumb" style="${productThumbStyle(p)}">${productMedia(p)}</div>
      <div class="bag-info">
        <span class="bag-name">${p.name}</span>
        <span class="bag-meta">${p.cat}</span>
        <div class="bag-bottom">
          <button class="filter-btn" onclick="event.stopPropagation(); quickAdd(${p.id})">Move to Bag</button>
          <span class="bag-price">${formatPrice(p.price)}</span>
        </div>
        <button class="remove-x" onclick="event.stopPropagation(); toggleWish(${p.id})">Remove</button>
      </div>
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
      <div class="pd-track" id="pdTrack" onscroll="syncSlideFromScroll()">
        ${pdImages.length
          ? pdImages.map((_,i)=>`<div class="pd-slide">${productMedia(p, i, 'contain')}</div>`).join('')
          : `<div class="pd-slide" style="background:linear-gradient(150deg, ${a}, ${b});">${dressSVG()}</div>`}
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
          Delivery in ${COUNTRIES.AE.delivery} in the UAE · ${COUNTRIES.LB.delivery} in Lebanon
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
  const track = document.getElementById('pdTrack');
  if(track) track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
  markSlide(i);
}

// The track is the source of truth once it scrolls, so swiping and the dots
// stay in agreement without either driving the other.
function syncSlideFromScroll(){
  const track = document.getElementById('pdTrack');
  if(!track || !track.clientWidth) return;
  markSlide(Math.round(track.scrollLeft / track.clientWidth));
}

function markSlide(i){
  currentSlide = i;
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
function updateWishBadge(){
  const b = document.getElementById('wishBadge');
  if(!b) return;
  b.style.display = state.wishlist.size>0 ? 'flex':'none';
  b.textContent = state.wishlist.size;
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

  const shipping = shippingFor(subtotal, state.country);
  const total = subtotal + shipping;

  el.innerHTML = itemsHtml + `
    <div class="bag-summary">
      <div class="sum-row"><span>Subtotal</span><span>${formatPrice(subtotal)}</span></div>
      <div class="sum-row"><span>Delivery</span><span>${shipping===0?'Free':formatPrice(shipping)}</span></div>
      ${shipping > 0 ? `<div style="font-size:11px; color:var(--ink-faint); margin-top:-6px; margin-bottom:6px;">Add ${formatPrice(countryOf(state.country).freeOver - subtotal)} more for free delivery</div>` : ''}
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
  if(!state.user) {
    closeAllSheets();
    postAuthRedirect = 'checkout';
    setAuthTab('signin');
    openAccount();
    showToast("Please sign in to checkout");
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

// Country drives the region field, shipping and payment options at once, so the
// whole form re-renders. Typed values are carried across rather than wiped —
// the region resets deliberately, since last country's region is meaningless.
function setCountry(code) {
  if(!COUNTRIES[code]) return;
  state.country = code;
  if(!COUNTRIES[code].cod && state.paymentMethod === 'cod') state.paymentMethod = 'transfer';

  const typed = {};
  CHECKOUT_FIELDS.forEach(f => {
    const el = document.getElementById(f.id);
    if(el) typed[f.id] = el.value;
  });

  renderCheckout();

  CHECKOUT_FIELDS.forEach(f => {
    const el = document.getElementById(f.id);
    if(el && typed[f.id] !== undefined) el.value = typed[f.id];
    updateCharCount(f);
  });
  refreshSubmit('checkout');
}

function renderCheckout() {
  const el = document.getElementById('checkoutContent');
  let subtotal = 0;
  state.bag.forEach(item => {
    const p = PRODUCTS.find(x => x.id === item.productId);
    if(p) subtotal += p.price * item.qty;
  });
  const shipping = shippingFor(subtotal, state.country);
  const total = subtotal + shipping;
  const country = countryOf(state.country);

  const defaultName = state.user ? state.user.name : "";
  const defaultEmail = state.user ? state.user.email : "";
  const defaultPhone = (state.user && state.user.phone) ? state.user.phone : "";

  el.innerHTML = `
    <div class="checkout-section">
      <div style="background:var(--surface-alt); border:1px solid var(--line); border-radius:var(--radius-sm); padding:10px 14px; margin-bottom:18px; font-size:12.5px; color:var(--ink-soft); display:flex; justify-content:space-between; align-items:center;">
        <span>Ordering ${state.bag.reduce((s,i)=>s+i.qty,0)} items</span>
        <strong style="color:var(--primary);">${formatPrice(total)}</strong>
      </div>

      <h4 style="margin-top:0;">Contact Details</h4>
      <div class="form-group">
        <label class="form-label" for="coName">Full Name *</label>
        <input class="form-input" id="coName" placeholder="e.g. Dina Amari" value="${defaultName}" autocomplete="name">
        <div class="field-error" id="coNameErr"></div>
      </div>
      <div class="form-row-2">
        <div class="form-group">
          <label class="form-label" for="coEmail">Email Address *</label>
          <input class="form-input" id="coEmail" type="email" placeholder="you@email.com" value="${defaultEmail}" autocomplete="email">
          <div class="field-error" id="coEmailErr"></div>
        </div>
        <div class="form-group">
          <label class="form-label" for="coPhone">Phone / WhatsApp *</label>
          <input class="form-input" id="coPhone" type="tel" placeholder="${country.phoneExample}" value="${defaultPhone}" autocomplete="tel">
          <div class="field-error" id="coPhoneErr"></div>
        </div>
      </div>

      <h4>Delivery Address</h4>
      <div class="form-group">
        <label class="form-label" for="coCountry">Country *</label>
        <select class="form-select" id="coCountry" onchange="setCountry(this.value)">
          ${Object.keys(COUNTRIES).map(code =>
            `<option value="${code}" ${state.country===code?'selected':''}>${COUNTRIES[code].name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="coRegion">${country.regionLabel} *</label>
        <select class="form-select" id="coRegion">
          ${country.regions.map(r => `<option value="${r}">${r}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="coAddress">Street & Villa / Apartment *</label>
        <input class="form-input" id="coAddress" placeholder="${country.addressExample}" maxlength="120" autocomplete="street-address">
        <div class="char-count" id="coAddressCount"></div>
        <div class="field-error" id="coAddressErr"></div>
      </div>
      <div class="form-group">
        <label class="form-label" for="coNotes">Delivery Instructions (Optional)</label>
        <input class="form-input" id="coNotes" placeholder="e.g. Ring bell or leave with concierge" maxlength="200">
        <div class="char-count" id="coNotesCount"></div>
      </div>

      <h4>Payment Method</h4>
      <div class="payment-methods">
        ${country.cod ? `
        <div class="payment-pill ${state.paymentMethod==='cod'?'active':''}" data-method="cod" onclick="setPaymentMethod('cod')">
          <div class="payment-pill-title">Cash on Delivery</div>
          <div class="payment-pill-sub">Pay courier in cash / card</div>
        </div>` : ''}
        <div class="payment-pill ${state.paymentMethod==='transfer'?'active':''}" data-method="transfer" onclick="setPaymentMethod('transfer')">
          <div class="payment-pill-title">Bank Transfer</div>
          <div class="payment-pill-sub">Details sent on WhatsApp</div>
        </div>
      </div>

      <div class="bag-summary" style="padding:14px; margin-top:16px; border:1px solid var(--line); border-radius:var(--radius-sm); background:var(--surface);">
        <div class="sum-row"><span>Subtotal</span><span>${formatPrice(subtotal)}</span></div>
        <div class="sum-row"><span>Delivery</span><span>${shipping===0?'Free':formatPrice(shipping)}</span></div>
        <div class="sum-row total"><span>Total</span><span>${formatPrice(total)}</span></div>
      </div>

      <button class="primary-btn" id="coSubmit" style="width:100%; margin-top:16px; padding:15px;" onclick="placeOrder()" disabled>
        Place Order (${formatPrice(total)})
      </button>
    </div>
  `;

  touchedFields = new Set();
  wireForm('checkout');
}

async function placeOrder() {
  const name = document.getElementById('coName').value.trim();
  const email = document.getElementById('coEmail').value.trim();
  const phone = document.getElementById('coPhone').value.trim();
  const region = document.getElementById('coRegion').value;
  const address = document.getElementById('coAddress').value.trim();
  const notes = document.getElementById('coNotes') ? document.getElementById('coNotes').value.trim() : "";

  // The button is disabled until the form validates; this is the backstop for
  // anything that enables it out from under us.
  if(!formIsValid('checkout')) {
    CHECKOUT_FIELDS.forEach(f => touchedFields.add(f.id));
    CHECKOUT_FIELDS.forEach(f => validateField('checkout', f.id));
    showToast("Please fix the highlighted fields");
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

  const shipping = shippingFor(subtotal, state.country);
  const total = subtotal + shipping;

  const orderPayload = {
    customer: { name, email, phone: phoneE164(phone, state.country) },
    shippingAddress: { country: state.country, region, address, notes },
    paymentMethod: state.paymentMethod,
    items,
    subtotal,
    shipping,
    total
  };

  let order;
  try {
    order = await apiService.createOrder(orderPayload);
  } catch(e) {
    showToast("Couldn't place your order — please try again");
    return;
  }

  state.bag = [];
  storageService.saveCart([]);
  updateBagBadge();
  await rememberPhone(orderPayload.customer.phone);

  closeAllSheets();
  renderOrderSuccess(order);
  openSheet('orderSuccessSheet');
}

// Checkout is the only place a phone number is captured, so the first order
// is what lets later ones pre-fill it.
async function rememberPhone(phone){
  if(!state.user || !phone || state.user.phone === phone) return;
  const { error } = await supabaseClient.from('profiles').update({ phone }).eq('id', state.user.id);
  if(error) { console.error(error); return; }
  state.user.phone = phone;
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

      ${order.paymentMethod === 'transfer' ? `
      <div class="transfer-note">
        <strong>Next step:</strong> we'll message you on WhatsApp at ${order.customer.phone} with the transfer details. Your order is reserved until payment arrives.
      </div>` : ''}

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
          <strong>${regionOf(order)}, ${countryOf(order.shippingAddress.country).name}</strong>
        </div>
        <div class="order-detail-row">
          <span>Address:</span>
          <span>${order.shippingAddress.address}</span>
        </div>
        <div class="order-detail-row">
          <span>Payment:</span>
          <strong style="text-transform:uppercase;">${order.paymentMethod === 'cod' ? 'Cash on Delivery' : 'Bank Transfer'}</strong>
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

      <p style="font-size:12px; color:var(--ink-faint); margin:12px 0 20px;">Estimated delivery: ${countryOf(order.shippingAddress.country).delivery}. A courier will call prior to delivery.</p>

      <div style="display:flex; flex-direction:column; gap:10px;">
        <button class="primary-btn" onclick="closeAllSheets()">Continue Shopping</button>
        <button class="sort-btn" style="width:100%; justify-content:center;" onclick="closeAllSheets(); openAccount();">View in My Account</button>
      </div>
    </div>
  `;
}

/* ========================= PRODUCT PHOTOS ========================= */
const PHOTO_BUCKET = 'product-images';
const MAX_PHOTOS = 4;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
// Sized against what the layout actually displays at 2x, not round numbers: grid
// cards are ~180px wide and the detail gallery is 38vh (~320px tall on a phone).
// Quality stays at 0.8 rather than lower — the fabric texture is the product
// here, and it is the first thing aggressive WebP smears.
const PHOTO_SIZES = [
  { suffix: 'sm', edge: 500, quality: 0.78 },
  { suffix: 'lg', edge: 900, quality: 0.80 }
];

// Never upscales: a photo smaller than the target keeps its own dimensions.
async function resizeToWebp(file, edge, quality){
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise(res => canvas.toBlob(res, 'image/webp', quality));
  if(!blob) throw new Error('Could not convert image');
  return blob;
}

function photoRejection(file){
  if(!file.type.startsWith('image/')) return `"${file.name}" isn't an image`;
  if(file.size > MAX_SOURCE_BYTES) return `"${file.name}" is over 10MB`;
  return null;
}

// Uploads both variants and returns the -lg URL, which is what the product row
// stores; the -sm one is found later by swapping the suffix.
async function uploadPhoto(file, folder, index){
  let lgUrl = null;
  for(const { suffix, edge, quality } of PHOTO_SIZES){
    const blob = await resizeToWebp(file, edge, quality);
    const path = `${folder}/${index}-${suffix}.webp`;
    const { error } = await supabaseClient.storage.from(PHOTO_BUCKET)
      .upload(path, blob, { contentType: 'image/webp', upsert: true });
    if(error) throw new Error(`${file.name}: ${error.message}`);
    if(suffix === 'lg'){
      lgUrl = supabaseClient.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
    }
  }
  return lgUrl;
}

/* ========================= FORM VALIDATION ========================= */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Accepts however someone types a number — spaces, dashes, brackets, a +971 /
// +961 / 00-prefixed international form, or a bare local one — and works out
// which country it belongs to. Matching is by digit length rather than a list
// of mobile prefixes, which would reject valid numbers as carriers add ranges.
// A customer ordering to Lebanon may still carry a UAE number, so an explicit
// country code always wins over whichever country is selected at checkout.
function parsePhone(raw, selected){
  const s = String(raw || '').replace(/[^\d+]/g, '').replace(/^00/, '+');
  const toLocal = rest => {
    const d = rest.replace(/\D/g, '');
    return d ? (d.startsWith('0') ? d : '0' + d) : '';
  };

  for(const code of Object.keys(COUNTRIES)){
    const dial = COUNTRIES[code].dial;
    if(s.startsWith('+' + dial)) return { country: code, local: toLocal(s.slice(1 + dial.length)) };
  }

  const digits = s.replace(/\D/g, '');
  for(const code of Object.keys(COUNTRIES)){
    const { dial, localDigits } = COUNTRIES[code];
    if(digits.startsWith(dial) && localDigits.includes(toLocal(digits.slice(dial.length)).length)){
      return { country: code, local: toLocal(digits.slice(dial.length)) };
    }
  }

  // A bare local number: prefer the selected country, else whichever length fits.
  const local = toLocal(digits);
  const order = [selected, ...Object.keys(COUNTRIES)];
  for(const code of order){
    if(COUNTRIES[code] && COUNTRIES[code].localDigits.includes(local.length)) return { country: code, local };
  }
  return { country: selected && COUNTRIES[selected] ? selected : 'AE', local };
}

function isValidPhone(raw, selected){
  const { country, local } = parsePhone(raw, selected);
  return /^0\d+$/.test(local) && COUNTRIES[country].localDigits.includes(local.length);
}
// Stored in international form so the number is unambiguous later.
function phoneE164(raw, selected){
  const { country, local } = parsePhone(raw, selected);
  return local ? '+' + COUNTRIES[country].dial + local.slice(1) : '';
}

const PW_RULES = [
  { label: 'At least 8 characters',          test: v => v.length >= 8 },
  { label: 'One capital letter',             test: v => /[A-Z]/.test(v) },
  { label: 'One number or special character', test: v => /\d/.test(v) || /[^A-Za-z0-9]/.test(v) }
];
function passwordMeetsRules(v){ return PW_RULES.every(r => r.test(v)); }

function warnIcon(){
  return `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16.5v.01"/></svg>`;
}

const CHECKOUT_FIELDS = [
  { id:'coName',    validate: v => v.trim() ? null : 'Please enter your full name' },
  { id:'coEmail',   validate: v => !v.trim() ? 'Please enter your email address'
                                : EMAIL_RE.test(v.trim()) ? null : 'Enter a valid email, like you@email.com' },
  { id:'coPhone',   validate: v => !v.trim() ? 'Please enter a phone number'
                                : isValidPhone(v, state.country) ? null
                                : `Enter a valid number, like ${countryOf(state.country).phoneExample}` },
  { id:'coAddress', validate: v => v.trim() ? null : 'Please enter your street and villa / apartment', max:120 },
  { id:'coNotes',   validate: () => null, max:200 }
];

const emailField = {
  id:'authEmail',
  validate: v => !v.trim() ? 'Please enter your email address'
               : EMAIL_RE.test(v.trim()) ? null : 'Enter a valid email, like you@email.com'
};
// Both the signup and the set-a-new-password forms hold a password to the same
// rules, so they share one validator rather than letting two copies drift.
const newPasswordField = {
  id:'authPass',
  validate: v => passwordMeetsRules(v) ? null : 'Password needs to meet every requirement below'
};

function authFields(){
  if(authTab === 'reset') return [emailField];
  if(authTab === 'recovery') return [newPasswordField];
  if(authTab === 'signup') return [emailField, newPasswordField];
  return [emailField, { id:'authPass', validate: v => v ? null : 'Please enter your password' }];
}
// Signup and recovery both show the live rules checklist.
function authShowsPwRules(){ return authTab === 'signup' || authTab === 'recovery'; }

function fieldsFor(form){ return form === 'auth' ? authFields() : CHECKOUT_FIELDS; }

// A field stays quiet until it has been left once, so nobody is told their
// half-typed email is wrong while they are still typing it.
let touchedFields = new Set();

function validateField(form, id){
  const field = fieldsFor(form).find(f => f.id === id);
  const input = document.getElementById(id);
  if(!field || !input) return true;
  const err = field.validate(input.value);
  const show = !!err && touchedFields.has(id);
  input.classList.toggle('invalid', show);
  input.classList.toggle('valid', !err && touchedFields.has(id) && input.value.trim() !== '');
  const errEl = document.getElementById(id + 'Err');
  if(errEl) errEl.innerHTML = show ? `${warnIcon()}<span>${err}</span>` : '';
  return !err;
}

function formIsValid(form){
  return fieldsFor(form).every(f => {
    const input = document.getElementById(f.id);
    return !input || !f.validate(input.value);
  });
}

function refreshSubmit(form){
  const btn = document.getElementById(form === 'auth' ? 'authSubmit' : 'coSubmit');
  if(btn) btn.disabled = !formIsValid(form);
}

function updateCharCount(field){
  if(!field.max) return;
  const input = document.getElementById(field.id);
  const el = document.getElementById(field.id + 'Count');
  if(!input || !el) return;
  el.textContent = `${input.value.length}/${field.max}`;
  el.classList.toggle('near', input.value.length >= field.max * 0.9);
}

function renderPwRules(){
  const el = document.getElementById('pwRules');
  const input = document.getElementById('authPass');
  if(!el || !input) return;
  const v = input.value;
  el.innerHTML = PW_RULES.map(r => `
    <li class="${r.test(v) ? 'met' : ''}">
      <span class="pw-check">${r.test(v) ? '✓' : ''}</span>${r.label}
    </li>`).join('');
}

// Called after each render, since both forms are rebuilt via innerHTML and
// lose their listeners every time.
function wireForm(form){
  fieldsFor(form).forEach(field => {
    const input = document.getElementById(field.id);
    if(!input) return;
    updateCharCount(field);
    input.addEventListener('blur', () => {
      touchedFields.add(field.id);
      validateField(form, field.id);
      refreshSubmit(form);
    });
    input.addEventListener('input', () => {
      if(touchedFields.has(field.id)) validateField(form, field.id);
      updateCharCount(field);
      if(form === 'auth' && field.id === 'authPass' && authShowsPwRules()) renderPwRules();
      refreshSubmit(form);
    });
    if(form === 'auth'){
      input.addEventListener('keydown', e => {
        if(e.key !== 'Enter') return;
        e.preventDefault();
        if(formIsValid('auth')) handleAuthSubmit();
        else {
          // Surface whatever is still missing rather than doing nothing.
          fieldsFor('auth').forEach(f => touchedFields.add(f.id));
          fieldsFor('auth').forEach(f => validateField('auth', f.id));
        }
      });
    }
  });
  refreshSubmit(form);
}

/* ========================= ACCOUNT & AUTH ========================= */
let authTab = "signin";
async function openAccount(){
  await renderAccount();
  openSheet('accountSheet');
}
async function setAuthTab(t){ authTab = t; await renderAccount(); }

async function renderAccount(){
  const title = document.getElementById('accountTitle');
  const el = document.getElementById('accountContent');

  if(state.user){
    title.textContent = "My Account";
    const myOrders = await apiService.getCustomerOrders(state.user.id);

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

  const labels = { signin:'Sign In', signup:'Create Account', reset:'Send Reset Link', recovery:'Set New Password' };
  const showsEmail = authTab !== 'recovery';
  const showsPassword = authTab !== 'reset';

  title.textContent = authTab === 'recovery' ? "Choose a new password"
                    : authTab === 'reset' ? "Reset your password"
                    : "Welcome";

  el.innerHTML = `
    ${authTab === 'signin' || authTab === 'signup' ? `
    <div class="auth-tabs" style="margin-top:12px;">
      <button class="auth-tab ${authTab==='signin'?'active':''}" onclick="setAuthTab('signin')">Sign In</button>
      <button class="auth-tab ${authTab==='signup'?'active':''}" onclick="setAuthTab('signup')">Create Account</button>
    </div>` : ``}
    <div class="auth-body">
      ${authTab === 'reset' ? `
      <p class="auth-note">Enter the email you signed up with and we'll send you a link to set a new password.</p>` : ``}
      ${authTab === 'recovery' ? `
      <p class="auth-note">Pick a new password for your account. You'll be signed in once it's saved.</p>` : ``}

      ${authTab==='signup' ? `
      <div class="field"><label>Full Name</label><input id="authName" placeholder="Dina Amari"></div>
      ` : ``}

      ${showsEmail ? `
      <div class="field">
        <label>Email *</label>
        <input id="authEmail" type="email" placeholder="you@email.com" autocomplete="email">
        <div class="field-error" id="authEmailErr"></div>
      </div>` : ``}

      ${showsPassword ? `
      <div class="field">
        <label>${authTab === 'recovery' ? 'New Password' : 'Password'} *</label>
        <input id="authPass" type="password" placeholder="••••••••" autocomplete="${authTab==='signin'?'current-password':'new-password'}">
        <div class="field-error" id="authPassErr"></div>
        ${authShowsPwRules() ? `<ul class="pw-rules" id="pwRules"></ul>` : ``}
      </div>` : ``}

      <button class="primary-btn" id="authSubmit" style="width:100%;" onclick="handleAuthSubmit()" disabled>${labels[authTab]}</button>

      ${authTab === 'signin' ? `
      <button class="auth-link" onclick="setAuthTab('reset')">Forgot your password?</button>` : ``}
      ${authTab === 'reset' ? `
      <button class="auth-link" onclick="setAuthTab('signin')">Back to sign in</button>` : ``}
    </div>
  `;

  touchedFields = new Set();
  if(authShowsPwRules()) renderPwRules();
  wireForm('auth');
}

async function handleAuthSubmit(){
  const emailEl = document.getElementById('authEmail');
  const passEl = document.getElementById('authPass');
  const nameEl = document.getElementById('authName');
  const email = emailEl ? emailEl.value.trim() : '';
  const password = passEl ? passEl.value : '';

  if(authTab === 'reset'){
    if(!email){ showToast("Enter your email address"); return; }
    await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/' });
    // Deliberately the same message whether or not an account exists — otherwise
    // this form becomes a way to discover who has an account here.
    showToast("If that email has an account, a reset link is on its way ✓");
    authTab = 'signin';
    await renderAccount();
    return;
  }

  if(authTab === 'recovery'){
    if(!passwordMeetsRules(password)){ showToast("Password doesn't meet the requirements"); return; }
    const { error } = await supabaseClient.auth.updateUser({ password });
    if(error){ showToast(error.message); return; }
    history.replaceState(null, '', location.pathname + location.search);
    await loadCurrentUser();
    showToast("Password updated ✓");
    authTab = 'signin';
    await resolvePostAuthRedirect();
    return;
  }

  if(!email || !password){ showToast("Enter an email and password"); return; }

  if(authTab === 'signup'){
    if(password.length < 6){ showToast("Password must be at least 6 characters"); return; }
    const name = (nameEl && nameEl.value.trim()) ? nameEl.value.trim() : email.split('@')[0];
    const { error } = await supabaseClient.auth.signUp({
      email, password, options: { data: { name } }
    });
    if(error){ showToast(error.message); return; }
    await loadCurrentUser();
    showToast("Account created ✓");
  } else {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if(error){ showToast(error.message); return; }
    await loadCurrentUser();
    showToast("Welcome back ✓");
  }

  await resolvePostAuthRedirect();
}

async function resolvePostAuthRedirect(){
  const redirect = postAuthRedirect;
  postAuthRedirect = null;
  if(redirect === 'checkout'){
    openCheckout();
  } else if(redirect === 'admin'){
    if(state.user.role === 'admin') await openAdmin();
    else showToast("Not authorized");
  } else {
    await renderAccount();
  }
}

async function signOut(){
  await supabaseClient.auth.signOut();
  state.user = null;
  await renderAccount();
  showToast("Signed out");
}

/* ========================= STORE OWNER & INVENTORY DASHBOARD ========================= */
let adminTab = "orders"; // "orders" | "inventory" | "add" | "photos"

// The photo picker is shared by "Add Piece" and the per-product editor. Items
// are either { url } for something already in the bucket, or { file, preview }
// for a pick not yet uploaded.
let photoDraft = [];
let photoEditProduct = null;   // set only in the "photos" tab
let photoBusy = false;

function renderPhotoPicker(){
  return `
    <div class="photo-picker">
      <label class="form-label">Photos (up to ${MAX_PHOTOS})</label>
      <div class="photo-grid" id="photoGrid">${photoThumbs()}</div>
      <input type="file" id="photoInput" accept="image/*" multiple hidden onchange="onPhotosPicked(event)">
      <button type="button" class="filter-btn" id="photoAddBtn"
        onclick="document.getElementById('photoInput').click()"
        ${photoDraft.length >= MAX_PHOTOS ? 'disabled' : ''}>+ Add photos</button>
      <div class="photo-hint" id="photoHint">First photo is used as the thumbnail.</div>
    </div>`;
}

function photoThumbs(){
  if(photoDraft.length === 0) return `<div class="photo-empty">No photos yet</div>`;
  return photoDraft.map((item, i) => `
    <div class="photo-thumb">
      <img src="${item.url || item.preview}" alt="Photo ${i+1}">
      ${i === 0 ? `<span class="photo-badge">Thumbnail</span>` : ''}
      <button type="button" class="photo-remove" aria-label="Remove photo ${i+1}"
        onclick="removePhoto(${i})">×</button>
    </div>`).join('');
}

function refreshPhotoGrid(){
  const grid = document.getElementById('photoGrid');
  if(grid) grid.innerHTML = photoThumbs();
  const btn = document.getElementById('photoAddBtn');
  if(btn) btn.disabled = photoDraft.length >= MAX_PHOTOS || photoBusy;
}

function onPhotosPicked(e){
  const picked = Array.from(e.target.files || []);
  e.target.value = '';  // so picking the same file twice still fires change
  const room = MAX_PHOTOS - photoDraft.length;
  if(picked.length > room){ showToast(`You can add ${room} more photo${room === 1 ? '' : 's'}`); }
  for(const file of picked.slice(0, room)){
    const problem = photoRejection(file);
    if(problem){ showToast(problem); continue; }
    photoDraft.push({ file, preview: URL.createObjectURL(file) });
  }
  refreshPhotoGrid();
}

function removePhoto(i){
  const [gone] = photoDraft.splice(i, 1);
  if(gone && gone.preview) URL.revokeObjectURL(gone.preview);
  refreshPhotoGrid();
}

function setPhotoBusy(on, message){
  photoBusy = on;
  const hint = document.getElementById('photoHint');
  if(hint) hint.textContent = message || 'First photo is used as the thumbnail.';
  refreshPhotoGrid();
}

// Uploads anything not yet in the bucket and returns the full ordered URL list.
// Nothing is written to the product until every upload succeeds, so a product
// is never published with half a gallery.
async function commitPhotos(folder){
  const urls = [];
  for(let i = 0; i < photoDraft.length; i++){
    const item = photoDraft[i];
    if(item.url){ urls.push(item.url); continue; }
    setPhotoBusy(true, `Uploading photo ${i + 1} of ${photoDraft.length}…`);
    urls.push(await uploadPhoto(item.file, folder, i));
  }
  setPhotoBusy(false);
  return urls;
}

function openPhotoEditor(productId){
  photoEditProduct = PRODUCTS.find(p => p.id === productId) || null;
  photoDraft = (photoEditProduct && photoEditProduct.images || []).map(url => ({ url }));
  setAdminTab('photos');
}
let newProductPaletteIndex = 0;

async function openAdmin() {
  closeAllSheets();
  await renderAdmin();
  openSheet('adminSheet');
}

async function setAdminTab(tab) {
  // Leaving the picker behind discards unsaved picks rather than carrying them
  // into the next piece. The photos tab is the exception: openPhotoEditor fills
  // the draft before switching to it.
  if(tab !== 'photos'){
    photoDraft.forEach(item => item.preview && URL.revokeObjectURL(item.preview));
    photoDraft = [];
    photoBusy = false;
  }
  adminTab = tab;
  await renderAdmin();
}

async function renderAdmin() {
  const el = document.getElementById('adminContent');
  const orders = await apiService.getOrders();
  
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
      </div>

      ${orders.length === 0 ? `
        <div class="order-summary-box" style="text-align:center; padding:30px 14px;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D97C8B" stroke-width="1.5" style="margin:0 auto 10px; display:block;"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>
          <div style="font-weight:700; font-size:14px; margin-bottom:4px;">No customer orders yet</div>
          <p style="font-size:12px; color:var(--ink-soft); margin-bottom:14px;">Orders placed on the website will automatically appear here.</p>
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
                📍 ${o.shippingAddress ? `${regionOf(o)}, ${countryOf(o.shippingAddress.country).name} (${o.shippingAddress.address})` : '—'}
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
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:14px;">
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
              <button class="stock-toggle-btn" onclick="openPhotoEditor(${p.id})">Photos (${(p.images||[]).length})</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } else if(adminTab === 'add') {
    bodyContent = `
      <div style="background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-md); padding:16px;">
        <h3 style="font-size:16px; margin:0 0 14px; color:var(--ink);">Add New Piece to Collection</h3>

        ${renderPhotoPicker()}

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

        <button class="primary-btn" id="npPublish" style="width:100%; margin-top:16px; padding:14px;" onclick="saveNewProduct()">
          Publish to Storefront
        </button>
      </div>
    `;
  } else if(adminTab === 'photos') {
    const p = photoEditProduct;
    bodyContent = p ? `
      <div style="background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-md); padding:16px;">
        <h3 style="font-size:16px; margin:0 0 4px; color:var(--ink);">Photos</h3>
        <p style="font-size:13px; color:var(--ink-soft); margin:0 0 14px;">${p.name}</p>

        ${renderPhotoPicker()}

        <button class="primary-btn" id="photoSave" style="width:100%; margin-top:16px; padding:14px;" onclick="savePhotos()">
          Save Photos
        </button>
        <button class="filter-btn" style="width:100%; margin-top:8px;" onclick="setAdminTab('inventory')">Back to Inventory</button>
      </div>
    ` : `<p style="font-size:13px; color:var(--ink-soft);">No piece selected.</p>`;
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

async function savePhotos(){
  const p = photoEditProduct;
  if(!p) return;
  const btn = document.getElementById('photoSave');
  if(btn) btn.disabled = true;
  try {
    const images = await commitPhotos(String(p.id));
    const updated = await apiService.updateProductImages(p.id, images);
    if(!updated) throw new Error('Could not save photos');
    showToast(`Photos updated for "${p.name}" ✓`);
    photoDraft = [];
    photoEditProduct = null;
    await setAdminTab('inventory');
    renderGrid();
    if(currentProduct && currentProduct.id === p.id){
      currentProduct.images = images;
      renderProductDetail();
    }
  } catch(e) {
    console.error(e);
    setPhotoBusy(false);
    showToast(e.message || 'Upload failed — please try again');
    if(btn) btn.disabled = false;
  }
}

async function setProductStock(productId, stockStatus) {
  const updated = await apiService.updateProductStock(productId, stockStatus);
  if(!updated) { showToast("Failed to update stock"); return; }
  showToast(`Updated "${updated.name}" to ${stockStatus.toUpperCase()} ✓`);
  await renderAdmin();
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

  if(!name) {
    showToast("Please enter a piece name");
    return;
  }
  if(!(Number(price) > 0)) {
    showToast("Enter a price greater than zero");
    return;
  }

  const btn = document.getElementById('npPublish');
  if(btn) btn.disabled = true;

  let images;
  try {
    // Photos go up before the row is written, so a product is never published
    // with a gallery that only half uploaded.
    images = await commitPhotos(crypto.randomUUID());
  } catch(e) {
    console.error(e);
    setPhotoBusy(false);
    showToast(e.message || 'Upload failed — please try again');
    if(btn) btn.disabled = false;
    return;
  }

  const newP = await apiService.addProduct({
    name,
    cat,
    price,
    stock,
    fabric,
    desc,
    images,
    paletteIndex: newProductPaletteIndex
  });

  if(!newP) {
    showToast("Failed to publish — please try again");
    if(btn) btn.disabled = false;
    return;
  }
  photoDraft = [];
  showToast(`"${name}" published to storefront ✓`);
  await setAdminTab('inventory');
  renderGrid();
}

async function updateStatus(orderId, newStatus) {
  await apiService.updateOrderStatus(orderId, newStatus);
  showToast(`Order ${orderId} updated to ${newStatus} ✓`);
  await renderAdmin();
}

/* ========================= SHEETS ========================= */
function openSheet(id){
  // Sheets are full-screen and share one overlay, so opening any of them closes
  // the rest. Without this, a sheet opened from inside another — a piece opened
  // from the saved-items list — leaves both stacked.
  closeAllSheets();
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
// Deliberately no timeout around the fetch: the Supabase client already gives
// up after ~8s, and racing it shorter would fail spuriously on exactly the slow
// connections this shop needs to work on.
async function retryProducts(){
  const grid = document.getElementById('productGrid');
  if(grid) grid.innerHTML = `<div class="grid-message">Loading…</div>`;
  try {
    PRODUCTS = await apiService.fetchProducts();
  } catch (e) {
    console.error('Failed to load products', e);
  }
  lastGridSignature = null;
  renderGrid();
}

async function initApp() {
  await loadCurrentUser();
  try {
    PRODUCTS = await apiService.fetchProducts();
  } catch (e) {
    console.error('Failed to load products', e);
  }
  renderTopTabs();
  renderFilterPanel();
  renderGrid();
  updateBagBadge();
  updateWishBadge();
  routeAdminHash();
}

// Admin isn't linked from customer-facing UI; the store owner reaches it via
// #admin. Changing the hash on an open page fires no reload, so this runs both
// on load and on hashchange.
async function routeAdminHash() {
  if(location.hash !== '#admin') return;
  if(!state.user) {
    postAuthRedirect = 'admin';
    setAuthTab('signin');
    openAccount();
  } else if(state.user.role === 'admin') {
    await openAdmin();
  } else {
    showToast("Not authorized");
    // replaceState rather than clearing the hash: it drops #admin without
    // firing another hashchange, and leaves no history entry for Back to
    // return them to.
    history.replaceState(null, '', location.pathname + location.search);
    setView('shop');
  }
}

window.addEventListener('hashchange', routeAdminHash);

// Arriving from a reset email: the Supabase client lifts the recovery token out
// of the URL and fires this, which is the only reliable signal that the visit is
// a password reset rather than an ordinary sign-in.
supabaseClient.auth.onAuthStateChange(event => {
  if(event !== 'PASSWORD_RECOVERY') return;
  authTab = 'recovery';
  openAccount();
});

initApp();
