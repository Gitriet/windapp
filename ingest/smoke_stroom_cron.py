"""Smoke test — stroom_cron.run_cycle control flow (vier scenario's).

Draai met:  python -m ingest.smoke_stroom_cron

Alle externe afhankelijkheden (Matroos, R2, Neon) worden gemockt; de tests
raken geen echte infrastructuur. Ze verificeren uitsluitend de control flow
van run_cycle — welke boxes worden gelogd bij welk faalpatroon.

Scenario 1 — Normale cyclus: alle boxes verwerkt → alle boxes gelogd.
Scenario 2 — Finalize crasht halverwege: de box waarvan finalize faalt blijft
             ongelogd; de volgende cyclus haalt hem op (idempotentie).
Scenario 3 — Idempotente redo: tweede run met zelfde analysetijden geeft geen
             dubbele log_run-aanroepen (want done=[] als al gelogd).
Scenario 4 — Timeout/abort halverwege boxlijst: boxes vóór het afbreekpunt
             zijn wél gelogd; dit dekt het gat in de twee-lus-structuur.
"""
from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, call, patch

# Stabiele tijdstippen voor tests
AT1 = datetime(2026, 8, 1,  6, tzinfo=timezone.utc)
AT2 = datetime(2026, 8, 1,  9, tzinfo=timezone.utc)
AT3 = datetime(2026, 8, 1, 12, tzinfo=timezone.utc)


def _noop_conn():
    """Minimale DB-connectie stub."""
    conn = MagicMock()
    conn.__enter__ = lambda s: s
    conn.__exit__ = MagicMock(return_value=False)
    return conn


class _Base(unittest.TestCase):
    """Patchcontext die alle buitenste afhankelijkheden van run_cycle neutraliseert."""

    def setUp(self):
        # --- storage stub ---------------------------------------------------
        self.st = MagicMock()
        self.st.list_keys.return_value = []
        self.st.exists.return_value = False

        # --- DB stub --------------------------------------------------------
        self.conn = _noop_conn()
        self.logged: list[tuple] = []   # (box_id, analysis_time) paren

        def _log_run(conn, box_id, at):
            self.logged.append((box_id, at))

        self.db_patcher = patch.multiple(
            "ingest.stroom_cron.DB",
            connect=MagicMock(return_value=self.conn),
            ensure_schema=MagicMock(),
            ensure_punt_schema=MagicMock(),
            ensure_run_log=MagicMock(),
            log_run=MagicMock(side_effect=_log_run),
            prune_punt_forecast=MagicMock(),
        )
        self.db_patcher.start()

        self.pu_patcher = patch("ingest.stroom_cron.PU.load_samplepunten",
                                return_value=[])
        self.pu_patcher.start()

        self.st_patcher = patch("ingest.stroom_cron.storage",
                                return_value=self.st)
        self.st_patcher.start()

    def tearDown(self):
        self.db_patcher.stop()
        self.pu_patcher.stop()
        self.st_patcher.stop()

    def _run_with_boxes(self, box_results: dict, finalize_side_effect=None):
        """
        box_results: {box_id: (rc, hc_rows, done_list)}
        Roept run_cycle aan met gemockte run_box en optionele finalize fout.
        Geeft de gerapporteerde (box_id, at)-paren uit logged terug.
        """
        from ingest import stroom_cron as C

        def fake_run_box(box_id, samplepunten, st, keep, stale_h, lookback_h, leads, now):
            result = box_results.get(box_id)
            if result is None:
                raise AssertionError(f"onverwachte box in test: {box_id!r}")
            return result

        fin_mock = MagicMock(side_effect=finalize_side_effect)
        with patch("ingest.stroom_cron.run_box", side_effect=fake_run_box), \
             patch("ingest.stroom_cron.finalize_hindcast_punten", fin_mock):
            boxes = list(box_results.keys())
            C.run_cycle(boxes)

        return list(self.logged)


