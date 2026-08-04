"""Getijstroom-ingestie — Fase 2: schema + idempotent wegschrijven (Neon).

Twee tabellen: ``stroom_run`` (constant per run: assen + metadata) en
``stroom_veld`` (één rij per valid_time met de u/v-velden). Payload compact:
float16 voor u/v (±0,01 m/s ruim genoeg, NaN blijft NaN), float32 voor de assen.
Schrijven is idempotent (ON CONFLICT DO NOTHING op de unique-keys) zodat een
herdraai van dezelfde run niets dupliceert.

DB-toegang: psycopg (v3) direct naar Neon via DATABASE_URL. Dit draait straks in
een GitHub Action; lokaal valt het terug op windapp/.env.local.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import psycopg

from .stroom import SOURCE, StroomField

log = logging.getLogger("wm.stroom_db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS stroom_run (
  id            SERIAL PRIMARY KEY,
  box_id        TEXT NOT NULL,
  source        TEXT NOT NULL,
  analysis_time TIMESTAMPTZ NOT NULL,          -- modelrun, UTC
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  nx            INT NOT NULL,
  ny            INT NOT NULL,
  lat           BYTEA NOT NULL,                -- float32[ny]
  lon           BYTEA NOT NULL,                -- float32[nx]
  UNIQUE (box_id, source, analysis_time)
);

CREATE TABLE IF NOT EXISTS stroom_veld (
  id         SERIAL PRIMARY KEY,
  run_id     INT NOT NULL REFERENCES stroom_run(id) ON DELETE CASCADE,
  valid_time TIMESTAMPTZ NOT NULL,             -- UTC
  u          BYTEA NOT NULL,                   -- float16[ny*nx], row-major, NaN behouden
  v          BYTEA NOT NULL,
  UNIQUE (run_id, valid_time)
);
CREATE INDEX IF NOT EXISTS stroom_veld_time ON stroom_veld (valid_time);

-- Grid-definitie per box, LOS van de runs: de forecast-runs eronder worden door
-- retentie (Fase 3a) opgeruimd, maar de hindcast (spoor 2) heeft hun assen nodig
-- om te georefereren. Eén keer per box gevuld bij de eerste ingestie.
CREATE TABLE IF NOT EXISTS stroom_box_grid (
  box_id TEXT PRIMARY KEY,
  nx     INT NOT NULL,
  ny     INT NOT NULL,
  lat    BYTEA NOT NULL,                       -- float32[ny]
  lon    BYTEA NOT NULL                        -- float32[nx]
);

-- Continue uurreeks (grondstof spoor 2 / latere harmonische analyse). Uit elke
-- run alleen de kortste leads (0/1/2 u); met 3-uurlijkse runs dekt dat elk uur
-- precies één keer. Blijft staan als de forecast-runs worden opgeruimd; geen
-- retentiegrens in deze fase (mag groeien).
CREATE TABLE IF NOT EXISTS stroom_hindcast (
  id              SERIAL PRIMARY KEY,
  box_id          TEXT NOT NULL REFERENCES stroom_box_grid(box_id),
  valid_time      TIMESTAMPTZ NOT NULL,        -- UTC
  source_analysis TIMESTAMPTZ NOT NULL,        -- herkomst-run (provenance)
  lead_h          SMALLINT NOT NULL,           -- 0/1/2
  u               BYTEA NOT NULL,              -- float16[ny*nx], NaN behouden
  v               BYTEA NOT NULL,
  UNIQUE (box_id, valid_time)                  -- kortste-lead-wint bij herinlezen
);
CREATE INDEX IF NOT EXISTS stroom_hindcast_time ON stroom_hindcast (box_id, valid_time);
"""


# --- pack/unpack ---------------------------------------------------------
def _f32(a: np.ndarray) -> bytes:
    return np.ascontiguousarray(a, dtype="<f4").tobytes()


def _f16(a: np.ndarray) -> bytes:
    return np.ascontiguousarray(a, dtype="<f2").tobytes()


def unpack_axis(buf: bytes, n: int) -> np.ndarray:
    return np.frombuffer(buf, dtype="<f4", count=n).astype(np.float32)


def unpack_field(buf: bytes, ny: int, nx: int) -> np.ndarray:
    """float16-bytea -> (ny, nx) float32, NaN intact, row-major."""
    return np.frombuffer(buf, dtype="<f2", count=ny * nx).reshape(ny, nx).astype(np.float32)


