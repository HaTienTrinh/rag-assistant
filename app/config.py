from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    secret_key: str
    access_token_expire_minutes: int = 15  # mặc định 15 phút theo Phase 2
    refresh_token_expire_days: int = 14  # thời hạn sống của refresh token (ngày)
    refresh_reuse_grace_seconds: int = 10  # thời gian ân hạn phát hiện dùng lại token (giây)
    cookie_secure: bool = False  # bật True khi triển khai HTTPS

    upload_dir: str = "uploads"
    max_upload_mb: int = 20

    embedding_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    chunk_words: int = 60
    chunk_overlap: int = 15
    top_k: int = 8
    min_score: float = 0.25  # dưới ngưỡng này coi như không tìm thấy tài liệu phù hợp
    debug_rag: bool = False  # bật True để ghi log chẩn đoán RAG cấp INFO cho mỗi câu hỏi

    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    llm_model: str = "deepseek-v4-flash"

    history_messages: int = 8
    daily_question_limit: int = 50
    display_utc_offset_minutes: int = 420  # độ lệch múi giờ hiển thị so với UTC (phút), mặc định 420 = UTC+7 (giờ VN)
    bulk_import_max_rows: int = 200  # giới hạn số dòng dữ liệu nhập tài khoản hàng loạt

    admin_email: str = ""
    admin_password: str = ""
    demo_email: str = ""
    demo_password: str = ""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator("database_url")
    @classmethod
    def use_pymysql_driver(cls, v: str) -> str:
        if v.startswith("mysql://"):
            return v.replace("mysql://", "mysql+pymysql://", 1)
        return v


settings = Settings()