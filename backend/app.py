import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from psycopg2 import sql

load_dotenv(Path(__file__).parent / ".env")

from db import get_cursor  # noqa: E402

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
SCHEMA = os.getenv("DB_SCHEMA", "public")

app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="")
CORS(app, resources={r"/api/*": {"origins": "*"}})


@app.get("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")

# dummy comment
@app.get("/api/health")
def health():
    try:
        with get_cursor() as cur:
            cur.execute("SELECT version() AS version")
            return jsonify(status="ok", database=cur.fetchone()["version"])
    except Exception as exc:
        app.logger.exception("Health check failed")
        return jsonify(status="error", message=str(exc)), 500


@app.get("/api/tables")
def list_tables():
    with get_cursor() as cur:
        cur.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = %s AND table_type = 'BASE TABLE' ORDER BY table_name",
            (SCHEMA,),
        )
        return jsonify([r["table_name"] for r in cur.fetchall()])


@app.get("/api/tables/<name>")
def table_rows(name):
    limit = min(max(request.args.get("limit", 50, type=int), 1), 500)
    offset = max(request.args.get("offset", 0, type=int), 0)
    with get_cursor() as cur:
        cur.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_schema = %s AND table_name = %s",
            (SCHEMA, name),
        )
        if cur.fetchone() is None:
            return jsonify(error="Table not found"), 404
        target = sql.SQL("{}.{}").format(sql.Identifier(SCHEMA), sql.Identifier(name))
        cur.execute(sql.SQL("SELECT COUNT(*) AS n FROM {}").format(target))
        total = cur.fetchone()["n"]
        cur.execute(
            sql.SQL("SELECT * FROM {} LIMIT %s OFFSET %s").format(target), (limit, offset)
        )
        rows = cur.fetchall()
        columns = [d.name for d in cur.description]
    return jsonify(columns=columns, rows=rows, total=total, limit=limit, offset=offset)


COMBOS_FROM = """
    FROM (SELECT DISTINCT "Vendor Name" AS vendor, "Name" AS name FROM bid_items_table
          WHERE "Vendor Name" IS NOT NULL AND "Name" IS NOT NULL) b
    LEFT JOIN (SELECT "Vendor Name" AS vendor, "Mat Name" AS name,
                      MAX("Mat ID") AS mat_id,
                      (array_agg("Keywords") FILTER (WHERE "Keywords" IS NOT NULL))[1] AS keywords
               FROM material_id_table GROUP BY 1, 2) m
      ON m.vendor = b.vendor AND m.name = b.name
"""


@app.get("/api/materials/combos")
def material_combos():
    limit = min(max(request.args.get("limit", 50, type=int), 1), 500)
    offset = max(request.args.get("offset", 0, type=int), 0)
    q = request.args.get("q", "").strip()
    status = request.args.get("status", "all")
    where, params = [], []
    if q:
        where.append("(b.vendor ILIKE %s OR b.name ILIKE %s)")
        params += [f"%{q}%"] * 2
    if status == "unmapped":
        where.append("(m.mat_id IS NULL OR m.mat_id = '')")
    elif status == "mapped":
        where.append("(m.mat_id IS NOT NULL AND m.mat_id <> '')")
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    with get_cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS n {COMBOS_FROM} {clause}", params)
        total = cur.fetchone()["n"]
        cur.execute(
            f"SELECT b.vendor, b.name, m.mat_id, m.keywords {COMBOS_FROM} {clause} "
            "ORDER BY b.vendor, b.name LIMIT %s OFFSET %s",
            params + [limit, offset],
        )
        rows = cur.fetchall()
    return jsonify(rows=rows, total=total, limit=limit, offset=offset)


@app.post("/api/materials")
def save_materials():
    items = (request.get_json(silent=True) or {}).get("items")
    if not isinstance(items, list):
        return jsonify(error="'items' list required"), 400
    updated = inserted = 0
    with get_cursor() as cur:
        for it in items:
            vendor, name = it.get("vendor"), it.get("name")
            mat_id = (it.get("mat_id") or "").strip()
            if not vendor or not name or not mat_id:
                continue
            kw = [k.strip() for k in (it.get("keywords") or []) if str(k).strip()] or None
            cur.execute(
                'UPDATE material_id_table SET "Mat ID" = %s, "Keywords" = %s '
                'WHERE "Vendor Name" = %s AND "Mat Name" = %s',
                (mat_id, kw, vendor, name),
            )
            if cur.rowcount:
                updated += 1
            else:
                cur.execute(
                    'INSERT INTO material_id_table ("Vendor Name", "Mat Name", "Mat ID", "Keywords") '
                    "VALUES (%s, %s, %s, %s)",
                    (vendor, name, mat_id, kw),
                )
                inserted += 1
    return jsonify(updated=updated, inserted=inserted)


@app.errorhandler(Exception)
def handle_error(exc):
    from werkzeug.exceptions import HTTPException

    if isinstance(exc, HTTPException):
        return jsonify(error=exc.description), exc.code
    app.logger.exception("Unhandled error")
    return jsonify(error="Internal server error"), 500


if __name__ == "__main__":
    app.run(
        port=int(os.getenv("PORT", "5000")),
        debug=os.getenv("FLASK_DEBUG", "0") == "1",
    )
