import { getAccessToken, refreshSession, logout } from "./auth.js";
import { toast } from "../ui/toast.js";

/**
 * Gọi API backend với access token trong bộ nhớ, tự động refresh và gửi lại request nếu gặp 401
 */
export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getAccessToken();

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let res = await fetch(path, { ...options, headers });

  // Khi gặp 401 (trừ các endpoint đăng nhập/refresh): refresh đúng một lần rồi gửi lại request gốc đúng một lần
  if (res.status === 401 && path !== "/auth/login" && path !== "/auth/refresh") {
    try {
      const newToken = await refreshSession();
      const retryHeaders = { ...(options.headers || {}), Authorization: `Bearer ${newToken}` };
      res = await fetch(path, { ...options, headers: retryHeaders });
    } catch (refreshErr) {
      if (refreshErr.status === 401) {
        toast("Phiên đăng nhập đã hết hạn", "error");
        logout();
      }
      throw refreshErr;
    }

    // Nếu sau khi gửi lại vẫn nhận 401 -> đăng xuất
    if (res.status === 401) {
      toast("Phiên đăng nhập đã hết hạn", "error");
      logout();
      throw new Error("Phiên đăng nhập đã hết hạn");
    }
  }

  const data = await res.json().catch(() => null);

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

