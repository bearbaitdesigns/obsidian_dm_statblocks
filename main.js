/*
 * DM Statblocks — 2024-format (SRD 5.2) statblocks and an initiative / combat tracker.
 * Plain JavaScript, no build step. Statblocks are ```statblock code blocks (YAML) so they
 * render in Live Preview and Reading view, and can be embedded with ![[Monster Name]].
 */
'use strict';

const obsidian = require('obsidian');
const { Plugin, ItemView, Modal, FuzzySuggestModal, Notice, PluginSettingTab, Setting, TFile, MarkdownRenderer, parseYaml, Keymap } = obsidian;

/* Icon helper with fallbacks for older Obsidian versions whose bundled Lucide lacks newer names. */
const ICON_FALLBACKS = { 'user-round': ['user-2', 'user'], 'wand-sparkles': ['wand-2', 'wand', 'sparkles'], 'arrow-down-wide-narrow': ['sort-desc', 'arrow-down'], 'scroll-text': ['scroll', 'file-text'], 'flask-conical': ['flask-round', 'beaker'], 'dices': ['dice-5', 'dice'], 'dice-5': ['dices', 'dice'], 'backpack': ['briefcase', 'package'], 'list-ordered': ['list'], 'eye-off': ['eye'], 'swords': ['sword', 'crosshair'], 'sword': ['swords', 'crosshair'], 'store': ['shopping-bag', 'home'], 'table': ['table-2', 'grid'], 'crown': ['award', 'star'], 'castle': ['home'], 'hand': ['gift'], 'layers': ['copy'], 'wand': ['wand-2', 'sparkles'], 'skull': ['ghost', 'alert-triangle'], 'beer': ['coffee', 'cup-soda'], 'hammer': ['wrench'], 'text-cursor-input': ['type', 'edit'], 'file-plus': ['file', 'plus'], 'user-plus': ['user', 'plus'] };
function setIcon(el, name) {
  const tryOne = n => { try { if (el.empty) el.empty(); obsidian.setIcon(el, n); } catch (e) { return false; } return !!(el.querySelector && el.querySelector('svg')); };
  if (tryOne(name)) return;
  for (const alt of (ICON_FALLBACKS[name] || [])) if (tryOne(alt)) return;
  tryOne('circle');
}

const TRACKER_VIEW = 'dm-statblocks-tracker';

const CR_XP = { '0': 10, '1/8': 25, '1/4': 50, '1/2': 100, '1': 200, '2': 450, '3': 700, '4': 1100, '5': 1800, '6': 2300, '7': 2900, '8': 3900, '9': 5000, '10': 5900, '11': 7200, '12': 8400, '13': 10000, '14': 11500, '15': 13000, '16': 15000, '17': 18000, '18': 20000, '19': 22000, '20': 25000, '21': 33000, '22': 41000, '23': 50000, '24': 62000, '25': 75000, '26': 90000, '27': 105000, '28': 120000, '29': 135000, '30': 155000 };
// 2024 encounter XP budget per character: [Low, Moderate, High]
const XP_BUDGET = { 1: [50, 75, 100], 2: [100, 150, 200], 3: [150, 225, 400], 4: [250, 375, 500], 5: [500, 750, 1100], 6: [600, 1000, 1400], 7: [750, 1300, 1700], 8: [1000, 1700, 2100], 9: [1300, 2000, 2600], 10: [1600, 2300, 3100], 11: [1900, 2900, 4100], 12: [2200, 3700, 4700], 13: [2600, 4200, 5400], 14: [2900, 4900, 6200], 15: [3300, 5400, 7800], 16: [3800, 6100, 9800], 17: [4500, 7200, 11700], 18: [5000, 8700, 14200], 19: [5500, 10700, 17200], 20: [6400, 13200, 22000] };
const CONDITIONS = ['Blinded', 'Charmed', 'Concentrating', 'Deafened', 'Exhaustion 1', 'Exhaustion 2', 'Exhaustion 3', 'Exhaustion 4', 'Exhaustion 5', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious', 'Bloodied', 'Hidden', 'Dodging', 'Raging'];
const ABILS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

const DEFAULTS = { rollMonsterHp: false, groupSameMonsters: false, rulesFolder: 'Rules 2024', templatesFolder: 'Templates', bestiaryFolder: 'Bestiary', state: { combatants: [], round: 1, turn: 0, started: false } };

/* ---------------- dice ---------------- */
function rnd(n) { return Math.floor(Math.random() * n) + 1; }
function rollDice(input) {
  let expr = String(input).trim().toLowerCase().replace(/−/g, '-'), mode = null;
  const m = expr.match(/\s+(adv|dis)\w*$/); if (m) { mode = m[1]; expr = expr.slice(0, m.index); }
  expr = expr.replace(/\s+/g, '');
  const re = /([+-])?(?:(\d*)d(\d+)|(\d+))/gy; let pos = 0, total = 0, parts = [], used = false;
  while (pos < expr.length) {
    re.lastIndex = pos; const t = re.exec(expr); if (!t || !t[0]) throw new Error('Bad roll: ' + input);
    pos = re.lastIndex; const s = t[1] === '-' ? -1 : 1;
    if (t[3]) {
      let c = parseInt(t[2] || '1', 10); const d = parseInt(t[3], 10); let rolls = Array.from({ length: c }, () => rnd(d));
      let shown = rolls.join(',');
      if (mode && !used && d === 20 && c === 1) { const r2 = rnd(20); used = true; const keep = mode === 'adv' ? Math.max(rolls[0], r2) : Math.min(rolls[0], r2); shown = rolls[0] + ',' + r2 + '→' + keep; rolls = [keep]; }
      total += s * rolls.reduce((a, b) => a + b, 0); parts.push((s < 0 ? '-' : parts.length ? '+' : '') + c + 'd' + d + '[' + shown + ']');
    } else { total += s * parseInt(t[4], 10); parts.push((s < 0 ? '-' : parts.length ? '+' : '') + t[4]); }
  }
  return { total, detail: parts.join(' ') };
}
function notifyRoll(expr, label) {
  try { const r = rollDice(expr); const nat = /^1d20|^d20/.test(expr.replace(/\s/g, '')) ? '' : ''; new Notice((label ? label + ' → ' : '') + r.total + nat + '\n' + r.detail, 7000); return r; }
  catch (e) { new Notice(e.message); }
}

/* ---------------- helpers ---------------- */
const mod = s => Math.floor((Number(s) - 10) / 2);
const fmt = n => (n >= 0 ? '+' : '−') + Math.abs(n);
function pbForCr(cr) { const v = crNum(cr); if (v < 5) return 2; if (v < 9) return 3; if (v < 13) return 4; if (v < 17) return 5; if (v < 21) return 6; if (v < 25) return 7; if (v < 29) return 8; return 9; }
function crNum(cr) { const s = String(cr ?? '0'); if (s.includes('/')) { const [a, b] = s.split('/'); return Number(a) / Number(b); } return Number(s) || 0; }
function lpSafe(el) { ['mousedown', 'pointerdown'].forEach(ev => el.addEventListener(ev, e => e.stopPropagation())); return el; }
function btn(parent, text, icon, onClick, cls) {
  const b = parent.createEl('button', { cls: 'dms-btn' + (cls ? ' ' + cls : '') });
  if (icon) setIcon(b.createSpan({ cls: 'dms-ic' }), icon);
  if (text) b.createSpan({ text });
  lpSafe(b); b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onClick(e); }); return b;
}
async function renderMd(app, md, el, path, comp) {
  if (MarkdownRenderer.render) return MarkdownRenderer.render(app, md, el, path, comp);
  return MarkdownRenderer.renderMarkdown(md, el, path, comp);
}
function asList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(x => typeof x === 'string' ? { name: '', desc: x } : { name: x.name || '', desc: x.desc || x.description || '' });
  if (typeof v === 'object') return Object.entries(v).map(([name, desc]) => ({ name, desc: String(desc) }));
  return [{ name: '', desc: String(v) }];
}
function extractStatblock(text) {
  const m = text.match(/```statblock[^\n]*\n([\s\S]*?)```/);
  if (!m) return null;
  try { return parseYaml(m[1]); } catch (e) { return null; }
}

/** Make attack bonuses and damage dice clickable inside rendered statblock text. */
function linkifyRolls(root, label) {
  const RX = /([+−-]\s?\d+)(?=\s*,\s*(?:reach|range))|\((\d+d\d+(?:\s*[+−-]\s*\d+)?)\)|\b(\d+d\d+(?:\s*[+−-]\s*\d+)?)\b/g;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = []; let n; while ((n = walker.nextNode())) if (!n.parentElement.closest('a, .dms-roll')) nodes.push(n);
  for (const node of nodes) {
    const text = node.nodeValue; RX.lastIndex = 0; if (!RX.test(text)) continue; RX.lastIndex = 0;
    const frag = document.createDocumentFragment(); let last = 0, m;
    while ((m = RX.exec(text))) {
      frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[1]) {
        const s = document.createElement('span'); s.className = 'dms-roll dms-roll-attack'; s.textContent = m[1];
        const bonus = m[1].replace(/[−\s]/g, c => c === '−' ? '-' : '');
        s.title = 'Roll attack (Shift = advantage, Alt = disadvantage)';
        s.addEventListener('click', e => { e.stopPropagation(); const mode = e.shiftKey ? ' adv' : e.altKey ? ' dis' : ''; notifyRoll('1d20' + (bonus.startsWith('-') ? bonus : '+' + bonus.replace('+', '')) + mode, label + ' attack'); });
        lpSafe(s); frag.appendChild(s);
      } else {
        const dice = (m[2] || m[3]);
        const s = document.createElement('span'); s.className = 'dms-roll'; s.textContent = m[2] ? '(' + dice + ')' : dice; s.title = 'Roll ' + dice + ' (Shift = critical: double dice)';
        s.addEventListener('click', e => {
          e.stopPropagation();
          let expr = dice.replace(/−/g, '-');
          if (e.shiftKey) expr = expr.replace(/(\d+)d(\d+)/, (_, c, d) => (2 * Number(c)) + 'd' + d);
          notifyRoll(expr, label + (e.shiftKey ? ' crit' : ' damage'));
        });
        lpSafe(s); frag.appendChild(s);
      }
      last = RX.lastIndex;
    }
    frag.appendChild(document.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}

/* ---------------- modals ---------------- */
class FileSuggest extends FuzzySuggestModal {
  constructor(app, items, onChoose, ph) { super(app); this.items = items; this.onChoose = onChoose; this.setPlaceholder(ph || 'Choose…'); }
  getItems() { return this.items; }
  getItemText(i) { return i.label || i.basename; }
  onChooseItem(i) { this.onChoose(i); }
}
class CustomCombatantModal extends Modal {
  constructor(app, onSubmit) { super(app); this.onSubmit = onSubmit; }
  onOpen() {
    const c = this.contentEl; c.createEl('h3', { text: 'Add combatant' });
    const v = { name: '', initBonus: 0, hp: 10, ac: 10, count: 1 };
    new Setting(c).setName('Name').addText(t => t.onChange(x => v.name = x));
    new Setting(c).setName('Initiative bonus').addText(t => t.setValue('0').onChange(x => v.initBonus = Number(x) || 0));
    new Setting(c).setName('HP').addText(t => t.setValue('10').onChange(x => v.hp = Number(x) || 1));
    new Setting(c).setName('AC').addText(t => t.setValue('10').onChange(x => v.ac = Number(x) || 10));
    new Setting(c).setName('How many').addText(t => t.setValue('1').onChange(x => v.count = Math.max(1, Number(x) || 1)));
    new Setting(c).addButton(b => b.setButtonText('Add').setCta().onClick(() => { if (!v.name) return; this.close(); this.onSubmit(v); }));
  }
  onClose() { this.contentEl.empty(); }
}

/* ---------------- tracker view ---------------- */
class TrackerView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return TRACKER_VIEW; }
  getDisplayText() { return 'Initiative tracker'; }
  getIcon() { return 'swords'; }
  async onOpen() { this.render(); }
  get state() { return this.plugin.settings.state; }
  save() { this.plugin.saveSettings(); this.render(); }
  render() {
    const el = this.contentEl; el.empty(); el.addClass('dms-tracker');
    const s = this.state;
    const top = el.createDiv({ cls: 'dms-tr-top' });
    top.createDiv({ cls: 'dms-round', text: s.started ? 'Round ' + s.round : 'Not started' });
    const bar = el.createDiv({ cls: 'dms-row dms-wrap' });
    btn(bar, '', 'users', () => this.plugin.addParty(), null).setAttr('aria-label', 'Add party');
    btn(bar, '', 'skull', () => this.plugin.pickMonster(), null).setAttr('aria-label', 'Add monster from Bestiary');
    btn(bar, '', 'user-plus', () => new CustomCombatantModal(this.app, v => this.plugin.addCustom(v)).open()).setAttr('aria-label', 'Add custom combatant');
    btn(bar, '', 'dices', () => this.rollAll(), null).setAttr('aria-label', 'Roll initiative for everyone without a value');
    btn(bar, '', 'arrow-down-wide-narrow', () => { this.sort(); this.save(); }).setAttr('aria-label', 'Sort by initiative');
    btn(bar, '', 'trash-2', () => { s.combatants = []; s.round = 1; s.turn = 0; s.started = false; this.save(); }).setAttr('aria-label', 'Clear encounter');
    const nav = el.createDiv({ cls: 'dms-row' });
    if (!s.started) btn(nav, 'Start combat', 'play', () => { this.rollAll(); this.sort(); s.started = true; s.round = 1; s.turn = 0; this.save(); }, 'mod-cta');
    else {
      btn(nav, 'Prev', 'chevron-left', () => this.step(-1));
      btn(nav, 'Next turn', 'chevron-right', () => this.step(1), 'mod-cta');
      btn(nav, 'End', 'square', () => { s.started = false; this.save(); });
    }
    this.renderDifficulty(el);
    const list = el.createDiv({ cls: 'dms-list' });
    if (!s.combatants.length) list.createDiv({ cls: 'dms-muted', text: 'Add the party and some monsters to begin. Tip: every statblock has an “Add to combat” button.' });
    s.combatants.forEach((c, i) => this.renderRow(list, c, i));
  }
  renderDifficulty(el) {
    const s = this.state;
    const players = s.combatants.filter(c => c.player && c.level);
    const monsters = s.combatants.filter(c => !c.player && c.xp);
    if (!players.length || !monsters.length) return;
    const budget = [0, 0, 0]; players.forEach(p => { const b = XP_BUDGET[Math.min(20, Math.max(1, p.level))]; budget[0] += b[0]; budget[1] += b[1]; budget[2] += b[2]; });
    const xp = monsters.reduce((a, m) => a + (m.xp || 0), 0);
    const label = xp > budget[2] ? 'Beyond High ⚠' : xp > budget[1] ? 'High' : xp > budget[0] ? 'Moderate' : 'Low';
    const d = el.createDiv({ cls: 'dms-diff dms-diff-' + label.split(' ')[0].toLowerCase() });
    d.setText('Encounter: ' + label + ' — ' + xp + ' XP (budget L ' + budget[0] + ' · M ' + budget[1] + ' · H ' + budget[2] + ')');
  }
  renderRow(list, c, i) {
    const s = this.state;
    const row = list.createDiv({ cls: 'dms-row-c' + (s.started && i === s.turn ? ' is-turn' : '') + (c.hp <= 0 ? ' is-down' : '') + (c.player ? ' is-player' : '') });
    const init = row.createEl('input', { type: 'number', cls: 'dms-init', value: c.init ?? '' }); init.title = 'Initiative (bonus ' + fmt(c.initBonus || 0) + ')';
    init.addEventListener('change', () => { c.init = init.value === '' ? null : Number(init.value); this.plugin.saveSettings(); });
    const main = row.createDiv({ cls: 'dms-main' });
    const nameRow = main.createDiv({ cls: 'dms-name-row' });
    const name = nameRow.createEl('a', { cls: 'dms-name', text: c.name });
    name.addEventListener('click', e => { if (c.path) this.app.workspace.openLinkText(c.path, '', Keymap.isModEvent(e) || true); });
    if (c.path) name.addEventListener('mouseover', e => this.app.workspace.trigger('hover-link', { event: e, source: TRACKER_VIEW, hoverParent: this, targetEl: name, linktext: c.path }));
    nameRow.createSpan({ cls: 'dms-ac', text: 'AC ' + c.ac });
    // HP
    const hpRow = main.createDiv({ cls: 'dms-hp-row' });
    const pct = c.maxHp ? Math.max(0, Math.min(1, c.hp / c.maxHp)) : 1;
    const bar = hpRow.createDiv({ cls: 'dms-hpbar' }); const fill = bar.createDiv({ cls: 'dms-hpfill' }); fill.style.width = (pct * 100) + '%';
    if (pct <= 0.5) fill.addClass('is-bloodied');
    hpRow.createSpan({ cls: 'dms-hp-text', text: c.hp + '/' + c.maxHp + (c.temp ? ' (+' + c.temp + ')' : '') });
    const dmg = hpRow.createEl('input', { type: 'text', cls: 'dms-dmg', attr: { placeholder: '−dmg / +heal' } });
    dmg.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return; const raw = dmg.value.trim(); if (!raw) return;
      let n; try { n = /d/.test(raw) ? rollDice(raw.replace(/^[+-]/, '')).total * (raw.startsWith('+') ? 1 : -1) : Number(raw); } catch (er) { new Notice(er.message); return; }
      if (raw.startsWith('t')) { c.temp = Math.max(0, Number(raw.slice(1)) || 0); }
      else if (n > 0 && raw.startsWith('+')) c.hp = Math.min(c.maxHp, c.hp + n);
      else { let d = Math.abs(n); if (c.temp) { const used = Math.min(c.temp, d); c.temp -= used; d -= used; } c.hp = Math.max(0, c.hp - d);
        if (c.conditions.includes('Concentrating') && Math.abs(n) > 0) new Notice(c.name + ': Concentration save DC ' + Math.min(30, Math.max(10, Math.floor(Math.abs(n) / 2))));
        if (c.hp <= 0) new Notice(c.name + (c.player ? ' drops to 0 HP — Unconscious, start death saves.' : ' is down!')); }
      if (c.hp > 0 && c.hp <= c.maxHp / 2 && !c.conditions.includes('Bloodied')) c.conditions.push('Bloodied');
      if (c.hp > c.maxHp / 2) c.conditions = c.conditions.filter(x => x !== 'Bloodied');
      this.save();
    });
    dmg.title = 'Type -7 for damage, +5 to heal, t8 for temp HP, or dice like -2d6+3';
    // conditions
    const conds = main.createDiv({ cls: 'dms-conds' });
    c.conditions.forEach(cn => {
      const p = conds.createSpan({ cls: 'dms-cond', text: cn }); p.title = 'Click: open rule · Right-click: remove';
      p.addEventListener('click', () => {
        const base = cn === 'Concentrating' ? 'Concentration' : cn.replace(/ \d$/, '');
        const dest = this.app.metadataCache.getFirstLinkpathDest(base, '');
        if (dest) this.app.workspace.openLinkText(dest.path, '', true); else new Notice('No rules note named "' + base + '"');
      });
      p.addEventListener('contextmenu', e => { e.preventDefault(); c.conditions = c.conditions.filter(x => x !== cn); this.save(); });
    });
    const add = conds.createEl('select', { cls: 'dms-cond-add' });
    add.createEl('option', { text: '+ condition', value: '' });
    CONDITIONS.filter(x => !c.conditions.includes(x)).forEach(x => add.createEl('option', { text: x, value: x }));
    add.addEventListener('change', () => { if (add.value) { c.conditions = c.conditions.filter(x => !(x.startsWith('Exhaustion') && add.value.startsWith('Exhaustion'))); c.conditions.push(add.value); this.save(); } });
    // controls
    const ctr = row.createDiv({ cls: 'dms-ctr' });
    btn(ctr, '', 'x', () => { s.combatants.splice(i, 1); if (s.turn >= s.combatants.length) s.turn = 0; this.save(); }).setAttr('aria-label', 'Remove');
  }
  rollAll() {
    this.state.combatants.forEach(c => { if (c.init == null || c.init === '') c.init = rnd(20) + (c.initBonus || 0); });
    this.save();
  }
  sort() {
    const cur = this.state.combatants[this.state.turn];
    this.state.combatants.sort((a, b) => (b.init ?? -99) - (a.init ?? -99) || (b.initBonus || 0) - (a.initBonus || 0) || (a.player ? -1 : 1));
    if (cur) this.state.turn = Math.max(0, this.state.combatants.indexOf(cur));
  }
  step(d) {
    const s = this.state; if (!s.combatants.length) return;
    let t = s.turn + d;
    if (t >= s.combatants.length) { t = 0; s.round++; }
    if (t < 0) { t = s.combatants.length - 1; s.round = Math.max(1, s.round - 1); }
    s.turn = t; const c = s.combatants[t];
    if (c && c.conditions.length) new Notice(c.name + "'s turn — " + c.conditions.join(', '));
    this.save();
  }
}

