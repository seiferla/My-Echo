# Privacy Policy — myEcho

**Last updated:** 26 October 2026

myEcho is an assistive communication app. You type text, and the app speaks it
out loud. This page explains, in plain words, what happens with your data.

> **Scope:** This policy covers the myEcho app (package name `io.github.seiferla.myecho`),
> shared with a small, selected group of people through the **internal test
> channel** on Google Play. Accounts are created by the operator; there is
> no public sign-up.

> This is the English version. The German version (`PRIVACY.md`) is the legally
> binding one.

---

## 1. Who is responsible

- **Name:** Lars Seifert
- **E-mail:** seifert_lars@gmx.net

myEcho is run **privately and not for profit**, and is only given to a small
group of people we know by name. For this reason no postal address is published
here. We will send it **on request** to any user or to a data protection
authority, using the e-mail address above.

---

## 2. What data we handle

myEcho needs a **user account** (e-mail address and password) and has **no ads
and no tracking**. We handle:

- **Account data** — your e-mail address and your password. The password is
  stored only as a hash, never in plain text. We create the accounts; there is
  no public sign-up.
- **Sign-in session** — after you sign in, the app keeps a session token in the
  secure storage of your operating system, so you stay signed in. It is removed
  when you sign out.
- **Message texts** — the text you type so the app can speak or save it. This
  text may include personal or health-related content.
- **Quick phrases** — the phrases you saved and their settings.
- **Generated audio** — the speech made from your text.
- **Usage numbers** — per day: the number of speech requests, the number of
  characters and the speaking time. They contain no message text. They are
  shown in the app's statistics screen and stored in your account, so they are
  the same on every device.
- **Technical connection data** — when the app contacts our server, we handle
  the device's **IP address**, the time, the path that was called, and the
  status code. The number of speech requests is limited per account (protection
  against overload); requests without a valid sign-in are limited by IP
  address. Path and time go into technical measurements such as response times
  and request counts; these contain no user ID and no message text. When you
  sign in, your IP address also reaches Supabase as part of the connection.
  **Please note:** when speech is requested, the text to be spoken travels as
  part of the request address. Our backend does not write it into its log
  files; they only contain the length of the text.

We do **not** collect location data, contacts, advertising IDs or anything
similar. The app does **not ask for microphone access**, and it never records
your voice.

---

## 3. Where your data is stored and processed

**a) On your device**
Messages, quick phrases, the audio cache, the usage numbers and the sign-in
session are stored locally on your device. Local data is kept separately for
each account. When you sign out, the data of that account stays on the device
(so your phrases and numbers are not lost); only the sign-in session is
removed. You can clear the audio cache at any time with "Clear cache" in the
app.

**b) Backend and database**
Your chats, quick phrases and usage numbers are also stored in a database of the
service provider **Supabase** (https://supabase.com), on servers in **Ireland
(EU)**. Supabase also handles the sign-in (e-mail address, password hash). The
app does not read the database directly: every access goes through our own
backend, which only returns the data of the signed-in account. The backend
runs on a virtual server of the hosting provider **Hetzner**. Supabase and
Hetzner process the data on our behalf.
<!--
  HINWEIS (nicht veroeffentlichen): Standort des Hetzner-Servers hier eintragen
  (EU), sobald G4 steht. Auftragsverarbeitungsvertraege mit Supabase und
  Hetzner abschliessen, bevor echte Nutzer kommen.
-->

**c) Speech synthesis by a third party (Fish Audio)**
To turn text into speech, the text you typed is sent to the service provider
**Fish Audio** (https://fish.audio) and processed there. Only the text itself is
sent — **no device ID, no user name, no chat history**. Please also read Fish
Audio's own privacy policy. The transfer happens only to create the spoken
output.

*Transfer outside the EU:* Fish Audio most likely processes the data on servers
**outside the EU/EEA**. For those countries there is no adequacy decision by the
EU Commission, and we have not signed Standard Contractual Clauses with the
provider. The transfer therefore relies on your **explicit consent**
(Art. 49(1)(a) GDPR), which you give by using the cloud speech feature. Please
be aware that the level of data protection in those countries may be lower, and
that enforcing your rights there can be harder. You can avoid the cloud speech
feature by using the app without a connection to our server (see d).

**d) Speech without internet (fallback on the device)**
If the server cannot be reached, the app uses the **speech engine of your
operating system**. In that case the text does **not** leave your device through
myEcho. How the system speech engine handles the text is covered by your device
manufacturer's privacy policy.

