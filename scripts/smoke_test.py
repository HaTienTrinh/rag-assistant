"""Script kiểm thử toàn diện các kịch bản của hệ thống (Smoke Test).

Sử dụng:
    python scripts/smoke_test.py
    python scripts/smoke_test.py --base-url http://127.0.0.1:8000 --admin-email admin@example.com --admin-password Admin12345
"""

import argparse
import os
import sys
import time
import uuid
from typing import Any

import httpx

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# Cho phép import config từ ứng dụng nếu có
try:
    from app.config import settings
    DEFAULT_ADMIN_EMAIL = getattr(settings, "admin_email", "") or "admin@example.com"
    DEFAULT_ADMIN_PASSWORD = getattr(settings, "admin_password", "") or "Admin12345"
except Exception:
    DEFAULT_ADMIN_EMAIL = "admin@example.com"
    DEFAULT_ADMIN_PASSWORD = "Admin12345"



class TestResult:
    def __init__(self):
        self.results: list[dict[str, Any]] = []

    def record(self, scenario: str, test_case: str, passed: bool, detail: str = ""):
        self.results.append({
            "scenario": scenario,
            "test_case": test_case,
            "passed": passed,
            "detail": detail
        })
        status_str = "[ĐẠT]" if passed else "[KHÔNG ĐẠT]"
        print(f"  {status_str} {test_case} {f'({detail})' if detail else ''}")

    def print_summary(self):
        print("\n" + "=" * 80)
        print("BẢNG TỔNG KẾT KẾT QUẢ KIỂM THỬ (SMOKE TEST)")
        print("=" * 80)
        print(f"{'Kịch bản':<35} | {'Trường hợp kiểm thử':<30} | {'Kết quả':<10}")
        print("-" * 80)
        passed_count = 0
        total_count = len(self.results)
        for r in self.results:
            status = "ĐẠT" if r["passed"] else "KHÔNG ĐẠT"
            if r["passed"]:
                passed_count += 1
            print(f"{r['scenario'][:34]:<35} | {r['test_case'][:29]:<30} | {status:<10}")
        print("-" * 80)
        print(f"Tổng kết: {passed_count}/{total_count} bài kiểm thử thành công.")
        print("=" * 80 + "\n")
        return passed_count == total_count


def auth_login(client: httpx.Client, email: str, password: str) -> httpx.Response:
    """Đăng nhập và tự động gắn access_token vào Authorization header."""
    resp = client.post("/auth/login", data={"username": email, "password": password})
    if resp.status_code == 200:
        token = resp.json().get("access_token")
        if token:
            client.headers["Authorization"] = f"Bearer {token}"
    return resp


def auth_refresh(client: httpx.Client) -> httpx.Response:
    """Refresh token và tự động cập nhật Authorization header."""
    resp = client.post("/auth/refresh")
    if resp.status_code == 200:
        token = resp.json().get("access_token")
        if token:
            client.headers["Authorization"] = f"Bearer {token}"
    return resp


def create_user_via_admin(client: httpx.Client, base_url: str, email: str, password: str, role: str = "user") -> int:
    """Tạo người dùng thông qua API quản trị."""
    resp = client.post(
        f"{base_url}/admin/users",
        json={"email": email, "password": password, "role": role, "daily_limit": None}
    )
    if resp.status_code != 201:
        raise RuntimeError(f"Không thể tạo user thử nghiệm: {resp.status_code} {resp.text}")
    return resp.json()["id"]


def purge_user_via_admin(client: httpx.Client, base_url: str, user_id: int):
    """Xóa hoàn toàn người dùng (chuyển thùng rác rồi xóa vĩnh viễn)."""
    # 1. Chuyển vào thùng rác nếu chưa
    client.delete(f"{base_url}/admin/users/{user_id}")
    # 2. Xóa vĩnh viễn
    client.delete(f"{base_url}/admin/users/{user_id}/permanent")


