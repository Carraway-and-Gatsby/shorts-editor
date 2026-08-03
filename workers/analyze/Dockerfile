FROM python:3.12-slim
WORKDIR /app

COPY workers/analyze/pyproject.toml ./
COPY workers/analyze/src ./src
RUN pip install --no-cache-dir .

EXPOSE 8083
CMD ["python", "-m", "analyze_worker"]