# --- connection ----------------------------------------------------------
def _database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    # lokale dev-fallback: lees windapp/.env.local (deze package woont in windapp/ingest/)
    env = Path(__file__).resolve().parent.parent / ".env.local"
    if env.exists():
        for line in env.read_text().splitlines():
            m = re.match(r"\s*DATABASE_URL\s*=\s*(.+?)\s*$", line)
            if m:
                return m.group(1).strip().strip('"').strip("'")
    raise RuntimeError("DATABASE_URL niet gezet (en niet in windapp/.env.local gevonden).")


def connect() -> psycopg.Connection:
    return psycopg.connect(_database_url())


def ensure_schema(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(SCHEMA)
    conn.commit()


# --- write ---------------------------------------------------------------
def ingest(field: StroomField, conn: psycopg.Connection | None = None) -> dict:
    """Schrijf één run + z'n velden idempotent weg. Retourneert telling."""
    own = conn is None
    conn = conn or connect()
    try:
        ensure_schema(conn)
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO stroom_run (box_id, source, analysis_time, nx, ny, lat, lon)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (box_id, source, analysis_time) DO NOTHING
                   RETURNING id""",
                (field.box_id, field.source, field.analysis_time, field.nx, field.ny,
                 _f32(field.lat), _f32(field.lon)),
            )
            row = cur.fetchone()
            run_inserted = row is not None
            if row is None:                       # run bestond al -> id ophalen
                cur.execute(
                    "SELECT id FROM stroom_run WHERE box_id=%s AND source=%s AND analysis_time=%s",
                    (field.box_id, field.source, field.analysis_time))
                row = cur.fetchone()
            run_id = row[0]

            rows = [(run_id, vt, _f16(field.u[i]), _f16(field.v[i]))
                    for i, vt in enumerate(field.valid_times)]
            cur.executemany(
                """INSERT INTO stroom_veld (run_id, valid_time, u, v)
                   VALUES (%s,%s,%s,%s)
                   ON CONFLICT (run_id, valid_time) DO NOTHING""", rows)
            fields_inserted = cur.rowcount if (cur.rowcount and cur.rowcount > 0) else 0
        conn.commit()
    finally:
        if own:
            conn.close()

    out = {"run_id": run_id, "run_inserted": run_inserted,
           "fields_inserted": fields_inserted, "fields_total": len(field.valid_times)}
    log.info("ingest %s anal=%s -> run_id=%d (%s) velden +%d/%d",
             field.box_id, field.analysis_time.strftime("%Y-%m-%d %H:%MZ"), run_id,
             "nieuw" if run_inserted else "bestond", fields_inserted, len(field.valid_times))
    return out


# --- Fase 3a: box-grid + retentie ----------------------------------------
def upsert_box_grid(field: StroomField, conn: psycopg.Connection | None = None) -> None:
    """Grid-referentie per box vastleggen (los van runs). Idempotent; ververst
    de assen als de boxconfig ooit verandert."""
    own = conn is None
    conn = conn or connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO stroom_box_grid (box_id, nx, ny, lat, lon)
                   VALUES (%s,%s,%s,%s,%s)
                   ON CONFLICT (box_id) DO UPDATE SET
                     nx=EXCLUDED.nx, ny=EXCLUDED.ny, lat=EXCLUDED.lat, lon=EXCLUDED.lon""",
                (field.box_id, field.nx, field.ny, _f32(field.lat), _f32(field.lon)))
        conn.commit()
    finally:
        if own:
            conn.close()


def prune_runs(box_id: str, keep: int = 3, conn: psycopg.Connection | None = None) -> int:
    """Retentie spoor 1: houd per box alleen de `keep` nieuwste analysetijden;
    verwijder de rest (cascade ruimt stroom_veld). Raakt de hindcast NIET."""
    own = conn is None
    conn = conn or connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """DELETE FROM stroom_run
                   WHERE box_id = %s AND analysis_time NOT IN (
                     SELECT analysis_time FROM stroom_run
                     WHERE box_id = %s ORDER BY analysis_time DESC LIMIT %s)""",
                (box_id, box_id, keep))
            n = cur.rowcount
        conn.commit()
    finally:
        if own:
            conn.close()
    if n:
        log.info("retentie %s: %d oude run(s) opgeruimd (houd laatste %d)", box_id, n, keep)
    return n


