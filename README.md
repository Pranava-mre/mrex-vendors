# MREX Vendors

Flask API (`backend/`) + static UI (`frontend/`) backed by Azure PostgreSQL.

## Setup (PowerShell)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env   # then fill in your Azure credentials
python app.py
```

Open http://localhost:5000.

Azure notes: allow your client IP in the server's networking/firewall rules; SSL is required (`DB_SSLMODE=require`).
