/**
 * dashboard.js — Multi-select filters + compact KPI
 */

// État des sélections multi
const MSState = {
  bloc:     new Set(),
  chambord: new Set(),
  levee:    new Set(),
  phase:    new Set(),
  statut:   '',
};

// Mapping Zone → Chambords (pour les options de bloc spéciales)
const ZONE_MAP = {
  'Bloc 2 - Zone 11': ['CR 22', 'CR 23', 'CR 24', 'CR 25'],
};

// Tous les chambords réservés aux zones spéciales
const ALL_ZONE_CHAMBORDS = new Set(Object.values(ZONE_MAP).flat());

/**
 * Détermine si un élément (levée ou mur) appartient à "Bloc 2 - Zone 11"
 * Règle :
 *   - CR 22 → toujours Zone 11
 *   - CR 23, 24, 25 + Phase 1 + Levée 1 ou 2 → Bloc 2 (PAS Zone 11)
 *   - CR 23, 24, 25 + autres cas → Zone 11
 */
function isZone11(item) {
  const cr = item.chambord;
  if (!ALL_ZONE_CHAMBORDS.has(cr)) return false; // pas un CR de zone 11

  if (cr === 'CR 22') return true; // CR 22 toujours en zone 11

  // CR 23, 24, 25 : Phase 1 + Levée 1 ou 2 → Bloc 2 (pas zone 11)
  const phase = String(item.phase || '').trim();
  const levee = parseInt(item.levee);
  if (phase === 'Phase 1' && (levee === 1 || levee === 2)) return false;

  return true; // tous les autres cas → zone 11
}

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
    renderChambordTable(AppState.stats);
    initMultiSelects(AppState.stats);
  }

  await initAPSViewer();
});

window.onViewerReady = async function(viewerInst) {
  await loadDataFromViewer(viewerInst);
  initCharts(AppState.stats);
  renderChambordTable(AppState.stats);
  ['msBlocDrop','msChambordDrop','msLeveeDrop','msPhaseDrop'].forEach(id => {
    const drop = document.getElementById(id);
    if (drop) {
      drop.innerHTML = '';
      drop.dataset.built = '';
    }
  });
  MSState.bloc.clear(); MSState.chambord.clear();
  MSState.levee.clear(); MSState.phase.clear();
  initMultiSelects(AppState.stats);
};

// ── Multi-select helpers ──────────────────────────────────────────────────────
function buildMultiSelect(containerId, dropId, badgeId, values, labelFn, stateKey) {
  const drop = document.getElementById(dropId);
  if (!drop) return;
  if (drop.dataset.built === '1') return;
  drop.dataset.built = '1';

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
  const blocs = Object.keys(stats.byBloc)
    .filter(b => !ZONE_MAP[b])
    .sort((a, b) => parseInt(a) - parseInt(b));

  const blocOptions = [...blocs, ...Object.keys(ZONE_MAP)];
  buildMultiSelect('msBloc','msBlocDrop','msBlocBadge', blocOptions, b => ZONE_MAP[b] ? b : `Bloc ${b}`, 'bloc');

  const chambords = Object.keys(stats.byChambord)
    .sort((a,b)=>(parseInt(a.replace(/\D/g,''))||0)-(parseInt(b.replace(/\D/g,''))||0));
  buildMultiSelect('msChambord','msChambordDrop','msChambordBadge', chambords, c=>c, 'chambord');

  const leveeVals = [...new Set(AppState.allLevees.map(l=>l.levee).filter(v=>v!==null&&v!==undefined))]
    .sort((a,b)=>parseInt(a)-parseInt(b));
  buildMultiSelect('msLevee','msLeveeDrop','msLeveeBadge', leveeVals, v=>`Levée ${v}`, 'levee');

  const phases = [...new Set(AppState.allLevees.map(l=>l.phase).filter(Boolean))].sort();
  buildMultiSelect('msPhase','msPhaseDrop','msPhaseBadge', phases, p=>p, 'phase');

  updateQfCount(AppState.allLevees.length, AppState.allLevees.length);
}

