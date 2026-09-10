import asyncio
import gc
import hmac
import json
import os
import threading
import time
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, model_validator

TARGET_MODEL_ID = "Qwen3.5-9B"
ACTIVE_ATTENTION_TOKENS = 32768
MODEL_ID = os.getenv("MODEL_ID", TARGET_MODEL_ID)
MAX_MODEL_LEN = int(os.getenv("MAX_MODEL_LEN", str(ACTIVE_ATTENTION_TOKENS)))
MODEL_IDLE_SECONDS = int(os.getenv("MODEL_IDLE_SECONDS", "300"))
MODEL_LOAD_TIMEOUT_SECONDS = int(os.getenv("MODEL_LOAD_TIMEOUT_SECONDS", "180"))
MODEL_UNLOAD_TIMEOUT_SECONDS = int(os.getenv("MODEL_UNLOAD_TIMEOUT_SECONDS", "30"))
AUTH_SECRET_FILE = os.getenv("INFERENCE_AUTH_SECRET_FILE", "").strip()
if not 30 <= MODEL_IDLE_SECONDS <= 86_400:
    raise RuntimeError("INFERENCE_IDLE_TIMEOUT_INVALID")
if not 30 <= MODEL_LOAD_TIMEOUT_SECONDS <= 600:
    raise RuntimeError("INFERENCE_LOAD_TIMEOUT_INVALID")
if not 5 <= MODEL_UNLOAD_TIMEOUT_SECONDS <= 120:
    raise RuntimeError("INFERENCE_UNLOAD_TIMEOUT_INVALID")
app = FastAPI(title="Unsloth inference service", version="1.0.0")
model: Any = None
tokenizer: Any = None
model_lock = threading.RLock()
last_used_at = 0.0
active_requests = 0
load_task: asyncio.Task[None] | None = None
generation_lock = asyncio.Lock()

def _read_auth_secret() -> str | None:
    if not AUTH_SECRET_FILE:
        return None
    try:
        with open(AUTH_SECRET_FILE, encoding="utf-8") as secret_file:
            value = secret_file.read().strip()
    except OSError as error:
        raise RuntimeError("INFERENCE_AUTH_SECRET_UNREADABLE") from error
    if not value:
        raise RuntimeError("INFERENCE_AUTH_SECRET_EMPTY")
    return value

AUTH_SECRET = _read_auth_secret()

def _matches_schema(value: Any, schema: dict[str, Any]) -> bool:
    if isinstance(schema.get("anyOf"), list):
        return any(isinstance(option, dict) and _matches_schema(value, option) for option in schema["anyOf"])
    kind = schema.get("type")
    if isinstance(kind, list):
        return any(_matches_schema(value, {**schema, "type": option}) for option in kind)
    if kind == "object":
        if not isinstance(value, dict): return False
        required = schema.get("required", [])
        if any(key not in value for key in required): return False
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False and set(value) - set(properties): return False
        return all(_matches_schema(value[key], child) for key, child in properties.items() if key in value)
    if kind == "array": return isinstance(value, list) and all(_matches_schema(item, schema.get("items", {})) for item in value)
    if kind == "string": return isinstance(value, str) and (not schema.get("enum") or value in schema["enum"])
    if kind == "boolean": return isinstance(value, bool)
    if kind == "null": return value is None
    if kind == "integer": return isinstance(value, int) and not isinstance(value, bool)
    if kind == "number": return isinstance(value, (int, float)) and not isinstance(value, bool)
    return True

def validate_response_format(text: str, response_format: dict[str, Any] | None) -> None:
    if not response_format: return
    if response_format.get("type") != "json_schema":
        raise HTTPException(status_code=400, detail="RESPONSE_FORMAT_UNSUPPORTED")
    schema = response_format.get("json_schema", {}).get("schema")
    if not isinstance(schema, dict):
        raise HTTPException(status_code=400, detail="RESPONSE_SCHEMA_INVALID")
    try: value = json.loads(text)
    except json.JSONDecodeError as error: raise HTTPException(status_code=502, detail="MODEL_INVALID_JSON") from error
    if not _matches_schema(value, schema): raise HTTPException(status_code=502, detail="MODEL_SCHEMA_MISMATCH")

