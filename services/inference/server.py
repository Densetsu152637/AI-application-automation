import asyncio
import gc
import os
import threading
import time
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

TARGET_MODEL_ID = "Qwen3.5-9B"
ACTIVE_ATTENTION_TOKENS = 32768
MODEL_ID = os.getenv("MODEL_ID", TARGET_MODEL_ID)
MAX_MODEL_LEN = int(os.getenv("MAX_MODEL_LEN", str(ACTIVE_ATTENTION_TOKENS)))
MODEL_IDLE_SECONDS = int(os.getenv("MODEL_IDLE_SECONDS", "300"))
MODEL_LOAD_TIMEOUT_SECONDS = int(os.getenv("MODEL_LOAD_TIMEOUT_SECONDS", "180"))
MODEL_UNLOAD_TIMEOUT_SECONDS = int(os.getenv("MODEL_UNLOAD_TIMEOUT_SECONDS", "30"))
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

class CompletionRequest(BaseModel):
    model: str
    messages: list[dict[str, Any]]
    temperature: float = 0
    max_tokens: int = 2048
    stream: bool = False
    response_format: dict[str, Any] | None = None

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
        model_name=MODEL_ID, max_seq_length=MAX_MODEL_LEN, load_in_4bit=True,
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

@app.post("/admin/model/load")
async def admin_load() -> dict[str, Any]:
    await ensure_model_loaded()
    return {"status": "ready", "model_loaded": True, "model": MODEL_ID}

@app.post("/admin/model/unload")
async def admin_unload() -> dict[str, Any]:
    with model_lock:
        if active_requests > 0:
            raise HTTPException(status_code=409, detail="MODEL_IN_USE")
    try:
        await asyncio.wait_for(asyncio.to_thread(unload_model), timeout=MODEL_UNLOAD_TIMEOUT_SECONDS)
    except RuntimeError as error:
        if str(error) == "MODEL_IN_USE":
            raise HTTPException(status_code=409, detail="MODEL_IN_USE") from error
        raise
    return {"status": "unloaded", "model_loaded": False, "model": MODEL_ID}

@app.get("/admin/model/status")
def admin_status() -> dict[str, Any]:
    return health()

@app.get("/v1/models")
def models() -> dict[str, Any]:
    return {"object": "list", "data": [{"id": MODEL_ID, "object": "model", "owned_by": "unsloth",
                                             "max_context_tokens": MAX_MODEL_LEN,
                                             "active_attention_tokens": ACTIVE_ATTENTION_TOKENS}]}

@app.post("/v1/chat/completions")
async def chat(request: CompletionRequest) -> dict[str, Any]:
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
        prompt = active_tokenizer.apply_chat_template(request.messages, tokenize=False, add_generation_prompt=True)
        inputs = active_tokenizer(prompt, return_tensors="pt").to(active_model.device)
        prompt_tokens = int(inputs.input_ids.shape[1])
        if prompt_tokens >= MAX_MODEL_LEN or request.max_tokens > MAX_MODEL_LEN - prompt_tokens:
            raise HTTPException(status_code=400, detail="MODEL_CONTEXT_LIMIT")
        with torch.inference_mode():
            output = active_model.generate(**inputs, max_new_tokens=request.max_tokens, do_sample=False)
        generated = output[0][inputs.input_ids.shape[1]:]
        text = active_tokenizer.decode(generated, skip_special_tokens=True)
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
