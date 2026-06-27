FROM python:3.11.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# /data ist der Mountpoint des benannten Volumes für die Chat-DB (DB_PATH).
# Anlegen + an appuser übergeben, BEVOR auf den non-root-User gewechselt wird:
# Docker übernimmt die Ownership des Mountpoints aus dem Image, wenn das Volume
# frisch (leer) ist — sonst gehört /data root und appuser kann nicht schreiben.
RUN useradd -m -u 1000 appuser \
    && mkdir -p /data \
    && chown appuser:appuser /data
USER appuser

EXPOSE 4444

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4444"]
