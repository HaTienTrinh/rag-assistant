r"""Script đồng bộ toàn bộ dữ liệu từ Docker MySQL cục bộ lên TiDB Cloud Serverless.

Cách dùng:
    .\venv\Scripts\python.exe scripts/sync_to_tidb.py --password "MẬT_KHẨU_TIDB"
hoặc chạy không tham số để nhập mật khẩu an toàn:
    .\venv\Scripts\python.exe scripts/sync_to_tidb.py
"""

import argparse
import getpass
import json
import os
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

import certifi
import pymysql

# Cấu hình nguồn (Local Docker MySQL)
LOCAL_HOST = "localhost"
LOCAL_PORT = 3307
LOCAL_USER = "rag_user"
LOCAL_PASS = "rag_pass"
LOCAL_DB = "rag_app"

# Cấu hình đích (TiDB Cloud Serverless)
TIDB_HOST = "gateway01.ap-southeast-1.prod.aws.tidbcloud.com"
TIDB_PORT = 4000
TIDB_USER = "37NsR1UnjkJhs6w.root"
TIDB_DB = "rag_app"


def get_local_connection():
    return pymysql.connect(
        host=LOCAL_HOST,
        port=LOCAL_PORT,
        user=LOCAL_USER,
        password=LOCAL_PASS,
        database=LOCAL_DB,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )


def get_tidb_connection(password: str):
    ca_path = certifi.where()
    return pymysql.connect(
        host=TIDB_HOST,
        port=TIDB_PORT,
        user=TIDB_USER,
        password=password,
        database=TIDB_DB,
        ssl={"ca": ca_path},
        autocommit=True,
        charset="utf8mb4",
    )


def sync_table(local_conn, tidb_conn, table_name: str, batch_size: int = 200):
    print(f"\n--- Đang đồng bộ bảng `{table_name}` ---")
    with local_conn.cursor() as loc_cur:
        loc_cur.execute(f"SELECT COUNT(*) as cnt FROM `{table_name}`")
        total = loc_cur.fetchone()["cnt"]
        if total == 0:
            print(f"  [Bỏ qua] Bảng `{table_name}` trên local không có dữ liệu.")
            return

        print(f"  Tìm thấy {total} bản ghi trên Local. Bắt đầu truyền sang TiDB Cloud...")

        loc_cur.execute(f"SELECT * FROM `{table_name}`")
        cols = [d[0] for d in loc_cur.description]
        cols_str = ", ".join(f"`{c}`" for c in cols)
        placeholders = ", ".join(["%s"] * len(cols))
        insert_sql = f"REPLACE INTO `{table_name}` ({cols_str}) VALUES ({placeholders})"

        with tidb_conn.cursor() as tidb_cur:
            imported = 0
            while True:
                rows = loc_cur.fetchmany(batch_size)
                if not rows:
                    break

                # Chuyển đổi định dạng phù hợp (đặc biệt là JSON trong chunks.embedding)
                param_rows = []
                for row in rows:
                    vals = []
                    for c in cols:
                        v = row[c]
                        if isinstance(v, (list, dict)):
                            v = json.dumps(v, ensure_ascii=False)
                        vals.append(v)
                    param_rows.append(vals)

                tidb_cur.executemany(insert_sql, param_rows)
                imported += len(rows)
                percent = (imported / total) * 100
                print(f"  -> Đã nạp {imported}/{total} ({percent:.1f}%)...", end="\r")

            print(f"\n  [XONG] Bảng `{table_name}`: Đã nạp thành công {imported}/{total} bản ghi!")


def main():
    parser = argparse.ArgumentParser(description="Đồng bộ trực tiếp MySQL Local sang TiDB Cloud")
    parser.add_argument("--password", default=None, help="Mật khẩu cụm TiDB Cloud")
    args = parser.parse_args()

    password = args.password or os.environ.get("TIDB_PASSWORD")
    if not password:
        password = getpass.getpass(f"Nhập mật khẩu cho TiDB user '{TIDB_USER}': ")

    if not password:
        print("Lỗi: Mật khẩu không được để trống!")
        sys.exit(1)

    print("================================================================================")
    print("BẮT ĐẦU ĐỒNG BỘ DỮ LIỆU TỪ LOCAL DOCKER SANG TIDB CLOUD")
    print("================================================================================")

    # 1. Kết nối Local
    print("1. Kiểm tra kết nối Docker MySQL cục bộ (localhost:3307)...")
    try:
        local_conn = get_local_connection()
        print("   [OK] Kết nối Local MySQL thành công!")
    except Exception as e:
        print(f"   [LỖI] Không thể kết nối Local MySQL: {e}")
        print("   Hãy chắc chắn Docker container 'rag-mysql' đang chạy (`docker-compose up -d`).")
        sys.exit(1)

    # 2. Kết nối TiDB Cloud
    print(f"2. Kiểm tra kết nối TiDB Cloud ({TIDB_HOST}:{TIDB_PORT})...")
    try:
        tidb_conn = get_tidb_connection(password)
        print("   [OK] Kết nối TiDB Cloud với SSL thành công!")
    except Exception as e:
        print(f"   [LỖI] Không thể kết nối TiDB Cloud: {e}")
        print("   Vui lòng kiểm tra lại mật khẩu hoặc địa chỉ cụm TiDB.")
        local_conn.close()
        sys.exit(1)

    # 3. Đảm bảo bảng đã tồn tại trên TiDB Cloud
    with tidb_conn.cursor() as cur:
        cur.execute("SET FOREIGN_KEY_CHECKS = 0;")

    # 4. Lần lượt đồng bộ các bảng
    tables_to_sync = ["users", "documents", "chunks", "conversations", "messages"]
    start_time = time.time()

    for table in tables_to_sync:
        try:
            sync_table(local_conn, tidb_conn, table)
        except Exception as e:
            print(f"  [CẢNH BÁO] Lỗi khi đồng bộ bảng `{table}`: {e}")

    with tidb_conn.cursor() as cur:
        cur.execute("SET FOREIGN_KEY_CHECKS = 1;")

    local_conn.close()
    tidb_conn.close()

    elapsed = time.time() - start_time
    print("\n================================================================================")
    print(f"ĐỒNG BỘ HOÀN TẤT TRONG {elapsed:.1f} GIÂY!")
    print("Bây giờ bạn có thể tải lại trang web https://rag-assistant-38wb.onrender.com/")
    print("Tất cả tài liệu và đoạn trích đã sẵn sàng phục vụ RAG!")
    print("================================================================================")


if __name__ == "__main__":
    main()