/* ---------------- settings ---------------- */
class StatSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const c = this.containerEl; c.empty(); const s = this.plugin.settings;
    new Setting(c).setName('Roll monster HP').setDesc('Roll hit dice when adding monsters instead of using the average.')
      .addToggle(t => t.setValue(s.rollMonsterHp).onChange(async v => { s.rollMonsterHp = v; await this.plugin.saveSettings(); }));
  }
}

/* ---------------- plugin ---------------- */
class DMStatblocksPlugin extends Plugin {
  async onload() {
    let data = await this.loadData();
    if (!data) data = (await this.readBackup()) || {};
    this.settings = Object.assign({}, DEFAULTS, data); this.settings.state = Object.assign({}, DEFAULTS.state, data.state || {});
    this.registerView(TRACKER_VIEW, leaf => new TrackerView(leaf, this));
    this.addRibbonIcon('swords', 'Initiative tracker', () => this.openTracker());
    this.addSettingTab(new StatSettings(this.app, this));
    this.addCommand({ id: 'open-tracker', name: 'Open initiative tracker', callback: () => this.openTracker() });
    this.addCommand({ id: 'add-party', name: 'Add party to combat', callback: () => this.addParty() });
    this.addCommand({ id: 'add-monster', name: 'Add monster to combat…', callback: () => this.pickMonster() });
    this.addCommand({ id: 'add-current', name: 'Add current note\'s statblock to combat', callback: async () => {
      const f = this.app.workspace.getActiveFile(); if (!f) return; const sb = extractStatblock(await this.app.vault.read(f));
      if (!sb) new Notice('No statblock in this note.'); else this.addMonster(sb, f.path, 1);
    } });
    this.addCommand({ id: 'insert-statblock', name: 'Insert blank statblock', editorCallback: ed => ed.replaceSelection(BLANK) });
    this.addCommand({ id: 'next-turn', name: 'Next turn', callback: () => this.withTracker(v => v.step(1)) });
    this.registerMarkdownCodeBlockProcessor('statblock', (src, el, ctx) => this.renderStatblock(src, el, ctx));
    this.registerMarkdownCodeBlockProcessor('encounter', (src, el, ctx) => this.renderEncounter(src, el, ctx));
    this.registerMonsterTools();
    this.registerEncounterTools();
  }
  async saveSettings() { await this.saveData(this.settings); await this.writeBackup(this.settings); }
  backupPath() { return this.app.vault.configDir + '/dm-vault-' + this.manifest.id + '-settings-backup.json'; }
  async readBackup() { try { const p = this.backupPath(); if (await this.app.vault.adapter.exists(p)) return JSON.parse(await this.app.vault.adapter.read(p)); } catch (e) {} return null; }
  async writeBackup(d) { try { await this.app.vault.adapter.write(this.backupPath(), JSON.stringify(d)); } catch (e) {} }

  async openTracker() {
    let leaf = this.app.workspace.getLeavesOfType(TRACKER_VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false); await leaf.setViewState({ type: TRACKER_VIEW, active: true }); }
    this.app.workspace.revealLeaf(leaf); return leaf;
  }
  async withTracker(fn) { const leaf = await this.openTracker(); if (leaf.view instanceof TrackerView) fn(leaf.view); }
  refresh() { this.app.workspace.getLeavesOfType(TRACKER_VIEW).forEach(l => l.view instanceof TrackerView && l.view.render()); this.saveSettings(); }
  fm(f) { return (this.app.metadataCache.getFileCache(f) || {}).frontmatter || {}; }
  isTemplate(f) { const t = (this.settings.templatesFolder || 'Templates').replace(/\/$/, '') + '/'; return f.path.startsWith(t) || f.basename.includes('{{'); }
  activePlayers() { return this.app.vault.getMarkdownFiles().filter(f => !this.isTemplate(f) && this.fm(f).type === 'player' && (this.fm(f).status || 'active') === 'active'); }

  addParty() {
    const players = this.activePlayers();
    if (!players.length) { new Notice('No active player notes (type: player) found.'); return; }
    const st = this.settings.state;
    players.forEach(f => {
      if (st.combatants.some(c => c.path === f.path)) return;
      const fm = this.fm(f); const hp = Number(fm.hp_max) || 10;
      st.combatants.push({ id: Date.now() + Math.random(), name: fm.character || f.basename, path: f.path, player: true, level: Number(fm.level) || 1, init: null, initBonus: Number(fm.init_bonus) || 0, hp: Number(fm.hp_current ?? hp), maxHp: hp, temp: 0, ac: Number(fm.ac) || 10, conditions: [] });
    });
    this.openTracker().then(() => this.refresh());
  }
  async pickMonster() {
    const files = this.app.vault.getMarkdownFiles().filter(f => { if (this.isTemplate(f)) return false; const t = this.fm(f).type; return t === 'monster' || t === 'npc' && this.fm(f).statblock; });
    const items = files.map(f => ({ file: f, label: f.basename + (this.fm(f).cr != null ? '  (CR ' + this.fm(f).cr + ')' : '') }));
    if (!items.length) { new Notice('No monster notes found (type: monster).'); return; }
    new FileSuggest(this.app, items, async it => {
      const sb = extractStatblock(await this.app.vault.read(it.file));
      if (!sb) { new Notice('That note has no ```statblock block.'); return; }
      new CountModal(this.app, sb.name || it.file.basename, n => this.addMonster(sb, it.file.path, n)).open();
    }, 'Add which monster?').open();
  }
  addMonster(sb, path, count = 1) {
    const st = this.settings.state;
    const dexMod = mod(sb.dex ?? 10); const pb = Number(sb.pb) || pbForCr(sb.cr);
    const initBonus = sb.initiative != null ? Number(String(sb.initiative).replace(/[^\d-]/g, '')) : dexMod;
    const avg = Number(sb.hp) || 1; const xp = Number(sb.xp) || CR_XP[String(sb.cr)] || 0;
    const existing = st.combatants.filter(c => c.base === (sb.name || 'Monster')).length;
    for (let i = 0; i < count; i++) {
      let hp = avg; if (this.settings.rollMonsterHp && sb.hit_dice) { try { hp = Math.max(1, rollDice(sb.hit_dice).total); } catch (e) {} }
      const n = existing + i + 1;
      st.combatants.push({ id: Date.now() + Math.random(), base: sb.name || 'Monster', name: (sb.name || 'Monster') + (count > 1 || existing ? ' ' + n : ''), path, player: false, xp, init: null, initBonus, hp, maxHp: hp, temp: 0, ac: Number(String(sb.ac).match(/\d+/)?.[0]) || 10, conditions: [] });
    }
    new Notice('Added ' + count + '× ' + (sb.name || 'monster'));
    this.openTracker().then(() => this.refresh());
  }
  addCustom(v) {
    const st = this.settings.state;
    for (let i = 0; i < v.count; i++) st.combatants.push({ id: Date.now() + Math.random(), name: v.name + (v.count > 1 ? ' ' + (i + 1) : ''), player: false, init: null, initBonus: v.initBonus, hp: v.hp, maxHp: v.hp, temp: 0, ac: v.ac, conditions: [] });
    this.refresh();
  }

  /* ----- statblock rendering ----- */
  async renderStatblock(src, el, ctx) {
    let sb;
    try { sb = parseYaml(src) || {}; } catch (e) { el.createDiv({ cls: 'dms-error', text: 'Statblock YAML error: ' + e.message }); return; }
    // allow "monster: Goblin Warrior" to pull a statblock from another note
    if (sb.monster && Object.keys(sb).length <= 3) {
      const f = this.app.metadataCache.getFirstLinkpathDest(String(sb.monster).replace(/^\[\[|\]\]$/g, ''), ctx.sourcePath);
      const other = f ? extractStatblock(await this.app.vault.cachedRead(f)) : null;
      if (!other) { el.createDiv({ cls: 'dms-error', text: 'Statblock not found: ' + sb.monster }); return; }
      sb = Object.assign({}, other, sb, { _from: f.path }); if (sb.rename) sb.name = sb.rename;
    }
    const comp = new obsidian.MarkdownRenderChild(el); ctx.addChild(comp);
    return this.drawStatblock(sb, el, ctx.sourcePath, comp);
  }

  async drawStatblock(sb, el, sourcePath, comp) {
    const box = el.createDiv({ cls: 'dms-statblock' }); lpSafe(box);
    const name = sb.name || 'Unnamed';
    const pb = Number(sb.pb) || pbForCr(sb.cr);
    const head = box.createDiv({ cls: 'dms-head' });
    const titleRow = head.createDiv({ cls: 'dms-title-row' });
    titleRow.createDiv({ cls: 'dms-title', text: name });
    const actions = titleRow.createDiv({ cls: 'dms-head-actions' });
    btn(actions, 'Add to combat', 'swords', () => this.addMonster(sb, sb._from || sourcePath, 1)).setAttr('aria-label', 'Add to initiative tracker');
    if (!sb._from && !sb._preview && sourcePath) btn(actions, 'Edit', 'pencil', () => this.openBuilderForFile(sourcePath)).setAttr('aria-label', 'Edit in monster builder');
    head.createDiv({ cls: 'dms-sub', text: [sb.size, sb.type].filter(Boolean).join(' ') + (sb.alignment ? ', ' + sb.alignment : '') });
    box.createDiv({ cls: 'dms-rule' });

    const dexMod = mod(sb.dex ?? 10);
    let initBonus = sb.initiative != null ? Number(String(sb.initiative).replace(/[^\d-]/g, '')) : dexMod;
    const basics = box.createDiv({ cls: 'dms-basics' });
    const line = (label, val, cls) => { if (val == null || val === '') return null; const d = basics.createDiv({ cls: 'dms-line ' + (cls || '') }); d.createSpan({ cls: 'dms-label', text: label + ' ' }); const v = d.createSpan({ text: String(val) }); return v; };
    const acRow = basics.createDiv({ cls: 'dms-line dms-two' });
    const ac = acRow.createDiv(); ac.createSpan({ cls: 'dms-label', text: 'AC ' }); ac.appendText(String(sb.ac ?? '—'));
    const ini = acRow.createDiv(); ini.createSpan({ cls: 'dms-label', text: 'Initiative ' });
    const iniRoll = ini.createSpan({ cls: 'dms-roll', text: fmt(initBonus) + ' (' + (10 + initBonus) + ')' });
    iniRoll.addEventListener('click', e => { e.stopPropagation(); notifyRoll('1d20+' + initBonus, name + ' initiative'); });
    const hpv = line('HP', (sb.hp ?? '—') + (sb.hit_dice ? ' (' + sb.hit_dice + ')' : ''));
    line('Speed', sb.speed || '30 ft.');

    // abilities: 2024 layout (score / mod / save)
    const saves = sb.saves || {};
    const saveProf = Array.isArray(saves) ? saves.map(s => String(s).toLowerCase().slice(0, 3)) : [];
    const table = box.createDiv({ cls: 'dms-abilities' });
    ABILS.forEach(a => {
      const score = Number(sb[a] ?? 10); const m = mod(score);
      let sv = m; if (saveProf.includes(a)) sv = m + pb; else if (!Array.isArray(saves) && saves[a] != null) sv = Number(String(saves[a]).replace(/[^\d-]/g, ''));
      const cell = table.createDiv({ cls: 'dms-abil' + (sv !== m ? ' is-prof' : '') });
      cell.createDiv({ cls: 'dms-abil-name', text: a.toUpperCase() });
      cell.createDiv({ cls: 'dms-abil-score', text: String(score) });
      const row = cell.createDiv({ cls: 'dms-abil-mods' });
      const mm = row.createSpan({ cls: 'dms-roll', text: fmt(m) }); mm.title = 'Check';
      mm.addEventListener('click', e => { e.stopPropagation(); notifyRoll('1d20' + (m >= 0 ? '+' : '') + m + (e.shiftKey ? ' adv' : e.altKey ? ' dis' : ''), name + ' ' + a.toUpperCase() + ' check'); });
      const ss = row.createSpan({ cls: 'dms-roll dms-save', text: fmt(sv) }); ss.title = 'Saving throw';
      ss.addEventListener('click', e => { e.stopPropagation(); notifyRoll('1d20' + (sv >= 0 ? '+' : '') + sv + (e.shiftKey ? ' adv' : e.altKey ? ' dis' : ''), name + ' ' + a.toUpperCase() + ' save'); });
      lpSafe(mm); lpSafe(ss);
    });
    table.createDiv({ cls: 'dms-abil-legend', text: 'score · mod · save' });

    const details = box.createDiv({ cls: 'dms-basics' });
    const dline = async (label, val) => {
      if (val == null || val === '' || (Array.isArray(val) && !val.length)) return;
      const d = details.createDiv({ cls: 'dms-line' }); d.createSpan({ cls: 'dms-label', text: label + ' ' });
      const span = d.createSpan(); await renderMd(this.app, Array.isArray(val) ? val.join(', ') : String(val), span, sourcePath, comp);
      span.querySelectorAll('p').forEach(p => p.style.display = 'inline');
    };
    const skills = sb.skills && typeof sb.skills === 'object' && !Array.isArray(sb.skills) ? Object.entries(sb.skills).map(([k, v]) => k + ' ' + (String(v).match(/^[+-]/) ? v : fmt(Number(v)))).join(', ') : sb.skills;
    await dline('Skills', skills);
    await dline('Vulnerabilities', sb.vulnerabilities);
    await dline('Resistances', sb.resistances);
    await dline('Immunities', sb.immunities);
    await dline('Gear', sb.gear);
    await dline('Senses', sb.senses);
    await dline('Languages', sb.languages || '—');
    const xp = sb.xp || CR_XP[String(sb.cr)];
    await dline('CR', (sb.cr ?? '—') + (xp != null ? ' (XP ' + Number(xp).toLocaleString() + (sb.xp_lair ? ', or ' + Number(sb.xp_lair).toLocaleString() + ' in lair' : '') + '; PB ' + fmt(pb) + ')' : ''));

    const section = async (title, list, intro) => {
      const items = asList(list); if (!items.length && !intro) return;
      box.createDiv({ cls: 'dms-section', text: title });
      if (intro) { const p = box.createDiv({ cls: 'dms-entry' }); await renderMd(this.app, String(intro), p, sourcePath, comp); linkifyRolls(p, name); }
      for (const it of items) {
        const p = box.createDiv({ cls: 'dms-entry' });
        const md = (it.name ? '***' + it.name.replace(/\.$/, '') + '.*** ' : '') + it.desc;
        await renderMd(this.app, md, p, sourcePath, comp);
        linkifyRolls(p, name + (it.name ? ' – ' + it.name : ''));
      }
    };
    await section('Traits', sb.traits);
    await section('Actions', sb.actions);
    await section('Bonus Actions', sb.bonus_actions);
    await section('Reactions', sb.reactions);
    await section('Legendary Actions', sb.legendary_actions, sb.legendary_intro);
    if (sb.source) box.createDiv({ cls: 'dms-source', text: sb.source });
  }

  /**
   * ```encounter
   * party: true            # include active party
   * monsters:
   *   - Goblin Warrior x4
   *   - "[[Goblin Boss]]"
   * ```
   */
  async renderEncounter(src, el, ctx) {
    let o; try { o = parseYaml(src) || {}; } catch (e) { el.createDiv({ cls: 'dms-error', text: e.message }); return; }
    const box = el.createDiv({ cls: 'dms-encounter' }); lpSafe(box);
    const entries = [];
    for (const raw of [].concat(o.monsters || [])) {
      const m = String(raw).match(/^\s*(?:\[\[)?([^\]×]+?)(?:\]\])?\s*(?:[x×]\s*(\d+))?\s*$/i);
      if (!m) continue; const nm = m[1].trim(), n = Number(m[2] || 1);
      const f = this.app.metadataCache.getFirstLinkpathDest(nm, ctx.sourcePath);
      const sb = f ? extractStatblock(await this.app.vault.cachedRead(f)) : null;
      entries.push({ name: nm, n, f, sb, xp: sb ? (Number(sb.xp) || CR_XP[String(sb.cr)] || 0) : 0 });
    }
    const players = this.activePlayers();
    const levels = o.levels ? [].concat(o.levels).map(Number) : players.map(f => Number(this.fm(f).level) || 1);
    const budget = [0, 0, 0]; levels.forEach(l => { const b = XP_BUDGET[Math.min(20, Math.max(1, l))]; budget[0] += b[0]; budget[1] += b[1]; budget[2] += b[2]; });
    const total = entries.reduce((a, e) => a + e.xp * e.n, 0);
    const diff = !levels.length ? '—' : total > budget[2] ? 'Beyond High ⚠' : total > budget[1] ? 'High' : total > budget[0] ? 'Moderate' : 'Low';
    box.createDiv({ cls: 'dms-enc-title', text: (o.title || 'Encounter') + ' — ' + diff });
    const ul = box.createEl('ul');
    entries.forEach(e => {
      const li = ul.createEl('li');
      if (e.f) { const a = li.createEl('a', { cls: 'internal-link', text: e.name }); a.addEventListener('click', ev => { ev.preventDefault(); this.app.workspace.openLinkText(e.f.path, ctx.sourcePath, true); }); }
      else li.createSpan({ text: e.name + ' (not found)', cls: 'dms-error' });
      li.appendText(' ×' + e.n + (e.sb ? ' — CR ' + e.sb.cr + ', ' + e.xp * e.n + ' XP' : ''));
    });
    box.createDiv({ cls: 'dms-muted', text: 'Total ' + total + ' XP · party of ' + levels.length + ' (levels ' + (levels.join(', ') || '—') + ') · budget Low ' + budget[0] + ' / Moderate ' + budget[1] + ' / High ' + budget[2] });
    const row = box.createDiv({ cls: 'dms-row' });
    btn(row, 'Run this encounter', 'swords', () => {
      if (o.party !== false) this.addParty();
      entries.forEach(e => e.sb && this.addMonster(e.sb, e.f.path, e.n));
    }, 'mod-cta');
    btn(row, 'Edit', 'pencil', () => this.openEncounterEditor(src, ctx.sourcePath));
    const srcFile = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(srcFile && this.fm(srcFile).type === 'encounter')) btn(row, 'Save as encounter note', 'file-plus', () => { const p = parseEncounterSrc(src); new EncounterBuilderModal(this, { title: p.title, monsters: p.monsters }, {}).open(); });
  }
}

