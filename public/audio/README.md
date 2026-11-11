# Game sound effects

Selected sounds in `sfx/` are from Kenney's CC0 audio packs. They may be used in personal and commercial projects; attribution is optional. The downloaded license texts are kept in `licenses/`.

- [RPG Audio](https://kenney.nl/assets/rpg-audio) — attack swishes.
- [Impact Sounds](https://kenney.nl/assets/impact-sounds) — footsteps, hits, material impacts, and pickups.
- [Interface Sounds](https://kenney.nl/assets/interface-sounds) — clicks, open/close, selection, and confirmation.
- [Sci-Fi Sounds](https://kenney.nl/assets/sci-fi-sounds) — lasers, explosions, force field, metal impacts, slime, thruster (`thrusterBurst_*` are the first 0.9 s of `thrusterFire_*`).
- [Digital Audio](https://kenney.nl/assets/digital-audio) — spell and ability tones, zaps, power-ups, notifications, robot death.
- RPG Audio is also the source of cloth, knife draw, chop, metal, book, leather, door and creak sounds.

Sounds that have no recording — monster growls and wails, bow twang, water steps, eating and drinking, acid sizzle,
and the whole ambience (wind, surf, crickets, birds, owl, city hum, campfire, Geiger counter, heartbeat) — are
synthesized in the browser by `public/js/audio.js` (`SYNTH` and `AMBIENT`).

All included assets are OGG files. The game loads them locally from this directory.
