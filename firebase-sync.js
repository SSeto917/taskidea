let initializeApp, browserLocalPersistence, createUserWithEmailAndPassword, getAuth,
  onAuthStateChanged, setPersistence, signInWithEmailAndPassword, signOutFirebase,
  doc, getDoc, getFirestore, onSnapshot, serverTimestamp, setDoc;

const $ = (selector) => document.querySelector(selector);
const ui = {
  authButton: $("#authButton"), modal: $("#authModal"), close: $("#closeAuthModal"),
  form: $("#authForm"), email: $("#authEmail"), password: $("#authPassword"), error: $("#authError"),
  register: $("#registerButton"), setup: $("#firebaseSetupNotice"), account: $("#accountPanel"),
  accountEmail: $("#accountEmail"), syncStatus: $("#syncStatus"), signOut: $("#signOutButton"),
  title: $("#authTitle"), description: $("#authDescription")
};

let auth = null;
let db = null;
let currentUser = null;
let unsubscribeCloud = null;
let uploadTimer = null;
let applyingCloud = false;
let syncBusy = false;

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
  ui.description.textContent = "未登入時，所有內容只留在這台裝置。登入後才會同步到你的私人雲端空間。";
  ui.authButton.classList.remove("signed-in", "syncing");
  ui.authButton.querySelector("b").textContent = "登入";
}

function showSignedIn(user) {
  ui.form.classList.add("hidden");
  ui.account.classList.remove("hidden");
  ui.title.textContent = "雲端帳號";
  ui.description.textContent = "登入期間的所有變更，都會同步到這個帳號的私人 Firestore 文件。";
  ui.accountEmail.textContent = user.email || "已登入";
  ui.authButton.classList.add("signed-in");
  ui.authButton.querySelector("b").textContent = "雲端";
}

function setSyncStatus(text, busy = false) {
  ui.syncStatus.textContent = text;
  ui.authButton.classList.toggle("syncing", busy);
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

async function uploadSnapshot() {
  if (!currentUser || !db || syncBusy || applyingCloud) return;
  const snapshot = bridge()?.getSnapshot();
  if (!snapshot) return;
  syncBusy = true;
  setSyncStatus("正在同步……", true);
  try {
    await setDoc(doc(db, "users", currentUser.uid), { ...snapshot, updatedAt: serverTimestamp() });
    setSyncStatus(`同步完成 · ${new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`);
  } catch (error) {
    setSyncStatus(friendlyError(error));
  } finally {
    syncBusy = false;
  }
}

function scheduleUpload() {
  if (!currentUser || applyingCloud) return;
  clearTimeout(uploadTimer);
  uploadTimer = setTimeout(uploadSnapshot, 650);
}

async function startCloudSession(user) {
  currentUser = user;
  showSignedIn(user);
  setSyncStatus("正在比較本機與雲端資料……", true);
  const reference = doc(db, "users", user.uid);
  try {
    const remoteSnapshot = await getDoc(reference);
    const local = bridge()?.getSnapshot();
    if (remoteSnapshot.exists() && Number(remoteSnapshot.data().clientModifiedAt) > Number(local?.clientModifiedAt || 0)) {
      applyingCloud = true;
      bridge()?.applySnapshot(remoteSnapshot.data());
      applyingCloud = false;
      setSyncStatus("已載入較新的雲端資料");
    } else {
      await uploadSnapshot();
    }

    unsubscribeCloud?.();
    unsubscribeCloud = onSnapshot(reference, (snapshot) => {
      if (!snapshot.exists() || applyingCloud) return;
      const remote = snapshot.data();
      const localNow = bridge()?.getSnapshot();
      if (Number(remote.clientModifiedAt) > Number(localNow?.clientModifiedAt || 0)) {
        applyingCloud = true;
        bridge()?.applySnapshot(remote);
        applyingCloud = false;
        setSyncStatus("已接收雲端更新");
      }
    }, (error) => setSyncStatus(friendlyError(error)));
  } catch (error) {
    applyingCloud = false;
    setSyncStatus(friendlyError(error));
  }
}

window.addEventListener("idea-cooling:data-changed", scheduleUpload);

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
    ({ doc, getDoc, getFirestore, onSnapshot, serverTimestamp, setDoc } = firestoreSdk);
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
      clearTimeout(uploadTimer);
      unsubscribeCloud?.();
      unsubscribeCloud = null;
      if (user) await startCloudSession(user);
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
