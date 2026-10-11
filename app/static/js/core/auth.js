const TOKEN_KEY = "token";

// Lấy token xác thực từ localStorage
export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

// Lưu token xác thực vào localStorage
export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    clearToken();
  }
}

// Xóa token xác thực
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// Đăng xuất khỏi hệ thống và chuyển về trang /login
export function logout() {
  clearToken();
  window.location.href = "/login";
}

// Lấy thông tin tài khoản hiện tại từ server (/auth/me)
export async function getCurrentUser() {
  const token = getToken();
  if (!token) return null;

  const res = await fetch("/auth/me", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    clearToken();
    return null;
  }

  return await res.json();
}

/**
 * Bảo vệ trang yêu cầu đăng nhập (dùng cho trang chat /):
 * Nếu chưa đăng nhập hoặc token hết hạn thì chuyển về /login.
 */
export async function requireAuth() {
  const token = getToken();
  if (!token) {
    window.location.href = "/login";
    return null;
  }

  const user = await getCurrentUser();
  if (!user) {
    window.location.href = "/login";
    return null;
  }

  return user;
}

/**
 * Bảo vệ trang quản trị (dùng cho /admin):
 * Nếu chưa đăng nhập -> chuyển về /login.
 * Nếu không phải admin -> chuyển về /.
 */
export async function requireAdmin() {
  const user = await requireAuth();
  if (!user) return null;

  if (user.role !== "admin") {
    window.location.href = "/";
    return null;
  }

  return user;
}

/**
 * Bảo vệ trang đăng nhập (/login):
 * Nếu đã có phiên đăng nhập hợp lệ -> chuyển về /.
 */
export async function redirectIfLoggedIn() {
  const token = getToken();
  if (!token) return;

  const user = await getCurrentUser();
  if (user) {
    window.location.href = "/";
  }
}
