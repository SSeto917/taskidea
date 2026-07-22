(() => {
  "use strict";

  const STORAGE_KEY = "idea-cooling-system-v1";
  const UI_KEY = "idea-cooling-ui-v1";
  const TASKS_KEY = "idea-cooling-recurring-tasks-v1";
  const DATA_META_KEY = "idea-cooling-data-meta-v1";
  const COOLING_MS = 24 * 60 * 60 * 1000;

  const defaultState = () => ({ currentTask: "", youtubeUrl: "", isFocusing: false, focusStartedAt: null, totalFocusMs: 0, completedFocusCount: 0, focusSessions: [], inbox: [], pool: [], todos: [] });
  let state = loadState();
  let collapsed = loadCollapsed();
  let recurringState = loadRecurringTasks();
  let localModifiedAt = Number(localStorage.getItem(DATA_META_KEY)) || 0;
  let editingTasks = false;
  let taskDraft = null;
  let reviewQueue = [];
  let toastTimer;

  const $ = (selector) => document.querySelector(selector);
  const els = {
    currentTask: $("#currentTask"), youtubeUrl: $("#youtubeUrl"), taskHint: $("#taskHint"), finishTask: $("#finishTask"), finishFocusedTask: $("#finishFocusedTask"),
    focusSetup: $("#focusSetup"), focusMedia: $("#focusMedia"), youtubePlayer: $("#youtubePlayer"), youtubeEmpty: $("#youtubeEmpty"),
    focusTimer: $("#focusTimer"), focusTimerTask: $("#focusTimerTask"), focusElapsed: $("#focusElapsed"), heroHeadline: $("#heroHeadline"),
    totalFocusTime: $("#totalFocusTime"), todayFocusTime: $("#todayFocusTime"), focusSessionCount: $("#focusSessionCount"), focusSessionList: $("#focusSessionList"),
    captureForm: $("#captureForm"), ideaInput: $("#ideaInput"), inboxCount: $("#inboxCount"),
    reviewSection: $("#reviewSection"), reviewCard: $("#reviewCard"), reviewProgress: $("#reviewProgress"),
    poolList: $("#poolList"), poolCount: $("#poolCount"), todoList: $("#todoList"), todoCount: $("#todoCount"),
    poolColumn: $("#poolColumn"), todoColumn: $("#todoColumn"), togglePool: $("#togglePool"), toggleTodo: $("#toggleTodo"),
    toast: $("#toast"), exportData: $("#exportData"), importData: $("#importData"), resetData: $("#resetData"),
    ideaView: $("#ideaView"), tasksView: $("#tasksView"), viewButtons: document.querySelectorAll("[data-view]"),
    taskTabs: $("#taskTabs"), taskBoard: $("#taskBoard"), missionList: $("#missionList"), addMission: $("#addMission"),
    editTasks: $("#editTasks"), addRecurringTask: $("#addRecurringTask"), cancelTaskEdit: $("#cancelTaskEdit"), resetCurrentTasks: $("#resetCurrentTasks"),
    taskPeriodLabel: $("#taskPeriodLabel"), taskBoardTitle: $("#taskBoardTitle"), periodResetHint: $("#periodResetHint"),
    overallProgressText: $("#overallProgressText"), overallProgressBar: $("#overallProgressBar"),
    dailyTabCount: $("#dailyTabCount"), weeklyTabCount: $("#weeklyTabCount"), monthlyTabCount: $("#monthlyTabCount"),
    authButton: $("#authButton"), authModal: $("#authModal"), closeAuthModal: $("#closeAuthModal"),
    firebaseSetupNotice: $("#firebaseSetupNotice"), authForm: $("#authForm"), authError: $("#authError")
  };
  els.installPwa = $("#installPwa");
  let installPrompt = null;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return saved && Array.isArray(saved.inbox) && Array.isArray(saved.pool) && Array.isArray(saved.todos)
        ? { ...defaultState(), ...saved }
        : defaultState();
    } catch { return defaultState(); }
  }

  function loadCollapsed() {
    try { return { pool: false, todo: false, ...JSON.parse(localStorage.getItem(UI_KEY)) }; }
    catch { return { pool: false, todo: false }; }
  }

  function defaultRecurringTasks() {
    const items = { daily: [], weekly: [], monthly: [] };
    return { active: "daily", items, periodMarkers: {} };
  }

  function loadRecurringTasks() {
    try {
      const saved = JSON.parse(localStorage.getItem(TASKS_KEY));
      const fresh = defaultRecurringTasks();
      if (!saved || !saved.items) return fresh;
      fresh.active = ["daily", "weekly", "monthly"].includes(saved.active) ? saved.active : "daily";
      fresh.periodMarkers = saved.periodMarkers || {};
      for (const period of ["daily", "weekly", "monthly"]) {
        fresh.items[period] = Array.isArray(saved.items[period]) ? saved.items[period] : [];
      }
      return fresh;
    } catch { return defaultRecurringTasks(); }
  }

  function localDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function periodKey(period, now = new Date()) {
    if (period === "daily") return localDateKey(now);
    if (period === "monthly") return localDateKey(now).slice(0, 7);
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = monday.getDay() || 7;
    monday.setDate(monday.getDate() - day + 1);
    return localDateKey(monday);
  }

  function resetExpiredPeriods() {
    let changed = false;
    let progressChanged = false;
    for (const period of ["daily", "weekly", "monthly"]) {
      const marker = periodKey(period);
      if (recurringState.periodMarkers[period] !== marker) {
        recurringState.items[period].forEach((task) => {
          if (Number(task.current) > 0) progressChanged = true;
          task.current = 0;
        });
        recurringState.periodMarkers[period] = marker;
        changed = true;
      }
    }
    if (changed) {
      localStorage.setItem(TASKS_KEY, JSON.stringify(recurringState));
      if (progressChanged) markDataChanged();
    }
  }

  function saveRecurringTasks() {
    localStorage.setItem(TASKS_KEY, JSON.stringify(recurringState));
    markDataChanged();
    renderTasks();
  }

  function renderCollapsed() {
    [["pool", els.poolColumn, els.togglePool], ["todo", els.todoColumn, els.toggleTodo]].forEach(([type, column, button]) => {
      const isCollapsed = Boolean(collapsed[type]);
      column.classList.toggle("is-collapsed", isCollapsed);
      button.setAttribute("aria-expanded", String(!isCollapsed));
      button.querySelector("span").textContent = isCollapsed ? "展開" : "收合";
    });
  }

  function toggleColumn(type) {
    collapsed[type] = !collapsed[type];
    localStorage.setItem(UI_KEY, JSON.stringify(collapsed));
    markDataChanged();
    renderCollapsed();
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    markDataChanged();
    render();
  }

  function markDataChanged() {
    localModifiedAt = Date.now();
    localStorage.setItem(DATA_META_KEY, String(localModifiedAt));
    window.dispatchEvent(new CustomEvent("idea-cooling:data-changed"));
  }

  function id() {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function formatDate(timestamp) {
    return new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp);
  }

  function remainingText(cooledAt) {
    const remaining = COOLING_MS - (Date.now() - cooledAt);
    if (remaining <= 0) return "冷卻完成";
    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.ceil((remaining % 3600000) / 60000);
    return `還要 ${hours} 小時 ${minutes} 分`;
  }

  function renderFocusTimer() {
    if (!state.isFocusing || !state.focusStartedAt) return;
    const totalSeconds = Math.max(0, Math.floor((Date.now() - state.focusStartedAt) / 1000));
    const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
    const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    els.focusElapsed.textContent = `${hours}:${minutes}:${seconds}`;
    els.focusElapsed.dateTime = `PT${totalSeconds}S`;
  }

  function durationSeconds(milliseconds, minimumDigits = 6) {
    const totalSeconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
    return { totalSeconds, text: String(totalSeconds).padStart(minimumDigits, "0") };
  }

  function renderFocusLedger() {
    const sessions = Array.isArray(state.focusSessions) ? state.focusSessions : [];
    const total = durationSeconds(state.totalFocusMs);
    const todayKey = localDateKey(new Date());
    const todayMs = sessions.reduce((sum, session) => {
      return localDateKey(new Date(Number(session.endedAt) || 0)) === todayKey ? sum + (Number(session.durationMs) || 0) : sum;
    }, 0);
    const today = durationSeconds(todayMs);
    els.totalFocusTime.textContent = total.text;
    els.totalFocusTime.dateTime = `PT${total.totalSeconds}S`;
    els.todayFocusTime.textContent = today.text;
    els.todayFocusTime.dateTime = `PT${today.totalSeconds}S`;
    els.focusSessionCount.textContent = String(Number(state.completedFocusCount) || sessions.length).padStart(3, "0");

    if (!sessions.length) {
      els.focusSessionList.innerHTML = '<div class="ledger-empty">NO COMPLETED SESSION YET<br><span>完成專注任務後，時間會記錄在這裡。</span></div>';
      return;
    }
    els.focusSessionList.innerHTML = sessions.slice(0, 6).map((session) => {
      const elapsed = durationSeconds(session.durationMs);
      return `<div class="ledger-log-row">
        <time datetime="${new Date(Number(session.endedAt) || 0).toISOString()}">${escapeHtml(formatDate(session.endedAt))}</time>
        <span title="${escapeHtml(session.task || "未命名任務")}">${escapeHtml(session.task || "未命名任務")}</span>
        <strong>+${elapsed.text}<small> SEC</small></strong>
      </div>`;
    }).join("");
  }

  function completeFocusSession() {
    if (!state.isFocusing) return;
    const endedAt = Date.now();
    const startedAt = Number(state.focusStartedAt) || endedAt;
    const durationMs = Math.max(0, endedAt - startedAt);
    const task = state.currentTask.trim() || "未命名任務";
    if (!Array.isArray(state.focusSessions)) state.focusSessions = [];
    state.focusSessions.unshift({ id: id(), task, startedAt, endedAt, durationMs });
    state.focusSessions = state.focusSessions.slice(0, 200);
    state.totalFocusMs = Math.max(0, Number(state.totalFocusMs) || 0) + durationMs;
    state.completedFocusCount = Math.max(0, Number(state.completedFocusCount) || 0) + 1;
    state.currentTask = "";
    state.isFocusing = false;
    state.focusStartedAt = null;
    saveState();
  }

  function youtubeEmbedUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value.trim());
      const host = url.hostname.replace(/^www\./, "");
      if (!["youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"].includes(host)) return "";
      let videoId = "";
      if (host === "youtu.be") videoId = url.pathname.split("/").filter(Boolean)[0] || "";
      else if (url.pathname === "/watch") videoId = url.searchParams.get("v") || "";
      else if (/^\/(shorts|embed)\//.test(url.pathname)) videoId = url.pathname.split("/")[2] || "";
      const playlistId = url.searchParams.get("list") || "";
      const safeVideo = /^[\w-]{6,}$/.test(videoId) ? videoId : "";
      const safeList = /^[\w-]{6,}$/.test(playlistId) ? playlistId : "";
      const params = new URLSearchParams({ autoplay: "1", playsinline: "1", rel: "0" });
      if (location.origin.startsWith("http")) params.set("origin", location.origin);
      if (safeVideo) {
        params.set("loop", "1");
        params.set("playlist", safeVideo);
        if (safeList) params.set("list", safeList);
        return `https://www.youtube.com/embed/${safeVideo}?${params}`;
      }
      if (safeList) {
        params.set("listType", "playlist");
        params.set("list", safeList);
        return `https://www.youtube.com/embed/videoseries?${params}`;
      }
    } catch { return ""; }
    return "";
  }

  function renderYoutubePlayer() {
    const embedUrl = state.isFocusing ? youtubeEmbedUrl(state.youtubeUrl) : "";
    els.youtubeEmpty.classList.toggle("hidden", Boolean(embedUrl));
    if (els.youtubePlayer.dataset.source !== embedUrl) {
      els.youtubePlayer.dataset.source = embedUrl;
      els.youtubePlayer.src = embedUrl || "about:blank";
    }
  }

  function notify(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2400);
  }

  function render() {
    document.body.classList.toggle("focus-mode", state.isFocusing);
    els.currentTask.value = state.currentTask;
    els.youtubeUrl.value = state.youtubeUrl || "";
    els.currentTask.readOnly = state.isFocusing;
    els.focusTimer.classList.toggle("hidden", !state.isFocusing);
    els.heroHeadline.classList.toggle("hidden", state.isFocusing);
    els.focusTimerTask.textContent = state.currentTask || "未命名任務";
    els.focusSetup.classList.toggle("hidden", state.isFocusing);
    els.focusMedia.classList.toggle("hidden", !state.isFocusing);
    els.finishTask.closest(".current-task-card").classList.toggle("is-focusing", state.isFocusing);
    renderFocusTimer();
    renderYoutubePlayer();
    els.inboxCount.textContent = `${state.inbox.length} 個待檢視`;
    els.poolCount.textContent = state.pool.length;
    els.todoCount.textContent = state.todos.length;
    renderFocusLedger();
    els.taskHint.textContent = state.isFocusing
      ? `專注進行中${state.focusStartedAt ? ` · ${formatDate(state.focusStartedAt)} 開始` : ""}。做完以前，靈感只放進暫存區。`
      : state.currentTask
        ? "準備好後按「開始專注」，任務會鎖定直到你完成。"
        : "輸入任務並開始專注；等真的做完後，再按一次按鈕。";
    renderPool();
    renderTodos();
  }

  function renderPool() {
    if (!state.pool.length) {
      els.poolList.innerHTML = '<div class="empty-state">還沒有冷卻中的點子。<br>真正有吸引力的，晚點會來到這裡。</div>';
      return;
    }
    els.poolList.innerHTML = state.pool
      .slice().sort((a, b) => a.cooledAt - b.cooledAt)
      .map((idea) => {
        const ready = Date.now() - idea.cooledAt >= COOLING_MS;
        return `<div class="idea-item">
          <p class="idea-text">${escapeHtml(idea.text)}</p>
          <div class="idea-meta"><span>${formatDate(idea.cooledAt)} 放入</span><span class="timer ${ready ? "ready" : ""}">${remainingText(idea.cooledAt)}</span></div>
          <div class="item-actions">
            <button class="mini-button primary" data-action="promote" data-id="${idea.id}" ${ready ? "" : "disabled"}>${ready ? "變成待辦 →" : "冷卻中"}</button>
            <button class="mini-button" data-action="delete-pool" data-id="${idea.id}">沒興趣了</button>
          </div>
        </div>`;
      }).join("");
  }

  function renderTodos() {
    if (!state.todos.length) {
      els.todoList.innerHTML = '<div class="empty-state">24 小時後仍想做的事，<br>才會出現在這裡。</div>';
      return;
    }
    els.todoList.innerHTML = state.todos
      .slice().sort((a, b) => Number(a.done) - Number(b.done) || b.promotedAt - a.promotedAt)
      .map((todo) => `<div class="idea-item todo-item ${todo.done ? "done" : ""}">
        <p class="idea-text">${escapeHtml(todo.text)}</p>
        <div class="idea-meta"><span>${todo.done ? "已完成" : `${formatDate(todo.promotedAt)} 加入待辦`}</span></div>
        <div class="item-actions">
          <button class="mini-button ${todo.done ? "" : "primary"}" data-action="toggle-todo" data-id="${todo.id}">${todo.done ? "恢復" : "完成"}</button>
          <button class="mini-button" data-action="delete-todo" data-id="${todo.id}">刪除</button>
        </div>
      </div>`).join("");
  }

  function switchView(view) {
    const showTasks = view === "tasks";
    els.ideaView.classList.toggle("hidden", showTasks);
    els.tasksView.classList.toggle("hidden", !showTasks);
    els.viewButtons.forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    if (showTasks) {
      renderTasks();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function taskStats(items) {
    return { completed: items.filter((task) => Number(task.current) >= Number(task.target)).length, total: items.length };
  }

  function renderTasks() {
    const active = recurringState.active;
    const displayItems = editingTasks ? taskDraft[active] : recurringState.items[active];
    const periodCopy = {
      daily: ["● DAILY MISSIONS", "今天要完成的事", "每日任務會在明天自動重置。"],
      weekly: ["● WEEKLY MISSIONS", "這週要完成的事", "每週任務會在下週一自動重置。"],
      monthly: ["● MONTHLY MISSIONS", "這個月要完成的事", "每月任務會在下個月一日自動重置。"]
    };
    const [label, title, hint] = periodCopy[active];
    els.taskPeriodLabel.textContent = label;
    els.taskBoardTitle.textContent = title;
    els.periodResetHint.textContent = hint;
    els.taskTabs.querySelectorAll("[data-period]").forEach((button) => button.classList.toggle("active", button.dataset.period === active));

    for (const period of ["daily", "weekly", "monthly"]) {
      const stats = taskStats(editingTasks ? taskDraft[period] : recurringState.items[period]);
      els[`${period}TabCount`].textContent = `${stats.completed}/${stats.total}`;
    }

    const stats = taskStats(displayItems);
    const ratio = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;
    els.overallProgressText.textContent = `${stats.completed} / ${stats.total} 完成`;
    els.overallProgressBar.style.width = `${ratio}%`;
    els.taskBoard.classList.toggle("edit-mode", editingTasks);
    els.taskBoard.classList.toggle("all-complete", !editingTasks && stats.total > 0 && stats.completed === stats.total);
    els.addMission.classList.toggle("hidden", !editingTasks);
    els.cancelTaskEdit.classList.toggle("hidden", !editingTasks);
    els.editTasks.textContent = editingTasks ? "儲存任務" : "編輯任務";

    if (!displayItems.length && !editingTasks) {
      els.missionList.innerHTML = '<div class="mission-empty">這個週期還沒有例行任務。<br>按上方「加入例行任務」開始建立。</div>';
      return;
    }

    els.missionList.innerHTML = displayItems.map((task, index) => {
      const current = Math.max(0, Number(task.current) || 0);
      const target = Math.max(1, Number(task.target) || 1);
      if (editingTasks) {
        return `<div class="mission-row editing" data-id="${task.id}">
          <div class="mission-index">${String(index + 1).padStart(2, "0")}</div>
          <input class="mission-edit-name" data-field="title" maxlength="80" value="${escapeHtml(task.title || "")}" placeholder="輸入任務名稱">
          <label class="mission-edit-goal">目標次數 <input data-field="target" type="number" min="1" max="999" value="${target}"></label>
          <button class="delete-mission" type="button" data-task-action="delete" title="刪除任務">×</button>
        </div>`;
      }
      const complete = current >= target;
      const percent = Math.min(100, Math.round((current / target) * 100));
      return `<div class="mission-row ${complete ? "complete" : ""}" data-id="${task.id}">
        <div class="mission-index">${complete ? "✓" : String(index + 1).padStart(2, "0")}</div>
        <div class="mission-copy"><small>${active.toUpperCase()} REQUIREMENT</small><p>${escapeHtml(task.title)}</p></div>
        <div class="mission-progress">
          <button class="progress-button" type="button" data-task-action="decrease" ${current <= 0 ? "disabled" : ""} aria-label="減少進度">−</button>
          <div class="progress-readout"><strong>${current} / ${target}</strong><div class="progress-track"><i style="width:${percent}%"></i></div></div>
          <button class="progress-button" type="button" data-task-action="increase" ${current >= target ? "disabled" : ""} aria-label="增加進度">＋</button>
        </div>
      </div>`;
    }).join("");
  }

  function beginTaskEdit() {
    editingTasks = true;
    taskDraft = structuredClone(recurringState.items);
    renderTasks();
  }

  function saveTaskEdit() {
    for (const period of ["daily", "weekly", "monthly"]) {
      taskDraft[period] = taskDraft[period]
        .map((task) => ({ ...task, title: String(task.title || "").trim(), target: Math.max(1, Math.min(999, Number(task.target) || 1)), current: Math.max(0, Number(task.current) || 0) }))
        .filter((task) => task.title);
    }
    recurringState.items = taskDraft;
    editingTasks = false;
    taskDraft = null;
    saveRecurringTasks();
    notify("任務清單已儲存。");
  }

  function cancelTaskEdit() {
    editingTasks = false;
    taskDraft = null;
    renderTasks();
  }

  function appendRecurringTask() {
    if (!editingTasks) beginTaskEdit();
    const period = recurringState.active;
    taskDraft[period].push({ id: id(), title: "", target: 1, current: 0 });
    renderTasks();
    const inputs = els.missionList.querySelectorAll('[data-field="title"]');
    inputs[inputs.length - 1]?.focus();
  }

  function handleTaskButton() {
    if (!state.currentTask.trim()) {
      notify("先寫下現在唯一要做的事。");
      els.currentTask.focus();
      return;
    }
    if (!state.isFocusing) {
      state.isFocusing = true;
      state.focusStartedAt = Date.now();
      saveState();
      notify("已開始專注。現在只做這一件事。");
      els.ideaInput.focus();
      return;
    }
    completeFocusSession();
    if (!state.inbox.length) {
      notify("任務完成。這次沒有需要檢視的靈感。");
      return;
    }
    reviewQueue = state.inbox.slice();
    els.reviewSection.classList.remove("hidden");
    renderReview();
    els.reviewSection.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function renderReview() {
    if (!reviewQueue.length) {
      state.currentTask = "";
      state.isFocusing = false;
      state.focusStartedAt = null;
      saveState();
      els.reviewSection.classList.add("hidden");
      notify("檢視完成。現在可以開始下一件事。");
      return;
    }
    const idea = reviewQueue[0];
    const total = reviewQueue.length;
    els.reviewProgress.textContent = `剩 ${total} 個`;
    els.reviewCard.innerHTML = `
      <p class="review-idea">${escapeHtml(idea.text)}</p>
      <p class="review-meta">${formatDate(idea.createdAt)} 記下 · 當時正在做「${escapeHtml(idea.task || "未命名任務")}」</p>
      <p class="review-question">現在還真的有興趣嗎？</p>
      <div class="review-actions">
        <button class="button button-danger" data-review="discard">🔴 沒興趣，刪除</button>
        <button class="button button-blue" data-review="keep">🔵 還有興趣，放進 Idea Pool</button>
        <button class="button button-ghost" data-review="later">稍後再看</button>
      </div>`;
  }

  function resolveReview(action) {
    const idea = reviewQueue[0];
    if (!idea) return;
    if (action === "later") {
      reviewQueue.push(reviewQueue.shift());
      renderReview();
      return;
    }
    state.inbox = state.inbox.filter((item) => item.id !== idea.id);
    if (action === "keep") state.pool.push({ ...idea, cooledAt: Date.now() });
    reviewQueue.shift();
    saveState();
    renderReview();
  }

  els.currentTask.addEventListener("input", () => {
    state.currentTask = els.currentTask.value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    markDataChanged();
  });

  els.youtubeUrl.addEventListener("input", () => {
    state.youtubeUrl = els.youtubeUrl.value.trim();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    markDataChanged();
  });

  els.finishTask.addEventListener("click", handleTaskButton);
  els.finishFocusedTask.addEventListener("click", handleTaskButton);
  els.captureForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = els.ideaInput.value.trim();
    if (!text) return;
    state.inbox.push({ id: id(), text, task: state.currentTask.trim(), createdAt: Date.now() });
    els.ideaInput.value = "";
    saveState();
    notify("已暫存。回到眼前的任務吧。");
    els.ideaInput.focus();
  });
  els.ideaInput.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key === "Enter") els.captureForm.requestSubmit();
  });
  els.reviewCard.addEventListener("click", (event) => {
    const action = event.target.closest("[data-review]")?.dataset.review;
    if (action) resolveReview(action);
  });

  els.poolList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const index = state.pool.findIndex((idea) => idea.id === button.dataset.id);
    if (index < 0) return;
    if (button.dataset.action === "promote") {
      const idea = state.pool[index];
      if (Date.now() - idea.cooledAt < COOLING_MS) return;
      state.todos.push({ id: id(), text: idea.text, promotedAt: Date.now(), done: false });
      state.pool.splice(index, 1);
      notify("這個點子通過了 24 小時冷卻，已成為待辦。");
    } else if (button.dataset.action === "delete-pool") {
      state.pool.splice(index, 1);
      notify("已放下這個點子。");
    }
    saveState();
  });

  els.todoList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const index = state.todos.findIndex((todo) => todo.id === button.dataset.id);
    if (index < 0) return;
    if (button.dataset.action === "toggle-todo") state.todos[index].done = !state.todos[index].done;
    if (button.dataset.action === "delete-todo") state.todos.splice(index, 1);
    saveState();
  });
  els.togglePool.addEventListener("click", () => toggleColumn("pool"));
  els.toggleTodo.addEventListener("click", () => toggleColumn("todo"));

  els.viewButtons.forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  els.taskTabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-period]");
    if (!tab) return;
    recurringState.active = tab.dataset.period;
    if (!editingTasks) {
      localStorage.setItem(TASKS_KEY, JSON.stringify(recurringState));
      markDataChanged();
    }
    renderTasks();
  });

  els.editTasks.addEventListener("click", () => editingTasks ? saveTaskEdit() : beginTaskEdit());
  els.addRecurringTask.addEventListener("click", appendRecurringTask);
  els.cancelTaskEdit.addEventListener("click", cancelTaskEdit);
  els.addMission.addEventListener("click", appendRecurringTask);

  els.missionList.addEventListener("input", (event) => {
    if (!editingTasks || !event.target.dataset.field) return;
    const task = taskDraft[recurringState.active].find((item) => item.id === event.target.closest("[data-id]")?.dataset.id);
    if (!task) return;
    task[event.target.dataset.field] = event.target.dataset.field === "target" ? Number(event.target.value) : event.target.value;
  });

  els.missionList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-task-action]");
    if (!button) return;
    const taskId = button.closest("[data-id]")?.dataset.id;
    const period = recurringState.active;
    if (editingTasks && button.dataset.taskAction === "delete") {
      taskDraft[period] = taskDraft[period].filter((task) => task.id !== taskId);
      renderTasks();
      return;
    }
    const task = recurringState.items[period].find((item) => item.id === taskId);
    if (!task) return;
    const target = Math.max(1, Number(task.target) || 1);
    if (button.dataset.taskAction === "increase") task.current = Math.min(target, (Number(task.current) || 0) + 1);
    if (button.dataset.taskAction === "decrease") task.current = Math.max(0, (Number(task.current) || 0) - 1);
    saveRecurringTasks();
  });

  els.resetCurrentTasks.addEventListener("click", () => {
    const labels = { daily: "每日", weekly: "每週", monthly: "每月" };
    if (!confirm(`確定將所有${labels[recurringState.active]}任務的進度歸零嗎？`)) return;
    recurringState.items[recurringState.active].forEach((task) => { task.current = 0; });
    saveRecurringTasks();
    notify("目前分頁的任務進度已重置。");
  });

  els.exportData.addEventListener("click", () => {
    const backup = { version: 3, ideaCooling: state, recurringTasks: recurringState, ui: { collapsed }, modifiedAt: localModifiedAt };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `靈感冷卻備份-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });

  els.importData.addEventListener("change", async () => {
    const file = els.importData.files[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      const ideaData = imported.ideaCooling || imported;
      if (!Array.isArray(ideaData.inbox) || !Array.isArray(ideaData.pool) || !Array.isArray(ideaData.todos)) throw new Error();
      state = { ...defaultState(), ...ideaData };
      if (imported.recurringTasks?.items) {
        recurringState = imported.recurringTasks;
        resetExpiredPeriods();
        saveRecurringTasks();
      }
      if (imported.ui?.collapsed) {
        collapsed = { pool: false, todo: false, ...imported.ui.collapsed };
        localStorage.setItem(UI_KEY, JSON.stringify(collapsed));
        renderCollapsed();
      }
      saveState();
      notify("備份已匯入。");
    } catch { notify("這不是有效的靈感冷卻備份。"); }
    els.importData.value = "";
  });

  els.resetData.addEventListener("click", () => {
    if (!confirm("確定清除所有靈感、待辦與每日／每週／每月任務嗎？這個動作無法復原。")) return;
    state = defaultState();
    recurringState = defaultRecurringTasks();
    resetExpiredPeriods();
    saveRecurringTasks();
    reviewQueue = [];
    els.reviewSection.classList.add("hidden");
    saveState();
    notify("所有資料已清除。");
  });

  function getCloudSnapshot() {
    return {
      version: 3,
      ideaCooling: structuredClone(state),
      recurringTasks: structuredClone(recurringState),
      ui: { collapsed: structuredClone(collapsed) },
      clientModifiedAt: localModifiedAt
    };
  }

  function applyCloudSnapshot(payload) {
    if (!payload?.ideaCooling || !Array.isArray(payload.ideaCooling.inbox) || !Array.isArray(payload.ideaCooling.pool) || !Array.isArray(payload.ideaCooling.todos)) return false;
    state = { ...defaultState(), ...payload.ideaCooling };

    if (payload.recurringTasks?.items) {
      const next = defaultRecurringTasks();
      next.active = ["daily", "weekly", "monthly"].includes(payload.recurringTasks.active) ? payload.recurringTasks.active : "daily";
      next.periodMarkers = payload.recurringTasks.periodMarkers || {};
      for (const period of ["daily", "weekly", "monthly"]) {
        next.items[period] = Array.isArray(payload.recurringTasks.items[period]) ? payload.recurringTasks.items[period] : [];
      }
      recurringState = next;
    }
    if (payload.ui?.collapsed) collapsed = { pool: false, todo: false, ...payload.ui.collapsed };

    localModifiedAt = Number(payload.clientModifiedAt) || Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(TASKS_KEY, JSON.stringify(recurringState));
    localStorage.setItem(UI_KEY, JSON.stringify(collapsed));
    localStorage.setItem(DATA_META_KEY, String(localModifiedAt));
    editingTasks = false;
    taskDraft = null;
    reviewQueue = [];
    els.reviewSection.classList.add("hidden");
    render();
    renderCollapsed();
    renderTasks();
    return true;
  }

  window.IdeaCoolingCloudBridge = { getSnapshot: getCloudSnapshot, applySnapshot: applyCloudSnapshot, notify };
  window.dispatchEvent(new CustomEvent("idea-cooling:bridge-ready"));

  function openAuthModal() {
    els.authModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    if (location.protocol === "file:") {
      els.firebaseSetupNotice.classList.remove("hidden");
      els.firebaseSetupNotice.innerHTML = '目前是直接開檔模式，瀏覽器不允許 Firebase 登入。<button id="openLoginVersion" class="setup-action" type="button">開啟可登入版本 →</button><small>若無法開啟，請先雙擊「啟動靈感冷卻.bat」。</small>';
      els.authForm.classList.add("hidden");
      $("#authModeTabs")?.classList.add("hidden");
      $("#openLoginVersion").addEventListener("click", () => { location.href = "http://localhost:8765/"; });
    }
  }

  function closeAuthModal() {
    els.authModal.classList.add("hidden");
    document.body.style.overflow = "";
    els.authError.textContent = "";
  }

  els.authButton.addEventListener("click", openAuthModal);
  els.closeAuthModal.addEventListener("click", closeAuthModal);
  els.authModal.addEventListener("click", (event) => { if (event.target === els.authModal) closeAuthModal(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !els.authModal.classList.contains("hidden")) closeAuthModal(); });
  window.IdeaCoolingAuthUI = { close: closeAuthModal };

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    els.installPwa.classList.remove("hidden");
  });

  els.installPwa.addEventListener("click", async () => {
    if (!installPrompt) {
      notify("請使用瀏覽器選單中的「安裝靈感冷卻」。");
      return;
    }
    await installPrompt.prompt();
    installPrompt = null;
    els.installPwa.classList.add("hidden");
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    els.installPwa.classList.add("hidden");
    notify("靈感冷卻已安裝完成。");
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {
        notify("離線功能暫時無法啟用，重新整理後會再次嘗試。");
      });
    });
  }

  render();
  renderCollapsed();
  resetExpiredPeriods();
  renderTasks();
  setInterval(renderPool, 60000);
  setInterval(renderFocusLedger, 60000);
  setInterval(renderFocusTimer, 1000);
})();