class CountModal extends Modal {
  constructor(app, name, cb) { super(app); this.name = name; this.cb = cb; }
  onOpen() {
    const c = this.contentEl; c.createEl('h3', { text: 'How many ' + this.name + '?' });
    const row = c.createDiv({ cls: 'dms-row dms-wrap' });
    [1, 2, 3, 4, 5, 6, 8, 10].forEach(n => btn(row, String(n), null, () => { this.close(); this.cb(n); }));
  }
  onClose() { this.contentEl.empty(); }
}

const BLANK = '```statblock\nname: New Creature\nsize: Medium\ntype: Humanoid\nalignment: Neutral\nac: 12\ninitiative: 1\nhp: 11\nhit_dice: 2d8 + 2\nspeed: 30 ft.\nstr: 10\ndex: 12\ncon: 12\nint: 10\nwis: 10\ncha: 10\nsaves: []\nskills: Perception +2\nsenses: Passive Perception 12\nlanguages: Common\ncr: 1/2\ntraits: []\nactions:\n  - name: Club\n    desc: "*Melee Attack Roll:* +2, reach 5 ft. *Hit:* 3 (1d4 + 1) Bludgeoning damage."\nbonus_actions: []\nreactions: []\n```\n';

/* ================================================================== */
/* Monster & villain builder + random monster generator               */
/* ================================================================== */

const CR_LIST = ['0', '1/8', '1/4', '1/2', ...Array.from({ length: 30 }, (_, i) => String(i + 1))];
const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
const HIT_DIE = { Tiny: 4, Small: 6, Medium: 8, Large: 10, Huge: 12, Gargantuan: 20 };
const CREATURE_TYPES = ['Aberration', 'Beast', 'Celestial', 'Construct', 'Dragon', 'Elemental', 'Fey', 'Fiend', 'Giant', 'Humanoid', 'Monstrosity', 'Ooze', 'Plant', 'Undead'];
const DAMAGE_TYPES = ['Acid', 'Bludgeoning', 'Cold', 'Fire', 'Force', 'Lightning', 'Necrotic', 'Piercing', 'Poison', 'Psychic', 'Radiant', 'Slashing', 'Thunder'];
const ABIL_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const pickR = a => a[Math.floor(Math.random() * a.length)];
const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);

/** Rough 2024-style targets per CR — calibrated on SRD 5.2 creatures. A starting point, not gospel. */
function crTargets(cr) {
  const v = crNum(cr), pb = pbForCr(cr);
  const ac = v < 1 ? 12 : v < 4 ? 13 : v < 5 ? 14 : v < 8 ? 15 : v < 10 ? 16 : v < 13 ? 17 : v < 17 ? 18 : 19;
  const hp = ({ '0': 4, '1/8': 9, '1/4': 13, '1/2': 19 })[cr] ?? (v <= 16 ? 28 + (v - 1) * 15 : 253 + (v - 16) * 25);
  const mainMod = v < 1 ? 2 : v < 3 ? 3 : v < 5 ? 4 : v < 11 ? 5 : v < 17 ? 6 : 7;
  const dpr = ({ '0': 1, '1/8': 4, '1/4': 5, '1/2': 8 })[cr] ?? (v <= 5 ? [11, 15, 20, 26, 32][v - 1] : 32 + (v - 5) * 6);
  const atks = v < 2 ? 1 : v < 11 ? 2 : v < 17 ? 3 : 4;
  return { pb, ac, hp, mainMod, atk: pb + mainMod, dc: 8 + pb + mainMod, dpr, atks };
}
function crForXp(xp) { let best = '1/8'; for (const c of CR_LIST) if ((CR_XP[c] || 0) <= xp && c !== '0') best = c; return best; }
function diceFor(target, die, mod) {
  const avgDie = (die + 1) / 2; const n = Math.max(1, Math.round((target - mod) / avgDie));
  return { n, die, mod, avg: Math.max(1, Math.floor(n * avgDie) + mod), expr: n + 'd' + die + (mod ? (mod > 0 ? ' + ' : ' − ') + Math.abs(mod) : '') };
}
const fmtHit = d => d.avg + ' (' + d.expr + ')';