// ── Filtre principal ──────────────────────────────────────────────────────────
window.onQuickFilter = function() {
  const statut = document.getElementById('filterStatut')?.value || '';
  document.getElementById('filterStatut')?.classList.toggle('has-value', statut!=='');

  const selectedBlocs = new Set();
  const selectedZoneChambords = new Set();
  MSState.bloc.forEach(val => {
    if (ZONE_MAP[val]) {
      ZONE_MAP[val].forEach(c => selectedZoneChambords.add(c));
    } else {
      selectedBlocs.add(val);
    }
  });

  const filteredLevees = AppState.allLevees.filter(l => {
    if (MSState.bloc.size > 0) {
      const itemIsZone11 = isZone11(l);

      if (itemIsZone11) {
        // Cet élément appartient à Zone 11 → visible seulement si Zone 11 sélectionnée
        if (!selectedZoneChambords.has(l.chambord)) return false;
      } else {
        // Cet élément appartient à un bloc normal → visible si son bloc est sélectionné
        if (!selectedBlocs.has(l.bloc)) return false;
      }
    }
    if (MSState.chambord.size>0 && !MSState.chambord.has(l.chambord))        return false;
    if (MSState.levee.size>0    && !MSState.levee.has(String(l.levee)))      return false;
    if (MSState.phase.size>0    && !MSState.phase.has(l.phase))              return false;
    if (statut && l.statut !== statut)                                        return false;
    return true;
  });

  const filteredStats = computeStats(filteredLevees);
  AppState.filteredStats  = filteredStats;
  AppState.filteredLevees = filteredLevees;

  updateCharts(filteredStats);
  renderChambordTable(filteredStats);
  updateQfCount(filteredLevees.length, AppState.allLevees.length);

  const filteredElements = AppState.allElements.filter(el => {
    if (MSState.bloc.size > 0) {
      const itemIsZone11 = isZone11(el);

      if (itemIsZone11) {
        if (!selectedZoneChambords.has(el.chambord)) return false;
      } else {
        if (!selectedBlocs.has(el.bloc)) return false;
      }
    }
    if (MSState.chambord.size>0 && !MSState.chambord.has(el.chambord))       return false;
    if (MSState.levee.size>0    && !MSState.levee.has(String(el.levee)))     return false;
    if (MSState.phase.size>0    && !MSState.phase.has(el.phase))             return false;
    if (statut && el.statut !== statut)                                        return false;
    return true;
  });

  const hasFilter = MSState.bloc.size>0||MSState.chambord.size>0||MSState.levee.size>0||MSState.phase.size>0||!!statut;
  applyViewerFilter(filteredElements, hasFilter);
};

function applyViewerFilter(filteredElements, hasFilter) {
  if (!viewer || !viewer.model) return;
  if (!hasFilter) {
    viewer.showAll();
    viewer.clearThemingColors(viewer.model);
    coloringApplied = false;
    document.getElementById('btnColor')?.classList.remove('active');
    return;
  }

  const filteredSet = new Set(filteredElements.map(el => parseInt(el.id)).filter(n => !isNaN(n)));
  const allIds = AppState.allElements.map(el => parseInt(el.id)).filter(n => !isNaN(n));
  const hiddenIds = allIds.filter(id => !filteredSet.has(id));

  viewer.showAll();
  if (hiddenIds.length > 0) viewer.hide(hiddenIds);

  viewer.clearThemingColors(viewer.model);
  for (const el of filteredElements) {
    const id = parseInt(el.id);
    if (!isNaN(id)) {
      viewer.setThemingColor(id, getAPSColor(el.statut), viewer.model, true);
    }
  }
  coloringApplied = true;
  document.getElementById('btnColor')?.classList.add('active');

  const filteredArr = [...filteredSet];
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
  ['bloc','chambord','levee','phase'].forEach(key => {
    MSState[key].clear();
    const drop = document.getElementById(`ms${key.charAt(0).toUpperCase()+key.slice(1)}Drop`);
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

  if (viewer) {
    viewer.showAll();
    viewer.clearThemingColors(viewer.model);
    coloringApplied = false;
    document.getElementById('btnColor')?.classList.remove('active');
  }
  updateCharts(AppState.stats);
  renderChambordTable(AppState.stats);
};

// ── Interactions graphes ──────────────────────────────────────────────────────
window.onViewerSelection = function(el) {
  if (!el?.chambord) return;
  MSState.chambord.clear();
  const drop = document.getElementById('msChambordDrop');
  if (drop) {
    drop.querySelectorAll('.ms-option input').forEach(cb => {
      const selected = cb.value === el.chambord;
      cb.checked = selected;
      cb.closest('.ms-option').classList.toggle('checked', selected);
      if (selected) MSState.chambord.add(cb.value);
    });
  }
  updateBadge('msChambordBadge','msChambord', MSState.chambord.size);
  onQuickFilter();
};

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

window.onChambordRowClick = function(chambord, rowEl) {
  document.querySelectorAll('#chambordBody tr').forEach(r=>r.classList.remove('selected'));
  if (rowEl) rowEl.classList.add('selected');
  MSState.chambord.clear();
  const drop = document.getElementById('msChambordDrop');
  if (drop) {
    drop.querySelectorAll('.ms-option input').forEach(cb => {
      const selected = cb.value === chambord;
      cb.checked = selected;
      cb.closest('.ms-option').classList.toggle('checked', selected);
      if (selected) MSState.chambord.add(cb.value);
    });
  }
  updateBadge('msChambordBadge','msChambord', MSState.chambord.size);
  onQuickFilter();
};

window.onStatutClick = function(statut) {
  const sel = document.getElementById('filterStatut');
  if (sel) { sel.value=statut; sel.classList.add('has-value'); }
  onQuickFilter();
};

window.resetFilters = function() {
  window.resetQuickFilters();
  document.querySelectorAll('#chambordBody tr').forEach(r=>r.classList.remove('selected'));
  closeDetail();
};

window.exportPDF = function() {
  document.title = `BIM Dashboard SGTM — ${new Date().toLocaleDateString('fr-FR')}`;
  window.print();
};