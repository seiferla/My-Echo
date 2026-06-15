FROM python:3.11.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd -m -u 1000 appuser
USER appuser

EXPOSE 4444

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4444"]
