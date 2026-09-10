FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip git && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin inference
COPY requirements.txt /tmp/requirements.txt
RUN python3 -m pip install --upgrade pip && python3 -m pip install -r /tmp/requirements.txt
WORKDIR /app
COPY server.py /app/server.py
RUN mkdir -p /home/inference/.cache/huggingface && chown -R 10001:10001 /app /home/inference
ENV HOME=/home/inference HF_HOME=/home/inference/.cache/huggingface
EXPOSE 8000
CMD ["python3", "server.py"]
