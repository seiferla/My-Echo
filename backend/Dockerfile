FROM python:3.14-slim

WORKDIR /app

# Install uv package manager
COPY --from=ghcr.io/astral-sh/uv:0.13.1 /uv /uvx /bin/

COPY requirements.txt .
RUN uv pip install --system --no-cache -r requirements.txt

COPY . .

RUN useradd -m -u 1000 appuser
USER appuser

EXPOSE 4444

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4444"]
