/**
 * dashboard.js — Multi-select filters + compact KPI
 */

// État des sélections multi
const MSState = {
  bloc:     new Set(),
  zone:     new Set(),
  niveau:   new Set(),
  grue:     new Set(),
  statut:   '',
};

document.addEventListener('DOMContentLoaded', async () => {
  const { connected } = await fetch('/api/auth/status').then(r=>r.json());

  if (!connected) {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('dashboardScreen').style.display = 'none';
    const p = new URLSearchParams(window.location.search);
    if (p.get('error')) {
      const el = document.getElementById('loginError');
      el.textContent = 'Erreur : ' + p.get('error');
      el.style.display = 'block';
    }
    return;
  }

  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('dashboardScreen').style.display = 'flex';
  document.getElementById('currentDate').textContent =
    new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'});

  // Fermer dropdowns au clic extérieur
  document.addEventListener('click', e => {
    if (!e.target.closest('.ms-wrapper')) closeAllDropdowns();
  });

  const jsonLoaded = await loadDataFromJSON();
  if (jsonLoaded && AppState.stats) {
    initCharts(AppState.stats);
    AppState.filteredElements = [...AppState.allElements];
    updateActivityBars(AppState.allElements);
    initMultiSelects(AppState.stats);
  }

  await initAPSViewer();
});

window.onViewerReady = async function(viewerInst) {
  // Toujours recharger depuis le viewer et reconstruire les filtres
  await loadDataFromViewer(viewerInst);
  initCharts(AppState.stats);
  AppState.filteredElements = [...AppState.allElements];
  updateActivityBars(AppState.allElements);
  // Vider et reconstruire les dropdowns avec les vraies données du viewer
  ['msBlocDrop','msZoneDrop','msNiveauDrop','msGrueDrop'].forEach(id => {
    const drop = document.getElementById(id);
    if (drop) drop.innerHTML = '';
  });
  MSState.bloc.clear(); MSState.zone.clear(); MSState.niveau.clear(); MSState.grue.clear();
  initMultiSelects(AppState.stats);
};

// ── Multi-select helpers ──────────────────────────────────────────────────────
function buildMultiSelect(containerId, dropId, badgeId, values, labelFn, stateKey) {
  const drop = document.getElementById(dropId);
  if (!drop || drop.querySelector('.ms-option')) return; // already built

  // Tout sélectionner (décoché par défaut = Set vide = tout affiché)
  const allDiv = document.createElement('div');
  allDiv.className = 'ms-select-all';
  allDiv.innerHTML = `<input type="checkbox" id="${dropId}All"> Tout sélectionner`;
  allDiv.querySelector('input').addEventListener('change', function() {
    const chk = this.checked;
    drop.querySelectorAll('.ms-option input').forEach(cb => {
      cb.checked = chk;
      const opt = cb.closest('.ms-option');
      opt?.classList.toggle('checked', chk);
      if (chk) MSState[stateKey].add(cb.value);
      else MSState[stateKey].delete(cb.value);
    });
    if (!chk) MSState[stateKey].clear();
    updateBadge(badgeId, containerId, MSState[stateKey].size);
    onQuickFilter();
  });
  drop.appendChild(allDiv);

  values.forEach(val => {
    const div = document.createElement('div');
    div.className = 'ms-option';
    div.innerHTML = `<input type="checkbox" value="${val}"> ${labelFn(val)}`;
    const cb = div.querySelector('input');
    cb.addEventListener('change', function() {
      if (this.checked) MSState[stateKey].add(val);
      else MSState[stateKey].delete(val);
      div.classList.toggle('checked', this.checked);
      // Update "all" checkbox
      const allCb = drop.querySelector(`#${dropId}All`);
      const totalOptions = drop.querySelectorAll('.ms-option input').length;
      if (allCb) allCb.checked = MSState[stateKey].size === totalOptions;
      updateBadge(badgeId, containerId, MSState[stateKey].size);
      onQuickFilter();
    });
    drop.appendChild(div);
  });
}

function updateBadge(badgeId, wrapperId, count) {
  const badge = document.getElementById(badgeId);
  const btn   = document.querySelector(`#${wrapperId} .ms-btn`);
  if (badge) { badge.style.display = count>0 ? 'inline' : 'none'; if(count>0) badge.textContent = count; }
  if (btn) btn.classList.toggle('active', count>0);
}

