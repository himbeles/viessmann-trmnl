# Viessmann Wärmepumpe für TRMNL X

Fortsetzung des bisherigen Platzhalter-Plugins. Bekanntes Innengerät: **IDU-A Modular AWMIW.A1.19-V051**, Geräte-ID in ViCare: **1**. Die API-Geräte-ID muss mit der API-Geräteliste abgeglichen werden. Die Geräteseriennummer aus ViCare ist nicht automatisch die Gateway-Seriennummer.

## Enthalten

- Heizung/Vorlauf, Warmwasserspeicher und Außentemperatur mit großen Ziffern.
- Heizkurven-Neigung und Niveau sowie die konfigurierte Betriebsart. Die Betriebsart sagt nicht, ob der Verdichter gerade läuft.
- Einfache lineare Kurvendarstellung, ausdrücklich als Schema gekennzeichnet. **Keine berechneten Viessmann-Sollwerte.**
- Anzeige fehlender, deaktivierter oder fehlerhafter Sensorwerte als Gedankenstrich; Nullwerte bleiben erhalten.
- Kennzeichnung alter Daten anhand des ältesten verwendeten API-Zeitstempels, standardmäßig nach 120 Minuten. Zeitangaben in UTC.
- Vier Layouts: Vollbild mit Kurve, drei kompakte Mashup-Layouts ohne Kurve.
- Alle Sensor-Feature-Namen und der Heizkreis sind konfigurierbar.

## 1. Layout importieren

In TRMNL → Plugins → Private Plugin → **Import new** die Datei `viessmann-trmnl-import.zip` wählen. Sie enthält ausschließlich die fünf flachen Importdateien. Standardmäßig bleibt das Plugin statisch und zeigt **Noch nicht verbunden**, keine erfundenen Messwerte.

`preview.html` lässt sich direkt im Browser öffnen, ohne Installation. Die zwei Ansichten zeigen ausdrücklich markierte Beispieldaten und den Zustand ohne Verbindung. In TRMNL selbst kannst du `demo-data.json` als Static Data einfügen. Vor der Live-Verbindung wieder entfernen.

Der komplette Quellcode und die Anleitung liegen in `viessmann-trmnl-source.zip`. Das ist kein TRMNL-Importarchiv.

## 2. OAuth direkt in TRMNL einrichten

Eine eigene Viessmann-Client-ID ist laut bisherigem Chat bereits vorhanden. Entwicklerfunktionen in TRMNL werden für private Plugins benötigt.

1. Im importierten Plugin **Enable OAuth Authentication** aktivieren und manuell konfigurieren.
2. Die **im eigenen TRMNL-Plugin angezeigte OAuth Redirect URL** exakt in der Viessmann-Entwickleranwendung hinterlegen. Keine Callback-Adresse aus Beispielen übernehmen.
3. Client-ID ausschließlich im TRMNL-OAuth-Einstellungsfeld eintragen. Nicht in Markup oder Static Data speichern. Für eine als öffentlicher PKCE-Client registrierte Anwendung bleibt das Client Secret leer.
4. Folgende Einstellungen verwenden; mit der aktuellen Dokumentation der eigenen Viessmann-Anwendung abgleichen:

| TRMNL-Feld | Wert |
|---|---|
| Authorization URL | `https://iam.viessmann-climatesolutions.com/idp/v3/authorize` |
| Token URL | `https://iam.viessmann-climatesolutions.com/idp/v3/token` |
| Scopes | `IoT User offline_access` |
| PKCE | Ja, S256 |
| Scope Separator | Leerzeichen |
| Token Auth Method | body |
| Token Body Format | form |
| Refresh URL | Token URL bzw. leer für Standard |
| Token Field Name | access_token |
| Expiry Field Name / Strategy | expires_in / expireIn |

5. Über TRMNL verbinden und im Viessmann-Fenster selbst autorisieren. Tokens bleiben in TRMNL. Kein Token muss in diesen Chat kopiert werden.

TRMNL unterstützt diese OAuth-Funktionen. Der konkrete Viessmann-Login und die automatische Erneuerung wurden ohne Kontozugriff noch nicht Ende-zu-Ende geprüft. Falls kein Refresh-Token zurückkommt, Scopes und Client-Typ prüfen. Bei Redirect-Fehlern die exakt angezeigte URI vergleichen.

## 3. Installation, Gateway und API-Gerät ermitteln

Eine erste Abfrage mit einem gültigen OAuth-Access-Token:

```text
GET https://api.viessmann-climatesolutions.com/iot/v2/equipment/installations?includeGateways=true
Authorization: Bearer <Access-Token>
```

Aus der Antwort werden `data[].id`, `data[].gateways[].serial` und `data[].gateways[].devices[].id` benötigt. Modellkennung und Geräte-ID abgleichen; **nicht pauschal Gerät 0 verwenden**. Die ViCare-ID 1 ist hier lediglich der erste Kandidat.

Die folgende Abfrage liefert die Features dieses Geräts:

```text
GET https://api.viessmann-climatesolutions.com/iot/v2/features/installations/INSTALLATION/gateways/GATEWAY/devices/DEVICE/features/
Authorization: Bearer <Access-Token>
```

Als optionales Hilfsmittel liegt `inspect_api.py` bei. Es fragt das Access-Token verdeckt ab, ruft nur GET-Endpunkte auf und gibt nur Gerätekennungen bzw. eine begrenzte Auswahl von Features aus:

```sh
python inspect_api.py
python inspect_api.py --installation INSTALLATION --gateway GATEWAY --device 1
```

Diese Abfragen verbrauchen API-Kontingent. Kein automatisches Polling oder Retry im Hilfsskript. Bei 401 neu verbinden, bei 403 API-Berechtigung prüfen, bei 429 Abfragelimit abwarten. Vollständige Rohantworten können persönliche Kennungen enthalten; vor dem Teilen kürzen.

