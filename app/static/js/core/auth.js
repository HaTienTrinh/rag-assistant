import { toast } from "../ui/toast.js";

// Xóa khóa token cũ khỏi localStorage nếu còn lưu từ Phase 1
try {
  localStorage.removeItem("token");
} catch (_) {}

let accessToken = null;
let tokenExpiresAt = null;
let refreshTimer = null;
let refreshPromise = null;

// Kênh BroadcastChannel đồng bộ đăng xuất và token mới giữa các tab
const authChannel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("rag_auth_channel") : null;
if (authChannel) {
  authChannel.onmessage = (event) => {
    if (event.data?.type === "logout") {
      clearSessionState();
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    } else if (event.data?.type === "token_refreshed") {
      setAccessToken(event.data.accessToken, event.data.expiresIn, false);
    }
  };
}

// Lấy access token hiện tại trong bộ nhớ
export function getAccessToken() {
  return accessToken;
}

// Lưu access token vào bộ nhớ và lên lịch refresh chủ động
export function setAccessToken(token, expiresIn, broadcast = true) {
  accessToken = token;
  if (expiresIn) {
    tokenExpiresAt = Date.now() + expiresIn * 1000;
    scheduleProactiveRefresh(expiresIn);
  } else {
    tokenExpiresAt = null;
    clearTimeout(refreshTimer);
  }

  if (broadcast && authChannel && token) {
    authChannel.postMessage({
      type: "token_refreshed",
      accessToken: token,
      expiresIn: expiresIn,
    });
  }
}

// Xóa trạng thái phiên trong bộ nhớ
export function clearSessionState() {
  accessToken = null;
  tokenExpiresAt = null;
  clearTimeout(refreshTimer);
  try {
    localStorage.removeItem("token");
  } catch (_) {}
}

// Lên lịch làm mới token chủ động trước khi hết hạn
function scheduleProactiveRefresh(expiresIn) {
  clearTimeout(refreshTimer);
  // Nếu expires_in <= 90s (chế độ test), refresh ở nửa thời gian; nếu bình thường (15 phút), refresh trước 60s
  const leadSeconds = expiresIn <= 90 ? Math.floor(expiresIn / 2) : 60;
  const delayMs = Math.max(3000, (expiresIn - leadSeconds) * 1000);

  refreshTimer = setTimeout(async () => {
    try {
      await refreshSession();
    } catch (err) {
      console.warn("Proactive refresh failed:", err);
      // Nếu lỗi mạng, thử lại sau 10 giây
      if (err.status !== 401) {
        refreshTimer = setTimeout(() => refreshSession().catch(() => {}), 10000);
      }
    }
  }, delayMs);
}

// Khi chuyển sang tab đang mở, kiểm tra xem token sắp hết hạn chưa
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && accessToken && tokenExpiresAt) {
      if (Date.now() >= tokenExpiresAt - 60000) {
        refreshSession().catch((err) => console.warn("Visibility refresh failed:", err));
      }
    }
  });
}

// Thực hiện gọi API /auth/refresh
async function executeRefreshCall() {
  // Nếu một tab khác vừa mới refresh thành công trong 20s qua và đã đồng bộ token
  if (tokenExpiresAt && (tokenExpiresAt - Date.now() > 20000) && accessToken) {
    return accessToken;
  }

  let res;
  try {
    res = await fetch("/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  } catch (netErr) {
    // Lỗi mạng: KHÔNG đăng xuất, hiển thị thông báo lỗi
    toast("Mất kết nối với máy chủ khi làm mới phiên", "error");
    throw netErr;
  }

  if (res.status === 401) {
    clearSessionState();
    if (authChannel) {
      authChannel.postMessage({ type: "logout" });
    }
    const err = new Error("Phiên đăng nhập đã hết hạn");
    err.status = 401;
    throw err;
  }

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    const err = new Error(errData.detail || "Không thể làm mới phiên đăng nhập");
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  setAccessToken(data.access_token, data.expires_in, true);
  return data.access_token;
}

// Làm mới phiên: dùng chung một Promise và khóa navigator.locks để tránh nhiều tab/request refresh song song
export async function refreshSession() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    if (typeof navigator !== "undefined" && navigator.locks) {
      return await navigator.locks.request("rag_refresh_lock", async () => {
        return await executeRefreshCall();
      });
    } else {
      return await executeRefreshCall();
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

// Đăng xuất khỏi hệ thống: gọi API /auth/logout, dọn bộ nhớ và chuyển về /login
export async function logout() {
  try {
    await fetch("/auth/logout", { method: "POST" });
  } catch (err) {
    console.warn("Logout request failed:", err);
  } finally {
    clearSessionState();
    if (authChannel) {
      authChannel.postMessage({ type: "logout" });
    }
    window.location.href = "/login";
  }
}

// Lấy thông tin tài khoản hiện tại từ server (/auth/me)
export async function getCurrentUser() {
  const token = getAccessToken();
  if (!token) return null;

  try {
    const res = await fetch("/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

// Bảo vệ trang yêu cầu đăng nhập (/): nếu chưa có token, khôi phục phiên qua refresh
export async function requireAuth() {
  if (!getAccessToken()) {
    try {
      await refreshSession();
    } catch (_) {
      window.location.href = "/login";
      return null;
    }
  }

  const user = await getCurrentUser();
  if (!user) {
    window.location.href = "/login";
    return null;
  }
  return user;
}

// Bảo vệ trang quản trị (/admin): yêu cầu quyền admin
export async function requireAdmin() {
  const user = await requireAuth();
  if (!user) return null;

  if (user.role !== "admin") {
    window.location.href = "/";
    return null;
  }
  return user;
}

// Bảo vệ trang đăng nhập (/login): nếu đã có phiên hợp lệ, chuyển về trang /
export async function redirectIfLoggedIn() {
  if (!getAccessToken()) {
    try {
      await refreshSession();
    } catch (_) {
      return;
    }
  }

  const user = await getCurrentUser();
  if (user) {
    window.location.href = "/";
  }
}

