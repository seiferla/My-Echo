# Datenschutzerklärung — myEcho

**Stand:** 21.08.2026

myEcho ist eine assistive Kommunikations-App. Du tippst Text, und die App gibt
ihn als Sprache aus. Diese Erklärung beschreibt, welche Daten dabei verarbeitet
werden.

> **Geltungsbereich:** Diese Erklärung gilt für die App myEcho
> (Paketname `io.github.seiferla.myecho`), die im **internen Testkanal** von Google Play
> an einen kleinen, ausgewählten Personenkreis verteilt wird.

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

myEcho verlangt **kein Benutzerkonto**, keine Anmeldung und enthält **keine
Werbung und kein Tracking**. Verarbeitet werden ausschließlich:

- **Nachrichtentexte:** die Texte, die du in der App eingibst, um sie sprechen
  oder speichern zu lassen. Diese können persönliche oder gesundheitsbezogene
  Inhalte enthalten.
- **Erzeugte Audiodateien:** die aus deinen Texten synthetisierte Sprache.
- **Nutzungsstatistiken:** aggregierte Kennzahlen (z. B. Anzahl Nachrichten,
  Sprechzeit, häufige Phrasen) zur Anzeige in der Statistik der App.
- **Technische Verbindungsdaten (nur Backend):** beim Aufruf des Backends
  werden die **IP-Adresse** des Geräts, Zeitpunkt, aufgerufener Pfad und
  Statuscode verarbeitet. Die IP-Adresse dient der Begrenzung der Anfragerate
  (Schutz vor Überlast), Pfad und Zeitpunkt fließen in technische Kennzahlen
  (Antwortzeiten, Anzahl Anfragen) zur Überwachung des Servers ein.
  **Wichtig:** Beim Abruf der Sprachausgabe wird der zu sprechende Text als
  Teil der Aufruf-Adresse übertragen und kann daher in den Server-Protokollen
  des Backends erscheinen.

Es werden **keine** Standortdaten, Kontakte, Werbe-IDs o. Ä. erfasst. Die App
fordert **keine Mikrofon-Berechtigung** an; es werden keine Sprachaufnahmen
gemacht.

---

## 3. Wo die Daten gespeichert und verarbeitet werden

**a) Auf deinem Gerät**
Nachrichten, der Audio-Cache und die Nutzungsstatistiken werden lokal auf dem
Gerät gespeichert. Der Audio-Cache lässt sich in der App jederzeit über
„Cache leeren" entfernen.

**b) Auf dem selbst betriebenen Backend**
Deine Chats werden zusätzlich an einen vom Verantwortlichen selbst betriebenen
Server (Raspberry Pi im privaten Netzwerk) übertragen und dort in einer lokalen
Datenbank gespeichert, um den Verlauf zu sichern und geräteübergreifend
verfügbar zu machen. Es besteht **keine öffentliche Zugänglichkeit**; der Zugriff
erfolgt innerhalb eines privaten Netzwerks bzw. über eine gesicherte
VPN-Verbindung.

**c) Sprachsynthese durch einen Drittanbieter (Fish Audio)**
Zur Umwandlung von Text in Sprache wird der eingegebene **Text an den
Dienstleister Fish Audio** (https://fish.audio) übermittelt und dort verarbeitet.
Übertragen wird ausschließlich der Text selbst — **keine Kennung des Geräts,
kein Nutzername, kein Chat-Verlauf**. Bitte beachte hierzu die
Datenschutzerklärung von Fish Audio. Die Übertragung dient ausschließlich der
Erzeugung der Sprachausgabe.

*Übermittlung in ein Drittland:* Fish Audio verarbeitet die Daten
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
Text in Sprache umzuwandeln, den Verlauf zu speichern und Nutzungsstatistiken
anzuzeigen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Erfüllung der
Nutzung der App) bzw. lit. f DSGVO (berechtigtes Interesse an einer
funktionierenden, verlässlichen Kommunikationshilfe). Soweit besondere
Kategorien personenbezogener Daten (z. B. Gesundheitsdaten) durch die Inhalte
betroffen sein können, erfolgt die Verarbeitung auf Grundlage deiner
ausdrücklichen Einwilligung durch die Nutzung der App (Art. 9 Abs. 2 lit. a DSGVO).

---

## 5. Weitergabe an Dritte

Eine Weitergabe erfolgt **ausschließlich** an den unter 3c genannten
Sprachsynthese-Dienstleister (Fish Audio), soweit dies für die Sprachausgabe
erforderlich ist. Es findet **kein Verkauf** von Daten und **keine Nutzung für
Werbung** statt.

---

## 6. Speicherdauer und Löschung

- **Gerät:** Daten bleiben gespeichert, bis du sie löschst (Cache über
  „Cache leeren", Chats über die App-Funktionen, oder durch Deinstallation).
- **Backend:** Chats bleiben gespeichert, bis sie vom Verantwortlichen gelöscht
  werden. Auf Wunsch werden deine Daten dort gelöscht.

---

## 7. Datensicherheit

Der Zugriff auf das Backend erfolgt innerhalb eines privaten Netzwerks bzw. über
eine VPN-Verbindung und ist nicht öffentlich erreichbar. Die Anzahl der Anfragen
pro Gerät ist begrenzt, um Überlast und Missbrauch zu verhindern.

Bitte beachte dabei zwei Punkte:

- Die Verbindung zwischen App und Backend erfolgt im privaten Netzwerk
  **unverschlüsselt (HTTP)**. Der Schutz beruht darauf, dass dieses Netzwerk
  bzw. der VPN-Tunnel nicht öffentlich zugänglich ist. Wer Zugriff auf dieses
  Netzwerk hat, könnte die Übertragung mitlesen.
- Die Übertragung an den Sprachsynthese-Dienstleister (Fish Audio) erfolgt über
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
