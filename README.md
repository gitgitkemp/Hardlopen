# Tempo Run

Hardloop app (PWA) voor je telefoon. Geen app store nodig: open de link, kies "Zet op beginscherm" en hij werkt als een normale app, ook offline.

## Wat zit erin

**Tijdens het rennen** (alles stel je vooraf in, tijdens de run hoef je niks meer te doen)
- Live: tijd, afstand, huidig tempo, gemiddeld tempo, rondetempo, hartslag + zone, cadans, stijging, calorieën
- 4 swipebare schermen: statistieken, live kaart, rondes, grafieken + tijd in zones
- Auto-pauze, auto-ronde per km, Nederlandse stemcoach, scherm blijft aan, schermvergrendeling (vasthouden om te ontgrendelen)
- Workouts met stem en piepjes (intervallen, tempo, piramide, fartlek) en tempo-begeleiding ("versnellen" / "iets rustiger")
- Ghost race tegen een eerdere run, route volgen met "van de route af" waarschuwing
- Hartslagband via Bluetooth (Chrome op Android), cadans via bewegingssensor
- Crash herstel: als de app sluit gaat je run gewoon verder

**Na de run**
- Kaart gekleurd op tempo / hartslag / hoogte, grafieken met scrubben (gekoppeld aan de kaart)
- Splits, rondes, hartslag- en tempozones, Grade Adjusted Pace, relatieve inspanning
- Beste prestaties (400 m t/m marathon) met PR medailles, vergelijkbare runs, persoonlijke segmenten
- Hoogtecorrectie via hoogtekaart, deelafbeelding voor Insta/WhatsApp
- Export GPX / TCX, **upload naar Strava met één tik**, import uit Strava

**Training**
- Weektotalen, maandtotalen, doelen, streak, schoenen-kilometers
- Fitheid & vorm (CTL/ATL/TSB), voorspelde racetijden (VDOT) en trainingstempo's
- Kalender, trainingsschema's voor 5 km / 10 km / halve / hele marathon
- Routeplanner die paden volgt, heatmap van al je runs

## Online zetten (GitHub Pages)

1. Repo op GitHub → **Settings → Pages** → bij "Source" kies **GitHub Actions**.
2. Push naar de branch, de workflow zet de app online op `https://<gebruikersnaam>.github.io/<repo>/`.
3. Open die link op je telefoon en kies "Toevoegen aan beginscherm".

GPS werkt alleen via https, dus lokaal openen als bestand werkt niet.

## Strava koppelen

1. Ga naar https://www.strava.com/settings/api en maak een applicatie aan.
2. Zet **Authorization Callback Domain** op het domein van je app (bijv. `gebruikersnaam.github.io`).
3. Vul Client ID en Client Secret in onder **Profiel** in de app en tik op "Verbinden met Strava".

Daarna kun je na elke run delen met je Strava vrienden en je oude runs importeren. Zonder koppeling kan het ook: exporteer TCX en upload op strava.com/upload.

## Goed om te weten

- iPhone: Safari pauzeert GPS als het scherm uit gaat. Laat het scherm aan (staat standaard aan) en vergrendel met het slotje in de app.
- Hartslagband via Bluetooth werkt in Chrome op Android, niet op iOS.
- Alle data staat lokaal op je telefoon. Maak af en toe een backup via Profiel.

## Techniek

Vanilla JS (ES modules), geen build stap. Leaflet voor kaarten (meegeleverd in `vendor/`), IndexedDB voor opslag, service worker voor offline gebruik.
