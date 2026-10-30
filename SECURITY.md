# Security

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository
(https://github.com/AirPJ/folium-pdf/security/advisories/new).

Include the Folium PDF version (ⓘ button → About and updates), what happens,
and if possible a PDF that shows the problem. You will get an answer within
a week.

## Supported versions

Only the latest version receives fixes. Folium updates itself when a new
version is published (this can be turned off in About and updates).

## How Folium protects you

- **Offline.** Documents never leave your computer. The only network request
  is the update check, to GitHub.
- **Signed updates.** Every update is signed; the app refuses an update whose
  signature does not match the key built into it.
- **Untrusted PDFs are contained.** PDFs are drawn as images, PDF JavaScript
  and forms are never run, and the window runs under a strict Content
  Security Policy. The file commands only open PDF files and only save PDF,
  PNG or JPEG files to places you chose.
- **Passwords** you type are kept in memory only, never written to disk.
  Protection uses AES-256.