def processed_analysis_times(conn: psycopg.Connection, box_id: str) -> set[datetime]:
    """Alle al-verwerkte analysetijden (UTC): zowel de bewaarde forecast-runs
    (stroom_run) als de hindcast-only runs (via source_analysis). Zonder de
    hindcast-tak zouden niet-bewaarde runs elke cyclus opnieuw opgehaald worden."""
    with conn.cursor() as cur:
        cur.execute(
            """SELECT analysis_time FROM stroom_run WHERE box_id = %s
               UNION
               SELECT DISTINCT source_analysis FROM stroom_hindcast WHERE box_id = %s""",
            (box_id, box_id))
        return {r[0].astimezone(timezone.utc) for r in cur.fetchall()}


def newest_analysis_time(conn: psycopg.Connection, box_id: str) -> datetime | None:
    with conn.cursor() as cur:
        cur.execute("SELECT max(analysis_time) FROM stroom_run WHERE box_id = %s", (box_id,))
        r = cur.fetchone()[0]
    return r.astimezone(timezone.utc) if r else None


# --- Fase 3b: hindcast-historie ------------------------------------------
def write_hindcast(field: StroomField, leads=(0, 1, 2),
                   conn: psycopg.Connection | None = None) -> int:
    """Schrijf de kortste-lead-slices (valid_time = analysis_time + 0/1/2 u) naar
    stroom_hindcast, kortste-lead-wint op (box_id, valid_time). Blijft staan als
    de forecast-runs worden opgeruimd."""
    own = conn is None
    conn = conn or connect()
    idx = {vt: i for i, vt in enumerate(field.valid_times)}
    written = 0
    try:
        with conn.cursor() as cur:
            for lead in leads:
                vt = field.analysis_time + timedelta(hours=lead)
                i = idx.get(vt)
                if i is None:
                    log.warning("hindcast %s: lead %du (valid %s) ontbreekt in run",
                                field.box_id, lead, vt.strftime("%Y-%m-%d %H:%MZ"))
                    continue
                cur.execute(
                    """INSERT INTO stroom_hindcast
                         (box_id, valid_time, source_analysis, lead_h, u, v)
                       VALUES (%s,%s,%s,%s,%s,%s)
                       ON CONFLICT (box_id, valid_time) DO UPDATE SET
                         source_analysis = EXCLUDED.source_analysis,
                         lead_h = EXCLUDED.lead_h, u = EXCLUDED.u, v = EXCLUDED.v
                       WHERE stroom_hindcast.lead_h > EXCLUDED.lead_h""",
                    (field.box_id, vt, field.analysis_time, lead,
                     _f16(field.u[i]), _f16(field.v[i])))
                written += cur.rowcount
        conn.commit()
    finally:
        if own:
            conn.close()
    log.info("hindcast %s: %d slice(s) bijgewerkt (leads %s)", field.box_id, written,
             ",".join(map(str, leads)))
    return written


def hindcast_at(box_id: str, valid_time: datetime, conn: psycopg.Connection | None = None):
    """Eén hindcast-uur teruglezen (voor verificatie / latere analyse)."""
    own = conn is None
    conn = conn or connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT h.source_analysis, h.lead_h, g.nx, g.ny, g.lat, g.lon, h.u, h.v
                   FROM stroom_hindcast h JOIN stroom_box_grid g ON h.box_id = g.box_id
                   WHERE h.box_id = %s AND h.valid_time = %s""",
                (box_id, valid_time.astimezone(timezone.utc)))
            row = cur.fetchone()
    finally:
        if own:
            conn.close()
    if row is None:
        return None
    sa, lead, nx, ny, lat, lon, u, v = row
    return {"source_analysis": sa, "lead_h": lead, "nx": nx, "ny": ny,
            "lat": unpack_axis(lat, ny), "lon": unpack_axis(lon, nx),
            "u": unpack_field(u, ny, nx), "v": unpack_field(v, ny, nx)}


# --- read (latest-wins) — voor verificatie + Fase 4 ----------------------
def read_field(box_id: str, valid_time: datetime, conn: psycopg.Connection | None = None):
    """Reconstrueer het u/v-grid voor (box, valid_time) uit de meest recente
    analysis_time die dat tijdstip dekt. None als niets dekt."""
    own = conn is None
    conn = conn or connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT r.analysis_time, r.nx, r.ny, r.lat, r.lon, f.u, f.v
                   FROM stroom_veld f JOIN stroom_run r ON f.run_id = r.id
                   WHERE r.box_id=%s AND r.source=%s AND f.valid_time=%s
                   ORDER BY r.analysis_time DESC LIMIT 1""",
                (box_id, SOURCE, valid_time.astimezone(timezone.utc)))
            row = cur.fetchone()
    finally:
        if own:
            conn.close()
    if row is None:
        return None
    anal, nx, ny, lat, lon, u, v = row
    return {
        "analysis_time": anal, "nx": nx, "ny": ny,
        "lat": unpack_axis(lat, ny), "lon": unpack_axis(lon, nx),
        "u": unpack_field(u, ny, nx), "v": unpack_field(v, ny, nx),
    }


