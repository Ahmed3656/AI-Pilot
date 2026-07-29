FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=10
WORKDIR /app
COPY pyproject.toml requirements.lock.txt ./
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --require-hashes -r requirements.lock.txt \
    && pip install --no-deps .
EXPOSE 8000
CMD ["uvicorn", "agent_ai.main:app", "--host", "0.0.0.0", "--port", "8000"]
