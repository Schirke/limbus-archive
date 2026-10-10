<p align="center">
  <img src="blue_face.png" width="110" alt=""><br>
  <b>Limbus Archive</b>
</p>

<p align="center">
  <a href="https://limbus-archive.com"><b>🌐 limbus-archive.com</b></a><br>
  the website: patch reports, the database and the team builder in a browser, nothing to install
</p>

<p align="center">
  <a href="https://limbus-archive.com"><img alt="website" src="https://img.shields.io/badge/website-open-c9a227"></a>
  <img alt="version" src="https://img.shields.io/github/v/release/Schirke/limbus-archive">
  <img alt="downloads" src="https://img.shields.io/github/downloads/Schirke/limbus-archive/total">
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows-blue">
</p>

<p align="center">
  <a href="docs/promo.mp4"><img src="docs/promo.webp" width="760" alt="A half-minute tour of the website"></a><br>
  <sub>a half-minute tour of the website — click for the video with sound</sub>
</p>

A Windows app for poking around Limbus Company's game files: patch datamining, an Identity / E.G.O
database, an enemy handbook, battle animations and skills rendered with the game's own effects,
Versus fights, every asset of the game, a team builder and the soundtrack.

The app wears the game's own look: its frames, plates, menu icons and fonts are read from your install
when the app runs (none of them is in this repository).

## Website

**[limbus-archive.com](https://limbus-archive.com)** is a copy of the app that runs in a browser:
patch reports, news and the change history, Identities & E.G.O, the enemy handbook, battle animations, the team
builder, the Mirror Dungeon planner, the music player, the games with Extraction and its banner archive, and the live
streams. The rest (skill renders with effects, Versus,
files) needs the game on your PC, so it is only in the app.

## Features

### Patch reports

After an update you get a list of what changed: new and edited texts, data, images, sounds, and
files the devs shipped early (`nextupdate` and friends). Click a patch to see everything it added.
Korean / Japanese-only lines come with an English machine translation, and **What's new** gives a
short summary ready to paste into Discord or Telegram. **News** shows the developers' weekly
update notices from Steam, each next to its patch in your archive.

<p align="center"><a href="docs/patches.webp"><img src="docs/patches.webp" width="760" alt="Patch reports"></a></p>

**Change history** turns the same reports around: pick an Identity, an E.G.O, an enemy or a status and see what each
patch changed in it — numbers, and the wording with the old text struck out and the new one marked.

<p align="center"><a href="docs/changes.webp"><img src="docs/changes.webp" width="760" alt="Change history"></a></p>

### Identities & E.G.O

A database with skills, passives and stats for every uptie, filters by sin, damage type, status, season
and association. Read straight from the game files, so new Identities show up by themselves after a
patch. Skill icons are shown in their sin frames (by tier, Defense in its own); click one to
save it as a PNG.

<p align="center"><a href="docs/identities.webp"><img src="docs/identities.webp" width="760" alt="Identities and E.G.O"></a></p>
<p align="center"><a href="docs/identity-card.webp"><img src="docs/identity-card.webp" width="760" alt="An Identity's card"></a></p>

### Enemy handbook

Every enemy, boss and abnormality with its battle look, stats by level, resistances, skills,
passives and the stages it is fought in. Sort by Canto, name, HP, speed or level.

<p align="center"><a href="docs/enemies.webp"><img src="docs/enemies.webp" width="760" alt="Enemy handbook"></a></p>

### Story map

Every chapter as the game lays it out: the map with its stage nodes, drag it about and pick a node to
see who is fought there, wave by wave, on which arena and to which battle theme. Dungeons list the
fights inside them. An enemy opens in the handbook, a theme plays in the corner player, and **Play in
Versus** takes the fight's enemy, arena and theme to the Versus page.

<p align="center"><a href="docs/stages.webp"><img src="docs/stages.webp" width="760" alt="Story map"></a></p>

### Buff effects

The buffs and debuffs that have an effect of their own in the game's files (Shin, Prey, the Warden's
nails…), each with a video of the effect and the Identities, E.G.O and enemies that give or get it.
Filter by buff / debuff and by who has it.

<p align="center"><a href="docs/buffs.webp"><img src="docs/buffs.webp" width="760" alt="Buff effects"></a></p>

### Animations, skills with effects, mods

- Battle sprites and animations of every Identity, E.G.O and enemy, Spine animations of enemies and
  abnormalities, and the game's own videos.
- **With effects:** skills of Identities, E.G.O (their full cut-in) and enemies rendered to video
  with the game's own effects, shaders, sounds and skill cameras, by a small Unity player that reads
  the game's files. One 1080p video per skill, coins played back to back, with or without a target,
  heads or tails. For editing: a transparent background (WebM with alpha), a static camera, and
  Bloom off.