**e) Audio files**
The generated speech is **not** stored on our server. It is passed straight
through to the app and kept in the local cache on your device.

---

## 4. Why we do this, and the legal basis

We process this data for one purpose: to make the app work — let you sign in
and keep your data apart from other users, turn text into speech, keep your
history and phrases, and show usage numbers.

The legal basis is Art. 6(1)(b) GDPR (providing the service you use) and
Art. 6(1)(f) GDPR (our legitimate interest in a reliable communication aid).
Because your messages can contain special categories of personal data (for
example health data), we process that content based on your **explicit consent**
given by using the app (Art. 9(2)(a) GDPR).

---

## 5. Sharing with others

We share data **only** with the service providers named in 3b and 3c: Supabase
(sign-in and database), Hetzner (the server our backend runs on) and Fish Audio
(speech), and only as far as it is needed for the app to work. We do **not
sell** data and we do **not use it for advertising**.

---

## 6. How long we keep data, and how to delete it

- **On your device:** data stays until you delete it — clear the audio cache
  with "Clear cache", delete chats in the app, or uninstall the app. The data
  of an account that is signed out stays on the device until you uninstall the
  app.
- **In the database:** chats stay until you delete them in the app or your
  account is deleted. Quick phrases and usage numbers stay until your account
  is deleted. When an account is deleted, all its data in the database is
  deleted with it. For now, we delete accounts on request (contact in
  section 1).
- **Technical measurements** (no message text, no user ID): 90 days.

---

## 7. Data security

The connections between the app, our backend and Supabase are encrypted
(HTTPS/TLS).
<!--
  HINWEIS (nicht veroeffentlichen): stimmt erst, wenn Caddy mit HTTPS laeuft
  (G4). Caddy darf ausserdem keine Query-Strings loggen (Text steht in der URL).
-->
Every request carries your sign-in token. The backend checks it and only returns
data of that account. The app cannot reach the database directly; only our
backend can read and write it (row-level security is on for every table and
blocks access by default). Your password is stored only as a hash, and the
sign-in session is kept in the secure storage of your operating system. The
number of speech requests per account is limited to prevent overload and
misuse.

We want to be open about two points:

- Chats and the audio cache are stored in the private area of the app on your
  device. The operating system protects this area, but the app does not
  encrypt the files in addition.
- The connection to the speech provider (Fish Audio) goes over the internet and
  **is encrypted (TLS)**.

---

## 8. Your rights

Under the GDPR you have the right to access (Art. 15), correction (Art. 16),
deletion (Art. 17), restriction of processing (Art. 18), data portability
(Art. 20) and objection (Art. 21). You can withdraw a consent you gave at any
time. You may also complain to a data protection authority. To use these rights,
contact us at the address in section 1.

---

## 9. App permissions

myEcho only needs:

- **Internet access** — to reach the server and the speech provider,
- **Audio playback (also in the background)** — to play the spoken output.

It does **not** ask for: microphone, camera, location, contacts, phone, SMS or
calendar.

---

## 10. No automated decision-making

There is **no automated decision-making** and **no profiling** in the sense of
Art. 22 GDPR. We do not build profiles and we do not analyse data for
advertising.

---

## 11. Distribution through Google Play

The app is distributed through the **internal test channel of Google Play** to a
small, selected group of people. **Google** is responsible for installation,
updates and the data it collects in that process (for example account, device
and crash data); Google's own privacy policy applies
(https://policies.google.com/privacy). We only receive aggregated,
non-personal information from Google, such as the number of installs.

---

## 12. Children

The app is not aimed at children.

---

## 13. Changes to this policy

We may update this policy when the app or the processing behind it changes. The
version published here is always the one that applies.

---

**Questions about privacy:** seifert_lars@gmx.net