def require_auth(authorization: str | None) -> None:
    if AUTH_SECRET is None:
        return
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(token, AUTH_SECRET):
        raise HTTPException(status_code=401, detail="MODEL_AUTH_FAILED")

class CompletionRequest(BaseModel):
    model: str = Field(min_length=1, max_length=128)
    messages: list[dict[str, Any]] = Field(min_length=1, max_length=128)
    temperature: float = Field(default=0, ge=0, le=2)
    max_tokens: int = Field(default=2048, ge=1, le=MAX_MODEL_LEN)
    stream: bool = False
    response_format: dict[str, Any] | None = None

    @model_validator(mode="after")
    def validate_request_size(self) -> "CompletionRequest":
        # Keep untyped message payloads from becoming an unbounded memory or
        # prompt-injection surface while retaining OpenAI-compatible fields.
        if any(len(json.dumps(message, separators=(",", ":"))) > 32_768 for message in self.messages):
            raise ValueError("message exceeds 32768 bytes")
        if sum(len(json.dumps(message, separators=(",", ":"))) for message in self.messages) > 262_144:
            raise ValueError("messages exceed 262144 bytes")
        if self.response_format is not None and len(json.dumps(self.response_format)) > 32_768:
            raise ValueError("response_format exceeds 32768 bytes")
        return self

def load_model() -> None:
    global model, tokenizer, last_used_at
    with model_lock:
        if model is not None and tokenizer is not None:
            last_used_at = time.monotonic()
            return
    if MODEL_ID != TARGET_MODEL_ID or MAX_MODEL_LEN != ACTIVE_ATTENTION_TOKENS:
        raise RuntimeError("INFERENCE_CONFIGURATION_INVALID")
    from unsloth import FastLanguageModel
    loaded_model, loaded_tokenizer = FastLanguageModel.from_pretrained(
        model_name=MODEL_ID, max_seq_length=MAX_MODEL_LEN, load_in_4bit=True, local_files_only=True,
    )
    FastLanguageModel.for_inference(loaded_model)
    with model_lock:
        model, tokenizer = loaded_model, loaded_tokenizer
        last_used_at = time.monotonic()

def unload_model() -> None:
    global model, tokenizer, last_used_at
    with model_lock:
        if active_requests > 0:
            raise RuntimeError("MODEL_IN_USE")
        old_model, old_tokenizer = model, tokenizer
        model, tokenizer = None, None
        last_used_at = 0.0
    del old_model, old_tokenizer
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
    except ImportError:
        pass

async def ensure_model_loaded() -> None:
    global load_task
    with model_lock:
        if model is not None and tokenizer is not None:
            return
    if load_task is None or load_task.done():
        load_task = asyncio.create_task(asyncio.to_thread(load_model))
    try:
        await asyncio.wait_for(asyncio.shield(load_task), timeout=MODEL_LOAD_TIMEOUT_SECONDS)
    except asyncio.TimeoutError as error:
        raise HTTPException(status_code=503, detail="MODEL_LOAD_TIMEOUT") from error
    except Exception as error:
        # Model/weight failures are an unavailable dependency, not an
        # internal server error; a later request may retry the lazy load.
        raise HTTPException(status_code=503, detail="MODEL_LOAD_FAILED") from error

async def idle_unloader() -> None:
    while True:
        await asyncio.sleep(15)
        with model_lock:
            idle = model is not None and active_requests == 0 and last_used_at > 0 and time.monotonic() - last_used_at >= MODEL_IDLE_SECONDS
        if idle:
            try:
                await asyncio.wait_for(asyncio.to_thread(unload_model), timeout=MODEL_UNLOAD_TIMEOUT_SECONDS)
            except asyncio.TimeoutError:
                # Do not interrupt CUDA cleanup; the next health check reports the
                # still-loaded state and the loop retries safely.
                pass

@app.on_event("startup")
async def startup() -> None:
    global load_task
    # Loading is deliberately lazy so an idle service does not reserve GPU RAM.
    load_task = None
    asyncio.create_task(idle_unloader())

