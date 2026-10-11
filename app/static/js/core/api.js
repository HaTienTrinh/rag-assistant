import { getToken, logout } from "./auth.js";

/**
 * Gọi API backend với token xác thực tự động
 * @param {string} path - Đường dẫn API (ví dụ: '/conversations')
 * @param {RequestInit} options - Tùy chọn fetch
 */
export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => null);

  // Nếu 401 thì hết hạn phiên đăng nhập -> đăng xuất
  if (res.status === 401 && path !== "/auth/login") {
    logout();
    const msg = data && typeof data.detail === "string" ? data.detail : "Phiên đăng nhập đã hết hạn";
    throw new Error(msg);
  }

  if (!res.ok) {
    let detail = "Yêu cầu không hợp lệ";
    if (data && typeof data.detail === "string") {
      detail = data.detail;
    } else if (data && Array.isArray(data.detail)) {
      detail = data.detail.map((d) => d.msg || JSON.stringify(d)).join("; ");
    }
    throw new Error(detail);
  }

  return data;
}

// Tiện ích gửi POST JSON
export function postJSON(path, body) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Tiện ích gửi request JSON với method tùy chọn (PATCH, PUT...)
export function sendJSON(method, path, body) {
  return api(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
