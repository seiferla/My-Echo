# Datenschutzerklärung — myEcho

**Stand:** 26.10.2026

myEcho ist eine assistive Kommunikations-App. Du tippst Text, und die App gibt
ihn als Sprache aus. Diese Erklärung beschreibt, welche Daten dabei verarbeitet
werden.

> **Geltungsbereich:** Diese Erklärung gilt für die App myEcho
> (Paketname `io.github.seiferla.myecho`), die im **internen Testkanal** von Google Play
> an einen kleinen, ausgewählten Personenkreis verteilt wird. Die Konten legt der
> Verantwortliche an; eine öffentliche Registrierung gibt es nicht.

---
                
## 1. Verantwortlicher

Verantwortlich für die Datenverarbeitung im Sinne der DSGVO:

- **Name:** Lars Seifert
- **E-Mail:** seifert_lars@gmx.net

myEcho wird **privat und nicht kommerziell** betrieben und ausschließlich einem
kleinen, namentlich bekannten Personenkreis im internen Test bereitgestellt.
Eine Postanschrift wird daher nicht öffentlich veröffentlicht; sie wird
betroffenen Personen und Aufsichtsbehörden **auf Anfrage** über die oben
genannte E-Mail-Adresse mitgeteilt.

<!--
  HINWEIS (nicht veröffentlichen — nur zur Entscheidung):
  Art. 13 DSGVO verlangt "Name und Kontaktdaten" des Verantwortlichen. Eine
  E-Mail-Adresse gilt bei rein privatem, nicht kommerziellem Betrieb meist als
  ausreichend; eine Postanschrift ist damit aber NICHT rechtssicher ersetzt.
  Zusätzlich verlangt Google für Play-Entwicklerkonten eine verifizierte
  Adresse, die bei Privatkonten öffentlich auf der Store-Seite erscheinen kann.
  Sichere Alternativen ohne Privatadresse:
    - virtuelle Geschäfts-/Ladungsanschrift (ca. 5-15 EUR/Monat)
    - c/o-Adresse (z. B. über eine dritte Person oder einen Dienstleister)
  Bei Zweifeln: kurze rechtliche Prüfung einholen.
-->


---

## 2. Welche Daten verarbeitet werden

myEcho verlangt ein **Benutzerkonto** (E-Mail-Adresse und Passwort) und enthält
**keine Werbung und kein Tracking**. Verarbeitet werden:

- **Kontodaten:** deine E-Mail-Adresse und dein Passwort. Das Passwort wird nur
  als Hash gespeichert, nie im Klartext. Die Konten legt der Verantwortliche an;
  eine öffentliche Registrierung gibt es nicht.
- **Anmelde-Sitzung:** Nach der Anmeldung speichert die App ein Sitzungs-Token
  im geschützten Speicher des Betriebssystems, damit du angemeldet bleibst.
  Beim Abmelden wird es entfernt.
- **Nachrichtentexte:** die Texte, die du in der App eingibst, um sie sprechen
  oder speichern zu lassen. Diese können persönliche oder gesundheitsbezogene
  Inhalte enthalten.
- **Schnellphrasen:** deine gespeicherten Phrasen und deren Einstellungen.
- **Erzeugte Audiodateien:** die aus deinen Texten synthetisierte Sprache.
- **Nutzungsstatistiken:** pro Tag die Anzahl der Sprachausgaben, die Anzahl der
  Zeichen und die Sprechzeit. Sie enthalten keinen Nachrichtentext. Sie werden
  in der Statistik der App angezeigt und in deinem Konto gespeichert, damit sie
  auf jedem Gerät gleich sind.
- **Technische Verbindungsdaten:** beim Aufruf des Backends werden die
  **IP-Adresse** des Geräts, Zeitpunkt, aufgerufener Pfad und Statuscode
  verarbeitet. Die Anzahl der Sprachausgaben wird pro Konto begrenzt (Schutz vor
  Überlast); Anfragen ohne gültige Anmeldung werden nach IP-Adresse begrenzt.
  Pfad und Zeitpunkt fließen in technische Kennzahlen (Antwortzeiten, Anzahl
  Anfragen) ein; diese enthalten weder eine Nutzerkennung noch Nachrichtentext.
  Bei der Anmeldung erhält auch Supabase deine IP-Adresse.
  **Wichtig:** Beim Abruf der Sprachausgabe wird der zu sprechende Text als
  Teil der Aufruf-Adresse übertragen. Das Backend schreibt ihn nicht in seine
  Protokolle; dort steht nur die Länge des Textes.

Es werden **keine** Standortdaten, Kontakte, Werbe-IDs o. Ä. erfasst. Die App
fordert **keine Mikrofon-Berechtigung** an; es werden keine Sprachaufnahmen
gemacht.

---