window.toggleDropdown = function(wrapperId) {
  const drop = document.querySelector(`#${wrapperId} .ms-dropdown`);
  const isOpen = drop?.classList.contains('open');
  closeAllDropdowns();
  if (!isOpen && drop) drop.classList.add('open');
};

function closeAllDropdowns() {
  document.querySelectorAll('.ms-dropdown.open').forEach(d=>d.classList.remove('open'));
}

function initMultiSelects(stats) {
  // Blocs
  const blocs = Object.keys(stats.byBloc).sort();
  buildMultiSelect('msBloc','msBlocDrop','msBlocBadge', blocs, b=>`Bloc ${b}`, 'bloc');

  // Zones
  const zones = Object.keys(stats.byZone).sort();
  buildMultiSelect('msZone','msZoneDrop','msZoneBadge', zones, z=>z, 'zone');

  // Niveaux (ME_ELEMENT SUB ZONE) — uniquement LT, MT, UT, dans cet ordre, avec libellés en français
  const NIVEAU_ORDER = ['LT', 'MT', 'UT'];
  const NIVEAU_LABELS = { LT: 'INF', MT: 'INT', UT: 'SUP' };
  const niveaux = NIVEAU_ORDER.filter(n => stats.byNiveau[n]);
  buildMultiSelect('msNiveau','msNiveauDrop','msNiveauBadge', niveaux, n => NIVEAU_LABELS[n] || n, 'niveau');

  // Grue (Commentaires) — XCMG ou Grue à tour (clé interne GRUE_TOUR sans accent, libellé affiché avec accent)
  const GRUE_ORDER  = ['XCMG', 'GRUE_TOUR'];
  const GRUE_LABELS = { XCMG: 'XCMG', GRUE_TOUR: 'Grue à tour' };
  const grues = GRUE_ORDER.filter(g => stats.byGrue[g]);
  buildMultiSelect('msGrue','msGrueDrop','msGrueBadge', grues, g => GRUE_LABELS[g] || g, 'grue');

  updateQfCount(AppState.allLevees.length, AppState.allLevees.length);
}

// ── Filtre principal ──────────────────────────────────────────────────────────
window.onQuickFilter = function() {
  const statut = document.getElementById('filterStatut')?.value || '';
  document.getElementById('filterStatut')?.classList.toggle('has-value', statut!=='');

  const filteredLevees = AppState.allLevees.filter(l => {
    if (MSState.bloc.size>0     && !MSState.bloc.has(l.bloc))                return false;
    if (MSState.zone.size>0     && !MSState.zone.has(l.zone))                return false;
    if (MSState.niveau.size>0   && !MSState.niveau.has(l.niveau))            return false;
    if (MSState.grue.size>0     && !MSState.grue.has(l.grue))                return false;
    if (statut && l.statut !== statut)                                        return false;
    return true;
  });

  const filteredStats = computeStats(filteredLevees);
  AppState.filteredStats  = filteredStats;
  AppState.filteredLevees = filteredLevees;

  updateCharts(filteredStats);
  updateQfCount(filteredLevees.length, AppState.allLevees.length);

  // Éléments pour le viewer
  const filteredElements = AppState.allElements.filter(el => {
    if (MSState.bloc.size>0     && !MSState.bloc.has(el.bloc))               return false;
    if (MSState.zone.size>0     && !MSState.zone.has(el.zone))               return false;
    if (MSState.niveau.size>0   && !MSState.niveau.has(el.niveau))           return false;
    if (MSState.grue.size>0     && !MSState.grue.has(el.grue))               return false;
    if (statut && el.statut !== statut)                                        return false;
    return true;
  });

  AppState.filteredElements = filteredElements;
  updateActivityBars(filteredElements);

  const hasFilter = MSState.bloc.size>0||MSState.zone.size>0||MSState.niveau.size>0||MSState.grue.size>0||!!statut;
  applyViewerFilter(filteredElements, hasFilter);
};

