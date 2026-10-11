const $ = (sel) => document.querySelector(sel);

let token = localStorage.getItem("token");
let me = null;
let activeConv = null;
let docTimer = null;

/* ---------- API ---------- */
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => null);
  if (res.status === 401 && path !== "/auth/login") {
    logout();
    throw new Error("Phiên đăng nhập đã hết hạn");
  }
  if (!res.ok) {
    const detail = data && typeof data.detail === "string" ? data.detail : "Yêu cầu không hợp lệ";
    throw new Error(detail);
  }
  return data;
}

function postJSON(path, body) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ---------- Đăng nhập / đăng xuất ---------- */
function show(view) {
  $("#login-view").hidden = view !== "login";
  $("#app-view").hidden = view !== "app";
}

function logout() {
  token = null;
  me = null;
  activeConv = null;
  localStorage.removeItem("token");
  clearTimeout(docTimer);
  show("login");
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-error").textContent = "";
  try {
    const data = await api("/auth/login", {
      method: "POST",
      body: new URLSearchParams({
        username: $("#email").value.trim(),
        password: $("#password").value,
      }),
    });
    token = data.access_token;
    localStorage.setItem("token", token);
    $("#password").value = "";
    await init();
  } catch (err) {
    $("#login-error").textContent = err.message;
  }
});

$("#logout-btn").addEventListener("click", logout);

async function init() {
  if (!token) return show("login");
  try {
    me = await api("/auth/me");
  } catch {
    return;
  }
  $("#user-email").textContent = me.email;
  $("#chat-btn").hidden = me.role !== "admin";
  $("#docs-btn").hidden = me.role !== "admin";
  show("app");
  await openNewChat();
}

/* ---------- Chuyển màn hình ---------- */
function showChatView() {
  clearTimeout(docTimer);
  $("#chat-view").hidden = false;
  $("#docs-view").hidden = true;
}

function showDocsView() {
  $("#chat-view").hidden = true;
  $("#docs-view").hidden = false;
  loadDocs();
}

$("#chat-btn").addEventListener("click", showChatView);
$("#docs-btn").addEventListener("click", showDocsView);

/* ---------- Hiển thị tin nhắn ---------- */
function bubble(role, content, sources) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  const text = document.createElement("div");
  text.className = "text";
  text.textContent = content;
  div.append(text);

  if (sources && sources.length) {
    const details = document.createElement("details");
    details.className = "sources";
    const summary = document.createElement("summary");
    summary.textContent = `Nguồn (${sources.length})`;
    details.append(summary);
    sources.forEach((s, i) => {
      const item = document.createElement("div");
      item.className = "source";
      const where = s.filename + (s.page ? `, trang ${s.page}` : "");
      const snippet = s.content.length > 220 ? s.content.slice(0, 220) + "…" : s.content;
      item.textContent = `[${i + 1}] ${where}: ${snippet}`;
      details.append(item);
    });
    div.append(details);
  }
  return div;
}

function scrollToBottom() {
  const box = $("#messages");
  box.scrollTop = box.scrollHeight;
}

function showWelcome() {
  const box = $("#messages");
  box.replaceChildren();
  const w = document.createElement("div");
  w.className = "welcome";
  w.textContent = "Hãy đặt câu hỏi về nội dung tài liệu.";
  box.append(w);
}

/* ---------- Hội thoại ---------- */
async function loadConversations() {
  const list = await api("/conversations");
  const ul = $("#conv-list");
  ul.replaceChildren();
  for (const c of list) {
    const li = document.createElement("li");
    if (c.id === activeConv) li.className = "active";

    const title = document.createElement("span");
    title.className = "conv-title";
    title.textContent = c.title;

    const del = document.createElement("button");
    del.textContent = "×";
    del.title = "Xóa hội thoại";
    del.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (!confirm("Xóa hội thoại này?")) return;
      await api(`/conversations/${c.id}`, { method: "DELETE" });
      if (activeConv === c.id) await openNewChat();
      else await loadConversations();
    });

    li.addEventListener("click", () => openConversation(c.id));
    li.append(title, del);
    ul.append(li);
  }
}

