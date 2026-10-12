# RAG Assistant
<p align="center">

  <img src="app/static/apple-touch-icon.png" alt="RAG Assistant Logo" width="100" height="100" style="border-radius: 20%;" />

</p>

<p align="center">

  <b>Trợ lý hỏi đáp tài liệu nội bộ sử dụng Retrieval-Augmented Generation (RAG)</b>

</p>

<p align="center">

  <img src="https://img.shields.io/badge/Python-3.12-3776AB?style=flat&logo=python&logoColor=white" alt="Python 3.12" />

  <img src="https://img.shields.io/badge/FastAPI-0.143-009688?style=flat&logo=fastapi&logoColor=white" alt="FastAPI" />

  <img src="https://img.shields.io/badge/FastEmbed-ONNX-orange?style=flat" alt="FastEmbed" />

  <img src="https://img.shields.io/badge/DeepSeek-V4_Flash-blue?style=flat" alt="DeepSeek" />

  <img src="https://img.shields.io/badge/MySQL-8.0-4479A1?style=flat&logo=mysql&logoColor=white" alt="MySQL" />

  <img src="https://img.shields.io/badge/TiDB_Cloud-Serverless-EA4335?style=flat" alt="TiDB Cloud" />

  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?style=flat&logo=docker&logoColor=white" alt="Docker" />

  <img src="https://img.shields.io/badge/License-MIT-green?style=flat" alt="License" />

</p>

---

