let initializeApp, browserLocalPersistence, createUserWithEmailAndPassword, getAuth,
  onAuthStateChanged, sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword,
  signOutFirebase, doc, getDoc, getFirestore, serverTimestamp, setDoc;

const $ = (selector) => document.querySelector(selector);
const ui = {
  authButton: $("#authButton"), loadCloud: $("#loadCloudButton"), saveCloud: $("#saveCloudButton"),
  form: $("#authForm"), modeTabs: $("#authModeTabs"), connection: $("#authConnection"),
  email: $("#authEmail"), password: $("#authPassword"), passwordConfirm: $("#authPasswordConfirm"),
  confirmField: $("#confirmPasswordField"), togglePassword: $("#togglePassword"),
  submit: $("#authSubmitButton"), forgot: $("#forgotPasswordButton"), error: $("#authError"),
  setup: $("#firebaseSetupNotice"), account: $("#accountPanel"), accountEmail: $("#accountEmail"),
  currentDeviceLabel: $("#currentDeviceLabel"), syncStatus: $("#syncStatus"),
  lastCloudSave: $("#lastCloudSave"), signOut: $("#signOutButton"),
  title: $("#authTitle"), description: $("#authDescription")
};

let auth = null;
let db = null;
let currentUser = null;
let authMode = "login";
let cloudBusy = false;

function bridge() { return window.IdeaCoolingCloudBridge; }
function configured(config) {
  return config && ["apiKey", "authDomain", "projectId", "appId"].every((key) => typeof config[key] === "string" && config[key].trim());
}

function currentDevice() {
  const ua = navigator.userAgent || "";
  const tablet = /iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const mobile = !tablet && /iPhone|iPod|Android|Mobile/i.test(ua);
  if (tablet) return { type: "tablet", label: "平板" };
  if (mobile) return { type: "mobile", label: "手機" };
  return { type: "desktop", label: "電腦" };
}

function setConnection(text, state = "") {
  ui.connection.classList.remove("ready", "error");
  if (state) ui.connection.classList.add(state);
  ui.connection.lastChild.textContent = ` ${text}`;
}

function setAuthEnabled(enabled) {
  ui.form.querySelectorAll("input, button").forEach((element) => { element.disabled = !enabled; });
  ui.modeTabs.querySelectorAll("button").forEach((element) => { element.disabled = !enabled; });
}

