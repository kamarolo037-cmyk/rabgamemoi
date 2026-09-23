// ======================= НАСТРОЙКИ =======================
const SUPABASE_URL = "https://gusoancxlsbixtnfzqpo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ef0R27oL_EFuBg97W1KdwA_j9EeIMDL";
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/hyper-service`;
// =========================================================

const tg = window.Telegram && window.Telegram.WebApp;
if (tg) { tg.ready(); tg.expand(); }

let me = null;
let tab = "profile";
let marketList = [];
let topList = [];
let slavesCache = [];
let ownerCache = null;
let profileDataFresh = false; // true сразу после init — данные уже свежие, лишний запрос не нужен
let topSort = "balance"; // balance | earn_rate | slaves_count
let busy = false;
let collectTimer = null;

const fmt = n => Math.floor(n || 0).toLocaleString("ru-RU");
const buyPrice = rate => 200 + rate * 1500;
const sellPriceFor = rate => 100 + rate * 17;
const shacklesPriceFor = rate => 500 + Math.floor(rate * 20);
const freePriceFor = rate => 1000 + rate * 11000;
const upgradePriceFor = rate => Math.floor(rate * 500);

function esc(s){
  return String(s == null ? "" : s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

function toast(msg){
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function placeholderAvatar(name){
  const letter = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(letter)}`;
}

// ======================= ВЫЗОВ EDGE FUNCTION =======================
// Личность игрока никогда не передаётся отдельным параметром —
// сервер сам достаёт её из подписанной tg.initData.
async function callAction(action, payload){
  const initData = tg ? tg.initData : "";
  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "apikey": SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ initData, action, payload: payload || {} }),
  });

  let out = null;
  try { out = await res.json(); } catch (e) {}

  if (!res.ok || !out || out.error) {
    throw new Error((out && out.error) || `Ошибка запроса (${res.status})`);
  }
  return out.data;
}

// ======================= ИНИЦИАЛИЗАЦИЯ =======================
async function init(){
  if (!tg || !tg.initData) {
    render(`<div class="empty">Открой это приложение через Telegram — вне Telegram оно работать не может.</div>`);
    return;
  }

  try {
    const initResult = await callAction("init");
    me = initResult.me;
    slavesCache = initResult.slaves || [];
    ownerCache = initResult.owner || null;
    profileDataFresh = true;
  } catch (e) {
    render(`<div class="empty">Ошибка подключения: ${esc(e.message)}</div>`);
    return;
  }

  render(); // всё уже пришло одним запросом — рисуем сразу, без дополнительных походов

  clearInterval(collectTimer);
  collectTimer = setInterval(() => {
    if (document.hidden) return;
    collect();
  }, 8000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && me) collect();
  });
}

// ======================= ДОХОД =======================
async function collect(silent){
  if (!me || busy) return;
  try {
    me = await callAction("collect");
    if (silent) return;
    updateProfileStats();
  } catch(e){}
}

function updateProfileStats(){
  if (tab !== "profile") return;
  const balanceEl = document.querySelector("[data-stat='balance']");
  if (balanceEl) balanceEl.textContent = fmt(me.balance) + " ₽";
  const ownEl = document.querySelector("[data-stat='own']");
  if (ownEl) ownEl.textContent = me.owner_id ? "0" : fmt(me.earn_rate);
}

// ======================= ЗАГРУЗКА ДАННЫХ =======================
async function refreshMarket(){
  try { marketList = await callAction("market", { limit: 40 }); }
  catch(e){ marketList = []; }
}
async function refreshTop(){
  try { topList = await callAction("top", { limit: 40 }); }
  catch(e){ topList = []; }
}
async function fetchOwnedSlaves(){
  try { return await callAction("mySlaves"); }
  catch(e){ return []; }
}
async function fetchOwnerOf(id){
  if (!id) return null;
  try { return await callAction("player", { id }); }
  catch(e){ return null; }
}
async function fetchPlayer(id){
  try { return await callAction("player", { id }); }
  catch(e){ return null; }
}

// ======================= ДЕЙСТВИЯ =======================
async function withBusy(fn){
  if (busy) return;
  busy = true;
  document.getElementById("app").classList.add("busy");
  document.body.classList.add("busy");
  try { await fn(); } finally {
    busy = false;
    document.getElementById("app").classList.remove("busy");
    document.body.classList.remove("busy");
  }
}

