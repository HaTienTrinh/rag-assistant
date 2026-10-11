from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    secret_key: str
    access_token_expire_minutes: int = 60

    # Tài liệu
    upload_dir: str = "uploads"
    max_upload_mb: int = 20

    # Embedding và tìm kiếm
    embedding_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    chunk_words: int = 180
    chunk_overlap: int = 30
    top_k: int = 5

    # LLM (DeepSeek)
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    anthropic_api_key: str = ""
    llm_model: str = "deepseek-chat"

    # Hội thoại
    history_messages: int = 8
    daily_question_limit: int = 50

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()