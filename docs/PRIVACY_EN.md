# Privacy Policy — myEcho

**Last updated:** 21 August 2026

myEcho is an assistive communication app. You type text, and the app speaks it
out loud. This page explains, in plain words, what happens with your data.

> **Scope:** This policy covers the myEcho app (package name `io.github.seiferla.myecho`),
> shared with a small, selected group of people through the **internal test
> channel** on Google Play.

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

myEcho needs **no user account**, no login, and has **no ads and no tracking**.
We only handle:

- **Message texts** — the text you type so the app can speak or save it. This
  text may include personal or health-related content.
- **Generated audio** — the speech made from your text.
- **Usage numbers** — counts only (for example number of messages, speaking
  time, frequent phrases), shown in the app's statistics screen.
- **Technical connection data (backend only)** — when the app contacts the
  server, we handle the device's **IP address**, the time, the path that was
  called, and the status code. The IP address is used to limit how many requests
  a device may send (protection against overload). Path and time go into
  technical measurements such as response times and request counts.
  **Please note:** when speech is requested, the text to be spoken travels as
  part of the request address, so it can appear in the server log files.

We do **not** collect location data, contacts, advertising IDs or anything
similar. The app does **not ask for microphone access**, and it never records
your voice.

---

## 3. Where your data is stored and processed

**a) On your device**
Messages, the audio cache and the usage numbers are stored locally on your
device. You can clear the audio cache at any time with "Clear cache" in the app.

**b) On our own server**
Your chats are also sent to a server that we run ourselves (a Raspberry Pi in a
private network) and stored there in a local database. This keeps your history
safe and available on more than one device. The server is **not reachable from
the public internet**: access works inside the private network or through a
secure VPN connection.

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

We process this data for one purpose: to make the app work — turn text into
speech, keep your history, and show usage numbers.

The legal basis is Art. 6(1)(b) GDPR (providing the service you use) and
Art. 6(1)(f) GDPR (our legitimate interest in a reliable communication aid).
Because your messages can contain special categories of personal data (for
example health data), we process that content based on your **explicit consent**
given by using the app (Art. 9(2)(a) GDPR).

---

## 5. Sharing with others

We share data **only** with the speech provider named in 3c (Fish Audio), and
only as far as it is needed for the spoken output. We do **not sell** data and
we do **not use it for advertising**.

---

## 6. How long we keep data, and how to delete it

- **On your device:** data stays until you delete it — clear the audio cache
  with "Clear cache", delete chats in the app, or uninstall the app.
- **On our server:** chats stay until we delete them. On your request we will
  delete your data there.

---

## 7. Data security

The server is only reachable inside a private network or through a VPN
connection, never from the public internet. The number of requests per device is
limited to prevent overload and misuse.

We want to be open about two points:

- The connection between app and server inside the private network is
  **not encrypted (HTTP)**. The protection comes from the fact that this network
  or VPN tunnel is not publicly reachable. Anyone with access to that network
  could read the traffic.
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