function setMode(mode) {
  authMode = mode;
  const registering = mode === "register";
  ui.modeTabs.querySelectorAll("[data-auth-mode]").forEach((button) => {
    const active = button.dataset.authMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  ui.confirmField.classList.toggle("hidden", !registering);
  ui.passwordConfirm.required = registering;
  ui.password.autocomplete = registering ? "new-password" : "current-password";
  ui.submit.textContent = registering ? "建立帳號" : "登入";
  ui.forgot.classList.toggle("hidden", registering);
  ui.error.textContent = "";
}

function setCloudBusy(busy, message) {
  cloudBusy = busy;
  if (message) ui.syncStatus.textContent = message;
  [ui.loadCloud, ui.saveCloud].forEach((button) => {
    button.disabled = busy;
    button.classList.toggle("syncing", busy);
  });
  ui.authButton.classList.toggle("syncing", busy);
}

function friendlyError(error) {
  const messages = {
    "auth/invalid-credential": "信箱或密碼不正確。",
    "auth/email-already-in-use": "這個信箱已經建立過帳號，請改用登入。",
    "auth/invalid-email": "電子信箱格式不正確。",
    "auth/weak-password": "密碼強度不足，請至少使用 6 個字元。",
    "auth/password-does-not-meet-requirements": "密碼不符合 Firebase 專案設定的要求。",
    "auth/operation-not-allowed": "Firebase 尚未啟用 Email/Password 登入。",
    "auth/too-many-requests": "嘗試次數太多，請稍後再試。",
    "auth/user-disabled": "這個帳號已被停用。",
    "auth/network-request-failed": "目前無法連線，請檢查網路後再試。",
    "permission-denied": "Firestore 安全規則尚未正確發布。"
  };
  return messages[error?.code] || `操作失敗：${error?.message || "未知錯誤"}`;
}

function showSignedOut() {
  currentUser = null;
  ui.form.classList.remove("hidden");
  ui.modeTabs.classList.remove("hidden");
  ui.account.classList.add("hidden");
  ui.title.textContent = "登入雲端";
  ui.description.textContent = "登入只驗證你的身分；資料仍由「讀取」與「存檔」手動控制。";
  ui.authButton.classList.remove("signed-in", "syncing");
  ui.authButton.querySelector("b").textContent = "登入";
  ui.loadCloud.classList.add("hidden");
  ui.saveCloud.classList.add("hidden");
  setMode("login");
}

function showSignedIn(user) {
  currentUser = user;
  ui.form.classList.add("hidden");
  ui.modeTabs.classList.add("hidden");
  ui.account.classList.remove("hidden");
  ui.title.textContent = "雲端帳號";
  ui.description.textContent = "資料不會自動傳輸。請自行選擇從雲端讀取，或將本機內容存檔到雲端。";
  ui.accountEmail.textContent = user.email || "已登入";
  ui.currentDeviceLabel.textContent = `目前裝置：${currentDevice().label}`;
  ui.authButton.classList.add("signed-in");
  ui.authButton.querySelector("b").textContent = "雲端";
  ui.loadCloud.classList.remove("hidden");
  ui.saveCloud.classList.remove("hidden");
  ui.saveCloud.title = `存檔到 Firebase（目前裝置：${currentDevice().label}）`;
  ui.syncStatus.textContent = "已登入 · 請選擇讀取或存檔";
  refreshCloudMetadata();
}

function formatCloudMetadata(data) {
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
  ui.lastCloudSave.textContent = "上次雲端存檔：正在查詢……";
  try {
    const snapshot = await getDoc(doc(db, "users", currentUser.uid));
    formatCloudMetadata(snapshot.exists() ? snapshot.data() : null);
  } catch (error) {
    ui.lastCloudSave.textContent = friendlyError(error);
  }
}

async function saveCloud() {
  if (!currentUser || !db || cloudBusy) return;
  const device = currentDevice();
  if (!confirm(`確定用目前本機資料覆蓋 Firebase 雲端存檔嗎？\n\n本次將標記為：${device.label}`)) return;
  const snapshot = bridge()?.getSnapshot();
  if (!snapshot) return;
  setCloudBusy(true, "正在存檔到雲端……");
  try {
    const clientSavedAt = Date.now();
    await setDoc(doc(db, "users", currentUser.uid), { ...snapshot, lastSavedDevice: device, clientSavedAt, lastSavedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    formatCloudMetadata({ lastSavedDevice: device, clientSavedAt });
    ui.syncStatus.textContent = "雲端存檔完成";
    bridge()?.notify("目前資料已存檔到 Firebase。");
  } catch (error) {
    ui.syncStatus.textContent = friendlyError(error);
  } finally {
    setCloudBusy(false);
  }
}

async function loadCloud() {
  if (!currentUser || !db || cloudBusy) return;
  setCloudBusy(true, "正在查詢雲端存檔……");
  try {
    const snapshot = await getDoc(doc(db, "users", currentUser.uid));
    if (!snapshot.exists()) {
      formatCloudMetadata(null);
      ui.syncStatus.textContent = "這個帳號目前沒有雲端存檔";
      bridge()?.notify("找不到雲端存檔，可先按「存檔」建立。");
      return;
    }
    const data = snapshot.data();
    formatCloudMetadata(data);
    const source = data.lastSavedDevice?.label || "未知裝置";
    if (!confirm(`確定讀取 Firebase 存檔並覆蓋目前本機資料嗎？\n\n上次存檔來源：${source}`)) {
      ui.syncStatus.textContent = "已取消讀取";
      return;
    }
    if (!bridge()?.applySnapshot(data)) throw new Error("雲端存檔格式不正確");
    ui.syncStatus.textContent = "雲端讀取完成";
    bridge()?.notify("已用 Firebase 存檔更新本機資料。");
  } catch (error) {
    ui.syncStatus.textContent = friendlyError(error);
  } finally {
    setCloudBusy(false);
  }
}

ui.modeTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-auth-mode]");
  if (button && !button.disabled) setMode(button.dataset.authMode);
});

ui.togglePassword.addEventListener("click", () => {
  const show = ui.password.type === "password";
  ui.password.type = show ? "text" : "password";
  ui.passwordConfirm.type = show ? "text" : "password";
  ui.togglePassword.textContent = show ? "隱藏" : "顯示";
});

ui.loadCloud.addEventListener("click", loadCloud);
ui.saveCloud.addEventListener("click", saveCloud);

setAuthEnabled(false);
setConnection("正在連接 Firebase");

const config = window.IDEA_COOLING_FIREBASE_CONFIG;
if (!configured(config)) {
  setConnection("Firebase 尚未設定", "error");
  ui.setup.classList.remove("hidden");
} else {
  try {
    const [appSdk, authSdk, firestoreSdk] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js")
    ]);
    ({ initializeApp } = appSdk);
    ({ browserLocalPersistence, createUserWithEmailAndPassword, getAuth, onAuthStateChanged, sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword, signOut: signOutFirebase } = authSdk);
    ({ doc, getDoc, getFirestore, serverTimestamp, setDoc } = firestoreSdk);

    const app = initializeApp(config);
    auth = getAuth(app);
    db = getFirestore(app);
    await setPersistence(auth, browserLocalPersistence);
    setAuthEnabled(true);
    setConnection("Firebase 連線正常", "ready");

    ui.form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!ui.form.reportValidity()) return;
      ui.error.textContent = "";
      ui.submit.disabled = true;
      ui.submit.textContent = authMode === "register" ? "正在建立……" : "正在登入……";
      try {
        if (authMode === "register") {
          if (ui.password.value !== ui.passwordConfirm.value) throw { code: "password-mismatch" };
          await createUserWithEmailAndPassword(auth, ui.email.value.trim(), ui.password.value);
        } else {
          await signInWithEmailAndPassword(auth, ui.email.value.trim(), ui.password.value);
        }
      } catch (error) {
        ui.error.textContent = error.code === "password-mismatch" ? "兩次輸入的密碼不一致。" : friendlyError(error);
      } finally {
        ui.submit.disabled = false;
        ui.submit.textContent = authMode === "register" ? "建立帳號" : "登入";
      }
    });

    ui.forgot.addEventListener("click", async () => {
      ui.error.textContent = "";
      if (!ui.email.checkValidity()) {
        ui.error.textContent = "請先輸入有效的電子信箱。";
        ui.email.focus();
        return;
      }
      try {
        await sendPasswordResetEmail(auth, ui.email.value.trim());
        ui.error.textContent = "密碼重設信已寄出，請檢查信箱。";
      } catch (error) { ui.error.textContent = friendlyError(error); }
    });

    ui.signOut.addEventListener("click", async () => {
      await signOutFirebase(auth);
      window.IdeaCoolingAuthUI?.close();
    });

    onAuthStateChanged(auth, (user) => user ? showSignedIn(user) : showSignedOut());
  } catch (error) {
    setConnection("Firebase 連線失敗", "error");
    ui.setup.classList.remove("hidden");
    ui.setup.innerHTML = `Firebase 初始化失敗：${error.message}<button id="retryFirebase" class="setup-action" type="button">重新連線</button>`;
    ui.modeTabs.classList.add("hidden");
    ui.form.classList.add("hidden");
    $("#retryFirebase").addEventListener("click", () => location.reload());
  }
}
