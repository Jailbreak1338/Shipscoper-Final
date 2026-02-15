# Vessel Watchlist — Benutzerhandbuch

## Was ist die Watchlist?

Mit der Watchlist kannst du einzelne Vessels beobachten und wirst automatisch
per E-Mail benachrichtigt, wenn sich deren ETA (Estimated Time of Arrival) ändert.

---

## Vessel hinzufügen

1. Öffne `/watchlist` in der Web-App
2. Gib den Vessel-Namen ein (z.B. `EVER GIVEN`)
3. Optional: Sendungsnummer eingeben (z.B. `S00123456`)
4. Klicke **Hinzufügen**

Die aktuelle ETA wird automatisch aus der Datenbank geholt und gespeichert.

---

## Watchlist verwalten

| Aktion | Beschreibung |
|--------|-------------|
| **Aktiv/Aus** | Benachrichtigungen ein-/ausschalten (pro Vessel) |
| **Entfernen** | Vessel von der Watchlist löschen |

---

## ETA-Benachrichtigungen

Wenn der Scraper läuft (3x täglich: 06:00, 12:00, 18:00 UTC) und eine
ETA-Änderung erkannt wird:

1. Ein Eintrag in `eta_change_notifications` wird erstellt
2. Eine E-Mail wird an deine registrierte Adresse gesendet
3. Die Watchlist zeigt die neue ETA automatisch an

### E-Mail-Inhalt

- Vessel-Name
- Sendungsnummer (falls vorhanden)
- Alte ETA vs. Neue ETA
- Verzögerung in Tagen (+3 Tage / -1 Tag)

---

## Tipps

- **Vessel-Name muss mit der Datenbank übereinstimmen.** Schreibweise wie in
  der Segelliste verwenden (z.B. `MSC ISABELLA`, nicht `msc isabella`).
  Fuzzy-Matching normalisiert Groß-/Kleinschreibung und Leerzeichen.
- **Mehrere Einträge pro Vessel** sind möglich, wenn verschiedene Sendungsnummern
  hinterlegt werden.
- **Benachrichtigungen deaktivieren**, wenn du temporär keine E-Mails möchtest,
  aber das Vessel weiter beobachten willst.