## Mục lục
- [Giới thiệu](#giới-thiệu)
- [Chức năng chính](#chức-năng-chính)
- [Kiến trúc hệ thống](#kiến-trúc-hệ-thống)
- [Công nghệ sử dụng](#công-nghệ-sử-dụng)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [Cài đặt và chạy cục bộ](#cài-đặt-và-chạy-cục-bộ)
- [Biến môi trường](#biến-môi-trường)
- [Chạy smoke test](#chạy-smoke-test)
- [Đồng bộ và sao lưu dữ liệu](#đồng-bộ-và-sao-lưu-dữ-liệu)
- [Triển khai](#triển-khai)
- [API](#api)
- [Tài khoản khởi tạo](#tài-khoản-khởi-tạo)

---

## Giới thiệu
**RAG Assistant** là ứng dụng hỏi đáp trên tài liệu nội bộ theo mô hình Retrieval-Augmented Generation (RAG). Người dùng có thể tải lên tài liệu PDF, DOCX hoặc TXT, đặt câu hỏi và xem các nguồn được sử dụng để tạo câu trả lời.

Ứng dụng gồm giao diện chat và trang quản trị. Quản trị viên có thể quản lý người dùng, tài liệu và hạn mức câu hỏi. Dự án hỗ trợ chạy cục bộ bằng Docker và cấu hình triển khai trên Render.

---

## Chức năng chính
### Hỏi đáp tài liệu
- **Tìm kiếm vector:** Ma trận embedding được nạp vào RAM (`np.ndarray`); hệ thống dùng độ tương đồng cosine để xếp hạng các đoạn văn bản.
- **Embedding đa ngôn ngữ:** Sử dụng `fastembed` với mô hình `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`, chạy trên ONNX Runtime CPU.
- **Viết lại câu hỏi:** Dựa vào lịch sử hội thoại gần nhất để viết lại câu hỏi nối tiếp trước khi tìm kiếm tài liệu.
- **Nguồn tham khảo:** Các ký hiệu trích dẫn như `[1]`, `[2]` được liên kết với tên tệp, số trang và đoạn văn bản nguồn tương ứng.
- **Câu hỏi chưa có thông tin:** Kết quả được lọc theo ngưỡng tương đồng (`min_score = 0.25`). Những câu hỏi không tìm được thông tin phù hợp có thể được ghi vào bảng `unanswered_questions` để quản trị viên xem xét.

### Tài khoản và bảo mật
- **Access token và refresh token:**
  - **Access Token:** JWT ngắn hạn (15 phút).
  - **Refresh Token:** HttpOnly Cookie (14 ngày), băm một chiều SHA-256 trong CSDL.
- **Xoay vòng token:** Theo dõi nhánh phiên (`family_id`). Nếu token cũ bị sử dụng lại ngoài thời gian ân hạn (`10s`), các phiên thuộc nhánh đó sẽ bị thu hồi.
- **Giới hạn đăng nhập:** Tạm khóa đăng nhập sau 5 lần thất bại trong vòng 15 phút.
- **Chính sách mật khẩu:** Mật khẩu phải có ít nhất 8 ký tự, gồm chữ hoa, chữ thường, chữ số và ký tự đặc biệt. Cờ `must_change_password` dùng để yêu cầu đổi mật khẩu ở lần đăng nhập đầu tiên.
- **Thu hồi phiên:** `token_version` được dùng để thu hồi các phiên đăng nhập khi người dùng đổi mật khẩu hoặc tài khoản bị khóa.

### Quản lý tài liệu
- Hỗ trợ đa dạng định dạng: **PDF**, **Word (.docx)**, **Văn bản thuần (.txt)**.
- Kiểm tra trùng lặp tệp bằng SHA-256.
- Tài liệu được xử lý nền bằng FastAPI `BackgroundTasks` và chia thành các đoạn có phần chồng lấn.
- Có thể bật hoặc tắt việc sử dụng tài liệu trong RAG mà không cần xóa tệp.
- Có thể xem các chunk đã tạo và xử lý lại tài liệu khi cần.

### Trang quản trị
- **Quản lý người dùng:** Tạo và sửa tài khoản, đặt lại mật khẩu, đặt hạn mức câu hỏi, khóa tài khoản hoặc khôi phục tài khoản đã xóa mềm.
- **Nhập người dùng hàng loạt (Bulk Import):** Nhập tài khoản từ file Excel (`.xlsx`) hoặc CSV. Có thể tải file mẫu để chuẩn bị dữ liệu.
- **Thống kê:** Hiển thị số câu hỏi theo thời gian, lượng token đầu vào/đầu ra và các người dùng hoạt động nhiều.
- **Câu hỏi chưa được giải đáp:** Phân loại theo lý do (`low_score` hoặc `llm_not_found`), đánh dấu trạng thái xử lý khi đã cập nhật tài liệu tương ứng.

---

## Kiến trúc hệ thống
```mermaid

flowchart TD

    subgraph Client ["Client (Trình duyệt Người Dùng & Quản Trị)"]

        UI["Web UI (Vanilla JS / CSS)"]

        ChatUI["Chatbot Interface (index.html)"]

        AdminUI["Admin Dashboard (admin.html)"]

    end

    subgraph Backend ["Backend API (FastAPI)"]

        AuthRouter["Auth & Security Router"]

        DocRouter["Documents Router"]

        ConvRouter["Conversations & RAG Router"]

        AdminRouter["Admin Router"]

        subgraph Pipeline ["RAG Pipeline Engine"]

            Rewriter["Query Rewriter (LLM)"]

            FastEmbed["FastEmbed (ONNX Multilingual)"]

            RAMCache["RAM In-Memory Vector Matrix"]

            LLMClient["DeepSeek LLM Client (Keep-Alive Pool)"]

        end

    end

    subgraph Storage ["Lưu Trữ & Cơ Sở Dữ Liệu"]

        MySQL[("MySQL 8.0 (Local Docker) / TiDB Cloud (Prod)")]

        FileStore["Thư mục Uploads (PDF / DOCX / TXT)"]

    end

    UI --> ChatUI & AdminUI

    ChatUI -->|JWT + HttpOnly Cookie| ConvRouter

    AdminUI -->|Admin Token| AdminRouter & DocRouter

    ConvRouter --> Rewriter

    Rewriter --> FastEmbed

    FastEmbed -->|Query Vector| RAMCache

    RAMCache -->|Top-K Chunks| LLMClient

    LLMClient -->|Stream / Answer + Citations| ConvRouter

    DocRouter -->|Tải lên tài liệu| FileStore

    DocRouter -->|Trích xuất & Chunking| FastEmbed

    FastEmbed -->|Lưu Chunks & Embeddings| MySQL

    MySQL -.->|Nạp sẵn Vector Matrix| RAMCache

```

---

## Công nghệ sử dụng
| Thành Phần | Công Nghệ | Mô Tả |
| :--- | :--- | :--- |
| **Backend Framework** | [FastAPI](https://fastapi.tiangolo.com/) (0.143+) | Web framework bất đồng bộ, tốc độ cao, chuẩn hóa OpenAPI / Swagger |
| **Web Server** | [Uvicorn](https://www\.uvicorn.org/) (ASGI) | Máy chủ ASGI hiệu năng cao cho Python |
| **Cơ Sở Dữ Liệu** | MySQL 8.0 / [TiDB Cloud Serverless](https://tidbcloud.com/) | CSDL quan hệ lưu trữ người dùng, hội thoại, tài liệu và vector JSON |
| **ORM & Driver** | [SQLAlchemy 2.0](https://www\.sqlalchemy.org/) + PyMySQL | Quản lý mô hình quan hệ CSDL và kết nối SSL |
| **Embedding Model** | [FastEmbed](https://github.com/qdrant/fastembed) (`paraphrase-multilingual-MiniLM-L12-v2`) | Sinh vector nhúng đa ngôn ngữ cực nhẹ chạy bằng ONNX CPU |
| **Mô Hình LLM** | [DeepSeek-V4-Flash](https://www\.deepseek.com/) (qua OpenAI SDK) | Suy luận sinh câu trả lời, viết lại câu hỏi với kết nối Keep-Alive |
| **Xử Lý File** | PyPDF, python-docx, openpyxl | Trích xuất văn bản từ file PDF, Word và đọc/ghi Excel |
| **Xác Thực** | PyJWT, bcrypt, cryptography | Quản lý JWT access token, mã hóa băm mật khẩu chuẩn blowfish |
| **Frontend** | HTML5, CSS3 hiện đại, Vanilla JavaScript | Giao diện Responsive mượt mà, không phụ thuộc framework cồng kềnh |
| **Container & Cloud** | Docker, Docker Compose, Render | Môi trường container hóa và tệp cấu hình triển khai tự động |
---

## Cấu trúc thư mục
```text

rag-assistant/

├── app/

│   ├── routers/             # Các API Endpoint phân hệ

│   │   ├── admin.py         # Quản trị người dùng, thống kê, câu hỏi chưa trả lời

│   │   ├── auth.py          # Đăng nhập, refresh token, đăng xuất, đổi mật khẩu

│   │   ├── conversations.py # Quản lý hội thoại, gửi câu hỏi chat RAG

│   │   ├── documents.py     # Tải lên, phân tích, kích hoạt, xóa tài liệu

│   │   └── rag.py           # API tìm kiếm vector độc lập

│   ├── services/            # Xử lý nghiệp vụ lõi

│   │   ├── bulk_import.py   # Xử lý file import người dùng hàng loạt

│   │   ├── chunking.py      # Phân mảnh văn bản theo số từ và độ chồng lấn

│   │   ├── embeddings.py    # Sinh vector nhúng văn bản bằng FastEmbed

│   │   ├── extract.py       # Đọc nội dung file PDF, DOCX, TXT

│   │   ├── ingest.py        # Tiến trình nền ingest tài liệu

│   │   ├── llm.py           # Kết nối DeepSeek LLM, viết lại câu hỏi, trích dẫn

│   │   ├── passwords.py     # Sinh mật khẩu ngẫu nhiên an toàn

│   │   └── retrieval.py     # Tìm kiếm tương đồng vector với RAM Cache

│   ├── static/              # Giao diện người dùng

│   │   ├── css/             # Stylesheet tùy biến

│   │   ├── js/              # Mã xử lý logic frontend (Chat, Admin, Auth)

│   │   ├── index.html       # Trang giao diện Chatbot chính

│   │   ├── login.html       # Trang đăng nhập và đổi mật khẩu

│   │   ├── admin.html       # Bảng điều khiển quản trị viên

│   │   └── favicon.*        # Bộ biểu tượng đa nền tảng

│   ├── auth.py              # Xử lý bảo mật JWT, cookie, quy tắc mật khẩu

│   ├── config.py            # Cấu hình Pydantic BaseSettings đọc từ .env

│   ├── database.py          # Cấu hình kết nối SQLAlchemy Engine & Session

│   ├── main.py              # Điểm khởi chạy ứng dụng FastAPI

│   ├── migrate.py           # Tự động cập nhật cấu trúc cột & chỉ mục bảng

│   ├── models.py            # Định nghĩa các bảng dữ liệu SQLAlchemy

│   └── seed.py              # Tạo dữ liệu tài khoản mặc định ban đầu

├── scripts/                 # Công cụ dòng lệnh hỗ trợ

│   ├── create_user.py       # Script tạo tài khoản trực tiếp qua CLI

│   ├── export_local.py      # Xuất dữ liệu local ra file backup.sql

│   ├── import_tidb.py       # Nạp file backup.sql lên TiDB Cloud

│   ├── sync_to_tidb.py      # Đồng bộ trực tiếp từ Docker MySQL sang TiDB Cloud

│   └── smoke_test.py        # Kịch bản kiểm thử tự động toàn diện

├── uploads/                 # Thư mục lưu trữ tài liệu đã tải lên

├── .env.example             # Mẫu cấu hình biến môi trường

├── docker-compose.yml       # Khởi động dịch vụ MySQL 8.0 cục bộ

├── render.yaml              # Cấu hình tự động triển khai trên Render Cloud

├── requirements.txt         # Danh sách các thư viện Python phụ thuộc

└── README.md                # Tài liệu hướng dẫn sử dụng dự án

```

---

## Cài đặt và chạy cục bộ
### 1. Yêu cầu hệ thống
- **Python**: Phiên bản 3.12 trở lên.
- **Docker & Docker Compose**: Để chạy cơ sở dữ liệu MySQL cục bộ.
- **DeepSeek API Key**: Tài khoản truy cập DeepSeek API ([Đăng ký tại platform.deepseek.com](https://platform.deepseek.com)).

### 2. Thiết lập môi trường ảo
```bash

# Clone dự án (nếu clone từ Git)

git clone https://github.com/HaTienTrinh/rag-assistant.git

cd rag-assistant

# Tạo môi trường ảo Python

python -m venv venv

# Kích hoạt môi trường ảo:

# Trên Windows (PowerShell):

.\venv\Scripts\Activate.ps1

# Trên Windows (cmd):

.\venv\Scripts\activate.bat

# Trên Linux / macOS:

source venv/bin/activate

```

### 3. Cài đặt các thư viện phụ thuộc
```bash

pip install --upgrade pip

pip install -r requirements.txt

```

### 4. Khởi chạy Cơ Sở Dữ Liệu MySQL cục bộ
Khởi động container MySQL 8.0 chạy trên cổng `3307`:

```bash

docker-compose up -d

```

> **Lưu ý:** Container tạo sẵn cơ sở dữ liệu `rag_app`, người dùng `rag_user` với mật khẩu `rag_pass` tại cổng `3307` để tránh xung đột với cổng MySQL mặc định `3306`.

### 5. Cấu hình file môi trường `.env`
Sao chép file mẫu `.env.example` thành `.env`:

```bash

# Trên Windows:

copy .env.example .env

# Trên Linux / macOS:

cp .env.example .env

```

Mở file `.env` và điền khóa API của DeepSeek cùng mật khẩu quản trị mong muốn:

```env

DATABASE_URL=mysql+pymysql://rag_user:rag_pass@localhost:3307/rag_app?charset=utf8mb4

SECRET_KEY=mot_chuoi_khoa_bi_mat_ngau_nhien_dai_it_nhat_32_ky_tu

DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

ADMIN_EMAIL=admin@example.com

ADMIN_PASSWORD=AdminPass12345@

```

### 6. Khởi động ứng dụng
Chạy server ứng dụng FastAPI với Uvicorn:

```bash

uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

```

Hệ thống sẽ tự động:

1\. Đợi cơ sở dữ liệu sẵn sàng.
2\. Tạo các bảng, cột và chỉ mục còn thiếu (`create_all`, `ensure_columns`, `ensure_indexes`).
3\. Dọn dẹp các token hết hạn.
4\. Tự động seed tài khoản quản trị viên và tài khoản demo cấu hình trong `.env`.

### 7. Truy cập ứng dụng
- **Giao diện Chat:** [http://127.0.0.1:8000/](http://127.0.0.1:8000/)
- **Giao diện Đăng nhập:** [http://127.0.0.1:8000/login](http://127.0.0.1:8000/login)
- **Bảng điều khiển Quản trị:** [http://127.0.0.1:8000/admin](http://127.0.0.1:8000/admin)
- **Tài liệu API Swagger UI:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

---

## Biến môi trường
| Biến | Mặc Định | Mô Tả |
| :--- | :--- | :--- |
| `DATABASE_URL` | - | Chuỗi kết nối CSDL (`mysql+pymysql://...`) |
| `SECRET_KEY` | - | Khóa bí mật dùng để ký và xác thực JWT token |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | Thời gian sống của Access Token (phút) |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `14` | Thời gian sống của Refresh Token (ngày) |
| `REFRESH_REUSE_GRACE_SECONDS`| `10` | Thời gian ân hạn mạng khi phát hiện dùng lại token |
| `COOKIE_SECURE` | `false` | Bật `true` khi triển khai production có HTTPS |
| `UPLOAD_DIR` | `uploads` | Thư mục lưu trữ các tệp tải lên |
| `MAX_UPLOAD_MB` | `20` | Kích thước file tải lên tối đa (MB) |
| `EMBEDDING_MODEL` | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | Mô hình FastEmbed sinh vector |
| `CHUNK_WORDS` | `60` | Kích thước mỗi đoạn văn bản (số từ) |
| `CHUNK_OVERLAP` | `15` | Số từ chồng lấn giữa hai đoạn liên tiếp |
| `TOP_K` | `8` | Số lượng đoạn văn bản tương đồng tối đa lấy về |
| `MIN_SCORE` | `0.25` | Ngưỡng điểm tương đồng tối thiểu để đưa vào ngữ cảnh |
| `DEEPSEEK_API_KEY` | - | Khóa API DeepSeek |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | Base URL của DeepSeek API |
| `LLM_MODEL` | `deepseek-v4-flash` | Định danh mô hình ngôn ngữ lớn |
| `HISTORY_MESSAGES` | `8` | Số tin nhắn lịch sử nạp vào prompt cho ngữ cảnh |
| `DAILY_QUESTION_LIMIT` | `50` | Giới hạn số câu hỏi mặc định mỗi ngày của người dùng |
| `DISPLAY_UTC_OFFSET_MINUTES` | `420` | Độ lệch múi giờ hiển thị (420 phút = UTC+7 Việt Nam) |
| `BULK_IMPORT_MAX_ROWS` | `200` | Số dòng tối đa khi nhập tài khoản hàng loạt |
| `ADMIN_EMAIL` | `admin@example.com` | Email quản trị viên khởi tạo ban đầu |
| `ADMIN_PASSWORD` | - | Mật khẩu quản trị viên khởi tạo ban đầu |
---

## Chạy smoke test
Script `scripts/smoke_test.py` kiểm tra một số luồng chính của người dùng và quản trị viên:

```bash

python scripts/smoke_test.py --base-url http://127.0.0.1:8000 --admin-email admin@example.com --admin-password AdminPass12345@

```

### Các kịch bản được kiểm thử tự động:
1\. **Xác thực & Vòng đời Token:** Đăng nhập, refresh xoay vòng, từ chối token cũ quá hạn ân hạn (Replay Attack), đăng xuất vô hiệu hóa phiên.
2\. **Đổi mật khẩu & Thu hồi đa thiết bị:** Đổi mật khẩu thành công, vô hiệu hóa mật khẩu cũ, tự động đăng xuất các phiên đang mở khác qua `token_version`.
3\. **Chính sách mật khẩu bắt buộc:** Buộc đổi mật khẩu lần đầu với cờ `must_change_password`, kiểm tra định dạng mật khẩu yếu bị chặn.
4\. **Quản trị người dùng:** Tạo tài khoản, sửa thông tin, khóa tài khoản, đặt lại mật khẩu, xóa mềm vào thùng rác, khôi phục và xóa vĩnh viễn.
5\. **Nhập người dùng hàng loạt (Bulk Import):** Tải file template mẫu, import file Excel giả lập, kiểm tra báo cáo thành công/thất bại chi tiết.
6\. **Vòng đời tài liệu:** Tải lên tệp thử nghiệm, chờ background task trích xuất & embedding hoàn tất, kiểm tra danh sách chunks, bật/tắt tài liệu, xóa tài liệu.
7\. **Truy vấn RAG & Trích dẫn:** Đặt câu hỏi trực tiếp, kiểm tra viết lại câu hỏi, đối chiếu nguồn trích dẫn `[1]`, `[2]`, ghi nhận câu hỏi chưa có lời giải khi nằm ngoài phạm vi tài liệu.
8\. **Thống kê Bảng điều khiển Admin:** Truy vấn dữ liệu thống kê tổng quan, tỷ lệ token và danh sách câu hỏi chưa giải quyết.

---

## Đồng bộ và sao lưu dữ liệu
Các script trong thư mục `scripts/` hỗ trợ đồng bộ dữ liệu lên TiDB Cloud hoặc xuất dữ liệu cục bộ ra tệp SQL.

### 1. Đồng bộ trực tiếp từ Docker MySQL sang TiDB Cloud
```bash

python scripts/sync_to_tidb.py --password "MAT_KHAU_TIDB_CLOUD"

```

**Script sẽ tự động đọc dữ liệu các bảng `users`, `documents`, `chunks`, `conversations`, `messages` từ Docker MySQL (`localhost:3307`) và truyền trực tiếp qua kết nối SSL bảo mật lên cụm TiDB Cloud Serverless.**

### 2. Xuất dữ liệu cục bộ ra file SQL
```bash

python scripts/export_local.py

```

**Tạo file `backup.sql` chứa toàn bộ dữ liệu có cấu trúc dưới dạng câu lệnh `REPLACE INTO` theo từng batch.**

### 3. Tạo tài khoản người dùng nhanh qua CLI
```bash

python -m scripts.create_user email@example.com MatKhau12345@ admin

```

---

## Triển khai
Dự án có tệp `render.yaml` để cấu hình triển khai trên Render.

### Triển khai trên Render:
1\. Đẩy mã nguồn lên kho lưu trữ GitHub của bạn.
2\. Truy cập [Render Dashboard](https://dashboard.render.com/) -> Chọn **New** -> **Blueprint**.
3\. Kết nối với kho lưu trữ `rag-assistant`. Render sẽ tự động nhận diện file `render.yaml`.
4\. Cấu hình các biến môi trường nhạy cảm trong bảng điều khiển Render:
   - `DATABASE_URL`: Đường dẫn kết nối TiDB Cloud Serverless (ví dụ: `mysql+pymysql://user:pass@gateway01...:4000/rag_app?ssl_ca=/etc/ssl/certs/ca-certificates.crt`).
   - `DEEPSEEK_API_KEY`: Khóa API DeepSeek của bạn.
   - `ADMIN_PASSWORD`: Mật khẩu cho tài khoản quản trị.
   - `COOKIE_SECURE`: Đặt giá trị `true` (do Render hoạt động trên HTTPS).
5\. Nhấn **Apply**. Dịch vụ sẽ tự động cài đặt thư viện và khởi chạy web service.

---

## API
Khi ứng dụng đang chạy, tài liệu API có thể truy cập tại `/docs`.

| Phương Thức | Đường Dẫn | Quyền Hạn | Mô Tả |
| :--- | :--- | :--- | :--- |
| `POST` | `/auth/login` | Công khai | Đăng nhập lấy access token và cookie refresh token |
| `POST` | `/auth/refresh` | Công khai | Xoay vòng cấp access token mới bằng refresh token |
| `POST` | `/auth/logout` | Đã đăng nhập | Thu hồi refresh token và đăng xuất |
| `GET` | `/auth/me` | Đã đăng nhập | Lấy thông tin tài khoản người dùng hiện tại |
| `POST` | `/auth/change-password` | Đã đăng nhập | Đổi mật khẩu cá nhân |
| `GET` | `/conversations` | User / Admin | Lấy danh sách các phiên hội thoại của người dùng |
| `POST` | `/conversations` | User / Admin | Tạo mới phiên hội thoại |
| `POST` | `/conversations/{id}/ask` | User / Admin | Gửi câu hỏi vào hội thoại, xử lý qua pipeline RAG |
| `DELETE` | `/conversations/{id}` | User / Admin | Xóa phiên hội thoại |
| `POST` | `/documents` | Admin | Tải lên tài liệu mới để nạp vào cơ sở tri thức |
| `GET` | `/documents` | Admin | Lấy danh sách tài liệu trong hệ thống |
| `PATCH` | `/documents/{id}` | Admin | Bật/tắt trạng thái sử dụng của tài liệu |
| `DELETE` | `/documents/{id}` | Admin | Xóa tài liệu và các chunk liên quan |
| `GET` | `/admin/stats` | Admin | Thống kê số liệu hệ thống theo ngày/tháng/năm |
| `GET` | `/admin/users` | Admin | Danh sách người dùng (hỗ trợ phân trang, tìm kiếm) |
| `POST` | `/admin/users` | Admin | Tạo tài khoản người dùng mới |
| `POST` | `/admin/users-import` | Admin | Nhập người dùng hàng loạt từ file Excel/CSV |
| `GET` | `/admin/unanswered` | Admin | Danh sách các câu hỏi chưa được giải đáp |
---

## Tài khoản khởi tạo
Khi khởi chạy lần đầu, hệ thống sẽ tự động tạo các tài khoản mẫu từ cấu hình biến môi trường:

| Loại Tài Khoản | Email Mặc Định | Mật Khẩu Khởi Tạo | Quyền Hạn |
| :--- | :--- | :--- | :--- |
| **Quản trị viên (Admin)** | `admin@example.com` | Giá trị trong `ADMIN_PASSWORD` | Toàn quyền quản trị tài liệu, người dùng, xem thống kê |
| **Người dùng thử nghiệm (Demo)** | `user@example.com` | Giá trị trong `DEMO_PASSWORD` | Hỏi đáp hội thoại RAG, đổi mật khẩu cá nhân |
> **Lưu ý bảo mật:** Hãy thay đổi các mật khẩu mặc định ngay sau khi khởi chạy hệ thống trên môi trường sản xuất!

---

## Giấy phép
Dự án sử dụng giấy phép MIT. Xem tệp giấy phép trong repository nếu có để biết đầy đủ điều khoản.