- **Effects:** each effect of a character on its own, without the characters, on a transparent
  background: skill effects, auras, buff and field effects, in sub-tabs (Skill effects / Auras /
  Battle VFX), each video with its progress bar while it renders. E.G.O cut-ins play their promotion_After
  version, the one of the trailers.
- **Edit:** redraw a skill's frames (download them one PNG per frame, load back the ones you
  changed; any size, placed by the feet), take frames from another character, add freeze frames or
  slow-motion, recolour the effects, or replace whole sprite sheets, then render again. Applied only
  while rendering: the game's files stay as they are.
- **Sprite workshop** (Tools): a frames zip laid out as one sheet, for editing by hand. Open its
  folder, draw over the PNGs in any editor and save: the sheet follows the files, marks the frames
  that changed, shows a frame next to the original (or the two in turn), with the frame before it
  shown through, and the whole skill in motion; the changed frames load into a mod in one click.

<p align="center"><a href="docs/animations.webp"><img src="docs/animations.webp" width="760" alt="Animations"></a></p>

### Versus

Any Identity, E.G.O or enemy against any other on one stage: one takes the other's skill with its
own idle and hit poses, or both clash first (their clash animations at once, as many rounds as you
like) and the winner's skill follows. Optional HP and damage numbers, a death finale, an intro card
and WIN, an E.G.O cut-in, buffs and debuffs with their effects, and battle music. Stage, music and
options are one panel with tabs; a stage's picture is drawn by itself as you scroll the list.
**Render the fight** makes the video, **Live** next to it plays the fight at once.

**Auto Battler** (a tab of Versus): teams of up to six stand on the stage face to face and fight by
autobattler rules: roles, cooldowns, targets. One fighter against two or more is a boss, and its
strength is set to be fair against the team.

<p align="center"><a href="docs/autobattler.webp"><img src="docs/autobattler.webp" width="760" alt="Auto Battler"></a></p>

