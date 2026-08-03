FROM python:3.12-slim

# opencv-python-headless 런타임 의존성
RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY workers/analyze/pyproject.toml ./
COPY workers/analyze/src ./src
RUN pip install --no-cache-dir '.[stt]'

# Whisper 모델은 첫 실행 시 /models(볼륨)에 캐시된다
ENV WHISPER_MODEL=base
ENV WHISPER_CACHE=/models

EXPOSE 8083
CMD ["python", "-m", "analyze_worker"]