const ARCH = {
  Aberration: { sizes: ['Medium', 'Large'], align: ['Chaotic Evil', 'Neutral Evil'], nat: ['Tentacle', 'Bludgeoning', 8], special: ['Psychic'], senses: 'Darkvision 120 ft.', lang: 'Deep Speech, telepathy 60 ft.', resist: '', immune: '', speed: ['30 ft.', '20 ft., Fly 30 ft. (hover)', '10 ft., Swim 40 ft.'], adj: ['Gibbering', 'Many-Eyed', 'Hollow', 'Writhing', 'Starborn', 'Whispering'], noun: ['Mawling', 'Horror', 'Seer', 'Lurker', 'Thing', 'Mindreaver'], bias: { int: 3, wis: 2, cha: 1 }, save: ['Mind Blast', 'int', '30-foot Cone', 'Psychic', 'Stunned'], env: ['underdark'] },
  Beast: { sizes: ['Medium', 'Large', 'Huge'], align: ['Unaligned'], nat: ['Bite', 'Piercing', 8], special: ['Poison'], senses: 'Darkvision 60 ft.', lang: 'None', resist: '', immune: '', speed: ['40 ft.', '40 ft., Climb 30 ft.', '30 ft., Swim 40 ft.', '10 ft., Fly 60 ft.'], adj: ['Dire', 'Razorback', 'Shadow', 'Blood', 'Thunder', 'Ash'], noun: ['Boar', 'Stag', 'Wolf', 'Bear', 'Hawk', 'Toad', 'Lizard'], bias: { str: 2, con: 1, int: -6 }, save: ['Terrifying Roar', 'wis', '30-foot Emanation', 'Thunder', 'Frightened'], env: ['forest', 'hills', 'grassland'] },
  Celestial: { sizes: ['Medium', 'Large'], align: ['Lawful Good', 'Neutral Good'], nat: ['Radiant Blade', 'Slashing', 8], special: ['Radiant'], senses: 'Darkvision 120 ft.', lang: 'all, telepathy 120 ft.', resist: 'Radiant', immune: 'Charmed, Frightened', speed: ['30 ft., Fly 90 ft.'], adj: ['Fallen', 'Dawnlit', 'Solemn', 'Gilded'], noun: ['Warden', 'Herald', 'Seraph', 'Avenger'], bias: { wis: 2, cha: 3 }, save: ['Searing Light', 'con', '20-foot-radius Sphere', 'Radiant', 'Blinded'], env: ['planar'] },
  Construct: { sizes: ['Medium', 'Large'], align: ['Unaligned'], nat: ['Slam', 'Bludgeoning', 10], special: ['Force', 'Lightning'], senses: 'Darkvision 60 ft.', lang: 'Understands the languages of its creator but can\'t speak', resist: '', immune: 'Poison, Psychic; Charmed, Exhaustion, Frightened, Paralyzed, Petrified, Poisoned', speed: ['30 ft.', '25 ft.'], adj: ['Clockwork', 'Iron', 'Rune-Etched', 'Brass', 'Obsidian'], noun: ['Sentinel', 'Golem', 'Warden', 'Automaton', 'Juggernaut'], bias: { str: 2, con: 2, int: -5, cha: -5 }, save: ['Discharge', 'dex', '15-foot Emanation', 'Lightning', null], env: ['dungeon', 'urban'] },
  Dragon: { sizes: ['Medium', 'Large', 'Huge'], align: ['Chaotic Evil', 'Lawful Evil', 'Neutral'], nat: ['Rend', 'Slashing', 10], special: ['Fire', 'Cold', 'Acid', 'Lightning', 'Poison'], senses: 'Blindsight 30 ft., Darkvision 60 ft.', lang: 'Common, Draconic', resist: '', immune: '§', speed: ['30 ft., Fly 60 ft.', '40 ft., Fly 80 ft., Swim 40 ft.'], adj: ['Young', 'Ember', 'Rime', 'Storm', 'Venom', 'Bronze-Scaled'], noun: ['Drake', 'Wyrmling', 'Wyvern-kin', 'Dragonet'], bias: { str: 2, con: 2, cha: 1 }, save: ['Breath Weapon', 'dex', '30-foot Cone', '§', null], env: ['mountain', 'hills'] },
  Elemental: { sizes: ['Medium', 'Large'], align: ['Neutral'], nat: ['Slam', 'Bludgeoning', 8], special: ['Fire', 'Cold', 'Lightning', 'Thunder'], senses: 'Darkvision 60 ft.', lang: 'Primordial', resist: 'Bludgeoning, Piercing, Slashing', immune: 'Poison; Exhaustion, Paralyzed, Petrified, Poisoned, Unconscious', speed: ['50 ft.', '30 ft., Fly 60 ft. (hover)', '30 ft., Swim 90 ft.', '30 ft., Burrow 30 ft.'], adj: ['Ember', 'Storm', 'Frost', 'Mud', 'Cinder', 'Gale'], noun: ['Spirit', 'Elemental', 'Wisp', 'Myrmidon'], bias: { con: 2, dex: 1, int: -4 }, save: ['Elemental Surge', 'dex', '20-foot-radius Sphere', '§', 'Prone'], env: ['planar', 'mountain'] },
  Fey: { sizes: ['Small', 'Medium'], align: ['Chaotic Neutral', 'Neutral Evil'], nat: ['Thorn Lash', 'Slashing', 6], special: ['Psychic', 'Necrotic'], senses: 'Darkvision 60 ft.', lang: 'Common, Elvish, Sylvan', resist: '', immune: 'Charmed', speed: ['30 ft.', '20 ft., Fly 40 ft.'], adj: ['Briar', 'Moonlit', 'Gloam', 'Thistle', 'Mirror'], noun: ['Sprite', 'Hag', 'Trickster', 'Knight', 'Piper'], bias: { dex: 2, cha: 3 }, save: ['Beguiling Song', 'wis', '30-foot Emanation', 'Psychic', 'Charmed'], env: ['forest'] },
  Fiend: { sizes: ['Small', 'Medium', 'Large'], align: ['Lawful Evil', 'Chaotic Evil'], nat: ['Claw', 'Slashing', 8], special: ['Fire', 'Necrotic'], senses: 'Darkvision 120 ft.', lang: 'Abyssal, Infernal, telepathy 60 ft.', resist: 'Cold, Fire', immune: 'Poison; Poisoned', speed: ['30 ft.', '30 ft., Fly 40 ft.'], adj: ['Cinder', 'Brimstone', 'Chain', 'Sulfur', 'Ashen'], noun: ['Imp', 'Fiend', 'Tormentor', 'Hound', 'Devil'], bias: { str: 1, con: 1, cha: 2 }, save: ['Hellfire Burst', 'dex', '20-foot-radius Sphere', 'Fire', null], env: ['planar', 'urban'] },
  Giant: { sizes: ['Large', 'Huge'], align: ['Chaotic Evil', 'Neutral'], nat: ['Greatclub', 'Bludgeoning', 12], special: ['Thunder', 'Cold'], senses: 'Darkvision 60 ft.', lang: 'Common, Giant', resist: '', immune: '', speed: ['40 ft.'], adj: ['Hill', 'Frost-Bitten', 'Stone', 'Two-Headed', 'Cave'], noun: ['Ogre', 'Giant', 'Brute', 'Ettin-kin', 'Troll-kin'], bias: { str: 3, con: 2, int: -3, dex: -2 }, save: ['Earthshaking Stomp', 'dex', '20-foot Emanation', 'Thunder', 'Prone'], env: ['hills', 'mountain'] },
  Humanoid: { sizes: ['Medium', 'Small'], align: ['Neutral Evil', 'Lawful Evil', 'Chaotic Neutral', 'Neutral'], nat: ['Longsword', 'Slashing', 8], special: ['Poison', 'Fire', 'Necrotic'], senses: '', lang: 'Common, plus one other language', resist: '', immune: '', speed: ['30 ft.'], adj: ['Masked', 'Ashen', 'Blood-Oath', 'Rogue', 'Hooded', 'Iron'], noun: ['Cultist', 'Captain', 'Assassin', 'Warlord', 'Witch', 'Duelist', 'Smuggler'], bias: { int: 1, wis: 1, cha: 1 }, save: ['Alchemical Flask', 'dex', '10-foot-radius Sphere', 'Fire', null], env: ['urban', 'any'] },
  Monstrosity: { sizes: ['Medium', 'Large', 'Huge'], align: ['Unaligned', 'Neutral Evil'], nat: ['Bite', 'Piercing', 10], special: ['Acid', 'Poison'], senses: 'Darkvision 60 ft.', lang: 'None', resist: '', immune: '', speed: ['40 ft.', '30 ft., Climb 30 ft.', '30 ft., Burrow 20 ft.'], adj: ['Barbed', 'Horned', 'Venom-Tailed', 'Glass-Eyed', 'Cave'], noun: ['Stalker', 'Basilisk-kin', 'Hydra-spawn', 'Manticore-kin', 'Chimera-kin'], bias: { str: 2, con: 2, int: -5 }, save: ['Acid Spray', 'dex', '30-foot Line', 'Acid', null], env: ['hills', 'underdark', 'swamp'] },
  Ooze: { sizes: ['Medium', 'Large'], align: ['Unaligned'], nat: ['Pseudopod', 'Bludgeoning', 6], special: ['Acid'], senses: 'Blindsight 60 ft.', lang: 'None', resist: '', immune: 'Acid; Blinded, Charmed, Deafened, Exhaustion, Frightened, Prone', speed: ['10 ft., Climb 10 ft.', '20 ft.'], adj: ['Gray', 'Gelatinous', 'Crimson', 'Ochre', 'Quivering'], noun: ['Ooze', 'Pudding', 'Slime', 'Jelly'], bias: { con: 3, int: -9, cha: -9 }, save: ['Engulf', 'dex', '5-foot Emanation', 'Acid', 'Restrained'], env: ['underdark', 'dungeon'] },
  Plant: { sizes: ['Medium', 'Large'], align: ['Unaligned', 'Neutral'], nat: ['Vine', 'Bludgeoning', 8], special: ['Poison'], senses: 'Blindsight 60 ft.', lang: 'None', resist: 'Cold, Lightning', immune: 'Blinded, Deafened, Exhaustion', speed: ['20 ft.', '30 ft.'], adj: ['Bloodthorn', 'Rot', 'Grasping', 'Spore', 'Willow'], noun: ['Shambler', 'Bloom', 'Blight', 'Treant-sapling'], bias: { str: 2, con: 2, int: -5 }, save: ['Spore Cloud', 'con', '15-foot Emanation', 'Poison', 'Poisoned'], env: ['forest', 'swamp'] },
  Undead: { sizes: ['Medium', 'Large'], align: ['Neutral Evil', 'Chaotic Evil', 'Lawful Evil'], nat: ['Grave Claw', 'Slashing', 8], special: ['Necrotic', 'Cold'], senses: 'Darkvision 60 ft.', lang: 'Understands the languages it knew in life', resist: 'Necrotic', immune: 'Poison; Exhaustion, Poisoned', speed: ['30 ft.', '0 ft., Fly 40 ft. (hover)'], adj: ['Grave', 'Hollow', 'Wailing', 'Bone', 'Drowned', 'Ashen'], noun: ['Revenant', 'Wight', 'Ghoul', 'Shade', 'Knight', 'Bride'], bias: { con: 1, wis: 1, cha: 1 }, save: ['Grave Chill', 'con', '20-foot Emanation', 'Necrotic', 'Frightened'], env: ['dungeon', 'any ruin', 'swamp'] },
};
const TRAITS = {
  any: [
    ['Keen Senses', 'The {n} has Advantage on Wisdom (Perception) checks.'],
    ['Pack Tactics', 'The {n} has Advantage on an attack roll against a creature if at least one of the {n}\'s allies is within 5 feet of the creature and the ally doesn\'t have the [[Incapacitated]] condition.'],
    ['Magic Resistance', 'The {n} has Advantage on saving throws against spells and other magical effects.'],
    ['Ambusher', 'The {n} has Advantage on attack rolls against any creature it has surprised or that hasn\'t taken a turn yet in the combat.'],
    ['Siege Monster', 'The {n} deals double damage to objects and structures.'],
  ],
  Undead: [['Turn Resistance', 'The {n} has Advantage on saving throws against any effect that turns Undead.'], ['Sunlight Sensitivity', 'While in sunlight, the {n} has Disadvantage on ability checks and attack rolls.']],
  Ooze: [['Amorphous', 'The {n} can move through a space as narrow as 1 inch without expending extra movement to do so.'], ['Spider Climb', 'The {n} can climb difficult surfaces, including along ceilings, without needing to make an ability check.']],
  Fey: [['Fey Step (Recharge 4–6)', 'As a Bonus Action, the {n} teleports up to 30 feet to an unoccupied space it can see.']],
  Fiend: [['Devil\'s Sight', 'Magical Darkness doesn\'t impede the {n}\'s Darkvision.']],
  Construct: [['Immutable Form', 'The {n} can\'t shape-shift.'], ['Magic Weapons', 'The {n}\'s attacks count as magical.']],
  Beast: [['Charge', 'If the {n} moves at least 20 feet straight toward a target and then hits it with a melee attack on the same turn, the target takes an extra {dmg} damage.']],
  Giant: [['Mighty Throw', 'The {n} can hurl boulders: treat its weapon attack as a ranged attack with range 60/240 ft.']],
  Elemental: [['Elemental Body', 'A creature that touches the {n} or hits it with a melee attack while within 5 feet of it takes {small} {sp} damage.']],
  Dragon: [['Amphibious', 'The {n} can breathe air and water.']],
  Monstrosity: [['Spider Climb', 'The {n} can climb difficult surfaces, including along ceilings, without needing to make an ability check.']],
  Plant: [['False Appearance', 'If the {n} is motionless at the start of combat, it has Advantage on its Initiative roll.']],
  Aberration: [['Alien Mind', 'The {n} has Advantage on Intelligence, Wisdom and Charisma saving throws.']],
  Celestial: [['Divine Awareness', 'The {n} knows if it hears a lie.']],
  Humanoid: [['Cunning Action', 'The {n} can take the Dash, Disengage or Hide action as a Bonus Action.']],
};
const ROLES = {
  Brute: { main: 'str', second: 'con', tactics: 'Charges the toughest-looking foe and keeps hitting until it drops.' },
  Skirmisher: { main: 'dex', second: 'wis', tactics: 'Strikes from range or flanks, then retreats to cover. Targets isolated or wounded characters.' },
  Controller: { main: 'int', second: 'wis', tactics: 'Hangs back, opens with its area ability, and keeps distance from melee characters.' },
  Leader: { main: 'cha', second: 'str', tactics: 'Directs minions, uses its allies as shields, and flees or bargains when Bloodied.' },
};

/** Build a random monster. opts: { cr, type, role, boss, name } */
function generateMonster(opts) {
  const cr = opts.cr || '1';
  const T = crTargets(cr); const v = crNum(cr);
  const typeName = opts.type && ARCH[opts.type] ? opts.type : pickR(Object.keys(ARCH));
  const A = ARCH[typeName];
  const roleName = opts.role && ROLES[opts.role] ? opts.role : pickR(Object.keys(ROLES));
  const R = ROLES[roleName];
  const spType = pickR(A.special);
  const name = opts.name || (pickR(A.adj) + ' ' + pickR(A.noun));
  const n = name.toLowerCase();
  let size = pickR(A.sizes); if (v >= 10 && size === 'Medium' && A.sizes.includes('Large')) size = 'Large'; if (v < 1 && (size === 'Huge' || size === 'Large')) size = A.sizes[0];
  // ability scores
  const sc = {}; ABILS.forEach(a => { sc[a] = 8 + Math.floor(Math.random() * 6); });
  for (const [k, b] of Object.entries(A.bias)) sc[k] = Math.max(1, Math.min(30, sc[k] + b * 2));
  sc[R.main] = 10 + 2 * T.mainMod + (Math.random() < 0.5 ? 1 : 0);
  sc[R.second] = Math.max(sc[R.second], 10 + 2 * Math.max(1, T.mainMod - 2));
  sc.con = Math.max(sc.con, 10 + 2 * Math.max(0, T.mainMod - 2));
  if (roleName !== 'Brute' && typeName !== 'Ooze') sc.dex = Math.max(sc.dex, 12);
  const m = Object.fromEntries(ABILS.map(a => [a, mod(sc[a])]));
  const atkAbil = roleName === 'Skirmisher' ? 'dex' : (roleName === 'Brute' || roleName === 'Leader') ? (sc.str >= sc.dex ? 'str' : 'dex') : 'str';
  const atkMod = roleName === 'Controller' ? Math.max(0, m[atkAbil]) : Math.max(m[atkAbil], T.mainMod); if (roleName !== 'Controller') { sc[atkAbil] = Math.max(sc[atkAbil], 10 + 2 * atkMod); m[atkAbil] = mod(sc[atkAbil]); }
  // HP
  const die = HIT_DIE[size]; const conMod = mod(sc.con);
  const resistsWeapons = /bludgeoning/i.test(A.resist);
  const targetHp = Math.round(T.hp * (opts.boss ? 0.88 : 1) * (resistsWeapons ? 0.8 : 1) * (0.94 + Math.random() * 0.12));
  const hdCount = Math.max(1, Math.round(targetHp / ((die + 1) / 2 + conMod)));
  const hp = Math.max(1, Math.floor(hdCount * (die + 1) / 2) + hdCount * conMod);
  const hitDice = hdCount + 'd' + die + (conMod ? (conMod > 0 ? ' + ' : ' − ') + Math.abs(hdCount * conMod) : '');
  // attacks
  const atkBonus = atkMod + T.pb;
  const dprShare = (roleName === 'Controller' ? 0.6 : 1) * (opts.boss ? 0.7 : 1);
  const perHit = Math.max(1, Math.round(T.dpr * dprShare / T.atks));
  const rider = v >= 3 && Math.random() < 0.6;
  const mainDmg = diceFor(rider ? perHit * 0.7 : perHit, A.nat[2], atkMod);
  const riderDmg = rider ? diceFor(perHit * 0.3, 6, 0) : null;
  const immune = A.immune === '§' ? spType : A.immune;
  const actions = [];
  if (T.atks > 1) actions.push(['Multiattack', 'The ' + n + ' makes ' + ['', 'one', 'two', 'three', 'four'][T.atks] + ' ' + A.nat[0] + ' attacks' + (roleName === 'Controller' ? ', or it makes one ' + A.nat[0] + ' attack and uses Eldritch Bolt' : '') + '.']);
  actions.push([A.nat[0], '*Melee Attack Roll:* ' + fmt(atkBonus) + ', reach ' + (['Large', 'Huge', 'Gargantuan'].includes(size) ? 10 : 5) + ' ft. *Hit:* ' + fmtHit(mainDmg) + ' ' + A.nat[1] + ' damage' + (riderDmg ? ' plus ' + fmtHit(riderDmg) + ' ' + spType + ' damage' : '') + '.']);
  if (roleName === 'Skirmisher') {
    const r = diceFor(perHit, 8, m.dex);
    actions.push([typeName === 'Humanoid' ? 'Hand Crossbow' : 'Hurled Spine', '*Ranged Attack Roll:* ' + fmt(m.dex + T.pb) + ', range 30/120 ft. *Hit:* ' + fmtHit(r) + ' Piercing damage.']);
  }
  if (roleName === 'Controller') {
    const cm = m[R.main]; const r = diceFor(perHit * 1.2, 10, 0);
    actions.push(['Eldritch Bolt', '*Ranged Attack Roll:* ' + fmt(cm + T.pb) + ', range 120 ft. *Hit:* ' + fmtHit(r) + ' ' + (A.special.includes('Psychic') ? 'Psychic' : spType === 'Poison' ? 'Necrotic' : spType) + ' damage.']);
  }
  // save ability
  if (roleName === 'Controller' || v >= 2 || opts.boss) {
    const [abName, saveAb, area, dtype, cond] = A.save;
    const dt = dtype === '§' ? spType : dtype;
    const dcAb = roleName === 'Controller' ? R.main : 'con';
    const dc = 8 + T.pb + Math.max(m[dcAb], T.mainMod - 1);
    const dmg = diceFor(T.dpr * (v < 5 ? 1 : 1.15) * (opts.boss ? 0.85 : 1), 8, 0);
    let desc = '*' + ABIL_NAMES[saveAb] + ' Saving Throw:* DC ' + dc + ', each creature in a ' + area + (area.includes('Emanation') ? ' originating from the ' + n : '') + '. *Failure:* ' + fmtHit(dmg) + ' ' + dt + ' damage' + (cond ? ', and the target has the [[' + cond + ']] condition until the end of its next turn' : '') + '. *Success:* Half damage only.';
    actions.push([abName + ' (Recharge 5–6)', desc]);
  }
  // traits
  const traits = [];
  const pool = (TRAITS[typeName] || []).concat(TRAITS.any);
  const nTraits = v < 1 ? 1 : v < 5 ? 1 + (Math.random() < 0.5 ? 1 : 0) : 2;
  const used = new Set();
  for (let k = 0; k < nTraits; k++) {
    const t = pickR(pool); if (used.has(t[0])) continue; used.add(t[0]);
    traits.push([t[0], t[1].replace(/\{n\}/g, n).replace('{dmg}', fmtHit(diceFor(perHit * 0.5, 6, 0)) + ' ' + A.nat[1]).replace('{small}', fmtHit(diceFor(Math.max(2, T.pb * 2), 6, 0))).replace('{sp}', spType)]);
  }
  if (opts.boss) traits.unshift(['Legendary Resistance (' + (v >= 10 ? 3 : 2) + '/Day)', 'If the ' + n + ' fails a saving throw, it can choose to succeed instead.']);
  // bonus actions & reactions
  const bonus = [], reactions = [];
  if (roleName === 'Skirmisher') bonus.push(['Nimble Retreat', 'The ' + n + ' takes the Disengage or [[Hiding|Hide]] action.']);
  if (roleName === 'Leader') bonus.push(['Command Ally', 'The ' + n + ' targets one ally it can see within 30 feet. That ally can use its Reaction to make one attack or move up to half its Speed without provoking Opportunity Attacks.']);
  if (roleName === 'Leader' || (roleName === 'Brute' && v >= 4)) reactions.push(['Parry', '*Trigger:* The ' + n + ' is hit by a melee attack roll while holding a weapon. *Response:* The ' + n + ' adds ' + Math.max(2, T.pb) + ' to its AC against that attack, possibly causing it to miss.']);
  if (roleName === 'Skirmisher' && v >= 3) reactions.push(['Uncanny Dodge', '*Trigger:* An attacker the ' + n + ' can see hits it with an attack roll. *Response:* The ' + n + ' halves the attack\'s damage against it.']);
  // legendary actions
  let legendary = null, legendaryIntro = null;
  if (opts.boss) {
    const uses = v >= 10 ? 3 : 2;
    legendaryIntro = '*Legendary Action Uses: ' + uses + ' (' + (uses + 1) + ' in Lair).* Immediately after another creature\'s turn, the ' + n + ' can expend a use to take one of the following actions. The ' + n + ' regains all expended uses at the start of each of its turns.';
    legendary = [
      ['Lash Out', 'The ' + n + ' makes one ' + A.nat[0] + ' attack.'],
      ['Shift', 'The ' + n + ' moves up to half its Speed without provoking Opportunity Attacks.'],
      ['Dread Presence', '*Wisdom Saving Throw:* DC ' + (8 + T.pb + T.mainMod - 1) + ', one creature the ' + n + ' can see within 60 feet. *Failure:* The target has the [[Frightened]] condition until the end of its next turn.'],
    ];
  }
  // saves / skills / senses
  const saveProf = [R.main, R.second].filter((x, i, a) => a.indexOf(x) === i);
  if (v < 2 && !opts.boss) saveProf.length = Math.min(saveProf.length, 1);
  const percProf = Math.random() < 0.6;
  const skills = [];
  if (percProf) skills.push('Perception ' + fmt(m.wis + T.pb));
  if (roleName === 'Skirmisher') skills.push('Stealth ' + fmt(m.dex + T.pb));
  if (roleName === 'Leader') skills.push('Intimidation ' + fmt(m.cha + T.pb));
  if (roleName === 'Controller' && sc.int >= 12) skills.push('Arcana ' + fmt(m.int + T.pb));
  const pp = 10 + m.wis + (percProf ? T.pb : 0);
  const initiative = m.dex + (roleName === 'Skirmisher' || opts.boss ? T.pb : 0);
  const ac = T.ac + (roleName === 'Brute' ? -1 : roleName === 'Leader' ? 1 : 0);
  const sb = {
    name, size, type: typeName, alignment: pickR(A.align), ac, initiative, hp, hit_dice: hitDice, speed: pickR(A.speed),
    str: sc.str, dex: sc.dex, con: sc.con, int: sc.int, wis: sc.wis, cha: sc.cha, saves: saveProf,
    skills: skills.join(', '), resistances: A.resist, immunities: immune,
    senses: (A.senses ? A.senses + '; ' : '') + 'Passive Perception ' + pp, languages: A.lang, cr,
    traits: traits.map(([a, b]) => ({ name: a, desc: b })), actions: actions.map(([a, b]) => ({ name: a, desc: b })),
    bonus_actions: bonus.map(([a, b]) => ({ name: a, desc: b })), reactions: reactions.map(([a, b]) => ({ name: a, desc: b })),
    source: 'Generated — DM Statblocks',
  };
  if (legendary) { sb.legendary_intro = legendaryIntro; sb.legendary_actions = legendary.map(([a, b]) => ({ name: a, desc: b })); }
  sb._meta = { role: roleName, tactics: R.tactics, environment: A.env, typeName };
  return sb;
}

