let initializeApp, browserLocalPersistence, createUserWithEmailAndPassword, getAuth,
  onAuthStateChanged, setPersistence, signInWithEmailAndPassword, signOutFirebase,
  doc, getDoc, getFirestore, serverTimestamp, setDoc;

const $ = (selector) => document.querySelector(selector);
const ui = {
  authButton: $("#authButton"), modal: $("#authModal"), close: $("#closeAuthModal"),
  form: $("#authForm"), email: $("#authEmail"), password: $("#authPassword"), error: $("#authError"),
  register: $("#registerButton"), setup: $("#firebaseSetupNotice"), account: $("#accountPanel"),
  accountEmail: $("#accountEmail"), syncStatus: $("#syncStatus"), signOut: $("#signOutButton"),
  title: $("#authTitle"), description: $("#authDescription"), lastCloudSave: $("#lastCloudSave")
};
ui.loadCloud = $("#loadCloudButton");
ui.saveCloud = $("#saveCloudButton");

let auth = null;
let db = null;
let currentUser = null;
let syncBusy = false;
let cloudMetadata = null;

function bridge() { return window.IdeaCoolingCloudBridge; }
function configured(config) {
  return config && ["apiKey", "authDomain", "projectId", "appId"].every((key) => typeof config[key] === "string" && config[key].trim());
}

function openModal() {
  ui.modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  if (!currentUser && !ui.form.classList.contains("hidden")) setTimeout(() => ui.email.focus(), 0);
}

function closeModal() {
  ui.modal.classList.add("hidden");
  document.body.style.overflow = "";
  ui.error.textContent = "";
}

function showSignedOut() {
  ui.form.classList.remove("hidden");
  ui.account.classList.add("hidden");
  ui.title.textContent = "登入雲端";
  ui.description.textContent = "未登入時，所有內容只留在這台裝置。登入後可自行選擇從雲端讀取，或把本機資料存檔到雲端。";
  ui.authButton.classList.remove("signed-in", "syncing");
  ui.authButton.querySelector("b").textContent = "登入";
  ui.loadCloud.classList.add("hidden");
  ui.saveCloud.classList.add("hidden");
  ui.lastCloudSave.textContent = "上次雲端存檔：尚未登入";
}

function showSignedIn(user) {
  ui.form.classList.add("hidden");
  ui.account.classList.remove("hidden");
  ui.title.textContent = "雲端帳號";
  ui.description.textContent = "資料不會自動傳輸。請使用上方的「讀取」或「存檔」決定資料方向。";
  ui.accountEmail.textContent = user.email || "已登入";
  ui.authButton.classList.add("signed-in");
  ui.authButton.querySelector("b").textContent = "雲端";
  ui.loadCloud.classList.remove("hidden");
  ui.saveCloud.classList.remove("hidden");
  ui.saveCloud.title = `存檔到 Firebase（目前裝置：${currentDevice().label}）`;
}

function setSyncStatus(text, busy = false) {
  ui.syncStatus.textContent = text;
  ui.authButton.classList.toggle("syncing", busy);
  [ui.loadCloud, ui.saveCloud].forEach((button) => {
    button.disabled = busy;
    button.classList.toggle("syncing", busy);
  });
  if (!busy && currentUser) ui.authButton.classList.add("signed-in");
}

function friendlyError(error) {
  const messages = {
    "auth/invalid-credential": "信箱或密碼不正確。",
    "auth/email-already-in-use": "這個信箱已經註冊過。",
    "auth/invalid-email": "電子信箱格式不正確。",
    "auth/weak-password": "密碼強度不足，請至少使用 6 個字元。",
    "auth/network-request-failed": "目前無法連線，請檢查網路後再試。",
    "permission-denied": "Firestore 安全規則尚未正確部署。"
  };
  return messages[error?.code] || `操作失敗：${error?.message || "未知錯誤"}`;
}

function currentDevice() {
  const ua = navigator.userAgent || "";
  const isTablet = /iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const isMobile = !isTablet && /iPhone|iPod|Android|Mobile/i.test(ua);
  if (isTablet) return { type: "tablet", label: "平板" };
  if (isMobile) return { type: "mobile", label: "手機" };
  return { type: "desktop", label: "電腦" };
}

function formatCloudMetadata(data) {
  cloudMetadata = data || null;
  if (!data) {
    ui.lastCloudSave.textContent = "上次雲端存檔：尚無存檔";
    return;
  }
  const device = data.lastSavedDevice?.label || "未知裝置";
  const savedDate = data.lastSavedAt?.toDate?.() || (data.clientSavedAt ? new Date(data.clientSavedAt) : null);
  const time = savedDate && !Number.isNaN(savedDate.getTime())
    ? new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(savedDate)
    : "時間未知";
  ui.lastCloudSave.textContent = `上次雲端存檔：${device} · ${time}`;
}

