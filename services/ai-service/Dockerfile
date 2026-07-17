FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml requirements.lock.txt ./
COPY src ./src
RUN pip install --no-cache-dir --require-hashes -r requirements.lock.txt \
    && pip install --no-cache-dir --no-deps .
EXPOSE 8000
CMD ["uvicorn", "agent_ai.main:app", "--host", "0.0.0.0", "--port", "8000"]