/* ---------- YAML writer for statblocks ---------- */
const SB_KEYS = ['name', 'size', 'type', 'alignment', 'ac', 'initiative', 'hp', 'hit_dice', 'speed', 'str', 'dex', 'con', 'int', 'wis', 'cha', 'saves', 'skills', 'vulnerabilities', 'resistances', 'immunities', 'gear', 'senses', 'languages', 'cr', 'xp', 'pb'];
function yScalar(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return JSON.stringify(v);
  if (v && typeof v === 'object') return '{ ' + Object.entries(v).map(([k, x]) => k + ': ' + yScalar(x)).join(', ') + ' }';
  return JSON.stringify(String(v ?? ''));
}
function statblockToYaml(sb) {
  let y = '';
  for (const k of SB_KEYS) {
    const v = sb[k];
    if (v == null || v === '' || (Array.isArray(v) && !v.length && k !== 'saves')) continue;
    y += k + ': ' + yScalar(v) + '\n';
  }
  for (const k of ['traits', 'actions', 'bonus_actions', 'reactions', 'legendary_intro', 'legendary_actions', 'source']) {
    const v = sb[k]; if (v == null || v === '') continue;
    if (typeof v === 'string') { y += k + ': ' + yScalar(v) + '\n'; continue; }
    const items = asList(v).filter(it => it.name || it.desc); if (!items.length) continue;
    y += k + ':\n' + items.map(it => '  - name: ' + yScalar(it.name) + '\n    desc: ' + yScalar(it.desc)).join('\n') + '\n';
  }
  return '```statblock\n' + y + '```';
}
function monsterNote(sb, extra) {
  extra = extra || {};
  const meta = sb._meta || {};
  const env = extra.environment || meta.environment || [];
  const villain = !!extra.villain;
  let fm = '---\ntype: monster\ncr: "' + (sb.cr ?? '') + '"\ncreature_type: ' + yScalar(sb.type ? String(sb.type).split(' ')[0] : '') + '\nenvironment: ' + JSON.stringify([].concat(env)) + '\nsource: ' + (String(sb.source || '').startsWith('Generated') ? 'Generated' : 'Homebrew') + '\n';
  if (villain) fm += 'villain: true\nstatus: active\n';
  fm += 'tags: [monster' + (villain ? ', villain' : '') + ']\n---\n';
  const clean = Object.assign({}, sb); delete clean._meta; delete clean._preview; delete clean._from;
  let body = fm + '# ' + sb.name + '\n\n' + statblockToYaml(clean) + '\n\n## Tactics\n' + (extra.tactics || meta.tactics || '') + '\n';
  if (villain) {
    body += '\n## Villain profile\n> [!secret] What they want\n> ' + (extra.goal || '*Goal*') + '\n\n- **Lair / base:** ' + (extra.lair || '') + '\n- **Minions:** ' + (extra.minions || '') + '\n- **Weakness:** ' + (extra.weakness || '') + '\n- **If they win:** \n\n## Scheme clock\n- [ ] \n- [ ] \n- [ ] \n- [ ] \n';
  }
  body += '\n## Used in\n```dm-list\nwhere: any\nfields: [type]\nempty: Not used in any note yet.\n```\n';
  return body;
}

/* ---------- small form helpers ---------- */
function field(parent, label, el) { const w = parent.createDiv({ cls: 'dms-f' }); w.createEl('label', { text: label }); w.appendChild(el); return el; }
function inputEl(type, value, attrs) { const i = document.createElement('input'); i.type = type; if (value != null) i.value = value; if (attrs) for (const k in attrs) i.setAttribute(k, attrs[k]); return i; }
function selectEl(options, value) { const s = document.createElement('select'); options.forEach(o => { const opt = document.createElement('option'); opt.value = Array.isArray(o) ? o[0] : o; opt.textContent = Array.isArray(o) ? o[1] : o; s.appendChild(opt); }); if (value != null) s.value = value; return s; }

/* ---------- Random monster modal ---------- */
/* ---------- CR check: estimate a CR from the stats actually on the statblock ---------- */
const NUMWORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
function avgDamageIn(desc) {
  // sums every "N (XdY ...)" in a description, e.g. "7 (1d6 + 4) Slashing damage plus 3 (1d6) Fire damage"
  let total = 0; const re = /(\d+)\s*\(\s*\d+d\d+[^)]*\)/g; let m;
  const main = String(desc).split(/\*?Success:?\*?/i)[0].replace(/plus \d+\s*\([^)]*\)[^.]*?\bif\b[^.]*/gi, '');
  while ((m = re.exec(main))) total += Number(m[1]);
  return total;
}
function crIndex(cr) { const i = CR_LIST.indexOf(String(cr)); return i < 0 ? 4 : i; }
function crAt(i) { return CR_LIST[Math.max(0, Math.min(CR_LIST.length - 1, Math.round(i)))]; }
function closestCr(key, value) {
  let best = 1, diff = Infinity;
  for (let i = 1; i < CR_LIST.length; i++) { const d = Math.abs(crTargets(CR_LIST[i])[key] - value); if (d < diff) { diff = d; best = i; } }
  return best;
}
/**
 * Estimate CR from a statblock. Defensive CR from effective HP and AC, offensive CR from damage per round
 * (first three rounds, recharge abilities used once) and attack bonus or save DC. Averages the two.
 */