async function buy(targetId, jobTitle){
  await withBusy(async () => {
    try {
      const payload = { targetId };
      if (jobTitle && jobTitle.trim()) payload.jobTitle = jobTitle.trim().slice(0, 60);
      const data = await callAction("buy", payload);
      if (data) slavesCache = [...slavesCache, data];
      toast("Куплен(а)!");
      closeModal();
      await collect(true);
      await refreshMarket();
      render();
    } catch(e){ toast(e.message); }
  });
}
async function sell(slaveId){
  await withBusy(async () => {
    try {
      await callAction("sell", { slaveId });
      slavesCache = slavesCache.filter(s => s.id !== slaveId);
      toast("Продан(а)! Замок снят.");
      closeModal();
      await collect(true);
      render();
    } catch(e){ toast(e.message); }
  });
}
async function upgradeSlave(slaveId){
  await withBusy(async () => {
    try {
      const data = await callAction("upgrade", { slaveId });
      if (data) slavesCache = slavesCache.map(s => s.id === slaveId ? data : s);
      toast("Раб улучшен!");
      closeModal();
      await collect(true);
      render();
    } catch(e){ toast(e.message); }
  });
}
async function applyShackles(slaveId){
  await withBusy(async () => {
    try {
      const data = await callAction("shackles", { slaveId });
      if (data) slavesCache = slavesCache.map(s => s.id === slaveId ? data : s);
      toast("Замок надет на 5 часов!");
      closeModal();
      await collect(true);
      render();
    } catch(e){ toast(e.message); }
  });
}
async function freeSelf(){
  await withBusy(async () => {
    try {
      me = await callAction("free");
      toast("Вы свободны!");
      render();
    } catch(e){ toast(e.message); }
  });
}
async function escape(){
  await withBusy(async () => {
    try {
      const data = await callAction("escape");
      if (data.success) {
        toast(`Побег удался! Украдено ${fmt(data.stolen)} ₽`);
        await collect(true);
      } else {
        toast("Побег не удался, попробуйте позже");
      }
      render();
    } catch(e){ toast(e.message); }
  });
}

// ======================= ИНВАЙТЫ =======================
const BOT_USERNAME = "jailcand_bot";

function getInviteLink(){
  const refId = (me && me.telegram_id) ? me.telegram_id : "0";
  return `https://t.me/${BOT_USERNAME}?startapp=ref_${refId}`;
}

function copyInviteLink(){
  const link = getInviteLink();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link)
      .then(() => toast("Ссылка скопирована!"))
      .catch(() => prompt("Скопируй ссылку:", link));
  } else {
    prompt("Скопируй ссылку:", link);
  }
}

function shareInvite(){
  const link = getInviteLink();
  const text = `Залетай в Рабство! По моей ссылке станешь моим рабом, а мне дадут 5000 ₽ 😈`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  if (tg && tg.openTelegramLink) tg.openTelegramLink(shareUrl);
  else if (tg && tg.openLink) tg.openLink(shareUrl);
  else if (navigator.share) navigator.share({ title: "Рабство", text: text + "\n" + link, url: link }).catch(copyInviteLink);
  else copyInviteLink();
}

function openInviteModal(){
  showModal(`
    <div style="text-align:center;margin-bottom:16px;">
      <div style="font-size:28px;margin-bottom:8px;">🔗</div>
      <div class="name" style="margin-bottom:12px;">Пригласить друга</div>
      <div class="muted" style="line-height:1.45;margin-bottom:8px;">
        Человек, который зайдёт по твоей ссылке,<br><b>сразу станет твоим рабом</b>.
      </div>
      <div class="muted" style="line-height:1.45;margin-bottom:18px;">
        Тебе начислят бонус <b style="color:var(--red);">+5000 ₽</b>
      </div>
    </div>
    <button onclick="shareInvite()" style="width:100%;margin-bottom:10px;">Поделиться</button>
    <button class="secondary" onclick="copyInviteLink()" style="width:100%;">Скопировать ссылку</button>
  `);
}

// ======================= РЕНДЕР =======================
function render(html){
  const app = document.getElementById("app");
  if (html !== undefined) { app.innerHTML = html; return; }
  if (tab === "profile") renderProfile();
  else if (tab === "market") renderMarket();
  else renderTop();
}

