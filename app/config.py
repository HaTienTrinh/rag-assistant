from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str
    secret_key: str
    access_token_expire_minutes: int = 60

    # Tài liệu
    upload_dir: str = "uploads"
    max_upload_mb: int = 20

    # Embedding và tìm kiếm
    embedding_model: str = "intfloat/multilingual-e5-small"
    chunk_words: int = 180
    chunk_overlap: int = 30
    top_k: int = 5

    # LLM (DeepSeek)
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    llm_model: str = "deepseek-chat"

    model_config = SettingsConfigDict(env_file=".env")


settings = Settings()