async function openNewChat() {
  activeConv = null;
  showChatView();
  showWelcome();
  await loadConversations();
  $("#question").focus();
}

async function openConversation(id) {
  activeConv = id;
  showChatView();
  const box = $("#messages");
  box.replaceChildren();
  try {
    const messages = await api(`/conversations/${id}/messages`);
    messages.forEach((m) => box.append(bubble(m.role, m.content, m.sources)));
    scrollToBottom();
  } catch (err) {
    box.append(errorBubble(err.message));
  }
  await loadConversations();
  $("#question").focus();
}

function errorBubble(message) {
  const el = bubble("assistant", message);
  el.classList.add("error");
  return el;
}

$("#new-chat").addEventListener("click", openNewChat);

/* ---------- Gửi câu hỏi ---------- */
async function send(text) {
  const box = $("#messages");
  const welcome = box.querySelector(".welcome");
  if (welcome) welcome.remove();

  $("#send-btn").disabled = true;
  box.append(bubble("user", text));
  const pending = bubble("assistant", "Đang trả lời…");
  box.append(pending);
  scrollToBottom();

  try {
    if (!activeConv) {
      const conv = await postJSON("/conversations", {});
      activeConv = conv.id;
    }
    const res = await postJSON(`/conversations/${activeConv}/ask`, { question: text });
    pending.replaceWith(bubble("assistant", res.message.content, res.message.sources));
    await loadConversations();
  } catch (err) {
    pending.replaceWith(errorBubble(err.message));
  } finally {
    $("#send-btn").disabled = false;
    scrollToBottom();
    $("#question").focus();
  }
}

$("#chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("#question");
  const text = input.value.trim();
  if (!text || $("#send-btn").disabled) return;
  input.value = "";
  send(text);
});

$("#question").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#chat-form").requestSubmit();
  }
});

/* ---------- Quản lý tài liệu (admin) ---------- */
const STATUS_LABEL = {
  pending: "Đang chờ",
  processing: "Đang xử lý",
  done: "Hoàn tất",
  failed: "Lỗi",
};

async function loadDocs() {
  clearTimeout(docTimer);
  const body = $("#docs-body");
  try {
    const docs = await api("/documents");
    body.replaceChildren();
    let busy = false;

    for (const d of docs) {
      if (d.status === "pending" || d.status === "processing") busy = true;
      const tr = document.createElement("tr");

      const name = document.createElement("td");
      name.textContent = d.filename;

      const status = document.createElement("td");
      status.textContent = STATUS_LABEL[d.status] || d.status;
      if (d.error) status.title = d.error;
      if (d.status === "failed" && d.error) status.textContent += `: ${d.error}`;

      const count = document.createElement("td");
      count.textContent = d.chunks ?? 0;

      const actions = document.createElement("td");
      const del = document.createElement("button");
      del.textContent = "Xóa";
      del.addEventListener("click", async () => {
        if (!confirm(`Xóa "${d.filename}"?`)) return;
        await api(`/documents/${d.id}`, { method: "DELETE" });
        loadDocs();
      });
      actions.append(del);

      tr.append(name, status, count, actions);
      body.append(tr);
    }
    if (busy && !$("#docs-view").hidden) docTimer = setTimeout(loadDocs, 3000);
  } catch (err) {
    $("#upload-msg").textContent = err.message;
  }
}

$("#upload-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = $("#file").files[0];
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  $("#upload-msg").textContent = "Đang tải lên…";
  try {
    await api("/documents", { method: "POST", body: form });
    $("#upload-msg").textContent = "Đã tải lên, đang xử lý nền.";
    $("#file").value = "";
    await loadDocs();
  } catch (err) {
    $("#upload-msg").textContent = err.message;
  }
});

init();