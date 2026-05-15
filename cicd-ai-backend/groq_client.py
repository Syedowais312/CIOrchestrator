import asyncio
from groq import Groq
from config import GROQ_API_KEY, GROQ_MODEL

client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None


def _masked_key() -> str:
    if not GROQ_API_KEY:
        return "<missing>"
    if len(GROQ_API_KEY) <= 10:
        return GROQ_API_KEY[:2] + "***"
    return f"{GROQ_API_KEY[:6]}...{GROQ_API_KEY[-4:]}"


def call_groq(system_prompt: str, user_message: str) -> str:
    if not client:
        return (
            "Groq API key is missing. Set GROQ_API_KEY in .env to enable AI diagnosis."
        )

    print(f"[groq] model={GROQ_MODEL} key={_masked_key()}")

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=0.1,
        max_tokens=2200,
    )
    return response.choices[0].message.content or ""


async def call_groq_async(system_prompt: str, user_message: str) -> str:
    return await asyncio.to_thread(call_groq, system_prompt, user_message)
