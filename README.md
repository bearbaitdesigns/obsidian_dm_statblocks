# DM Statblocks — 2024 statblocks, monster builder, encounters and initiative for Obsidian

- **` ```statblock ``` ` code blocks** in the 2024 format (AC + Initiative, abilities with modifier and save, CR with XP and proficiency bonus). Click attack bonuses, damage dice, checks and saves to roll them (Shift = advantage or crit, Alt = disadvantage). Reuse a statblock with `monster: Bandit` + `rename: Captain Vex`.
- **Monster and villain builder:** a form with a live statblock preview, CR guidance, a hit-point calculator, attack and saving-throw helpers (attacks can pull weapons from the DM Codex Armory), and villain profiles. Saves to your Bestiary. Every statblock has an **Edit** button.
- **CR check:** works out defensive and offensive CR from the actual stats and compares them with the CR you chose, with a one-click fix.
- **Random monster:** suggests a CR from party level, size and difficulty (or takes a CR), then generates a full statblock by creature type, role and boss option.
- **Encounter builder:** live 2024 difficulty, suggestions from your Bestiary by environment, or a generated monster to fill the budget. Save encounters as notes, edit them, or run them.
- **Initiative tracker** (right sidebar): add the party or monsters, HP math (`-7`, `+5`, `t8`, `-2d6+3`), conditions linked to rules notes, Bloodied, concentration DCs, and encounter difficulty.

Works in **Live Preview**. Pairs with **[DM Codex](https://github.com/bearbaitdesigns/obsidian_dm_codex)** (dashboard, armory, spells, generators).

## Importing statblocks and art

The Monster/Villain builder can **import a statblock** from pasted text or from a picture (screenshot or photo), and add **art** that shows on the statblock. Imported art is saved to your attachments folder.

**Network use:** reading text from a picture uses [Tesseract.js](https://github.com/naptha/tesseract.js) (OCR). It is downloaded from `cdn.jsdelivr.net` the first time you use it, and only after you agree. Your image is processed on your device and is never uploaded. You can turn this off in Settings → DM Statblocks; pasting text works offline.

## Install
- **BRAT:** *Add beta plugin* and enter `bearbaitdesigns/obsidian_dm_statblocks`.
- **Manual:** copy `main.js`, `manifest.json` and `styles.css` from the latest release into `<vault>/.obsidian/plugins/dm-statblocks/`.

Settings and tracker state are mirrored to `.obsidian/dm-vault-dm-statblocks-settings-backup.json` and restored automatically if `data.json` is lost while you update.

## Development
Plain JavaScript, no build step: `main.js` *is* the source. Check it with `node --check main.js`.

### Releasing (GitHub Action)
The **Release** workflow runs on every push to `main`, on tags, and on demand. It checks `main.js`, then **creates** the GitHub release for the `manifest.json` version, or **replaces the files** on it if it already exists. To ship an update to BRAT users, bump `version` in `manifest.json`, add it to `versions.json`, and push.

After releasing DM Statblocks, re-run the DM Codex **Release** workflow (*Actions → Release → Run workflow*) so its starter vault picks up the new version.

## Licence
Code: MIT. Creature statistics and rules references include material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd, licensed under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/legalcode). The monster-generation targets are the author's own approximations, not official rules.
