import json
import sys
from pathlib import Path
import pymysql

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

def export_local_data():
    conn = pymysql.connect(
        host="localhost",
        port=3307,
        user="rag_user",
        password="rag_pass",
        database="rag_app",
        charset="utf8mb4"
    )
    tables = ["users", "documents", "chunks", "conversations", "messages"]
    output_path = Path("backup.sql")
    
    with conn.cursor() as cursor, open(output_path, "w", encoding="utf-8") as f:
        f.write("-- Backup data from local rag-mysql\n")
        f.write("SET FOREIGN_KEY_CHECKS = 0;\n\n")
        
        for table in tables:
            cursor.execute(f"SELECT * FROM `{table}`")
            rows = cursor.fetchall()
            if not rows:
                print(f"Table `{table}`: 0 rows (skipped)")
                continue
            
            # Lấy tên cột
            columns = [desc[0] for desc in cursor.description]
            cols_str = ", ".join(f"`{c}`" for c in columns)
            
            print(f"Table `{table}`: {len(rows)} rows exporting...")
            f.write(f"-- Data for `{table}`\n")
            
            # Xuất dạng INSERT INTO với batch 100 rows
            batch_size = 100
            for i in range(0, len(rows), batch_size):
                batch = rows[i:i + batch_size]
                values_clauses = []
                for row in batch:
                    val_strs = []
                    for val in row:
                        if val is None:
                            val_strs.append("NULL")
                        elif isinstance(val, (int, float)):
                            val_strs.append(str(val))
                        elif isinstance(val, bool):
                            val_strs.append("1" if val else "0")
                        else:
                            # string / json / datetime
                            s = str(val).replace("\\", "\\\\").replace("'", "\\'")
                            val_strs.append(f"'{s}'")
                    values_clauses.append(f"({', '.join(val_strs)})")
                
                f.write(f"REPLACE INTO `{table}` ({cols_str}) VALUES\n" + ",\n".join(values_clauses) + ";\n")
            f.write("\n")
        
        f.write("SET FOREIGN_KEY_CHECKS = 1;\n")
    
    conn.close()
    print(f"\n[DONE] Đã xuất thành công file {output_path} ({output_path.stat().st_size / 1024 / 1024:.2f} MB)")

if __name__ == "__main__":
    export_local_data()