async function refreshCloudMetadata() {
  if (!currentUser || !db) return;
  try {
    const snapshot = await getDoc(doc(db, "users", currentUser.uid));
    formatCloudMetadata(snapshot.exists() ? snapshot.data() : null);
  } catch {
    ui.lastCloudSave.textContent = "上次雲端存檔：查詢失敗";
  }
}

async function saveCloud() {
  if (!currentUser || !db || syncBusy) return;
  const device = currentDevice();
  if (!confirm(`確定用目前本機資料覆蓋 Firebase 雲端存檔嗎？\n\n本次將標記為：${device.label}`)) return;
  const snapshot = bridge()?.getSnapshot();
  if (!snapshot) return;
  syncBusy = true;
  setSyncStatus("正在存檔到雲端……", true);
  try {
    const clientSavedAt = Date.now();
    await setDoc(doc(db, "users", currentUser.uid), { ...snapshot, lastSavedDevice: device, clientSavedAt, lastSavedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    formatCloudMetadata({ lastSavedDevice: device, clientSavedAt });
    setSyncStatus(`雲端存檔完成 · ${new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`);
    bridge()?.notify("目前資料已存檔到 Firebase。");
  } catch (error) {
    setSyncStatus(friendlyError(error));
  } finally {
    syncBusy = false;
    setSyncStatus(ui.syncStatus.textContent, false);
  }
}

async function loadCloud() {
  if (!currentUser || !db || syncBusy) return;
  const reference = doc(db, "users", currentUser.uid);
  syncBusy = true;
  setSyncStatus("正在讀取雲端存檔……", true);
  try {
    const remoteSnapshot = await getDoc(reference);
    if (!remoteSnapshot.exists()) {
      setSyncStatus("這個帳號目前沒有雲端存檔");
      bridge()?.notify("找不到雲端存檔，可先按「存檔」建立。");
      return;
    }
    const remoteData = remoteSnapshot.data();
    formatCloudMetadata(remoteData);
    const sourceDevice = remoteData.lastSavedDevice?.label || "未知裝置";
    if (!confirm(`確定讀取 Firebase 存檔並覆蓋目前本機資料嗎？\n\n上次存檔來源：${sourceDevice}`)) {
      setSyncStatus("已取消讀取");
      return;
    }
    bridge()?.applySnapshot(remoteData);
    setSyncStatus(`雲端讀取完成 · ${new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`);
    bridge()?.notify("已用 Firebase 存檔更新本機資料。");
  } catch (error) {
    setSyncStatus(friendlyError(error));
  } finally {
    syncBusy = false;
    setSyncStatus(ui.syncStatus.textContent, false);
  }
}

function startCloudSession(user) {
  currentUser = user;
  showSignedIn(user);
  setSyncStatus("已登入 · 請選擇讀取或存檔");
  ui.lastCloudSave.textContent = "上次雲端存檔：正在查詢……";
  refreshCloudMetadata();
}

ui.loadCloud.addEventListener("click", loadCloud);
ui.saveCloud.addEventListener("click", saveCloud);

const config = window.IDEA_COOLING_FIREBASE_CONFIG;
if (!configured(config)) {
  ui.setup.classList.remove("hidden");
  ui.form.querySelectorAll("input, button").forEach((element) => { element.disabled = true; });
  ui.authButton.querySelector("b").textContent = "設定登入";
} else {
  try {
    const [appSdk, authSdk, firestoreSdk] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js")
    ]);
    ({ initializeApp } = appSdk);
    ({ browserLocalPersistence, createUserWithEmailAndPassword, getAuth, onAuthStateChanged, setPersistence, signInWithEmailAndPassword, signOut: signOutFirebase } = authSdk);
    ({ doc, getDoc, getFirestore, serverTimestamp, setDoc } = firestoreSdk);
    const app = initializeApp(config);
    auth = getAuth(app);
    db = getFirestore(app);
    await setPersistence(auth, browserLocalPersistence);

    ui.form.addEventListener("submit", async (event) => {
      event.preventDefault();
      ui.error.textContent = "";
      try { await signInWithEmailAndPassword(auth, ui.email.value.trim(), ui.password.value); }
      catch (error) { ui.error.textContent = friendlyError(error); }
    });

    ui.register.addEventListener("click", async () => {
      ui.error.textContent = "";
      if (!ui.form.reportValidity()) return;
      try { await createUserWithEmailAndPassword(auth, ui.email.value.trim(), ui.password.value); }
      catch (error) { ui.error.textContent = friendlyError(error); }
    });

    ui.signOut.addEventListener("click", async () => {
      await signOutFirebase(auth);
      closeModal();
    });

    onAuthStateChanged(auth, async (user) => {
      if (user) startCloudSession(user);
      else {
        currentUser = null;
        syncBusy = false;
        showSignedOut();
      }
    });
  } catch (error) {
    ui.setup.classList.remove("hidden");
    ui.setup.innerHTML = `Firebase 初始化失敗：${error.message}<button id="retryFirebase" class="setup-action" type="button">重新連線</button>`;
    ui.form.classList.add("hidden");
    $("#retryFirebase").addEventListener("click", () => location.reload());
  }
}