function buildBannerHtml(owner){
  if (!me.owner_id) return "";
  const freePrice = freePriceFor(me.earn_rate);
  const canEscape = !me.locked_until || new Date(me.locked_until) < new Date();
  const ownerName = owner ? esc(owner.name) : "…";
  const jobTitle = esc(me.job_title);
  return `
    <div class="banner owned">
      Вы в рабстве у <b>${ownerName}</b> на работе «${jobTitle}»
      <button onclick="freeSelf()" ${canEscape ? "" : "disabled"} style="${canEscape ? "" : "opacity:0.5"}">
        Освободиться за ${fmt(freePrice)} ₽
      </button>
    </div>
    <div class="banner escape">
      ${canEscape
        ? "Попробуйте сбежать от хозяина и украсть немного деньжат."
        : `🔒 Замок надет! Сбеж невозможен до ${new Date(me.locked_until).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"})}`}
      <button class="secondary" ${canEscape?"":"disabled"} onclick="escape()">Сбежать от хозяина</button>
    </div>`;
}

function buildSlavesHtml(slaves){
  const totalRate = slaves.reduce((s,p) => s + p.earn_rate, 0);
  const listHtml = slaves.length ? `
    <div class="slaves-grid">
      ${slaves.map(s => `
        <div class="slave-card" onclick="openSlave('${esc(s.id)}')">
          <img class="avatar" src="${esc(s.avatar_url || placeholderAvatar(s.name))}">
          <div class="n">${esc(s.name)}</div>
          <div class="job">${esc(s.job_title)}</div>
          <div class="rate">+${fmt(s.earn_rate)} ₽ / мин</div>
        </div>
      `).join("")}
    </div>` : `<div class="empty">У вас пока нет рабов</div>`;
  return `
    <div class="row" style="justify-content:space-between;margin-bottom:12px;">
      <b>Мои рабы (${slaves.length})</b><span class="muted">${fmt(totalRate)} ₽/мин</span>
    </div>
    ${listHtml}`;
}

function renderProfile(){
  const totalRate = slavesCache.reduce((s,p) => s + p.earn_rate, 0);

  render(`
    <h1>Мой профиль</h1>
    <div class="card row">
      <img class="avatar" src="${esc(me.avatar_url || placeholderAvatar(me.name))}">
      <div>
        <div class="name">${esc(me.name)}</div>
      </div>
    </div>
    <div class="card">
      <div class="stat"><span>Баланс</span><b data-stat="balance">${fmt(me.balance)} ₽</b></div>
      <div class="stat-desc">Всего денег на счету прямо сейчас</div>
      <div class="stat"><span>Личный доход</span><span data-stat="own">${me.owner_id ? "0 ₽/мин" : fmt(me.earn_rate) + " ₽/мин"}</span></div>
      <div class="stat-desc">${me.owner_id ? "Пока вы в рабстве, доход идёт хозяину" : "Сколько вы сами зарабатываете в минуту, без учёта рабов"}</div>
      <div class="stat"><span>Доход с рабов</span><span data-stat="slaves-rate">${fmt(totalRate)} ₽/мин</span></div>
      <div class="stat-desc">Сколько в сумме приносят все ваши рабы в минуту</div>
    </div>
    <div class="card">
      <button onclick="openInviteModal()" style="width:100%;background:#333;">Пригласить друга</button>
    </div>
    <div id="bannerSlot">${buildBannerHtml(ownerCache)}</div>
    <div class="card" id="slavesSlot">${buildSlavesHtml(slavesCache)}</div>
  `);

  if (profileDataFresh) {
    profileDataFresh = false;
  } else {
    refreshProfileData();
  }
}

async function refreshProfileData(){
  const requestTab = tab;
  const [slaves, owner] = await Promise.all([
    fetchOwnedSlaves(),
    me.owner_id ? fetchOwnerOf(me.owner_id) : Promise.resolve(null)
  ]);
  slavesCache = slaves;
  ownerCache = owner;
  if (tab !== requestTab || tab !== "profile") return; // ушли с вкладки, пока грузилось

  const bannerSlot = document.getElementById("bannerSlot");
  if (bannerSlot) bannerSlot.innerHTML = buildBannerHtml(owner);
  const slavesSlot = document.getElementById("slavesSlot");
  if (slavesSlot) slavesSlot.innerHTML = buildSlavesHtml(slaves);
  const rateEl = document.querySelector("[data-stat='slaves-rate']");
  if (rateEl) rateEl.textContent = fmt(slaves.reduce((s,p) => s + p.earn_rate, 0)) + " ₽/мин";
}

async function renderMarket(){
  render(`<h1>Покупка рабов</h1><div class="card"><div class="empty">Загрузка…</div></div>`);
  await refreshMarket();
  const html = marketList.length ? marketList.map(p => {
    const price = buyPrice(p.earn_rate);
    const status = p.owner_id
      ? `В рабстве у ${esc(p.owner_name || "кого-то")}`
      : "Свободен";
    return `
    <div class="list-item" onclick="openTarget('${esc(p.id)}')">
      <img class="avatar sm" src="${esc(p.avatar_url || placeholderAvatar(p.name))}">
      <div class="info">
        <div class="n">${esc(p.name)}</div>
        <div class="muted">${status}</div>
      </div>
      <div class="price">${fmt(price)} ₽</div>
    </div>`;
  }).join("") : `<div class="empty">Пока некого купить</div>`;
  render(`<h1>Покупка рабов</h1><div class="card">${html}</div>`);
}

const TOP_SORT_LABELS = {
  balance: "💰 Деньги",
  earn_rate: "⚡ Доход/мин",
  slaves_count: "⛓️ Рабы"
};

async function renderTop(){
  render(`<h1>Рейтинг</h1><div class="card"><div class="empty">Загрузка…</div></div>`);
  await refreshTop();
  renderTopList();
}

function renderTopList(){
  const sorted = [...topList].sort((a,b) => (b[topSort] || 0) - (a[topSort] || 0));

  const tabsHtml = Object.keys(TOP_SORT_LABELS).map(key => `
    <div class="stab ${topSort===key ? "active" : ""}" onclick="setTopSort('${key}')">${TOP_SORT_LABELS[key]}</div>
  `).join("");

  const rowsHtml = sorted.length ? sorted.map((p,i) => {
    const slavesCount = (p.slaves_count != null) ? fmt(p.slaves_count) : "—";
    return `
    <div class="rank-row" onclick="openProfile('${esc(p.id)}')">
      <b class="rank-num">${i+1}</b>
      <img class="avatar sm" src="${esc(p.avatar_url || placeholderAvatar(p.name))}">
      <div class="info">
        <div class="n">${esc(p.name)}${p.id===me.id ? " (вы)" : ""}</div>
        <div class="mini">
          <span class="${topSort==='balance' ? 'active-metric' : ''}">💰 <b>${fmt(p.balance)} ₽</b></span>
          <span class="${topSort==='earn_rate' ? 'active-metric' : ''}">⚡ <b>${fmt(p.earn_rate)} ₽/мин</b></span>
          <span class="${topSort==='slaves_count' ? 'active-metric' : ''}">⛓️ <b>${slavesCount}</b></span>
        </div>
      </div>
    </div>`;
  }).join("") : `<div class="empty">Пока пусто</div>`;

  render(`
    <h1>Рейтинг</h1>
    <div class="muted" style="font-size:12px;margin-bottom:10px;">
      💰 — сколько денег на счету · ⚡ — доход в минуту · ⛓️ — сколько рабов в собственности
    </div>
    <div class="sort-tabs">${tabsHtml}</div>
    <div class="card">${rowsHtml}</div>
  `);
}

function setTopSort(key){
  topSort = key;
  renderTopList();
}

// ======================= МОДАЛКИ =======================
async function openSlave(id){
  const s = await fetchPlayer(id);
  if (!s) return toast("Игрок не найден");
  const locked = s.locked_until && new Date(s.locked_until) > new Date();
  const sellPrice = sellPriceFor(s.earn_rate);
  const shacklesPrice = shacklesPriceFor(s.earn_rate);
  const upgradePrice = upgradePriceFor(s.earn_rate);
  showModal(`
    <div class="row" style="margin-bottom:12px;">
      <img class="avatar" src="${esc(s.avatar_url || placeholderAvatar(s.name))}">
      <div>
        <div class="name">${esc(s.name)}</div>
        <div class="muted">${esc(s.job_title)} · ${fmt(s.earn_rate)} ₽/мин</div>
      </div>
    </div>
    ${locked
      ? `<div class="muted" style="margin-bottom:12px;color:var(--red);"><b>🔒 Замок надет!</b> До ${new Date(s.locked_until).toLocaleString("ru-RU")}</div>`
      : `<div class="muted" style="margin-bottom:12px;">Замок не надет</div>`}
    <button onclick="sell('${esc(s.id)}')" ${locked ? "disabled" : ""} class="${locked ? "secondary" : ""}" style="margin-bottom:10px;width:100%;">
      ${locked ? "Нельзя продать, пока надет замок" : `Продать за ${fmt(sellPrice)} ₽`}
    </button>
    <button onclick="upgradeSlave('${esc(s.id)}')" style="margin-bottom:10px;width:100%;background:#6c5ce7;">
      Улучшить за ${fmt(upgradePrice)} ₽ (+50 ₽/мин)
    </button>
    <button onclick="applyShackles('${esc(s.id)}')" ${locked ? "disabled" : ""} class="${locked ? "secondary" : ""}" style="width:100%;${locked ? "" : "background:#555;"}">
      ${locked ? "Замок уже надет" : `Надеть замок на 5 часов за ${fmt(shacklesPrice)} ₽`}
    </button>
  `);
}

async function openProfile(id){
  const p = await fetchPlayer(id);
  if (!p) return toast("Игрок не найден");
  const owner = p.owner_id ? await fetchOwnerOf(p.owner_id) : null;
  const locked = p.locked_until && new Date(p.locked_until) > new Date();
  const slavesCount = (p.slaves_count != null) ? fmt(p.slaves_count) : "—";
  const statusHtml = p.owner_id
    ? `В рабстве у <b>${owner ? esc(owner.name) : "кого-то"}</b>`
    : `Свободен`;
  const canBuy = !p.owner_id && p.id !== me.id;

  showModal(`
    <div class="row" style="margin-bottom:14px;">
      <img class="avatar" src="${esc(p.avatar_url || placeholderAvatar(p.name))}">
      <div>
        <div class="name">${esc(p.name)}${p.id===me.id ? " (вы)" : ""}</div>
        <div class="muted">${esc(p.job_title)}</div>
      </div>
    </div>
    <div class="stat"><span>Статус</span><span>${statusHtml}</span></div>
    <div class="stat"><span>Баланс</span><b>${fmt(p.balance)} ₽</b></div>
    <div class="stat"><span>Доход в минуту</span><span>${fmt(p.earn_rate)} ₽/мин</span></div>
    <div class="stat"><span>Рабов в собственности</span><span>${slavesCount}</span></div>
    ${locked ? `<div class="muted" style="margin-top:10px;color:var(--red);">🔒 Замок надет до ${new Date(p.locked_until).toLocaleString("ru-RU")}</div>` : ""}
    ${canBuy ? `
      <div class="muted" style="margin-top:14px;margin-bottom:6px;font-size:13px;">Чем он будет заниматься?</div>
      <input type="text" id="buyJobTitle" maxlength="60" placeholder="Например: разбор почты, уборка, личный помощник…">
      <button onclick="buy('${esc(p.id)}', document.getElementById('buyJobTitle').value)" style="width:100%;">Купить за ${fmt(buyPrice(p.earn_rate))} ₽</button>
    ` : ""}
  `);
}

function openTarget(id){
  const p = marketList.find(x => x.id === id);
  if (!p) return toast("Игрок не найден");
  const price = buyPrice(p.earn_rate);
  showModal(`
    <div class="row" style="margin-bottom:12px;">
      <img class="avatar" src="${esc(p.avatar_url || placeholderAvatar(p.name))}">
      <div>
        <div class="name">${esc(p.name)}</div>
        <div class="muted">${esc(p.job_title)} · ${fmt(p.earn_rate)} ₽/мин</div>
      </div>
    </div>
    <div class="muted" style="margin-bottom:6px;font-size:13px;">Чем он будет заниматься?</div>
    <input type="text" id="buyJobTitle" maxlength="60" placeholder="Например: разбор почты, уборка, личный помощник…">
    <button onclick="buy('${esc(p.id)}', document.getElementById('buyJobTitle').value)">Купить за ${fmt(price)} ₽</button>
  `);
}

function showModal(inner){
  closeModal();
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.id = "modalBg";
  bg.onclick = (e) => { if (e.target.id === "modalBg") closeModal(); };
  bg.innerHTML = `<div class="modal">${inner}</div>`;
  document.body.appendChild(bg);
}
function closeModal(){
  const bg = document.getElementById("modalBg");
  if (bg) bg.remove();
}

// ======================= ТАББАР =======================
function switchTab(t){
  tab = t;
  document.querySelectorAll(".tab").forEach(el => el.classList.remove("active"));
  const el = document.getElementById("t-" + t);
  if (el) el.classList.add("active");
  render();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("app").insertAdjacentHTML("afterend", `
    <div class="tabbar">
      <div class="tab active" id="t-profile" onclick="switchTab('profile')"><span class="ico">👤</span>Мой профиль</div>
      <div class="tab" id="t-market" onclick="switchTab('market')"><span class="ico">🛒</span>Покупка</div>
      <div class="tab" id="t-top" onclick="switchTab('top')"><span class="ico">⭐</span>Рейтинг</div>
    </div>
  `);
  init();
});