function applyViewerFilter(filteredElements, hasFilter) {
  if (!viewer || !viewer.model) return;
  if (!hasFilter) {
    viewer.showAll();
    viewer.clearThemingColors(viewer.model);
    viewer.clearSelection();
    coloringApplied = false;
    document.getElementById('btnColor')?.classList.remove('active');
    return;
  }

  const filteredSet = new Set(filteredElements.map(el => parseInt(el.id)).filter(n => !isNaN(n)));
  const allIds     = AppState.allElements.map(el => parseInt(el.id)).filter(n => !isNaN(n));
  const hiddenIds  = allIds.filter(id => !filteredSet.has(id));
  const filteredArr = [...filteredSet];

  // Le rendu de ce modèle plante/désynchronise quand on manipule une TRÈS grande liste
  // d'un coup (hide() ou isolate()). Solution : toujours opérer sur la plus petite des
  // deux listes (celle à cacher ou celle à montrer), jamais sur la grande.
  viewer.showAll();
  if (filteredArr.length <= hiddenIds.length) {
    // Le sous-ensemble filtré est le plus petit → l'isoler directement
    viewer.isolate(filteredArr);
  } else {
    // Le complément (à cacher) est le plus petit → cacher seulement celui-là
    if (hiddenIds.length > 0) viewer.hide(hiddenIds);
  }

  // Colorier par statut les éléments filtrés
  viewer.clearThemingColors(viewer.model);
  for (const el of filteredElements) {
    const id = parseInt(el.id);
    if (!isNaN(id)) {
      viewer.setThemingColor(id, getAPSColor(el.statut), viewer.model, true);
    }
  }
  coloringApplied = true;
  document.getElementById('btnColor')?.classList.add('active');

  // Zoomer sur les éléments filtrés
  viewer.clearSelection();
  if (filteredArr.length > 0) {
    setTimeout(() => viewer.fitToView(filteredArr), 200);
  }
}

function updateQfCount(filtered, total) {
  const el = document.getElementById('qfCount');
  if (!el) return;
  el.textContent = filtered===total
    ? `${total.toLocaleString('fr-FR')} levées`
    : `${filtered.toLocaleString('fr-FR')} / ${total.toLocaleString('fr-FR')} levées`;
  el.style.color = filtered===total?'':'#E87722';
  el.style.fontWeight = filtered===total?'':'600';
}

window.resetQuickFilters = function() {
  ['bloc','zone','niveau','grue'].forEach(key => {
    MSState[key].clear();
    const dropId = `ms${key.charAt(0).toUpperCase()+key.slice(1)}Drop`;
    const drop = document.getElementById(dropId);
    if (drop) {
      drop.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked=false);
      drop.querySelectorAll('.ms-option').forEach(o => o.classList.remove('checked'));
    }
    const badgeId = `ms${key.charAt(0).toUpperCase()+key.slice(1)}Badge`;
    const wrapperId = `ms${key.charAt(0).toUpperCase()+key.slice(1)}`;
    updateBadge(badgeId, wrapperId, 0);
  });

  const statSel = document.getElementById('filterStatut');
  if (statSel) { statSel.value=''; statSel.classList.remove('has-value'); }
  MSState.statut = '';

  AppState.filteredStats  = AppState.stats;
  AppState.filteredLevees = [...AppState.allLevees];
  updateQfCount(AppState.allLevees.length, AppState.allLevees.length);
  AppState.filteredElements = [...AppState.allElements];
  updateActivityBars(AppState.allElements);

if (viewer) {
    viewer.showAll();
    viewer.clearThemingColors(viewer.model);
    viewer.clearSelection();
    coloringApplied = false;
    document.getElementById('btnColor')?.classList.remove('active');
  }
  updateCharts(AppState.stats);
};

// ── Interactions graphes ──────────────────────────────────────────────────────

window.onBlocClick = function(bloc) {
  MSState.bloc.clear();
  const drop = document.getElementById('msBlocDrop');
  if (drop) {
    drop.querySelectorAll('.ms-option input').forEach(cb => {
      const selected = cb.value === bloc;
      cb.checked = selected;
      cb.closest('.ms-option').classList.toggle('checked', selected);
      if (selected) MSState.bloc.add(cb.value);
    });
  }
  updateBadge('msBlocBadge','msBloc', MSState.bloc.size);
  onQuickFilter();
};

window.onStatutClick = function(statut) {
  const sel = document.getElementById('filterStatut');
  if (sel) { sel.value=statut; sel.classList.add('has-value'); }
  onQuickFilter();
};

window.resetFilters = function() {
  window.resetQuickFilters();
  closeDetail();
};

window.exportPDF = function() {
  document.title = `BIM Dashboard SGTM — ${new Date().toLocaleDateString('fr-FR')}`;
  window.print();
};