**Versus Live** plays such a fight as it happens, in the renderer's own window: press START for two random
fighters on a random stage (or the Versus page's picks), with the fight's sounds, music, intro card and WIN.
Nothing is saved.

**Online room** (pick and fight): make a room and send its code. Two players each pick a fighter and
its last skill in secret; at the host's Start the same fight plays on everybody's screen in Versus
Live. The others in the room watch and may bet lunacy on a side. Everybody needs the app.

<p align="center"><a href="docs/versus.webp"><img src="docs/versus.webp" width="760" alt="Versus"></a></p>

### Files

Every asset in the game, like in AssetRipper: catalog paths and files of the install, with preview
and export (PNG, JSON, WAV, MP4).

<p align="center"><a href="docs/browse.webp"><img src="docs/browse.webp" width="760" alt="Files"></a></p>

### Team builder

Pick an Identity per Sinner and an order: the page counts the statuses, damage types and sins the
team brings. A team code copied in the game (Sinners → the two-papers icon → Copy team code) loads here with its E.G.O,
and the team goes back to the game the same way (Copy team code).

<p align="center"><a href="docs/team-builder.webp"><img src="docs/team-builder.webp" width="760" alt="Team builder"></a></p>

### Mirror Dungeon planner

Pick the E.G.O gifts you want and get a route: which theme packs to take and on which floors. Some gifts drop only in
certain packs and some packs appear only on certain floors — the planner seats the packs so that as much of the build
as possible is reachable, adds the ingredients of fusions by itself and warns about what needs luck. Normal and Hard,
5, 10 or 15 floors; click a floor to see the other packs worth taking there and pin one.

<p align="center"><a href="docs/mirror.webp"><img src="docs/mirror.webp" width="760" alt="Mirror Dungeon planner"></a></p>

### Music player

A small player in the corner (folded into a square with a note until you click it) with the game's own soundtrack, read from its sound files: battle themes first,
under their official names, with the Canto and the boss a theme belongs to. Search by track, Canto or enemy.

<p align="center"><a href="docs/music.webp"><img src="docs/music.webp" width="420" alt="Music player"></a></p>

### Games

Guessing games, ten rounds each, Easy with four answers or Hard typing the name; hints cost
points. Puzzles. And two toys.

- **Guess the track:** a piece of the soundtrack plays from a random spot, and the sooner you name it
  the more it is worth. Also backwards, sped up, or with another track over it.
- **Guess the Identity:** a voice line of an Identity or a boss, by ear or by its text.
- **Guess the character:** a voiced line from the story — who says it?
- **Guess the skill:** a skill's picture — whose skill is it?
- **Guess the enemy:** a black silhouette that opens in steps; or an Identity in big pixels.
- **Guess the Canto:** a piece of a background from the story that zooms out.
- **Guess the art:** the same over the art of Identities and E.G.O.
- **In pieces:** an Identity's moving art as the game keeps it — cut into parts on a sheet; the
  parts come in steps.
- **Odd one out:** four Identities, three with something in common — find the fourth and say what
  the others share.
- **Limbus Wordle:** one hidden Identity, eight tries; each try shows what it shares with the hidden
  one — Sinner, season, rarity, archetype, damage, faction.
- **Connections:** sixteen Identities, four groups of four with something in common.
- **Limbus Grid:** a 3 × 3 grid with a condition on every row and column — name an Identity for
  each cell, nine tries.
- **Chain:** from one Identity to another, each step sharing the Sinner or a faction with the one
  before — in the fewest links.
- **Jigsaw:** an Identity's art cut into tiles and shuffled — put it together against the clock.
- **Mixed up:** a piece of a track cut into parts and shuffled — listen and put them back in order.
- **Guess the buff:** the effect of a buff or a debuff plays — which one is it?
- **Spot the difference:** an Identity's art twice, the second changed in a few spots.
- **When was it:** an Identity or an E.G.O — put the mark on the game's timeline where it came out.
- **Guess who** (for two, in a room or against the game): the same 24 Identities and a hidden one
  each; ask what the other's is, the game answers and darkens the cards it can't be — name it first.
- **Extraction** (its own tab, with your lunacy next to it): the game's own extraction — its banners with their real pools and chances,
  the orb in chains, every 000 and E.G.O shown with its line and voice, the ten cards. All of it with
  the game's pictures and sounds.
- **Challenge roulette** (a toy): a random team and a rule to play it by.

**Daily challenge:** the same game for everybody, new at the game's daily reset; the result copies
as a line of squares to share.

**Duel:** the same rounds for you and a friend. *By link* — the invite is there from the first round;
send it, each plays in their own time, and the result page's link carries the result to beat. *Live* —
a room for two to eight under nicknames, everybody at once: a **race** (each at their own pace) or
**first to answer** (rounds in step, the first right answer takes the round). Live needs the website.

**Lunacy:** the games pay it — a finished game, a Daily, days in a row, a duel won, eighteen
achievements — and Extraction spends it.

<p align="center"><a href="docs/games.webp"><img src="docs/games.webp" width="760" alt="Games"></a></p>

### Banner archive

The banners the app has seen, with the game's own pools and chances. The game describes only the banners of the day, so
the app keeps each new one and the list grows patch by patch. **Pull** opens any of them in Extraction, ended ones too.

<p align="center"><a href="docs/banners.webp"><img src="docs/banners.webp" width="760" alt="Banner archive"></a></p>

### Community

Who streams Limbus Company right now on Twitch and YouTube: English, Russian and Korean streams,
sorted by viewers, by start or by how long they have been live. While a big stream is on, the menu
button shows who it is.

<p align="center"><a href="docs/community.webp"><img src="docs/community.webp" width="760" alt="Community"></a></p>

Also: reset timers (daily, weekly, maintenance) at the top and a list of your snapshots.

## Requirements

- Windows 10 or 11, 64-bit.
- Limbus Company installed through **Steam** (the app finds it by itself in any Steam library).
- About 1 GB of free disk for the app's data (more if you render a lot of videos), and up to ~6 GB
  of RAM while the first snapshot is built.
- A graphics card for the skill renders (they run in Unity).
- [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (already there on
  Windows 11 and an updated Windows 10).
- Internet for some parts: Spine animations (the player loads from a CDN) and translations of
  Korean / Japanese lines.

Nothing else to install: Python, FFmpeg and the Unity player are inside the zip.

The app reads the game's files on your PC. It doesn't touch the running game or its servers.

## Install

1. Grab `LimbusArchive.zip` from [Releases](../../releases) and unzip it into a folder with free
   space (not Program Files): the app keeps its data in `data\` next to the exe.
2. Update the game, then run `LimbusArchive.exe`. If SmartScreen complains, click
   **More info → Run anyway**.
3. Hit **Take first snapshot** (about 10 minutes the first time).

After each patch, open the game so it downloads everything. The app notices the new version by
itself (on start, or within a couple of minutes if it's open) and builds the report. It also tells
you when a new version of the app is out; install it from the status button at the top.

## Build

Install [uv](https://docs.astral.sh/uv/) and run `build.ps1` (it sets up Python 3.12 and the
dependencies). The skill renderer (a Unity player) is not part of this repository; without it the
app is built without the renders with effects — take the `LimbusViewer` folder from a release zip
and put it next to the built exe to have them.

## Thanks

[UnityPy](https://github.com/K0lb3/UnityPy), [fmod_toolkit](https://github.com/K0lb3/fmod_toolkit),
[pywebview](https://pywebview.flowrl.com/), [FFmpeg](https://ffmpeg.org/),
[Unity](https://unity.com/), [Spine](https://esotericsoftware.com/) (its web player is loaded
from a CDN).

## License

MIT. Not affiliated with Project Moon; the game's assets belong to them.