# ---------------------------------------------------------------------------
# Scenario 1 — Normale cyclus
# ---------------------------------------------------------------------------
class TestScenario1Normaal(_Base):
    def test_alle_boxes_gelogd(self):
        hc = [("r1", 1, "box-a", AT1, 0.1, 0.2)]
        resultaten = {
            "box-a": (0, hc, [AT1, AT2]),
            "box-b": (0, [],  [AT3]),
            "box-c": (0, [],  []),       # geen nieuwe runs
        }
        gelogd = self._run_with_boxes(resultaten)
        self.assertIn(("box-a", AT1), gelogd)
        self.assertIn(("box-a", AT2), gelogd)
        self.assertIn(("box-b", AT3), gelogd)
        # box-c: done=[] → niets te loggen
        self.assertFalse(any(b == "box-c" for b, _ in gelogd))


# ---------------------------------------------------------------------------
# Scenario 2 — Finalize crasht halverwege
# ---------------------------------------------------------------------------
class TestScenario2FinalizeCrash(_Base):
    def test_crash_box_ongelogd_volgende_cyclus_haalt_op(self):
        hc_a = [("r1", 1, "box-a", AT1, 0.1, 0.2)]
        hc_b = [("r1", 2, "box-b", AT2, 0.3, 0.4)]

        crash_calls = {"count": 0}

        def finalize_met_crash(st, rows):
            crash_calls["count"] += 1
            if crash_calls["count"] == 1:
                raise RuntimeError("R2 write timeout (gesimuleerd)")
            # tweede en verdere aanroepen slagen gewoon

        resultaten = {
            "box-a": (0, hc_a, [AT1]),
            "box-b": (0, hc_b, [AT2]),
        }
        # Cyclus 1: finalize van box-a crasht → exception propageert vóórdat box-b
        # bereikt wordt, dus zijn noch box-a noch box-b gelogd.
        with self.assertRaises(RuntimeError):
            self._run_with_boxes(resultaten, finalize_side_effect=finalize_met_crash)

        gelogd_c1 = list(self.logged)
        self.assertNotIn(("box-a", AT1), gelogd_c1, "box-a niet gelogd na crash")
        self.assertNotIn(("box-b", AT2), gelogd_c1,
                         "box-b ook niet: exception propageerde vóór box-b bereikt werd")

        # Cyclus 2: beide opnieuw aangeboden; finalize slaagt nu (count≥2).
        self._run_with_boxes(resultaten, finalize_side_effect=finalize_met_crash)
        self.assertIn(("box-a", AT1), self.logged, "box-a gelogd in cyclus 2")
        self.assertIn(("box-b", AT2), self.logged, "box-b gelogd in cyclus 2")


# ---------------------------------------------------------------------------
# Scenario 3 — Idempotente redo
# ---------------------------------------------------------------------------
class TestScenario3Idempotent(_Base):
    def test_geen_dubbele_log_run_bij_redo(self):
        resultaten = {
            "box-a": (0, [], [AT1, AT2]),
        }
        # Cyclus 1
        self._run_with_boxes(resultaten)
        na_cyclus1 = list(self.logged)

        # Cyclus 2: zelfde box maar done=[] (al gelogd door run_box zelf — in productie
        # retourneert run_box een lege done-lijst als alle analysetijden al in run_log staan)
        resultaten_c2 = {"box-a": (0, [], [])}
        self._run_with_boxes(resultaten_c2)
        na_cyclus2 = list(self.logged)

        # Geen nieuwe entries na cyclus 2
        self.assertEqual(na_cyclus1, na_cyclus2[:len(na_cyclus1)])
        self.assertEqual(len(na_cyclus2), len(na_cyclus1),
                         "geen extra log_run-calls bij redo met lege done-lijst")


