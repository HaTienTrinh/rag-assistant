"""Script tự động nạp dữ liệu từ file backup.sql vào TiDB Cloud Serverless.

Cách dùng:
    python scripts/import_tidb.py --password "MẬT_KHẨU_TIDB_CỦA_BẠN"
hoặc chạy không tham số để nhập mật khẩu an toàn:
    python scripts/import_tidb.py
"""

import argparse
import getpass
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

import certifi
import pymysql
from pymysql.constants import CLIENT

DEFAULT_HOST = "gateway01.ap-southeast-1.prod.aws.tidbcloud.com"
DEFAULT_PORT = 4000
DEFAULT_USER = "37NsR1UnjkJhs6w.root"
DEFAULT_DB = "rag_app"
BACKUP_FILE = "backup.sql"


def main():
    parser = argparse.ArgumentParser(description="Import backup.sql vào TiDB Cloud")
    parser.add_argument("--host", default=DEFAULT_HOST, help="TiDB Cloud Host")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="TiDB Cloud Port")
    parser.add_argument("--user", default=DEFAULT_USER, help="TiDB Cloud User")
    parser.add_argument("--database", default=DEFAULT_DB, help="Tên database đích")
    parser.add_argument("--password", default=None, help="Mật khẩu cụm TiDB Cloud")
    parser.add_argument("--file", default=BACKUP_FILE, help="Đường dẫn file .sql")
    args = parser.parse_args()

    password = args.password
    if not password:
        password = os.environ.get("TIDB_PASSWORD")
    if not password:
        password = getpass.getpass(f"Nhập mật khẩu cho user TiDB '{args.user}': ")

    if not password:
        print("Lỗi: Mật khẩu không được để trống!")
        sys.exit(1)

    if not os.path.exists(args.file):
        print(f"Lỗi: Không tìm thấy file '{args.file}'!")
        sys.exit(1)

    print(f"1. Đang kết nối tới TiDB Cloud ({args.host}:{args.port})...")
    ca_path = certifi.where()

    try:
        conn = pymysql.connect(
            host=args.host,
            port=args.port,
            user=args.user,
            password=password,
            ssl={"ca": ca_path},
            client_flag=CLIENT.MULTI_STATEMENTS,
            autocommit=True,
            charset="utf8mb4",
        )
    except Exception as e:
        print(f"Lỗi kết nối tới TiDB Cloud: {e}")
        sys.exit(1)

    print("   [ĐẠT] Kết nối SSL thành công!")

    with conn.cursor() as cursor:
        print(f"2. Tạo database '{args.database}' nếu chưa có...")
        cursor.execute(
            f"CREATE DATABASE IF NOT EXISTS `{args.database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
        )
        cursor.execute(f"USE `{args.database}`;")

        print(f"3. Đọc dữ liệu từ file '{args.file}'...")
        with open(args.file, "r", encoding="utf-8") as f:
            sql_content = f.read()

        print(f"4. Đang nạp dữ liệu vào database '{args.database}' trên TiDB Cloud...")
        # Tách các câu lệnh và thực thi
        statements = []
        current_stmt = []
        for line in sql_content.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("--") or stripped.startswith("/*"):
                continue
            current_stmt.append(line)
            if stripped.endswith(";"):
                stmt = "\n".join(current_stmt).strip()
                if stmt:
                    statements.append(stmt)
                current_stmt = []

        total = len(statements)
        print(f"   Tìm thấy {total} câu lệnh SQL. Đang thực thi...")

        for idx, stmt in enumerate(statements, start=1):
            try:
                cursor.execute(stmt)
            except Exception as e:
                # Bỏ qua các cảnh báo không ảnh hưởng
                err_msg = str(e).lower()
                if "already exists" in err_msg:
                    pass
                else:
                    print(f"   [Cảnh báo ở câu {idx}]: {e}")

            if idx % 50 == 0 or idx == total:
                print(f"   Đã thực thi: {idx}/{total} câu lệnh ({(idx/total)*100:.1f}%)...")

    conn.close()
    print("\n================================================================================")
    print("NẠP DỮ LIỆU VÀO TIDB CLOUD THÀNH CÔNG RỰC RỠ!")
    print("================================================================================")
    print("Chuỗi DATABASE_URL chuẩn để dán vào Render:")
    print(f"mysql+pymysql://{args.user}:{password}@{args.host}:{args.port}/{args.database}?ssl_verify_cert=true&ssl_verify_identity=true")
    print("================================================================================")


if __name__ == "__main__":
    main()