function estimateCr(sb) {
  const notes = [];
  const actions = asList(sb.actions), bonus = asList(sb.bonus_actions), traits = asList(sb.traits), legendary = asList(sb.legendary_actions);
  // ---- defense
  let hp = Number(sb.hp) || 1, mult = 1;
  const res = String(sb.resistances || '').toLowerCase(), imm = String(sb.immunities || '').toLowerCase().split(';')[0];
  const bps = s => /bludgeoning/.test(s) && /piercing/.test(s) && /slashing/.test(s);
  if (bps(imm)) { mult = 1.5; notes.push('immune to weapon damage (×1.5 HP)'); }
  else if (bps(res)) { mult = 1.25; notes.push('resists weapon damage (×1.25 HP)'); }
  else if ((res.match(/acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant|thunder/g) || []).length + (imm.match(/acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant|thunder/g) || []).length >= 3) { mult = 1.1; notes.push('several energy resistances (×1.1 HP)'); }
  const lr = traits.find(t => /legendary resistance/i.test(t.name));
  if (lr) { mult += 0.15; notes.push('Legendary Resistance'); }
  const ehp = Math.round(hp * mult);
  const ac = Number(String(sb.ac).match(/\d+/)?.[0]) || 10;
  // each point of AC above/below typical ≈ 7% more/less effective HP
  const score = (val, target) => Math.abs(Math.log(Math.max(0.5, val) / target));
  let defI = 1, best = Infinity;
  for (let i = 1; i < CR_LIST.length; i++) { const t = crTargets(CR_LIST[i]); const adj = ehp * Math.max(0.5, 1 + 0.07 * (ac - t.ac)); const sc = score(adj, t.hp); if (sc < best) { best = sc; defI = i; } }
  // ---- offense
  const atkDmg = {}; let bestAtk = null, bestDc = null;
  for (const a of actions.concat(bonus, legendary)) {
    const d = String(a.desc);
    const am = d.match(/Attack Roll:?\*?\s*([+−-]\s?\d+)/i); if (am) { const v = Number(am[1].replace(/[−\s]/g, c => c === '−' ? '-' : '')); bestAtk = bestAtk == null ? v : Math.max(bestAtk, v); }
    const dm = d.match(/DC\s*(\d+)/); if (dm) bestDc = bestDc == null ? Number(dm[1]) : Math.max(bestDc, Number(dm[1]));
  }
  actions.forEach(a => { if (/Attack Roll/i.test(a.desc)) atkDmg[String(a.name).toLowerCase().replace(/\s*\(.*\)$/, '')] = avgDamageIn(a.desc); });
  const maxAtk = Math.max(0, ...Object.values(atkDmg));
  let routine = 0;
  const multi = actions.find(a => /^multiattack/i.test(a.name));
  if (multi) {
    const re = /\b(one|two|three|four|five|six|\d+)\s+((?:[A-Z][\w'’-]*\s?)*)attacks?/gi; let m;
    const first = String(multi.desc).split(/,?\s+or\s+/i)[0];
    while ((m = re.exec(first))) {
      const n = NUMWORDS[m[1].toLowerCase()] || Number(m[1]) || 1; const nm = m[2].trim().toLowerCase();
      routine += n * (nm && atkDmg[nm] != null ? atkDmg[nm] : maxAtk);
    }
    if (!routine) routine = 2 * maxAtk;
  } else routine = maxAtk;
  // save-based / limited-use actions
  let burst = 0;
  actions.forEach(a => { if (!/Attack Roll/i.test(a.desc) && /Saving Throw/i.test(a.desc)) { const d = avgDamageIn(a.desc); if (/recharge|\/day/i.test(a.name)) burst = Math.max(burst, d); else routine = Math.max(routine, d); } });
  // bonus-action attacks and legendary attacks add to each round
  bonus.forEach(a => { if (/Attack Roll/i.test(a.desc)) routine += avgDamageIn(a.desc); });
  if (legendary.some(a => /attack/i.test(a.desc))) { routine += maxAtk; notes.push('legendary attacks'); }
  const dpr = Math.round(burst ? Math.max(routine, (burst + 2 * routine) / 3) : routine);
  let offI;
  if (dpr <= 0) { offI = defI; notes.push('no damage found — offense assumed to match defense'); }
  else {
    // each point of attack bonus (or save DC) above/below typical ≈ 7% more/less damage landed
    let bestO = Infinity; offI = 1;
    for (let i = 1; i < CR_LIST.length; i++) {
      const t = crTargets(CR_LIST[i]);
      const acc = bestAtk != null ? bestAtk - t.atk : bestDc != null ? bestDc - t.dc : 0;
      const sc = score(dpr * Math.max(0.5, 1 + 0.07 * acc), t.dpr); if (sc < bestO) { bestO = sc; offI = i; }
    }
  }
  defI = Math.max(1, Math.min(CR_LIST.length - 1, defI)); offI = Math.max(1, Math.min(CR_LIST.length - 1, offI));
  const sugI = Math.round((defI + offI) / 2);
  return { defensive: crAt(defI), offensive: crAt(offI), suggested: crAt(sugI), sugI, ehp, ac, dpr, atk: bestAtk, dc: bestDc, notes };
}
/** Render the CR check panel. onApply(cr) is called when the user accepts the suggestion. */
function renderCrCheck(el, sb, onApply) {
  el.empty(); el.addClass('dms-crcheck');
  const e = estimateCr(sb); const chosen = String(sb.cr ?? '');
  const gap = crIndex(chosen) - e.sugI;
  const ok = Math.abs(gap) <= 1;
  el.toggleClass('is-ok', ok); el.toggleClass('is-off', !ok);
  const head = el.createDiv({ cls: 'dms-crcheck-head' });
  head.createSpan({ cls: 'dms-crcheck-badge', text: ok ? '✓ CR ' + chosen + ' fits' : (gap > 0 ? '▲ CR ' + chosen + ' looks too high' : '▼ CR ' + chosen + ' looks too low') });
  head.createSpan({ text: ' · stats suggest CR ' + e.suggested });
  el.createDiv({ cls: 'dms-muted', text: 'Defensive CR ' + e.defensive + ' (effective HP ' + e.ehp + ', AC ' + e.ac + ') · Offensive CR ' + e.offensive + ' (≈' + e.dpr + ' damage/round' + (e.atk != null ? ', ' + fmt(e.atk) + ' to hit' : '') + (e.dc != null ? ', save DC ' + e.dc : '') + ')' + (e.notes.length ? ' · ' + e.notes.join(', ') : '') });
  if (!ok && onApply) {
    const row = el.createDiv({ cls: 'dms-row dms-wrap' });
    btn(row, 'Use CR ' + e.suggested, 'check', () => onApply(e.suggested), 'mod-cta');
  }
  return e;
}

class RandomMonsterModal extends Modal {
  constructor(plugin) { super(plugin.app); this.plugin = plugin; this.sb = null; }
  onOpen() {
    const c = this.contentEl; c.addClass('dms-gen-modal'); this.modalEl.addClass('dms-wide-modal');
    c.createEl('h3', { text: 'Random monster/villain' });
    const party = this.plugin.activePlayers().map(f => Number(this.plugin.fm(f).level) || 1);
    const avg = party.length ? Math.round(party.reduce((a, b) => a + b, 0) / party.length) : 3;
    const form = c.createDiv({ cls: 'dms-form-grid' });
    const mode = field(form, 'Pick by', selectEl([['party', 'Party level & difficulty'], ['cr', 'Challenge Rating']], 'party'));
    const level = field(form, 'Party level', selectEl(Array.from({ length: 20 }, (_, i) => String(i + 1)), String(avg)));
    const size = field(form, 'Party size', inputEl('number', party.length || 4, { min: 1, max: 10 }));
    const diff = field(form, 'Difficulty', selectEl(['Low', 'Moderate', 'High'], 'Moderate'));
    const count = field(form, 'How many monsters', selectEl(['1', '2', '3', '4', '5', '6', '8'], '1'));
    const crSel = field(form, 'Challenge Rating', selectEl(CR_LIST.slice(1), '2'));
    const type = field(form, 'Creature type', selectEl(['Any', ...Object.keys(ARCH)], 'Any'));
    const role = field(form, 'Role', selectEl(['Any', ...Object.keys(ROLES)], 'Any'));
    const bossWrap = form.createDiv({ cls: 'dms-f dms-check' }); const boss = bossWrap.createEl('input', { type: 'checkbox' }); bossWrap.createEl('label', { text: ' Boss (legendary actions)' });
    const nameIn = field(form, 'Name (optional)', inputEl('text', '', { placeholder: 'leave blank to generate' }));
    const syncMode = () => { const p = mode.value === 'party'; [level, size, diff].forEach(x => x.parentElement.style.display = p ? '' : 'none'); crSel.parentElement.style.display = p ? 'none' : ''; };
    const target = c.createDiv({ cls: 'dms-gen-target' });
    const computeTarget = () => {
      const n = Number(count.value);
      const L = Number(level.value), sz = Math.max(1, Number(size.value) || 1);
      if (mode.value === 'party') {
        const d = ['Low', 'Moderate', 'High'].indexOf(diff.value);
        const budget = XP_BUDGET[L][d] * sz; const cr = crForXp(budget / n);
        return { cr, note: diff.value + ' for ' + sz + ' × level ' + L + ' → budget ' + budget.toLocaleString() + ' XP → ' + n + ' × CR ' + cr + ' (' + (CR_XP[cr] * n).toLocaleString() + ' XP)' };
      }
      const cr = crSel.value; const xp = CR_XP[cr] * n;
      const dd = difficultyFor(xp, Array(sz).fill(L));
      const modCr = crForXp(XP_BUDGET[L][1] * sz / n);
      return { cr, label: 'CR ' + cr, note: n + ' × CR ' + cr + ' = ' + xp.toLocaleString() + ' XP → ' + dd.label + ' for ' + sz + ' × level ' + L + (dd.label !== 'Moderate' ? ' · for a Moderate fight use CR ' + modCr : '') };
    };
    const showTarget = () => { const t = computeTarget(); target.empty(); target.createSpan({ cls: 'dms-crcheck-badge', text: t.label || 'Suggested CR ' + t.cr }); target.createSpan({ text: ' ' + t.note }); };
    const syncMode2 = () => { level.parentElement.style.display = ''; size.parentElement.style.display = ''; };
    mode.addEventListener('change', () => { syncMode(); syncMode2(); showTarget(); }); syncMode(); syncMode2();
    form.addEventListener('change', showTarget); form.addEventListener('input', showTarget); showTarget();
    const summary = c.createDiv({ cls: 'dms-muted dms-gen-summary' });
    const check = c.createDiv();
    const row = c.createDiv({ cls: 'dms-row dms-wrap' });
    const preview = c.createDiv({ cls: 'dms-gen-preview' });
    const actions = c.createDiv({ cls: 'dms-row dms-wrap' });
    const gen = async () => {
      const n = Number(count.value);
      const { cr, note } = computeTarget();
      this.count = n;
      this.sb = generateMonster({ cr, type: type.value === 'Any' ? null : type.value, role: role.value === 'Any' ? null : role.value, boss: boss.checked, name: nameIn.value.trim() || null });
      summary.setText(note + ' · ' + this.sb._meta.typeName + ' ' + this.sb._meta.role.toLowerCase() + (boss.checked ? ' · boss' : ''));
      const redraw = async () => {
        preview.empty(); const comp = new obsidian.Component(); comp.load();
        await this.plugin.drawStatblock(Object.assign({ _preview: true }, this.sb), preview, '', comp);
        renderCrCheck(check, this.sb, newCr => { this.sb.cr = newCr; redraw(); });
      };
      await redraw();
      actions.empty();
      btn(actions, 'Save to Bestiary', 'save', () => this.save(false), 'mod-cta');
      btn(actions, 'Save as villain', 'crown', () => this.save(true));
      btn(actions, 'Tweak in builder', 'pencil', () => { const sb = this.sb; this.close(); new MonsterBuilderModal(this.plugin, sb, {}).open(); });
      btn(actions, 'Add ' + n + ' to combat', 'swords', () => this.plugin.addMonster(this.sb, null, n));
    };
    btn(row, 'Generate', 'dices', gen, 'mod-cta');
    gen();
  }
  async save(villain) {
    const f = await this.plugin.saveMonster(this.sb, { villain });
    if (f) { this.close(); this.app.workspace.getLeaf(false).openFile(f); }
  }
  onClose() { this.contentEl.empty(); }
}

/* ---------- Monster / villain builder ---------- */
class MonsterBuilderModal extends Modal {
  constructor(plugin, initial, opts) {
    super(plugin.app); this.plugin = plugin; this.opts = opts || {};
    const base = { name: '', size: 'Medium', type: 'Humanoid', alignment: 'Neutral Evil', ac: 13, initiative: null, hp: 22, hit_dice: '4d8 + 4', speed: '30 ft.', str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 10, saves: [], skills: '', vulnerabilities: '', resistances: '', immunities: '', gear: '', senses: '', languages: 'Common', cr: '1', traits: [], actions: [], bonus_actions: [], reactions: [], legendary_actions: [], legendary_intro: '' };
    this.sb = Object.assign(base, JSON.parse(JSON.stringify(initial || {})));
    ['traits', 'actions', 'bonus_actions', 'reactions', 'legendary_actions'].forEach(k => { this.sb[k] = asList(this.sb[k]); });
    if (!Array.isArray(this.sb.saves)) this.sb.saves = Object.keys(this.sb.saves || {});
    this.villain = !!this.opts.villain; this.extra = { goal: '', lair: '', minions: '', weakness: '', tactics: (initial && initial._meta && initial._meta.tactics) || '', environment: (initial && initial._meta && initial._meta.environment) || [] };
  }
  onOpen() {
    const c = this.contentEl; this.modalEl.addClass('dms-wide-modal', 'dms-builder-modal');
    c.createEl('h3', { text: this.opts.file ? 'Edit statblock' : 'Monster/Villain builder' });
    const wrap = c.createDiv({ cls: 'dms-builder' });
    const form = wrap.createDiv({ cls: 'dms-builder-form' });
    this.previewEl = wrap.createDiv({ cls: 'dms-builder-preview' });
    const sb = this.sb, self = this;
    const upd = obsidian.debounce ? obsidian.debounce(() => this.refresh(), 250, true) : () => this.refresh();
    const bind = (el, key, num) => { el.addEventListener('input', () => { sb[key] = num ? (el.value === '' ? null : Number(el.value)) : el.value; upd(); }); el.addEventListener('change', () => { sb[key] = num ? (el.value === '' ? null : Number(el.value)) : el.value; upd(); }); return el; };
    const sec = t => { form.createDiv({ cls: 'dms-sec', text: t }); return form.createDiv({ cls: 'dms-form-grid' }); };

    let g = sec('Basics');
    const kind = field(g, 'Kind', selectEl([['monster', 'Monster'], ['villain', 'Villain']], this.villain ? 'villain' : 'monster'));
    kind.addEventListener('change', () => { this.villain = kind.value === 'villain'; villainBox.style.display = this.villain ? '' : 'none'; });
    bind(field(g, 'Name', inputEl('text', sb.name, { placeholder: 'e.g. Captain Vex' })), 'name');
    bind(field(g, 'Size', selectEl(SIZES, sb.size)), 'size');
    bind(field(g, 'Creature type', inputEl('text', sb.type, { list: 'dms-ctypes' })), 'type');
    const dl = g.createEl('datalist', { attr: { id: 'dms-ctypes' } }); CREATURE_TYPES.forEach(t => dl.createEl('option', { value: t }));
    bind(field(g, 'Alignment', inputEl('text', sb.alignment)), 'alignment');
    const crS = bind(field(g, 'Challenge Rating', selectEl(CR_LIST, String(sb.cr))), 'cr');
    const crInfo = g.createDiv({ cls: 'dms-muted dms-span2' });
    const suggest = g.createDiv({ cls: 'dms-span2' });
    const showCr = () => { const t = crTargets(sb.cr); crInfo.setText('CR ' + sb.cr + ': ' + (CR_XP[sb.cr] || 0).toLocaleString() + ' XP · PB ' + fmt(t.pb) + ' · typical AC ' + t.ac + ', HP ≈' + t.hp + ', attack ' + fmt(t.atk) + ', save DC ' + t.dc + ', damage/round ≈' + t.dpr); };
    crS.addEventListener('change', showCr); showCr();
    this.crS = crS; this.showCr = showCr;
    btn(suggest, 'Apply typical AC/HP for this CR', 'wand', () => { const t = crTargets(sb.cr); sb.ac = t.ac; acI.value = t.ac; const die = HIT_DIE[sb.size] || 8; const cm = mod(sb.con); const n = Math.max(1, Math.round(t.hp / ((die + 1) / 2 + cm))); hdN.value = n; calcHp(); });
    g.createDiv({ cls: 'dms-span2 dms-sec-sub', text: 'CR check — updates as you edit' });
    this.crCheckEl = g.createDiv({ cls: 'dms-span2' });

    g = sec('Defenses & movement');
    const acI = bind(field(g, 'Armor Class', inputEl('number', sb.ac)), 'ac', true);
    bind(field(g, 'Initiative bonus (blank = Dex)', inputEl('number', sb.initiative ?? '')), 'initiative', true);
    const hdN = field(g, 'Hit dice count', inputEl('number', String(sb.hit_dice || '').match(/^\d+/)?.[0] || 4, { min: 1 }));
    const hpI = bind(field(g, 'Hit Points', inputEl('number', sb.hp)), 'hp', true);
    const hdI = bind(field(g, 'Hit dice (text)', inputEl('text', sb.hit_dice)), 'hit_dice');
    const calcHp = () => { const die = HIT_DIE[sb.size] || 8, n = Math.max(1, Number(hdN.value) || 1), cm = mod(sb.con); sb.hp = Math.max(1, Math.floor(n * (die + 1) / 2) + n * cm); sb.hit_dice = n + 'd' + die + (cm ? (cm > 0 ? ' + ' : ' − ') + Math.abs(n * cm) : ''); hpI.value = sb.hp; hdI.value = sb.hit_dice; upd(); };
    hdN.addEventListener('input', calcHp);
    bind(field(g, 'Speed', inputEl('text', sb.speed)), 'speed');

    g = sec('Ability scores (tick = proficient save)');
    g.addClass('dms-abil-grid');
    ABILS.forEach(a => {
      const w = g.createDiv({ cls: 'dms-f' }); w.createEl('label', { text: a.toUpperCase() });
      const i = w.createEl('input', { type: 'number', value: sb[a] }); i.addEventListener('input', () => { sb[a] = Number(i.value) || 1; upd(); });
      const ck = w.createEl('label', { cls: 'dms-save-ck' }); const cb = ck.createEl('input', { type: 'checkbox' }); cb.checked = sb.saves.includes(a); ck.appendText(' save');
      cb.addEventListener('change', () => { sb.saves = cb.checked ? [...new Set([...sb.saves, a])] : sb.saves.filter(x => x !== a); upd(); });
    });

    g = sec('Details');
    bind(field(g, 'Skills', inputEl('text', sb.skills, { placeholder: 'Perception +4, Stealth +6' })), 'skills');
    bind(field(g, 'Senses', inputEl('text', sb.senses, { placeholder: 'Darkvision 60 ft. (Passive Perception added automatically)' })), 'senses');
    bind(field(g, 'Languages', inputEl('text', sb.languages)), 'languages');
    bind(field(g, 'Gear', inputEl('text', sb.gear)), 'gear');
    bind(field(g, 'Vulnerabilities', inputEl('text', sb.vulnerabilities)), 'vulnerabilities');
    bind(field(g, 'Resistances', inputEl('text', sb.resistances)), 'resistances');
    bind(field(g, 'Immunities', inputEl('text', sb.immunities, { placeholder: 'Poison; Poisoned' })), 'immunities');
    const envI = field(g, 'Environment (comma-separated)', inputEl('text', [].concat(this.extra.environment).join(', ')));
    envI.addEventListener('input', () => { this.extra.environment = envI.value.split(',').map(s => s.trim()).filter(Boolean); });

    const lists = [['traits', 'Traits'], ['actions', 'Actions'], ['bonus_actions', 'Bonus Actions'], ['reactions', 'Reactions'], ['legendary_actions', 'Legendary Actions']];
    for (const [key, label] of lists) {
      form.createDiv({ cls: 'dms-sec', text: label });
      if (key === 'legendary_actions') {
        const li = form.createEl('textarea', { cls: 'dms-ta', attr: { rows: 2, placeholder: 'Legendary intro, e.g. *Legendary Action Uses: 3.* Immediately after another creature\'s turn…' } }); li.value = sb.legendary_intro || '';
        li.addEventListener('input', () => { sb.legendary_intro = li.value; upd(); });
      }
      const box = form.createDiv({ cls: 'dms-entries' });
      const draw = () => {
        box.empty();
        sb[key].forEach((it, idx) => {
          const r = box.createDiv({ cls: 'dms-entry-edit' });
          const n = r.createEl('input', { type: 'text', value: it.name, attr: { placeholder: 'Name' } });
          const d = r.createEl('textarea', { cls: 'dms-ta', attr: { rows: 2, placeholder: 'Description (Markdown, [[links]] work)' } }); d.value = it.desc;
          n.addEventListener('input', () => { it.name = n.value; upd(); }); d.addEventListener('input', () => { it.desc = d.value; upd(); });
          btn(r, '', 'trash-2', () => { sb[key].splice(idx, 1); draw(); upd(); }).setAttr('aria-label', 'Remove');
        });
        const add = box.createDiv({ cls: 'dms-row dms-wrap' });
        btn(add, 'Add', 'plus', () => { sb[key].push({ name: '', desc: '' }); draw(); });
        if (key === 'actions' || key === 'legendary_actions' || key === 'bonus_actions') {
          btn(add, 'Attack…', 'sword', () => new AttackHelperModal(this.app, sb, d => { sb[key].push(d); draw(); upd(); }).open());
          btn(add, 'Save ability…', 'zap', () => new SaveHelperModal(this.app, sb, d => { sb[key].push(d); draw(); upd(); }).open());
        }
        if (key === 'actions') btn(add, 'Multiattack', 'layers', () => { sb[key].unshift({ name: 'Multiattack', desc: 'The ' + (sb.name || 'creature').toLowerCase() + ' makes two attacks.' }); draw(); upd(); });
        if (key === 'traits') btn(add, 'Legendary Resistance', 'shield', () => { sb[key].push({ name: 'Legendary Resistance (3/Day)', desc: 'If the ' + (sb.name || 'creature').toLowerCase() + ' fails a saving throw, it can choose to succeed instead.' }); draw(); upd(); });
      };
      draw();
    }

    const villainBox = form.createDiv(); villainBox.style.display = this.villain ? '' : 'none';
    villainBox.createDiv({ cls: 'dms-sec', text: 'Villain profile' });
    const vg = villainBox.createDiv({ cls: 'dms-form-grid' });
    for (const [k, l, ph] of [['goal', 'Goal', 'What do they want?'], ['lair', 'Lair / base', 'Link a place: [[The Old Mill]]'], ['minions', 'Minions', '[[Cultist]] ×4'], ['weakness', 'Weakness', 'What can the party exploit?']]) {
      const i = field(vg, l, inputEl('text', this.extra[k], { placeholder: ph })); i.addEventListener('input', () => { this.extra[k] = i.value; });
    }
    form.createDiv({ cls: 'dms-sec', text: 'Tactics' });
    const tac = form.createEl('textarea', { cls: 'dms-ta', attr: { rows: 2, placeholder: 'How does it fight?' } }); tac.value = this.extra.tactics; tac.addEventListener('input', () => { this.extra.tactics = tac.value; });

    const foot = c.createDiv({ cls: 'dms-row dms-wrap dms-builder-foot' });
    btn(foot, this.opts.file ? 'Save changes' : 'Save to Bestiary', 'save', () => this.save(), 'mod-cta');
    btn(foot, 'Add to combat', 'swords', () => this.plugin.addMonster(this.finalSb(), this.opts.file || null, 1));
    btn(foot, 'Copy statblock', 'copy', () => { try { navigator.clipboard.writeText(statblockToYaml(this.finalSb())); new Notice('Statblock copied'); } catch (e) { new Notice('Copy not available'); } });
    btn(foot, 'Cancel', null, () => this.close());
    this.refresh();
  }
  finalSb() {
    const sb = JSON.parse(JSON.stringify(this.sb)); delete sb._meta;
    sb.name = (sb.name || '').trim() || 'Unnamed Creature';
    const pb = pbForCr(sb.cr); const wis = mod(sb.wis);
    const percM = String(sb.skills || '').match(/Perception\s*([+−-]\s?\d+)/i);
    const pp = 10 + (percM ? Number(percM[1].replace('−', '-').replace(/\s/g, '')) : wis);
    if (!/Passive Perception/i.test(sb.senses || '')) sb.senses = (sb.senses ? sb.senses.replace(/;?\s*$/, '; ') : '') + 'Passive Perception ' + pp;
    if (sb.initiative == null || sb.initiative === '') delete sb.initiative;
    if (!sb.legendary_actions.length) { delete sb.legendary_actions; delete sb.legendary_intro; }
    return sb;
  }
  async refresh() {
    if (!this.previewEl) return;
    if (this.crCheckEl) renderCrCheck(this.crCheckEl, this.finalSb(), cr => { this.sb.cr = cr; this.crS.value = cr; this.showCr(); this.refresh(); });
    this.previewEl.empty(); const comp = new obsidian.Component(); comp.load();
    try { await this.plugin.drawStatblock(Object.assign({ _preview: true }, this.finalSb()), this.previewEl, this.opts.file || '', comp); }
    catch (e) { this.previewEl.createDiv({ cls: 'dms-error', text: e.message }); }
  }
  async save() {
    const sb = this.finalSb();
    if (this.opts.file) {
      const f = this.app.vault.getAbstractFileByPath(this.opts.file);
      if (!(f instanceof TFile)) return;
      const text = await this.app.vault.read(f);
      const out = text.match(/```statblock[^\n]*\n[\s\S]*?```/) ? text.replace(/```statblock[^\n]*\n[\s\S]*?```/, () => statblockToYaml(sb)) : text.replace(/\s*$/, '\n\n') + statblockToYaml(sb) + '\n';
      await this.app.vault.modify(f, out);
      if (this.plugin.fm(f).type === 'monster' || this.villain) await this.app.fileManager.processFrontMatter(f, fm => { fm.cr = String(sb.cr); fm.creature_type = String(sb.type || '').split(' ')[0]; if (this.villain) { fm.villain = true; } });
      new Notice('Statblock updated: ' + sb.name); this.close(); return;
    }
    const f = await this.plugin.saveMonster(Object.assign(sb, { _meta: { tactics: this.extra.tactics, environment: this.extra.environment } }), Object.assign({ villain: this.villain }, this.extra));
    if (f) { this.close(); this.app.workspace.getLeaf(false).openFile(f); }
  }
  onClose() { this.contentEl.empty(); }
}

class AttackHelperModal extends Modal {
  constructor(app, sb, cb) { super(app); this.sb = sb; this.cb = cb; }
  onOpen() {
    const c = this.contentEl; c.createEl('h3', { text: 'Add an attack' });
    const g = c.createDiv({ cls: 'dms-form-grid' });
    const weapons = this.app.vault.getMarkdownFiles().filter(f => { const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter || {}; return fm.type === 'weapon' && !String(fm.holder || '').trim() && !f.path.startsWith('Templates/'); }).sort((a, b) => a.basename.localeCompare(b.basename));
    const fromArmory = weapons.length ? field(g, 'From Armory', selectEl([['', '— pick a weapon —'], ...weapons.map(f => [f.path, f.basename])], '')) : null;
    const name = field(g, 'Name', inputEl('text', 'Longsword'));
    const kind = field(g, 'Kind', selectEl(['Melee', 'Ranged', 'Melee or Ranged'], 'Melee'));
    const magic = field(g, 'Magic bonus', selectEl(['0', '1', '2', '3'], '0'));
    const abil = field(g, 'Ability', selectEl(ABILS.map(a => [a, a.toUpperCase()]), mod(this.sb.dex) > mod(this.sb.str) ? 'dex' : 'str'));
    const reach = field(g, 'Reach / range', inputEl('text', 'reach 5 ft.'));
    const dice = field(g, 'Damage dice', inputEl('text', '1d8'));
    const type = field(g, 'Damage type', selectEl(DAMAGE_TYPES, 'Slashing'));
    const extraD = field(g, 'Extra damage (optional)', inputEl('text', '', { placeholder: '2d6 Fire' }));
    const effect = field(g, 'On-hit effect (optional)', inputEl('text', '', { placeholder: 'the target has the [[Prone]] condition' }));
    const out = c.createDiv({ cls: 'dms-muted', attr: { style: 'margin:8px 0' } });
    const build = () => {
      const pb = pbForCr(this.sb.cr), m = mod(this.sb[abil.value]) + Number(magic.value);
      const dm = dice.value.match(/(\d+)d(\d+)/); const n = dm ? +dm[1] : 1, d = dm ? +dm[2] : 6;
      const avg = Math.max(1, Math.floor(n * (d + 1) / 2) + m);
      let desc = '*' + kind.value + ' Attack Roll:* ' + fmt(m + pb) + ', ' + reach.value.trim() + ' *Hit:* ' + avg + ' (' + n + 'd' + d + (m ? (m > 0 ? ' + ' : ' − ') + Math.abs(m) : '') + ') ' + type.value + ' damage';
      const ex = extraD.value.match(/(\d+)d(\d+)\s*(\w+)?/);
      if (ex) desc += ' plus ' + Math.floor(+ex[1] * (+ex[2] + 1) / 2) + ' (' + ex[1] + 'd' + ex[2] + ') ' + (ex[3] ? cap(ex[3]) : type.value) + ' damage';
      desc += effect.value.trim() ? '. ' + cap(effect.value.trim()).replace(/\.$/, '') + '.' : '.';
      return { name: name.value.trim() || 'Attack', desc };
    };
    const show = () => out.setText(build().desc);
    [name, kind, abil, reach, dice, type, extraD, effect, magic].forEach(x => { x.addEventListener('input', show); x.addEventListener('change', show); });
    if (fromArmory) fromArmory.addEventListener('change', () => {
      const f = this.app.vault.getAbstractFileByPath(fromArmory.value); if (!f) return;
      const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter || {};
      const props = [].concat(fm.properties || []).map(String);
      const ranged = /Ranged/.test(fm.category || ''), thrown = props.find(p => /^Thrown/.test(p)), ammo = props.find(p => /^Ammunition/.test(p));
      const rng = ((thrown || ammo || '').match(/\(([\d/]+)/) || [])[1];
      name.value = f.basename; type.value = fm.damage_type || 'Slashing'; dice.value = String(fm.damage || '1d6').replace(/\s*\+.*$/, '');
      magic.value = String(Number(fm.magic_bonus) || 0);
      kind.value = ranged ? 'Ranged' : thrown ? 'Melee or Ranged' : 'Melee';
      reach.value = ranged ? 'range ' + (rng || '80/320') + ' ft.' : (props.includes('Reach') ? 'reach 10 ft.' : 'reach 5 ft.') + (thrown ? ' or range ' + (rng || '20/60') + ' ft.' : '');
      abil.value = ranged ? 'dex' : props.includes('Finesse') ? (mod(this.sb.dex) > mod(this.sb.str) ? 'dex' : 'str') : 'str';
      show();
    });
    kind.addEventListener('change', () => { reach.value = kind.value === 'Ranged' ? 'range 80/320 ft.' : kind.value === 'Melee' ? 'reach 5 ft.' : 'reach 5 ft. or range 20/60 ft.'; show(); });
    show();
    btn(c, 'Add attack', 'check', () => { this.close(); this.cb(build()); }, 'mod-cta');
  }
  onClose() { this.contentEl.empty(); }
}
class SaveHelperModal extends Modal {
  constructor(app, sb, cb) { super(app); this.sb = sb; this.cb = cb; }
  onOpen() {
    const c = this.contentEl; c.createEl('h3', { text: 'Add a saving-throw ability' });
    const g = c.createDiv({ cls: 'dms-form-grid' });
    const name = field(g, 'Name', inputEl('text', 'Fire Breath'));
    const recharge = field(g, 'Recharge', selectEl(['', 'Recharge 5–6', 'Recharge 6', '1/Day', '2/Day', '3/Day'], 'Recharge 5–6'));
    const save = field(g, 'Saving throw', selectEl(ABILS.map(a => [a, ABIL_NAMES[a]]), 'dex'));
    const dcAb = field(g, 'DC ability', selectEl(ABILS.map(a => [a, a.toUpperCase()]), 'con'));
    const area = field(g, 'Target / area', inputEl('text', 'each creature in a 15-foot Cone'));
    const dice = field(g, 'Damage dice (optional)', inputEl('text', '4d6'));
    const type = field(g, 'Damage type', selectEl(DAMAGE_TYPES, 'Fire'));
    const cond = field(g, 'Condition on failure (optional)', selectEl(['', 'Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Paralyzed', 'Poisoned', 'Prone', 'Restrained', 'Stunned']));
    const half = field(g, 'On success', selectEl([['half', 'Half damage'], ['none', 'No effect']], 'half'));
    const out = c.createDiv({ cls: 'dms-muted', attr: { style: 'margin:8px 0' } });
    const build = () => {
      const dc = 8 + pbForCr(this.sb.cr) + mod(this.sb[dcAb.value]);
      const dm = dice.value.match(/(\d+)d(\d+)/);
      let fail = dm ? Math.floor(+dm[1] * (+dm[2] + 1) / 2) + ' (' + dm[1] + 'd' + dm[2] + ') ' + type.value + ' damage' : '';
      if (cond.value) fail += (fail ? ', and the target' : 'The target') + ' has the [[' + cond.value + ']] condition until the end of its next turn';
      let desc = '*' + ABIL_NAMES[save.value] + ' Saving Throw:* DC ' + dc + ', ' + area.value.trim() + '. *Failure:* ' + cap(fail || 'Describe the effect') + '.';
      desc += dm && half.value === 'half' ? ' *Success:* Half damage only.' : ' *Success:* No effect.';
      return { name: name.value.trim() + (recharge.value ? ' (' + recharge.value + ')' : ''), desc };
    };
    const show = () => out.setText(build().desc);
    [name, recharge, save, dcAb, area, dice, type, cond, half].forEach(x => { x.addEventListener('input', show); x.addEventListener('change', show); });
    show();
    btn(c, 'Add ability', 'check', () => { this.close(); this.cb(build()); }, 'mod-cta');
  }
  onClose() { this.contentEl.empty(); }
}

Object.assign(DMStatblocksPlugin.prototype, {
  registerMonsterTools() {
    this.addRibbonIcon('skull', 'Random monster/villain', () => new RandomMonsterModal(this).open());
    this.addCommand({ id: 'new-monster', name: 'Monster/Villain builder', callback: () => new MonsterBuilderModal(this, null, {}).open() });
    this.addCommand({ id: 'new-villain', name: 'Monster/Villain builder (start as villain)', callback: () => new MonsterBuilderModal(this, { alignment: 'Lawful Evil' }, { villain: true }).open() });
    this.addCommand({ id: 'random-monster', name: 'Generate random monster/villain…', callback: () => new RandomMonsterModal(this).open() });
    this.addCommand({ id: 'edit-statblock', name: 'Edit this note\'s statblock in the builder', callback: () => { const f = this.app.workspace.getActiveFile(); if (f) this.openBuilderForFile(f.path); } });
    this.registerMarkdownCodeBlockProcessor('monster-tools', (src, el) => {
      lpSafe(el); const row = el.createDiv({ cls: 'dms-row dms-wrap dms-tools-block' });
      btn(row, 'Monster/Villain builder', 'skull', () => new MonsterBuilderModal(this, null, {}).open(), 'mod-cta');
      btn(row, 'Random monster/villain', 'dices', () => new RandomMonsterModal(this).open());
    });
  },
  async openBuilderForFile(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return;
    const sb = extractStatblock(await this.app.vault.read(f));
    if (!sb) { new Notice('No ```statblock block in this note.'); return; }
    if (sb.monster) { new Notice('This block reuses “' + sb.monster + '” — edit that note instead.'); return; }
    new MonsterBuilderModal(this, sb, { file: f.path, villain: !!this.fm(f).villain }).open();
  },
  async saveMonster(sb, extra) {
    const folder = this.settings.bestiaryFolder || 'Bestiary';
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    const base = String(sb.name || 'Unnamed Creature').replace(/[\\/:*?"<>|#^\[\]]/g, '').trim();
    let path = folder + '/' + base + '.md', i = 2;
    while (this.app.vault.getAbstractFileByPath(path)) path = folder + '/' + base + ' ' + (i++) + '.md';
    const f = await this.app.vault.create(path, monsterNote(sb, extra));
    new Notice((extra && extra.villain ? 'Villain' : 'Monster') + ' added to the Bestiary: ' + f.basename);
    return f;
  },
});

/* ================================================================== */
/* Encounter builder — create, save, edit and run encounters          */
/* ================================================================== */

function parseEncounterSrc(src) {
  let o = {}; try { o = parseYaml(src) || {}; } catch (e) { o = {}; }
  const monsters = [];
  for (const raw of [].concat(o.monsters || [])) {
    const m = String(raw).match(/^\s*(?:\[\[)?([^\]×]+?)(?:\]\])?\s*(?:[x×]\s*(\d+))?\s*$/i);
    if (m) monsters.push({ name: m[1].trim(), n: Number(m[2] || 1) });
  }
  return { title: o.title || '', monsters, party: o.party, levels: o.levels };
}
function encounterSrc(e) {
  let y = 'title: ' + JSON.stringify(e.title || 'Encounter') + '\nmonsters:\n';
  y += e.monsters.map(m => '  - ' + JSON.stringify(m.name + (m.n > 1 ? ' x' + m.n : ''))).join('\n') + '\n';
  if (e.levels && e.levels.length) y += 'levels: ' + JSON.stringify(e.levels) + '\n';
  return y.replace(/\n$/, '');
}
function difficultyFor(xp, levels) {
  const b = [0, 0, 0]; levels.forEach(l => { const x = XP_BUDGET[Math.min(20, Math.max(1, l))]; b[0] += x[0]; b[1] += x[1]; b[2] += x[2]; });
  const label = !levels.length ? '—' : xp > b[2] ? 'Beyond High' : xp > b[1] ? 'High' : xp > b[0] ? 'Moderate' : 'Low';
  return { budget: b, label };
}

class EncounterBuilderModal extends Modal {
  constructor(plugin, init, opts) {
    super(plugin.app); this.plugin = plugin; this.opts = opts || {};
    this.e = Object.assign({ title: '', monsters: [], location: '', session: '', environment: 'Any', target: 'Moderate', setup: '', terrain: '', tactics: '', treasure: '', levels: null }, init || {});
    this.e.monsters = this.e.monsters.map(m => Object.assign({}, m));
  }
  bestiary() {
    return this.app.vault.getMarkdownFiles().filter(f => !this.plugin.isTemplate(f) && this.plugin.fm(f).type === 'monster');
  }
  monsterInfo(name) {
    const f = this.app.metadataCache.getFirstLinkpathDest(name, '');
    const fm = f ? this.plugin.fm(f) : {};
    const cr = fm.cr != null ? String(fm.cr) : null;
    return { f, cr, xp: cr != null ? (CR_XP[cr] || 0) : 0, env: [].concat(fm.environment || []).map(String) };
  }
  partyLevels() {
    if (this.e.levels && this.e.levels.length) return this.e.levels;
    return this.plugin.activePlayers().map(f => Number(this.plugin.fm(f).level) || 1);
  }
  onOpen() {
    const c = this.contentEl; this.modalEl.addClass('dms-wide-modal');
    c.createEl('h3', { text: this.opts.src ? 'Edit encounter' : 'Encounter builder' });
    const e = this.e;
    const g = c.createDiv({ cls: 'dms-form-grid' });
    const title = field(g, 'Encounter name', inputEl('text', e.title, { placeholder: 'e.g. Ambush at the ford' })); title.addEventListener('input', () => e.title = title.value);
    const places = this.app.vault.getMarkdownFiles().filter(f => this.plugin.fm(f).type === 'place').map(f => f.basename);
    const sessions = this.app.vault.getMarkdownFiles().filter(f => this.plugin.fm(f).type === 'session').map(f => f.basename);
    const loc = field(g, 'Location', selectEl([['', '—'], ...places.map(p => [p, p])], e.location)); loc.addEventListener('change', () => e.location = loc.value);
    const ses = field(g, 'Session', selectEl([['', '—'], ...sessions.map(p => [p, p])], e.session)); ses.addEventListener('change', () => e.session = ses.value);
    const envs = [...new Set(this.bestiary().flatMap(f => [].concat(this.plugin.fm(f).environment || []).map(String)))].sort();
    const env = field(g, 'Environment (for suggestions)', selectEl(['Any', ...envs], e.environment)); env.addEventListener('change', () => e.environment = env.value);
    const target = field(g, 'Target difficulty', selectEl(['Low', 'Moderate', 'High'], e.target)); target.addEventListener('change', () => { e.target = target.value; draw(); });
    const lv = field(g, 'Party levels (blank = active party)', inputEl('text', (e.levels || []).join(', '), { placeholder: this.partyLevels().join(', ') || 'e.g. 3, 3, 4' }));
    lv.addEventListener('input', () => { const a = lv.value.split(/[,\s]+/).map(Number).filter(n => n >= 1 && n <= 20); e.levels = a.length ? a : null; draw(); });

    const meter = c.createDiv({ cls: 'dms-enc-meter' });
    const list = c.createDiv({ cls: 'dms-enc-list' });
    const tools = c.createDiv({ cls: 'dms-row dms-wrap' });
    btn(tools, 'Add from Bestiary', 'plus', () => this.addFromBestiary(draw), 'mod-cta');
    btn(tools, 'Suggest encounter', 'sparkles', () => { this.suggest(); draw(); });
    btn(tools, 'Generate new monster', 'skull', async () => { await this.generateNew(); draw(); });
    btn(tools, 'Clear', 'trash-2', () => { e.monsters = []; draw(); });

    const notes = c.createDiv({ cls: 'dms-form-grid' });
    for (const [k, label, ph] of [['setup', 'Read-aloud / setup', 'What the characters see as it begins'], ['terrain', 'Terrain & features', 'Cover, hazards, elevation, light'], ['tactics', 'Tactics', 'How the enemies fight; when they flee'], ['treasure', 'Treasure', 'Coins, items, clues']]) {
      const w = notes.createDiv({ cls: 'dms-f dms-span2' }); w.createEl('label', { text: label });
      const t = w.createEl('textarea', { cls: 'dms-ta', attr: { rows: 2, placeholder: ph } }); t.value = e[k]; t.addEventListener('input', () => e[k] = t.value);
    }
    const foot = c.createDiv({ cls: 'dms-row dms-wrap dms-builder-foot' });
    if (this.opts.src && this.opts.file) btn(foot, 'Update this encounter', 'save', () => this.updateInPlace(), 'mod-cta');
    btn(foot, 'Save as encounter note', 'file-plus', () => this.saveNote(), this.opts.src ? '' : 'mod-cta');
    btn(foot, 'Insert into current note', 'text-cursor-input', () => this.insert());
    btn(foot, 'Run now', 'swords', () => this.run());

    const draw = () => {
      list.empty();
      if (!e.monsters.length) list.createDiv({ cls: 'dms-muted', text: 'No monsters yet — add some from the Bestiary, ask for a suggestion, or generate a new one.' });
      e.monsters.forEach((m, i) => {
        const info = this.monsterInfo(m.name);
        const r = list.createDiv({ cls: 'dms-enc-row' });
        const a = r.createEl('a', { cls: 'internal-link' + (info.f ? '' : ' is-unresolved'), text: m.name });
        a.addEventListener('click', ev => { ev.preventDefault(); if (info.f) this.app.workspace.openLinkText(info.f.path, '', true); });
        r.createSpan({ cls: 'dms-muted', text: info.cr != null ? 'CR ' + info.cr + ' · ' + info.xp + ' XP' : 'not in Bestiary' });
        const n = r.createEl('input', { type: 'number', value: m.n, attr: { min: 1, max: 30 } }); n.addEventListener('input', () => { m.n = Math.max(1, Number(n.value) || 1); summary(); });
        btn(r, '', 'x', () => { e.monsters.splice(i, 1); draw(); }).setAttr('aria-label', 'Remove');
      });
      summary();
    };
    const summary = () => {
      meter.empty();
      const levels = this.partyLevels();
      const xp = e.monsters.reduce((a, m) => a + this.monsterInfo(m.name).xp * m.n, 0);
      const d = difficultyFor(xp, levels);
      const head = meter.createDiv({ cls: 'dms-enc-head' });
      head.createSpan({ cls: 'dms-enc-label dms-diff-' + d.label.split(' ')[0].toLowerCase(), text: d.label });
      head.createSpan({ text: ' ' + xp.toLocaleString() + ' XP · party ' + (levels.length ? levels.length + ' × L' + levels.join('/') : 'unknown') });
      if (!levels.length) return;
      const max = Math.max(d.budget[2] * 1.25, xp, 1);
      const bar = meter.createDiv({ cls: 'dms-enc-bar' });
      const fill = bar.createDiv({ cls: 'dms-enc-fill' }); fill.style.width = Math.min(100, xp / max * 100) + '%';
      ['Low', 'Moderate', 'High'].forEach((l, i) => { const t = bar.createDiv({ cls: 'dms-enc-tick', text: l }); t.style.left = (d.budget[i] / max * 100) + '%'; });
      meter.createDiv({ cls: 'dms-muted', text: 'Budget: Low ' + d.budget[0].toLocaleString() + ' · Moderate ' + d.budget[1].toLocaleString() + ' · High ' + d.budget[2].toLocaleString() });
    };
    draw();
  }
  addFromBestiary(after) {
    const items = this.bestiary().map(f => ({ file: f, label: f.basename + '  ·  CR ' + (this.plugin.fm(f).cr ?? '?') + (this.plugin.fm(f).villain ? '  ·  villain' : '') }));
    if (!items.length) { new Notice('The Bestiary is empty.'); return; }
    new FileSuggest(this.app, items, it => {
      new CountModal(this.app, it.file.basename, n => { const ex = this.e.monsters.find(m => m.name === it.file.basename); if (ex) ex.n += n; else this.e.monsters.push({ name: it.file.basename, n }); after(); }).open();
    }, 'Add which creature?').open();
  }
  suggest() {
    const levels = this.partyLevels(); if (!levels.length) { new Notice('Set party levels first.'); return; }
    const budget = difficultyFor(0, levels).budget[['Low', 'Moderate', 'High'].indexOf(this.e.target)];
    let pool = this.bestiary().map(f => ({ f, ...this.monsterInfo(f.basename) })).filter(x => x.xp > 0 && x.xp <= budget && !this.plugin.fm(x.f).villain);
    if (this.e.environment !== 'Any') { const p2 = pool.filter(x => x.env.includes(this.e.environment) || x.env.includes('any')); if (p2.length) pool = p2; }
    if (!pool.length) { new Notice('No Bestiary creature fits that budget — try “Generate new monster”.'); return; }
    pool.sort(() => Math.random() - 0.5);
    const lead = pool.filter(x => x.xp >= budget * 0.3).sort((a, b) => b.xp - a.xp)[0] || pool.sort((a, b) => b.xp - a.xp)[0];
    const monsters = [{ name: lead.f.basename, n: 1 }]; let left = budget - lead.xp;
    const minion = pool.filter(x => x.f !== lead.f && x.xp <= left).sort(() => Math.random() - 0.5)[0];
    if (minion) monsters.push({ name: minion.f.basename, n: Math.min(8, Math.max(1, Math.floor(left / minion.xp))) });
    else if (left >= lead.xp) monsters[0].n += Math.min(5, Math.floor(left / lead.xp));
    this.e.monsters = monsters;
    if (!this.e.title) this.e.title = (this.e.location ? this.e.location + ' — ' : '') + lead.f.basename + (minion ? ' & ' + minion.f.basename : '');
  }
  async generateNew() {
    const levels = this.partyLevels(); if (!levels.length) { new Notice('Set party levels first.'); return; }
    const budget = difficultyFor(0, levels).budget[['Low', 'Moderate', 'High'].indexOf(this.e.target)];
    const used = this.e.monsters.reduce((a, m) => a + this.monsterInfo(m.name).xp * m.n, 0);
    const left = Math.max(CR_XP['1/8'], budget - used);
    const sb = generateMonster({ cr: crForXp(left) });
    const f = await this.plugin.saveMonster(sb, {});
    if (f) this.e.monsters.push({ name: f.basename, n: 1 });
  }
  block() { return '```encounter\n' + encounterSrc({ title: this.e.title || 'Encounter', monsters: this.e.monsters, levels: this.e.levels }) + '\n```'; }
  async saveNote() {
    if (!this.e.monsters.length) { new Notice('Add at least one monster.'); return; }
    const e = this.e; const name = (e.title || 'Encounter').replace(/[\\/:*?"<>|#^\[\]]/g, '').trim();
    const folder = (this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins['dm-codex'] && this.app.plugins.plugins['dm-codex'].settings.folders.encounter) || 'Campaign/Encounters';
    const parts = folder.split('/'); for (let i = 1; i <= parts.length; i++) { const p = parts.slice(0, i).join('/'); if (!this.app.vault.getAbstractFileByPath(p)) await this.app.vault.createFolder(p); }
    let path = folder + '/' + name + '.md', i = 2; while (this.app.vault.getAbstractFileByPath(path)) path = folder + '/' + name + ' ' + (i++) + '.md';
    const levels = this.partyLevels(); const xp = e.monsters.reduce((a, m) => a + this.monsterInfo(m.name).xp * m.n, 0);
    const d = difficultyFor(xp, levels);
    const envs = e.environment && e.environment !== 'Any' ? [e.environment] : [];
    const content = '---\ntype: encounter\nstatus: planned\ndifficulty: ' + d.label + '\nxp: ' + xp + '\nlocation: "' + (e.location ? '[[' + e.location + ']]' : '') + '"\nsession: "' + (e.session ? '[[' + e.session + ']]' : '') + '"\nenvironment: ' + JSON.stringify(envs) + '\ntags: [encounter]\n---\n# ' + name + '\n\n'
      + '> [!read-aloud] Setup\n> ' + (e.setup || '*What the characters see as it begins.*') + '\n\n' + this.block() + '\n\n'
      + '## Creatures\n' + e.monsters.map(m => '- [[' + m.name + ']] ×' + m.n).join('\n') + '\n\n'
      + '## Terrain & features\n' + (e.terrain || '- ') + '\n\n## Tactics\n' + (e.tactics || '- ') + '\n\n## Treasure\n' + (e.treasure || '- ') + '\n\n## What happened\n- [ ] Used in a session\n';
    const f = await this.app.vault.create(path, content);
    new Notice('Encounter saved: ' + f.basename); this.close(); this.app.workspace.getLeaf(false).openFile(f);
  }
  async updateInPlace() {
    const f = this.app.vault.getAbstractFileByPath(this.opts.file); if (!(f instanceof TFile)) return;
    const text = await this.app.vault.read(f);
    const old = '```encounter\n' + this.opts.src + '\n```';
    if (!text.includes(old)) { new Notice('Could not find the original block — saving as a new note instead.'); return this.saveNote(); }
    await this.app.vault.modify(f, text.replace(old, () => this.block()));
    if (this.plugin.fm(f).type === 'encounter') {
      const xp = this.e.monsters.reduce((a, m) => a + this.monsterInfo(m.name).xp * m.n, 0);
      await this.app.fileManager.processFrontMatter(f, fm => { fm.xp = xp; fm.difficulty = difficultyFor(xp, this.partyLevels()).label; });
    }
    new Notice('Encounter updated'); this.close();
  }
  insert() {
    const ed = this.app.workspace.activeEditor && this.app.workspace.activeEditor.editor;
    if (!ed) { new Notice('Open a note first.'); return; }
    ed.replaceSelection('\n' + this.block() + '\n'); this.close();
  }
  run() {
    this.plugin.addParty();
    for (const m of this.e.monsters) {
      const info = this.monsterInfo(m.name); if (!info.f) continue;
      this.app.vault.cachedRead(info.f).then(t => { const sb = extractStatblock(t); if (sb) this.plugin.addMonster(sb, info.f.path, m.n); });
    }
    this.close();
  }
}

Object.assign(DMStatblocksPlugin.prototype, {
  registerEncounterTools() {
    this.addCommand({ id: 'new-encounter', name: 'Build a new encounter…', callback: () => new EncounterBuilderModal(this, {}, {}).open() });
    this.addCommand({ id: 'suggest-encounter', name: 'Suggest a random encounter…', callback: () => { const m = new EncounterBuilderModal(this, {}, {}); m.suggest(); m.open(); } });
    this.addRibbonIcon('shield', 'Encounter builder', () => new EncounterBuilderModal(this, {}, {}).open());
  },
  openEncounterEditor(src, sourcePath) {
    const p = parseEncounterSrc(src);
    const f = this.app.vault.getAbstractFileByPath(sourcePath);
    const fm = f ? this.fm(f) : {};
    const strip = v => String(v || '').replace(/^\[\[|\]\]$/g, '');
    new EncounterBuilderModal(this, { title: p.title, monsters: p.monsters, levels: p.levels ? [].concat(p.levels).map(Number) : null, location: fm.type === 'encounter' ? strip(fm.location) : '', session: fm.type === 'encounter' ? strip(fm.session) : '' }, { src, file: sourcePath }).open();
  },
});

module.exports = DMStatblocksPlugin;
module.exports._test = { rollDice, mod, pbForCr, CR_XP, XP_BUDGET, generateMonster, statblockToYaml, crForXp, crTargets, estimateCr };
