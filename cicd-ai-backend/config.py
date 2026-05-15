import os
from dotenv import load_dotenv

# Prefer the project's .env values over any stale shell-exported variables.
load_dotenv(override=True)

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

GITHUB_API_BASE = "https://api.github.com"
REQUEST_TIMEOUT_SECONDS = 30.0
MAX_LOG_CHARS = 12000
MAX_FILE_CHARS = 8000
DATABASE_PATH = os.getenv("DATABASE_PATH", "diagnosis_history.db")

HEADERS_GITHUB = {
    "Authorization": f"token {GITHUB_TOKEN}" if GITHUB_TOKEN else "",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}
