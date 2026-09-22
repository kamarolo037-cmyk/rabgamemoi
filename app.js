// ======================= НАСТРОЙКИ =======================
const SUPABASE_URL = "https://gusoancxlsbixtnfzqpo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ef0R27oL_EFuBg97W1KdwA_j9EeIMDL";
// =========================================================

const tg = window.Telegram && window.Telegram.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let me = null;
let tab = "profile";
let marketList = [];
let topList = [];
let slavesCache = [];
let busy = false;
let collectTimer = null;

const fmt = n => Math.floor(n || 0).toLocaleString("ru-RU");

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

// ======================= ИНИЦИАЛИЗАЦИЯ =======================
async function init(){
  const u = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) || null;
  const telegramId = u ? u.id : 0;
  const name = u ? [u.first_name, u.last_name].filter(Boolean).join(" ") : "Тестер";
  const avatar = u && u.photo_url ? u.photo_url : null;

  let startParam = "public";
  if (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) {
    startParam = tg.initDataUnsafe.start_param;
  } else {
    try {
      const hashParams = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
      if (hashParams.get("tgWebAppStartParam")) {
        startParam = hashParams.get("tgWebAppStartParam");
      }
    } catch(e){}
  }
  const companyId = (startParam || "public").toLowerCase().replace(/[^a-z0-9_\-]/g, "").slice(0, 48) || "public";

  const { data, error } = await sb.rpc("get_or_create_player", {
    p_telegram_id: telegramId,
    p_name: name,
    p_avatar_url: avatar,
    p_company_id: companyId
  });
  if (error) {
    render(`<div class="empty">Ошибка подключения: ${esc(error.message)}</div>`);
    return;
  }
  me = data;
  await collect(true);
  render();

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
    const { data, error } = await sb.rpc("collect_income", { p_player_id: me.id });
    if (error) return;
    me = data;
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
  const { data, error } = await sb.rpc("list_market", { p_viewer_id: me.id, p_limit: 40 });
  marketList = (!error && data) ? data : [];
}
async function refreshTop(){
  const { data, error } = await sb.rpc("list_top", { p_viewer_id: me.id, p_limit: 40 });
  topList = (!error && data) ? data : [];
}
async function fetchOwnedSlaves(){
  const { data } = await sb.from("players")
    .select("*").eq("owner_id", me.id).order("earn_rate", { ascending:false });
  return data || [];
}
async function fetchOwnerOf(id){
  if (!id) return null;
  const { data } = await sb.from("players").select("*").eq("id", id).maybeSingle();
  return data;
}
async function fetchPlayer(id){
  const { data } = await sb.from("players").select("*").eq("id", id).maybeSingle();
  return data;
}

// ======================= ДЕЙСТВИЯ =======================
async function withBusy(fn){
  if (busy) return;
  busy = true;
  try { await fn(); } finally { busy = false; }
}

async function buy(targetId){
  await withBusy(async () => {
    const { error } = await sb.rpc("buy_slave", { p_buyer_id: me.id, p_target_id: targetId });
    if (error) return toast(error.message.replace(/^.*ERROR:\s*/,""));
    toast("Куплен(а)!");
    closeModal();
    await collect(true);
    await refreshMarket();
    render();
  });
}
async function sell(slaveId){
  await withBusy(async () => {
    const { error } = await sb.rpc("sell_slave", { p_owner_id: me.id, p_slave_id: slaveId });
    if (error) return toast(error.message.replace(/^.*ERROR:\s*/,""));
    toast("Продан(а)!");
    closeModal();
    await collect(true);
    render();
  });
}
async function applyShackles(slaveId){
  await withBusy(async () => {
    const { error } = await sb.rpc("apply_shackles", { p_owner_id: me.id, p_slave_id: slaveId });
    if (error) return toast(error.message.replace(/^.*ERROR:\s*/,""));
    toast("Оковы надеты на 5 часов!");
    closeModal();
    await collect(true);
    render();
  });
}
async function freeSelf(){
  await withBusy(async () => {
    const { data, error } = await sb.rpc("free_self", { p_player_id: me.id });
    if (error) return toast(error.message.replace(/^.*ERROR:\s*/,""));
    me = data;
    toast("Вы свободны!");
    render();
  });
}
async function escape(){
  await withBusy(async () => {
    const { data, error } = await sb.rpc("try_escape", { p_player_id: me.id });
    if (error) return toast(error.message.replace(/^.*ERROR:\s*/,""));
    if (data.success) {
      toast(`Побег удался! Украдено ${fmt(data.stolen)} ₽`);
      await collect(true);
    } else {
      toast("Побег не удался, попробуйте позже");
    }
    render();
  });
}