## 3. Wo die Daten gespeichert und verarbeitet werden

**a) Auf deinem Gerät**
Nachrichten, Schnellphrasen, der Audio-Cache, die Nutzungsstatistiken und die
Anmelde-Sitzung werden lokal auf dem Gerät gespeichert. Die lokalen Daten werden
pro Konto getrennt abgelegt. Beim Abmelden bleiben die Daten des Kontos auf dem
Gerät erhalten (damit Phrasen und Statistik nicht verloren gehen); nur die
Anmelde-Sitzung wird entfernt. Der Audio-Cache lässt sich in der App jederzeit
über „Cache leeren" entfernen.

**b) Backend und Datenbank**
Deine Chats, Schnellphrasen und Nutzungsstatistiken werden zusätzlich in einer
Datenbank des Dienstleisters **Supabase** (https://supabase.com) gespeichert,
auf Servern in **Irland (EU)**. Supabase übernimmt außerdem die Anmeldung
(E-Mail-Adresse, Passwort-Hash). Die App greift nicht direkt auf die Datenbank
zu: Jeder Zugriff läuft über das Backend des Verantwortlichen, das nur die Daten
des angemeldeten Kontos liefert. Das Backend läuft auf einem virtuellen Server
des Hosting-Anbieters **Hetzner**. Supabase und Hetzner verarbeiten die Daten
im Auftrag des Verantwortlichen.
<!--
  HINWEIS (nicht veroeffentlichen): Standort des Hetzner-Servers hier eintragen
  (EU), sobald G4 steht. Auftragsverarbeitungsvertraege mit Supabase und
  Hetzner abschliessen, bevor echte Nutzer kommen.
-->

**c) Sprachsynthese durch einen Drittanbieter (Mistral AI)**
Zur Umwandlung von Text in Sprache wird der eingegebene **Text an den
Dienstleister Mistral AI** (https://mistral.ai) übermittelt und dort verarbeitet.
Übertragen wird ausschließlich der Text selbst — **keine Kennung des Geräts,
kein Nutzername, kein Chat-Verlauf**. Bitte beachte hierzu die
Datenschutzerklärung von Mistral AI. Die Übertragung dient ausschließlich der
Erzeugung der Sprachausgabe.

*Übermittlung in ein Drittland:* Mistral AI verarbeitet die Daten
voraussichtlich auf Servern **außerhalb der EU/des EWR**. Für diese Länder
liegt kein Angemessenheitsbeschluss der EU-Kommission vor, und es wurden keine
eigenen Standardvertragsklauseln mit dem Anbieter geschlossen. Die Übermittlung
erfolgt daher auf Grundlage deiner **ausdrücklichen Einwilligung**
(Art. 49 Abs. 1 lit. a DSGVO), die du mit der Nutzung der Cloud-Sprachausgabe
erteilst. Dir muss bewusst sein, dass in diesen Ländern möglicherweise kein
gleichwertiges Datenschutzniveau besteht und die Durchsetzung deiner Rechte
erschwert sein kann. Du kannst die Cloud-Sprachausgabe vermeiden, indem du
das Gerät ohne Verbindung zum Backend nutzt (siehe d).

**d) Sprachausgabe ohne Internet (Fallback auf dem Gerät)**
Ist das Backend nicht erreichbar, nutzt die App die **Sprachausgabe des
Betriebssystems** auf dem Gerät. In diesem Fall verlässt der Text das Gerät
**nicht** über myEcho. Die Verarbeitung durch die System-Sprachausgabe richtet
sich nach den Datenschutzbestimmungen des Geräteherstellers.

**e) Audiodateien**
Die erzeugte Sprachausgabe wird **nicht** auf dem Backend gespeichert; sie wird
direkt an die App durchgeleitet und dort im lokalen Cache abgelegt.

---

## 4. Zwecke und Rechtsgrundlage

Die Verarbeitung erfolgt zu dem Zweck, die Kernfunktion der App bereitzustellen:
die Anmeldung und die Trennung deiner Daten von denen anderer Nutzer, die
Umwandlung von Text in Sprache, das Speichern von Verlauf und Schnellphrasen und
die Anzeige von Nutzungsstatistiken. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b
DSGVO (Erfüllung der Nutzung der App) bzw. lit. f DSGVO (berechtigtes Interesse
an einer funktionierenden, verlässlichen Kommunikationshilfe). Soweit besondere
Kategorien personenbezogener Daten (z. B. Gesundheitsdaten) durch die Inhalte
betroffen sein können, erfolgt die Verarbeitung auf Grundlage deiner
ausdrücklichen Einwilligung durch die Nutzung der App (Art. 9 Abs. 2 lit. a DSGVO).

---

## 5. Weitergabe an Dritte