# ---------------------------------------------------------------------------
# Scenario 4 — Timeout/abort halverwege boxlijst
# ---------------------------------------------------------------------------
class TestScenario4TimeoutHalverwege(_Base):
    """
    Simuleert een GitHub-timeout die de process halverwege de boxlijst doodt.
    Concreet: run_box van box-b gooit KeyboardInterrupt (analoog aan SIGKILL
    vanuit een job-timeout). Alle boxes vóór box-b moeten wél gelogd zijn.

    Dit is het gat in de twee-lus-structuur (02cdd7b): met twee aparte lussen
    bereikt loop 2 (finalize+log) nooit de al-voltooide boxes. Met de
    samengevoegde lus is elke box al gefinalized+gelogd vóórdat de volgende
    box wordt gestart.
    """

    def test_boxes_voor_afbreekpunt_gelogd(self):
        abort_called = {"flag": False}

        def fake_run_box(box_id, samplepunten, st, keep, stale_h, lookback_h, leads, now):
            if box_id == "box-b":
                abort_called["flag"] = True
                raise KeyboardInterrupt("gesimuleerde GitHub-timeout")
            if box_id == "box-a":
                return (0, [], [AT1, AT2])
            return (0, [], [])

        from ingest import stroom_cron as C
        fin_mock = MagicMock()
        with patch("ingest.stroom_cron.run_box", side_effect=fake_run_box), \
             patch("ingest.stroom_cron.finalize_hindcast_punten", fin_mock):
            try:
                C.run_cycle(["box-a", "box-b", "box-c"])
            except KeyboardInterrupt:
                pass  # verwacht: timeout doodt het proces

        self.assertTrue(abort_called["flag"], "box-b moet geprobeerd zijn")

        # box-a: vóór het afbreekpunt → gelogd ✓
        self.assertIn(("box-a", AT1), self.logged,
                      "box-a AT1 moet gelogd zijn ondanks timeout bij box-b")
        self.assertIn(("box-a", AT2), self.logged,
                      "box-a AT2 moet gelogd zijn ondanks timeout bij box-b")

        # box-b en box-c: na/op het afbreekpunt → ongelogd
        self.assertFalse(any(b == "box-b" for b, _ in self.logged),
                         "box-b mag niet gelogd zijn (abort vóór return)")
        self.assertFalse(any(b == "box-c" for b, _ in self.logged),
                         "box-c mag niet gelogd zijn (nooit bereikt)")

    def test_volgende_cyclus_pikt_afgebroken_boxes_op(self):
        """Na een abort haalt de volgende cyclus de onvoltooide boxes op."""

        def fake_run_box_c1(box_id, samplepunten, st, keep, stale_h, lookback_h, leads, now):
            if box_id == "box-b":
                raise KeyboardInterrupt("timeout")
            return (0, [], [AT1]) if box_id == "box-a" else (0, [], [])

        def fake_run_box_c2(box_id, samplepunten, st, keep, stale_h, lookback_h, leads, now):
            # box-a: al gelogd → done=[]
            # box-b: opnieuw aangeboden → succesvol
            return (0, [], [AT2]) if box_id == "box-b" else (0, [], [])

        from ingest import stroom_cron as C
        fin = MagicMock()

        with patch("ingest.stroom_cron.run_box", side_effect=fake_run_box_c1), \
             patch("ingest.stroom_cron.finalize_hindcast_punten", fin):
            try:
                C.run_cycle(["box-a", "box-b"])
            except KeyboardInterrupt:
                pass

        na_c1 = list(self.logged)
        self.assertIn(("box-a", AT1), na_c1)
        self.assertNotIn(("box-b", AT2), na_c1)

        with patch("ingest.stroom_cron.run_box", side_effect=fake_run_box_c2), \
             patch("ingest.stroom_cron.finalize_hindcast_punten", fin):
            C.run_cycle(["box-a", "box-b"])

        self.assertIn(("box-b", AT2), self.logged,
                      "box-b moet in cyclus 2 gelogd worden na eerdere abort")


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    suite = unittest.TestLoader().loadTestsFromModule(sys.modules[__name__])
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