## 4. Live-Polling aktivieren

`settings-live.yml` ist eine vorbereitete alternative Konfiguration. Für das bereits importierte Plugin sind folgende Änderungen nötig:

1. **Form Fields** durch die `custom_fields` aus `settings-live.yml` ersetzen. So bleiben die Sensorfelder erhalten und die drei API-Kennungen kommen hinzu.
2. Die richtigen Werte für `installation_id`, `gateway_serial` und `device_id` in der Plugin-Form eintragen.
3. Strategie auf **Polling** setzen, Verb **GET**, Refresh zunächst **60 Minuten** (das sind keine Sekunden).
4. Polling URL aus `settings-live.yml` übernehmen, Polling Headers auf `Authorization: Bearer {{ oauth_access_token }}` setzen. OAuth aus Schritt 2 beibehalten.
5. Speichern → **Force Refresh** → unter **Edit Markup / Your Variables** die Antwort und die gerenderten Werte prüfen.
6. Für die erste Prüfung Vollbild wählen. Fehlende Werte bedeuten nicht automatisch 0 °C; Sensor-Feature, Verfügbarkeit und API-Tarif prüfen.

Wer lieber ein zweites Plugin importiert, kann im entpackten Importarchiv `settings.yml` durch `settings-live.yml` ersetzen, wieder als flaches ZIP packen und importieren. Danach müssen Kennungen und OAuth-Zugang im neuen Plugin eingerichtet werden. Die Live-Konfiguration enthält keine Zugangsdaten.

## Sensorzuordnung

| Anzeige | Standard-Feature | Eigenschaft |
|---|---|---|
| Vorlauf | `heating.secondaryCircuit.sensors.temperature.supply` | `properties.value.value` |
| Warmwasser | `heating.dhw.sensors.temperature.dhwCylinder` | `properties.value.value` |
| Außen | `heating.sensors.temperature.outside` | `properties.value.value` |
| Neigung/Niveau | `heating.circuits.N.heating.curve` | `properties.slope.value`, `properties.shift.value` |
| Betriebsart | `heating.circuits.N.operating.modes.active` | `properties.value.value` |

Diese Kandidaten sind **für das konkrete Gerät noch zu bestätigen**. Bei anderen Vorlaufsensoren deren Feature-Namen im Konfigurationsfeld eintragen. Heizkreis 0 ist der erste API-Heizkreis; weitere Kreise können 1 oder 2 sein. Die Vorlage liest ein `data`-Feature-Array, alternativ `IDX_0.data`.

Viessmann hat die Warmwasser-Feldnamen 2025 von `hotWaterStorage` auf `dhwCylinder` umgestellt. Ältere Anleitungen können deshalb falsche Namen enthalten.

## Heizkurve und Datenalter

Das Schema zeigt `20 + Niveau + Neigung × (20 − Außentemperatur)` im Bereich −20 bis +20 °C außen. Es erklärt nur die Wirkung der Parameter. Die Darstellung wird auf 20 bis 60 °C beschnitten. Raum-Solltemperatur, Herstellermodell, Heizgrenzen und maximale Vorlauftemperatur werden darin **nicht** simuliert. Für eine genaue Viessmann-Kennlinie sind die Modellformel oder bestätigte Stützpunkte nötig.

Der Screenshot nennt eine maximale Vorlauftemperatur von 50 °C. Das ist eine Einstellung, kein aktueller Messwert. Sie wird daher nicht als Temperatur übernommen und im Schema nicht als Modellgrenze ausgegeben.

Ein E-Ink-Gerät kann bei Verbindungsproblemen das letzte Bild behalten. Die Veraltet-Kennzeichnung wird bei der nächsten erfolgreichen Bildschirmberechnung gesetzt; sie kann auf einem eingefrorenen Bild nicht von selbst weiterlaufen. Der sichtbare Messzeitpunkt ist deshalb entscheidend. Es gibt keine erfundenen Temperaturverläufe und keine Schreibzugriffe auf die Wärmepumpe.

## Entwicklung und Prüfung

```sh
npm ci
npm test
npm run build
python package.py
```

Geprüft: Liquid-Rendering mit synthetischen API-Antworten, Null-/Minuswerte, fehlende und deaktivierte Sensoren, alte/fehlende Zeitstempel, anderer Heizkreis, konfigurierbare Sensoren und HTML-Escaping. Die echte TRMNL-Serverdarstellung, das physische TRMNL X sowie OAuth und Live-Daten wurden ohne Kontozugriff nicht geprüft. Die Browser-Vorschau ist eine lokale HTML-Vorschau desselben Vollbild-Markups.

## Quellen (geprüft am 18.10.2026)

- TRMNL Importformat: https://help.trmnl.com/en/articles/10542599-importing-and-exporting-private-plugins
- Polling und Liquid: https://help.trmnl.com/en/articles/9510536-private-plugins
- OAuth-Einstellungsfelder: https://trmnl.com/integrations/private_plugin
- OAuth-YAML und PKCE: https://github.com/usetrmnl/trmnlp#oauth2
- Form Fields: https://help.trmnl.com/en/articles/10513740-custom-plugin-form-builder
- Viessmann-Feldumbenennung: https://developer.viessmann-climatesolutions.com/start/news/important-updates-to-viessmann-api-effective-30-04-2025.html
- Viessmann-Portal: https://developer.viessmann-climatesolutions.com/start.html
- Aktuelle API-v2-Endpunkte im PyViCare-Client: https://github.com/somm15/PyViCare/blob/master/PyViCare/PyViCareAbstractOAuthManager.py und https://github.com/somm15/PyViCare/blob/master/PyViCare/PyViCareService.py