@app.get("/health")
def health() -> dict[str, Any]:
    with model_lock:
        loaded = model is not None and tokenizer is not None
        loading = load_task is not None and not load_task.done()
    return {"status": "ready" if loaded else "loading" if loading else "unloaded", "model": MODEL_ID,
            "model_loaded": loaded, "load_on_demand": True, "idle_unload_seconds": MODEL_IDLE_SECONDS,
            "max_context_tokens": MAX_MODEL_LEN, "active_attention_tokens": ACTIVE_ATTENTION_TOKENS}

@app.get("/ready")
def ready() -> dict[str, Any]:
    """Readiness probe: lazy loading means an unloaded process is live, not ready."""
    with model_lock:
        loaded = model is not None and tokenizer is not None
    if not loaded:
        raise HTTPException(status_code=503, detail="MODEL_NOT_READY")
    return {"status": "ready", "model": MODEL_ID, "model_loaded": True}

@app.post("/admin/model/load")
async def admin_load(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_auth(authorization)
    await ensure_model_loaded()
    return {"status": "ready", "model_loaded": True, "model": MODEL_ID}

@app.post("/admin/model/unload")
async def admin_unload(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_auth(authorization)
    with model_lock:
        if active_requests > 0:
            raise HTTPException(status_code=409, detail="MODEL_IN_USE")
        if load_task is not None and not load_task.done():
            raise HTTPException(status_code=409, detail="MODEL_LOAD_IN_PROGRESS")
    try:
        await asyncio.wait_for(asyncio.to_thread(unload_model), timeout=MODEL_UNLOAD_TIMEOUT_SECONDS)
    except RuntimeError as error:
        if str(error) == "MODEL_IN_USE":
            raise HTTPException(status_code=409, detail="MODEL_IN_USE") from error
        raise
    return {"status": "unloaded", "model_loaded": False, "model": MODEL_ID}

@app.get("/admin/model/status")
def admin_status(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_auth(authorization)
    return health()

@app.get("/v1/models")
def models(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_auth(authorization)
    return {"object": "list", "data": [{"id": MODEL_ID, "object": "model", "owned_by": "unsloth",
                                             "max_context_tokens": MAX_MODEL_LEN,
                                             "active_attention_tokens": ACTIVE_ATTENTION_TOKENS}]}

@app.post("/v1/chat/completions")
async def chat(request: CompletionRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_auth(authorization)
    global last_used_at, active_requests
    await ensure_model_loaded()
    if request.model != MODEL_ID:
        raise HTTPException(status_code=404, detail="MODEL_NOT_FOUND")
    if request.stream:
        raise HTTPException(status_code=400, detail="STREAMING_UNSUPPORTED")
    import torch
    with model_lock:
        active_model, active_tokenizer = model, tokenizer
        if active_model is None or active_tokenizer is None:
            raise HTTPException(status_code=503, detail="MODEL_UNAVAILABLE")
        active_requests += 1
        last_used_at = time.monotonic()
    try:
        async with generation_lock:
            prompt = active_tokenizer.apply_chat_template(request.messages, tokenize=False, add_generation_prompt=True)
            inputs = active_tokenizer(prompt, return_tensors="pt").to(active_model.device)
            prompt_tokens = int(inputs.input_ids.shape[1])
            if prompt_tokens >= MAX_MODEL_LEN or request.max_tokens > MAX_MODEL_LEN - prompt_tokens:
                raise HTTPException(status_code=400, detail="MODEL_CONTEXT_LIMIT")
            with torch.inference_mode():
                output = active_model.generate(**inputs, max_new_tokens=request.max_tokens, do_sample=False)
            generated = output[0][inputs.input_ids.shape[1]:]
            text = active_tokenizer.decode(generated, skip_special_tokens=True).strip()
            validate_response_format(text, request.response_format)
            return {"id": "chatcmpl-unsloth", "object": "chat.completion", "model": MODEL_ID,
                    "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": int(generated.shape[0]), "total_tokens": int(output.shape[1])}}
    finally:
        with model_lock:
            active_requests -= 1
            last_used_at = time.monotonic()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