def run_smoke_tests(base_url: str, admin_email: str, admin_password: str) -> bool:
    tr = TestResult()
    print(f"\nBắt đầu chạy Smoke Test trên {base_url}...")
    print(f"Tài khoản Admin: {admin_email}\n")

    admin_client = httpx.Client(base_url=base_url, timeout=15.0)
    users_to_cleanup: list[int] = []

    try:
        # ==========================================
        # 0. ĐĂNG NHẬP TÀI KHOẢN ADMIN
        # ==========================================
        print(">> Kiểm tra đăng nhập Admin...")
        login_resp = auth_login(admin_client, admin_email, admin_password)
        if login_resp.status_code != 200:
            print(f"LỖI: Không thể đăng nhập tài khoản admin ({login_resp.status_code}): {login_resp.text}")
            return False
        tr.record("Xác thực Admin", "Đăng nhập admin thành công", True)

        # ==========================================
        # KỊCH BẢN 1: ĐĂNG NHẬP, REFRESH XOAY VÒNG, REPLAY ATTACK, ĐĂNG XUẤT
        # ==========================================
        print("\n>> Kịch bản 1: Đăng nhập, refresh xoay vòng, từ chối token cũ, đăng xuất...")
        test_email = f"smoke_user_{uuid.uuid4().hex[:8]}@example.com"
        test_password = "UserPass12345@"
        user_id = create_user_via_admin(admin_client, base_url, test_email, test_password)
        users_to_cleanup.append(user_id)

        user_client = httpx.Client(base_url=base_url, timeout=15.0)
        # 1.1 Đăng nhập
        u_login = auth_login(user_client, test_email, test_password)
        tr.record("Kịch bản 1 (Auth)", "User đăng nhập thành công", u_login.status_code == 200)

        old_refresh_token = user_client.cookies.get("refresh_token")

        # 1.2 Refresh xoay vòng lần 1
        u_refresh1 = auth_refresh(user_client)
        new_refresh_token = user_client.cookies.get("refresh_token")
        rotated = (u_refresh1.status_code == 200) and (new_refresh_token != old_refresh_token)
        tr.record("Kịch bản 1 (Auth)", "Refresh xoay vòng cấp token mới", rotated)

        # 1.3 Dùng lại refresh token cũ sau khi bị thay thế và sau thời gian ân hạn
        attacker_client = httpx.Client(base_url=base_url, timeout=15.0)
        attacker_client.cookies.set("refresh_token", old_refresh_token)
        # Thử refresh lần 2 từ user hợp lệ để token cũ hoàn toàn bị coi là cũ/thay thế
        auth_refresh(user_client)
        
        # Chờ 11s để vượt qua REFRESH_REUSE_GRACE_SECONDS (10s) và kích hoạt cơ chế phát hiện tái sử dụng
        print("  (Chờ 11s để hết thời gian ân hạn và kích hoạt cơ chế phát hiện tái sử dụng token...)")
        time.sleep(11.0)
        attack_resp = attacker_client.post("/auth/refresh")
        old_token_rejected = (attack_resp.status_code in (401, 403))
        tr.record("Kịch bản 1 (Auth)", "Dùng lại refresh token cũ bị từ chối/thu hồi", old_token_rejected)

        # 1.4 Đăng xuất làm refresh thất bại
        u_logout = user_client.post("/auth/logout")
        tr.record("Kịch bản 1 (Auth)", "Đăng xuất thành công", u_logout.status_code == 200)

        # Thử refresh sau khi đăng xuất
        u_refresh_after_logout = user_client.post("/auth/refresh")
        tr.record("Kịch bản 1 (Auth)", "Refresh thất bại sau khi đã đăng xuất", u_refresh_after_logout.status_code in (401, 403))

        # ==========================================
        # KỊCH BẢN 2: ĐỔI MẬT KHẨU, THU HỒI PHIÊN KHÁC
        # ==========================================
        print("\n>> Kịch bản 2: Đổi mật khẩu, thu hồi phiên khác, kiểm tra mật khẩu cũ...")
        new_password = "NewSecretPass6789@"
        
        # Mở phiên A (Client A)
        session_a = httpx.Client(base_url=base_url, timeout=15.0)
        auth_login(session_a, test_email, test_password)

        # Mở phiên B (Client B)
        session_b = httpx.Client(base_url=base_url, timeout=15.0)
        auth_login(session_b, test_email, test_password)

        # Phiên A đổi mật khẩu
        chg_resp = session_a.post(
            "/auth/change-password",
            json={"current_password": test_password, "new_password": new_password}
        )
        tr.record("Kịch bản 2 (Password)", "Đổi mật khẩu thành công", chg_resp.status_code == 200)

        # Phiên A nhận access_token mới trả về từ change-password và cập nhật header
        if chg_resp.status_code == 200 and chg_resp.json().get("access_token"):
            session_a.headers["Authorization"] = f"Bearer {chg_resp.json()['access_token']}"

        # Phiên A vẫn truy cập được
        me_a = session_a.get("/auth/me")
        tr.record("Kịch bản 2 (Password)", "Phiên hiện tại (A) giữ nguyên hoạt động", me_a.status_code == 200)

        # Phiên B bị thu hồi (refresh thất bại)
        refresh_b = session_b.post("/auth/refresh")
        tr.record("Kịch bản 2 (Password)", "Phiên khác (B) bị thu hồi khi refresh", refresh_b.status_code in (401, 403))

        # Đăng nhập lại với mật khẩu cũ phải thất bại
        old_login = httpx.post(f"{base_url}/auth/login", data={"username": test_email, "password": test_password})
        tr.record("Kịch bản 2 (Password)", "Mật khẩu cũ không đăng nhập được", old_login.status_code == 401)

        # Đăng nhập với mật khẩu mới phải thành công
        new_login = httpx.post(f"{base_url}/auth/login", data={"username": test_email, "password": new_password})
        tr.record("Kịch bản 2 (Password)", "Mật khẩu mới đăng nhập thành công", new_login.status_code == 200)


        # ==========================================
        # KỊCH BẢN 3: QUẢN TRỊ USER, KHÓA/MỞ, THÙNG RÁC, CHẶN ADMIN CUỐI
        # ==========================================
        print("\n>> Kịch bản 3: Khóa, mở khóa, thùng rác, khôi phục, xóa vĩnh viễn, trùng email, chặn admin cuối...")
        # 3.1 Khóa tài khoản
        lock_resp = admin_client.patch(f"/admin/users/{user_id}", json={"is_active": False})
        tr.record("Kịch bản 3 (User)", "Khóa tài khoản thành công", lock_resp.status_code == 200 and lock_resp.json()["is_active"] is False)

        # Tài khoản bị khóa không đăng nhập được
        locked_login = httpx.post(f"{base_url}/auth/login", data={"username": test_email, "password": new_password})
        tr.record("Kịch bản 3 (User)", "Tài khoản bị khóa bị từ chối đăng nhập", locked_login.status_code in (401, 403))

        # 3.2 Mở khóa tài khoản
        unlock_resp = admin_client.patch(f"/admin/users/{user_id}", json={"is_active": True})
        tr.record("Kịch bản 3 (User)", "Mở khóa tài khoản thành công", unlock_resp.status_code == 200 and unlock_resp.json()["is_active"] is True)

        # 3.3 Chuyển vào thùng rác
        trash_resp = admin_client.delete(f"/admin/users/{user_id}")
        tr.record("Kịch bản 3 (User)", "Chuyển tài khoản vào thùng rác", trash_resp.status_code == 200)

        # 3.4 Trùng email trong thùng rác -> 409
        dup_resp = admin_client.post(
            "/admin/users",
            json={"email": test_email, "password": "SamplePassword123@", "role": "user"}
        )
        tr.record("Kịch bản 3 (User)", "Trùng email tài khoản trong thùng rác trả về 409", dup_resp.status_code == 409)

        # 3.5 Khôi phục tài khoản từ thùng rác
        restore_resp = admin_client.post(f"/admin/users/{user_id}/restore")
        tr.record("Kịch bản 3 (User)", "Khôi phục tài khoản từ thùng rác", restore_resp.status_code == 200)

        # 3.6 Chặn tự khóa hoặc xóa admin cuối cùng
        me_admin = admin_client.get("/auth/me").json()
        admin_id = me_admin["id"]

        # Thử tự khóa chính admin
        self_lock = admin_client.patch(f"/admin/users/{admin_id}", json={"is_active": False})
        tr.record("Kịch bản 3 (User)", "Chặn tự khóa tài khoản của chính admin", self_lock.status_code in (400, 409))

        # Thử chuyển chính admin vào thùng rác
        self_trash = admin_client.delete(f"/admin/users/{admin_id}")
        tr.record("Kịch bản 3 (User)", "Chặn chuyển chính admin vào thùng rác", self_trash.status_code in (400, 409))

        # 3.7 Xóa vĩnh viễn user sau khi chuyển vào thùng rác
        admin_client.delete(f"/admin/users/{user_id}")  # vào thùng rác
        perm_del = admin_client.delete(f"/admin/users/{user_id}/permanent")
        tr.record("Kịch bản 3 (User)", "Xóa vĩnh viễn tài khoản trong thùng rác", perm_del.status_code == 200)
        # Đã xóa vĩnh viễn xong, bỏ khỏi danh sách cleanup
        users_to_cleanup.remove(user_id)

        # ==========================================
        # KỊCH BẢN 4: PHÂN QUYỀN VÀ BẢO VỆ DỮ LIỆU
        # ==========================================
        print("\n>> Kịch bản 4: Phân quyền admin/user và bảo vệ quyền sở hữu hội thoại...")
        user_a_email = f"user_a_{uuid.uuid4().hex[:8]}@example.com"
        user_b_email = f"user_b_{uuid.uuid4().hex[:8]}@example.com"
        pass_ab = "StandardUser123@"

        user_a_id = create_user_via_admin(admin_client, base_url, user_a_email, pass_ab)
        users_to_cleanup.append(user_a_id)
        user_b_id = create_user_via_admin(admin_client, base_url, user_b_email, pass_ab)
        users_to_cleanup.append(user_b_id)

        client_a = httpx.Client(base_url=base_url, timeout=15.0)
        auth_login(client_a, user_a_email, pass_ab)

        client_b = httpx.Client(base_url=base_url, timeout=15.0)
        auth_login(client_b, user_b_email, pass_ab)

        # 4.1 User thường gọi /admin/* -> 403
        a_admin_users = client_a.get("/admin/users")
        tr.record("Kịch bản 4 (Authz)", "User thường gọi /admin/users trả về 403", a_admin_users.status_code == 403)

        # 4.2 User thường gọi /documents -> 403
        a_docs = client_a.get("/documents")
        tr.record("Kịch bản 4 (Authz)", "User thường gọi /documents trả về 403", a_docs.status_code == 403)

        # 4.3 User thường gọi /rag/search -> 403
        a_rag = client_a.post("/rag/search", json={"query": "test"})
        tr.record("Kịch bản 4 (Authz)", "User thường gọi /rag/search trả về 403", a_rag.status_code == 403)


        # 4.4 User B tạo hội thoại, User A thử truy cập -> 404
        conv_b_resp = client_b.post("/conversations", json={"title": "Hội thoại của User B"})
        conv_b_id = conv_b_resp.json()["id"]

        a_read_b = client_a.get(f"/conversations/{conv_b_id}/messages")
        tr.record("Kịch bản 4 (Authz)", "User A đọc hội thoại của User B trả về 404", a_read_b.status_code == 404)

        a_ask_b = client_a.post(f"/conversations/{conv_b_id}/ask", json={"question": "Câu hỏi trái phép"})
        tr.record("Kịch bản 4 (Authz)", "User A gửi câu hỏi vào hội thoại của User B trả về 404", a_ask_b.status_code == 404)

        a_del_b = client_a.delete(f"/conversations/{conv_b_id}")
        tr.record("Kịch bản 4 (Authz)", "User A xóa hội thoại của User B trả về 404", a_del_b.status_code == 404)

        # ==========================================
        # KỊCH BẢN 5: THỐNG KÊ /admin/stats
        # ==========================================
        print("\n>> Kịch bản 5: Kiểm tra /admin/stats theo các chu kỳ và tham số sai...")
        for period in ["recent", "week", "month", "year"]:
            stats_resp = admin_client.get(f"/admin/stats?period={period}")
            valid = (stats_resp.status_code == 200) and ("buckets" in stats_resp.json()) and ("totals" in stats_resp.json())
            tr.record("Kịch bản 5 (Stats)", f"Thống kê /admin/stats period={period}", valid)

        # Tham số sai
        stats_bad_period = admin_client.get("/admin/stats?period=invalid_period")
        tr.record("Kịch bản 5 (Stats)", "Gọi period không hợp lệ trả về 400 hoặc 422", stats_bad_period.status_code in (400, 422))

        stats_bad_days = admin_client.get("/admin/stats?period=recent&days=9999")
        tr.record("Kịch bản 5 (Stats)", "Gọi days không hợp lệ (>365) trả về 400 hoặc 422", stats_bad_days.status_code in (400, 422))

    finally:
        # ==========================================
        # DỌN SẠCH TẤT CẢ DỮ LIỆU THỬ NGHIỆM
        # ==========================================
        print("\n>> Dọn sạch dữ liệu người dùng thử nghiệm...")
        for uid in users_to_cleanup:
            try:
                purge_user_via_admin(admin_client, base_url, uid)
                print(f"  Đã xóa sạch user test ID: {uid}")
            except Exception as e:
                print(f"  Cảnh báo dọn dẹp user ID {uid}: {e}")

    return tr.print_summary()


def main():
    parser = argparse.ArgumentParser(description="Chạy Smoke Test kiểm tra toàn bộ hệ thống RAG Assistant.")
    parser.add_argument("--base-url", default=os.getenv("BASE_URL", "http://127.0.0.1:8000"), help="Địa chỉ server")
    parser.add_argument("--admin-email", default=os.getenv("ADMIN_EMAIL", DEFAULT_ADMIN_EMAIL), help="Email quản trị")
    parser.add_argument("--admin-password", default=os.getenv("ADMIN_PASSWORD", DEFAULT_ADMIN_PASSWORD), help="Mật khẩu quản trị")

    args = parser.parse_args()

    if not args.admin_email or not args.admin_password:
        print("LỖI: Chưa cung cấp thông tin tài khoản admin qua tham số (--admin-email, --admin-password) hoặc biến môi trường (ADMIN_EMAIL, ADMIN_PASSWORD).")
        sys.exit(1)

    success = run_smoke_tests(args.base_url.rstrip("/"), args.admin_email, args.admin_password)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
