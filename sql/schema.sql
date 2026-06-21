-- Wind app v1 schema (Neon Postgres). Holds the fase-1 artifacts + a live cache.
-- The bias table is stored as the fitted JSON (hierarchical cells + fallback),
-- which keeps the min-cell fallback intact; the engine reads it directly.

CREATE TABLE IF NOT EXISTS locations (
  location_key TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  station      TEXT NOT NULL,
  area         TEXT NOT NULL,
  lat          DOUBLE PRECISION NOT NULL,
  lon          DOUBLE PRECISION NOT NULL
);

-- Best single speed-corrected model per location and lead (v1: no blend).
CREATE TABLE IF NOT EXISTS serving (
  location_key TEXT NOT NULL REFERENCES locations(location_key),
  lead         INT  NOT NULL,
  model_id     TEXT NOT NULL,
  model_label  TEXT NOT NULL,
  PRIMARY KEY (location_key, lead)
);

-- Speed bias correction, one fitted table per (location, model, lead).
CREATE TABLE IF NOT EXISTS bias_speed (
  location_key TEXT NOT NULL REFERENCES locations(location_key),
  model_id     TEXT NOT NULL,
  lead         INT  NOT NULL,
  model_json   JSONB NOT NULL,
  PRIMARY KEY (location_key, model_id, lead)
);

-- On-demand TTL cache of raw live forecasts, one row per (location, model).
CREATE TABLE IF NOT EXISTS forecast_cache (
  location_key TEXT NOT NULL REFERENCES locations(location_key),
  model_id     TEXT NOT NULL,
  payload      JSONB NOT NULL,           -- { time:[], speed:[], dir:[], gust:[] }
  fetched_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (location_key, model_id)
);

-- Saved routes (ordered calibrated waypoints). Optional in v1.
CREATE TABLE IF NOT EXISTS routes (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  boat_speed_kn DOUBLE PRECISION NOT NULL,
  waypoints     JSONB NOT NULL,          -- ordered ["ijmuiden","k13a",...]
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