# --- Puntreeksen (Stap 3): forecast-stroom op de route-samplepunten -------
# De grids verhuizen naar R2; Neon houdt alleen de dichtstbijzijnde-cel-waarden per
# samplepunt. NaN -> NULL (nooit nul). Retentie: laatste 3 analysis_times per box.
PUNT_SCHEMA = """
CREATE TABLE IF NOT EXISTS stroom_punt_forecast (
  route_id      TEXT NOT NULL REFERENCES netwerk_routes(id) ON DELETE CASCADE,
  volgnr        INT  NOT NULL,
  box_id        TEXT NOT NULL,                 -- herkomst-tegel (deterministische keuzeregel)
  analysis_time TIMESTAMPTZ NOT NULL,
  valid_time    TIMESTAMPTZ NOT NULL,
  u REAL, v REAL,                              -- m/s; NULL = droog/ontbrekend, nooit nul
  PRIMARY KEY (route_id, volgnr, analysis_time, valid_time)
);
CREATE INDEX IF NOT EXISTS stroom_punt_fc_lookup ON stroom_punt_forecast (route_id, valid_time);
"""


def ensure_punt_schema(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(PUNT_SCHEMA)
    conn.commit()


def write_punt_forecast(conn: psycopg.Connection, analysis_time: datetime, rows) -> int:
    """rows: (route_id, volgnr, box_id, valid_time, u, v). Idempotent upsert op de
    volledige sleutel."""
    data = [(r[0], r[1], r[2], analysis_time, r[3], r[4], r[5]) for r in rows]
    if not data:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO stroom_punt_forecast
                 (route_id, volgnr, box_id, analysis_time, valid_time, u, v)
               VALUES (%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (route_id, volgnr, analysis_time, valid_time) DO UPDATE
                 SET box_id = EXCLUDED.box_id, u = EXCLUDED.u, v = EXCLUDED.v""", data)
    conn.commit()
    return len(data)


def prune_punt_forecast(conn: psycopg.Connection, box_id: str, keep: int = 3) -> int:
    """Verwijder analysis_times ouder dan de laatste `keep` per box (spiegelt de
    forecast-grid-retentie in R2)."""
    with conn.cursor() as cur:
        cur.execute(
            """DELETE FROM stroom_punt_forecast
               WHERE box_id = %s AND analysis_time NOT IN (
                 SELECT DISTINCT analysis_time FROM stroom_punt_forecast
                 WHERE box_id = %s ORDER BY analysis_time DESC LIMIT %s)""",
            (box_id, box_id, keep))
        n = cur.rowcount
    conn.commit()
    return n


# --- Bookkeeping: verwerkte analysetijden (permanent geheugen) ------------
# De grids verhuizen naar R2 en de oude gridtabellen worden straks geleegd; dit log
# maakt expliciet wat zij impliciet bijhielden — welke runs al verwerkt zijn — zodat
# de cron ze niet elk uur opnieuw ophaalt. GEEN retentie: dit mag groeien (paar regels
# per dag per box).
RUN_LOG_SCHEMA = """
CREATE TABLE IF NOT EXISTS stroom_run_log (
  box_id        TEXT NOT NULL,
  analysis_time TIMESTAMPTZ NOT NULL,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (box_id, analysis_time)
);
"""


def ensure_run_log(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(RUN_LOG_SCHEMA)
    conn.commit()


def log_run(conn: psycopg.Connection, box_id: str, analysis_time: datetime) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO stroom_run_log (box_id, analysis_time) VALUES (%s,%s) "
            "ON CONFLICT (box_id, analysis_time) DO NOTHING",
            (box_id, analysis_time))
    conn.commit()


def logged_analysis_times(conn: psycopg.Connection, box_id: str) -> set[datetime]:
    with conn.cursor() as cur:
        cur.execute("SELECT analysis_time FROM stroom_run_log WHERE box_id = %s", (box_id,))
        return {r[0].astimezone(timezone.utc) for r in cur.fetchall()}