Eine Weitergabe erfolgt **ausschließlich** an die unter 3b und 3c genannten
Dienstleister: Supabase (Anmeldung und Datenbank), Hetzner (Server des Backends)
und Mistral AI (Sprachausgabe), soweit dies für die Funktion der App
erforderlich ist. Es findet **kein Verkauf** von Daten und **keine Nutzung für
Werbung** statt.

---

## 6. Speicherdauer und Löschung

- **Gerät:** Daten bleiben gespeichert, bis du sie löschst (Cache über
  „Cache leeren", Chats über die App-Funktionen, oder durch Deinstallation). Die
  Daten eines abgemeldeten Kontos bleiben bis zur Deinstallation der App auf dem
  Gerät.
- **Datenbank:** Chats bleiben gespeichert, bis du sie in der App löschst oder
  das Konto gelöscht wird. Schnellphrasen und Nutzungsstatistiken bleiben bis zur
  Löschung des Kontos. Mit dem Konto werden alle zugehörigen Daten in der
  Datenbank gelöscht. Derzeit löscht der Verantwortliche Konten auf Anfrage
  (Kontakt unter 1.).
- **Technische Kennzahlen** (kein Nachrichtentext, keine Nutzerkennung):
  90 Tage.

---

## 7. Datensicherheit

Die Verbindungen zwischen App, Backend und Supabase sind verschlüsselt
(HTTPS/TLS).
<!--
  HINWEIS (nicht veroeffentlichen): stimmt erst, wenn Caddy mit HTTPS laeuft
  (G4). Caddy darf ausserdem keine Query-Strings loggen (Text steht in der URL).
-->
Jede Anfrage trägt dein Anmelde-Token. Das Backend prüft es und liefert nur Daten
des eigenen Kontos. Die App kann nicht direkt auf die Datenbank zugreifen; nur
das Backend darf sie lesen und schreiben (der Zeilenzugriffsschutz ist für jede
Tabelle aktiv und sperrt den Zugriff standardmäßig). Das Passwort wird nur als
Hash gespeichert, die Anmelde-Sitzung liegt im geschützten Speicher des
Betriebssystems. Die Anzahl der Sprachausgaben pro Konto ist begrenzt, um
Überlast und Missbrauch zu verhindern.

Bitte beachte dabei zwei Punkte:

- Chats und Audio-Cache liegen im privaten Bereich der App auf dem Gerät. Das
  Betriebssystem schützt diesen Bereich, die App verschlüsselt die Dateien aber
  nicht zusätzlich.
- Die Übertragung an den Sprachsynthese-Dienstleister (Mistral AI) erfolgt über
  das Internet und ist dorthin verschlüsselt (TLS).

---

## 8. Deine Rechte

Du hast im Rahmen der DSGVO das Recht auf Auskunft (Art. 15), Berichtigung
(Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18),
Datenübertragbarkeit (Art. 20) und Widerspruch (Art. 21) sowie das Recht, eine
erteilte Einwilligung jederzeit zu widerrufen. Zudem besteht ein Beschwerderecht
bei einer Datenschutz-Aufsichtsbehörde. Wende dich dazu an den unter 1. genannten
Kontakt.

---

## 9. Berechtigungen der App

myEcho benötigt nur:

- **Internetzugriff** — um Backend und Sprachsynthese zu erreichen,
- **Audio-Wiedergabe (auch im Hintergrund)** — um die Sprachausgabe abzuspielen.

Nicht angefordert werden: Mikrofon, Kamera, Standort, Kontakte, Telefon, SMS,
Kalender.

---

## 10. Keine automatisierte Entscheidungsfindung

Es findet **keine automatisierte Entscheidungsfindung** und **kein Profiling**
im Sinne von Art. 22 DSGVO statt. Es werden keine Profile gebildet und keine
Daten für Werbezwecke ausgewertet.

---

## 11. Verteilung über Google Play

Die App wird über den **geschlossenen bzw. internen Testkanal von Google Play**
an einen begrenzten, ausgewählten Personenkreis verteilt. Für die Installation,
Aktualisierung und die dabei von Google erhobenen Daten (z. B. Konto-, Geräte-
und Absturzdaten) ist **Google** verantwortlich; es gelten die
Datenschutzbestimmungen von Google
(https://policies.google.com/privacy). Der Verantwortliche erhält von Google
lediglich aggregierte, nicht personenbezogene Angaben (z. B. Anzahl der
Installationen).

---

## 12. Kinder

Die App richtet sich nicht gezielt an Kinder.

---

## 13. Änderungen dieser Erklärung

Diese Datenschutzerklärung kann angepasst werden, wenn sich die App oder die
zugrunde liegende Verarbeitung ändert. Es gilt jeweils die hier veröffentlichte
Fassung.

---

**Kontakt bei Fragen zum Datenschutz:** seifert_lars@gmx.net