// ======================= ИНВАЙТЫ =======================
function getInviteLink(){
  const refId = (me && me.telegram_id) ? me.telegram_id : "0";
  return `https://t.me/jailcand_bot?start=ref_${refId}`;
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

async function renderProfile(){
  const [slaves, owner] = await Promise.all([
    fetchOwnedSlaves(),
    me.owner_id ? fetchOwnerOf(me.owner_id) : Promise.resolve(null)
  ]);
  slavesCache = slaves;

  const totalRate = slaves.reduce((s,p) => s + p.earn_rate, 0);

  let bannerHtml = "";
  if (me.owner_id){
    const freePrice = 1000 + me.earn_rate * 11000;
    const canEscape = !me.locked_until || new Date(me.locked_until) < new Date();
    const ownerName = owner ? esc(owner.name) : "неизвестного";
    const jobTitle = esc(me.job_title);
    bannerHtml = `
      <div class="banner owned">
        Вы в рабстве у <b>${ownerName}</b> на работе «${jobTitle}»
        <button onclick="freeSelf()" ${canEscape ? "" : "disabled"} style="${canEscape ? "" : "opacity:0.5"}">
          Освободиться за ${fmt(freePrice)} ₽
        </button>
      </div>
      <div class="banner escape">
        ${canEscape
          ? "Попробуйте сбежать от хозяина и украсть немного деньжат."
          : `В оковах до ${new Date(me.locked_until).toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"})}`}
        <button class="secondary" ${canEscape?"":"disabled"} onclick="escape()">Сбежать от хозяина</button>
      </div>`;
  }

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

  render(`
    <h1>Мой профиль</h1>
    ${bannerHtml}
    <div class="card row">
      <img class="avatar" src="${esc(me.avatar_url || placeholderAvatar(me.name))}">
      <div>
        <div class="name">${esc(me.name)}</div>
        <div class="muted">Работа: ${esc(me.job_title)}</div>
      </div>
    </div>
    <div class="card">
      <div class="stat"><span>Баланс</span><b data-stat="balance">${fmt(me.balance)} ₽</b></div>
      <div class="stat"><span>Собственный доход</span><span data-stat="own">${me.owner_id ? "0" : fmt(me.earn_rate)}</span></div>
      <div class="stat"><span>Доход с рабов</span><span>${fmt(totalRate)} ₽/мин</span></div>
    </div>
    <div class="card">
      <button onclick="openInviteModal()" style="width:100%;background:#333;">Пригласить друга</button>
    </div>
    <div class="card">
      <div class="row" style="justify-content:space-between;margin-bottom:12px;">
        <b>Мои рабы (${slaves.length})</b><span class="muted">${fmt(totalRate)} ₽/мин</span>
      </div>
      ${listHtml}
    </div>
  `);
}

async function renderMarket(){
  render(`<h1>Покупка рабов</h1><div class="card"><div class="empty">Загрузка…</div></div>`);
  await refreshMarket();
  const html = marketList.length ? marketList.map(p => {
    const price = 200 + p.earn_rate * 1500;
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

async function renderTop(){
  render(`<h1>Рейтинг</h1><div class="card"><div class="empty">Загрузка…</div></div>`);
  await refreshTop();
  const html = topList.length ? topList.map((p,i) => `
    <div class="list-item">
      <b style="width:20px;">${i+1}</b>
      <img class="avatar sm" src="${esc(p.avatar_url || placeholderAvatar(p.name))}">
      <div class="info">
        <div class="n">${esc(p.name)}${p.id===me.id?" (вы)":""}</div>
        <div class="muted">${fmt(p.earn_rate)} ₽/мин</div>
      </div>
      <b>${fmt(p.balance)} ₽</b>
    </div>`).join("") : `<div class="empty">Пока пусто</div>`;
  render(`<h1>Рейтинг</h1><div class="card">${html}</div>`);
}

// ======================= МОДАЛКИ =======================
async function openSlave(id){
  const s = await fetchPlayer(id);
  if (!s) return toast("Игрок не найден");
  const locked = s.locked_until && new Date(s.locked_until) > new Date();
  const sellPrice = 100 + s.earn_rate * 17;
  const shacklesPrice = 500 + Math.floor(s.earn_rate * 20);
  showModal(`
    <div class="row" style="margin-bottom:12px;">
      <img class="avatar" src="${esc(s.avatar_url || placeholderAvatar(s.name))}">
      <div>
        <div class="name">${esc(s.name)}</div>
        <div class="muted">${esc(s.job_title)} · ${fmt(s.earn_rate)} ₽/мин</div>
      </div>
    </div>
    ${locked
      ? `<div class="muted" style="margin-bottom:12px;">В оковах ещё до ${new Date(s.locked_until).toLocaleString("ru-RU")}</div>`
      : `<div class="muted" style="margin-bottom:12px;">Сейчас свободен от оков</div>`}
    <button onclick="sell('${esc(s.id)}')" ${locked ? "disabled" : ""} class="${locked ? "secondary" : ""}" style="margin-bottom:10px;width:100%;">
      Продать за ${fmt(sellPrice)} ₽
    </button>
    <button onclick="applyShackles('${esc(s.id)}')" style="width:100%;background:#555;">
      Надеть оковы на 5 часов за ${fmt(shacklesPrice)} ₽
    </button>
  `);
}

function openTarget(id){
  const p = marketList.find(x => x.id === id);
  if (!p) return toast("Игрок не найден");
  const price = 200 + p.earn_rate * 1500;
  showModal(`
    <div class="row" style="margin-bottom:12px;">
      <img class="avatar" src="${esc(p.avatar_url || placeholderAvatar(p.name))}">
      <div>
        <div class="name">${esc(p.name)}</div>
        <div class="muted">${esc(p.job_title)} · ${fmt(p.earn_rate)} ₽/мин</div>
      </div>
    </div>
    <button onclick="buy('${esc(p.id)}')">Купить за ${fmt(price)} ₽</button>
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
