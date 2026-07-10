/**
 * data.js — Données BIM
 * 
 * LEVÉE = groupe d'éléments ayant le même Bloc + Zone + Niveau (ME_ELEMENT LEVEL)
 * Le dashboard affiche des LEVÉES, pas des éléments individuels.
 */

const AppState = {
  allElements:   [],   // Éléments individuels (pour le viewer)
  allLevees:     [],   // Levées (pour les KPI et graphes)
  filteredLevees:[],
  activeFilter:  null,
  stats:         null,
  filteredStats: null,
  dbIdMap:       new Map(),  // dbId → element
};

// ── Chargement depuis JSON pré-calculé ────────────────────────────────────────

async function loadDataFromJSON() {
  try {
    const [elemResp, levResp] = await Promise.all([
      fetch('/assets/data.json'),
      fetch('/assets/levees.json'),
    ]);
    AppState.allElements = await elemResp.json();
    AppState.allLevees   = await levResp.json();
    AppState.dbIdMap.clear();
    AppState.allElements.forEach(el => {
      const id = parseInt(el.id);
      if (!isNaN(id)) AppState.dbIdMap.set(id, el);
    });
    console.log('[Data] dbIdMap:', AppState.dbIdMap.size, 'entrées');

    AppState.filteredLevees = [...AppState.allLevees];
    AppState.stats          = computeStats(AppState.allLevees);
    AppState.filteredStats  = AppState.stats;

    console.log(`[Data] ${AppState.allElements.length} éléments, ${AppState.allLevees.length} levées`);
    return true;
  } catch (err) {
    console.warn('[Data] Chargement JSON échoué:', err);
    return false;
  }
}

// ── Chargement depuis le Viewer APS (fallback si JSON absent) ─────────────────

async function loadDataFromViewer(viewer) {
  return new Promise((resolve, reject) => {
    viewer.model.getBulkProperties(
      null,
      {
        propFilter: [
  'BLOC',
  'ZONE',
  'ME_ELEMENT LEVEL', 'ME_ELEMENT SUB ZONE',
  'Phase 1', 'RESTE', 'Coulé 1', 'Coulé 2',
  'BB FERR', 'BB COULAGE', 'BB POSE',
  'Volume', 'Inaccessible',
],
      },
      (results) => {
        // ... reste inchangé
        AppState.allElements = [];
        AppState.dbIdMap.clear();

        for (const r of results) {
          const el = normalizeElementFromViewer(r);
          AppState.allElements.push(el);
          AppState.dbIdMap.set(r.dbId, el);
        }

        // Debug : afficher les premiers éléments avec Bloc
        const avecBloc = AppState.allElements.filter(e => e.bloc);
        console.log('[Data] Éléments avec bloc:', avecBloc.length, avecBloc.slice(0,3).map(e=>({bloc:e.bloc,zone:e.zone})));

        // Debug : histogramme des valeurs de zone (pour diagnostiquer les zones manquantes)
        const zoneCounts = {};
        let sansZone = 0;
        for (const e of AppState.allElements) {
          if (e.zone) zoneCounts[e.zone] = (zoneCounts[e.zone]||0) + 1;
          else sansZone++;
        }
        console.log('[Data] Distribution zones:', zoneCounts, '| Sans zone:', sansZone, '/', AppState.allElements.length);

        // Debug : histogramme des valeurs de bloc (pour diagnostiquer les blocs manquants)
        const blocCounts = {};
        let sansBloc = 0;
        for (const e of AppState.allElements) {
          if (e.bloc) blocCounts[e.bloc] = (blocCounts[e.bloc]||0) + 1;
          else sansBloc++;
        }
        console.log('[Data] Distribution blocs:', blocCounts, '| Sans bloc:', sansBloc, '/', AppState.allElements.length);

        // Construire les levées depuis les éléments du viewer
        AppState.allLevees   = buildLeveesFromElements(AppState.allElements);
        AppState.filteredLevees = [...AppState.allLevees];
        AppState.stats          = computeStats(AppState.allLevees);
        AppState.filteredStats  = AppState.stats;

        console.log(`[Data] ${AppState.allElements.length} éléments, ${AppState.allLevees.length} levées (viewer)`);
        resolve();
      },
      reject
    );
  });
}

function normalizeElementFromViewer(raw) {
  const props = {};
  for (const p of (raw.properties || [])) {
    props[p.displayName?.toLowerCase()] = p.displayValue;
    if (p.attributeName) props[p.attributeName.toLowerCase()] = p.displayValue;
  }
  const get = (...keys) => {
    for (const k of keys) {
      const v = props[k.toLowerCase()];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return null;
  };

  const phase1 = get('Phase 1', 'phase 1');
  const reste  = get('RESTE');
  const coule1 = get('Coulé 1', 'Coule 1');
  const coule2 = get('Coulé 2', 'Coule 2');
  const isTrue = v => v === true || v === 'true' || v === 1 || v === '.T.';

  let statut;
  if (isTrue(phase1))              statut = 'realise';
  else if (isTrue(coule1) || isTrue(coule2)) statut = 'en_cours';
  else if (isTrue(reste))          statut = 'non_realise';
  else                             statut = 'non_concerne';

 return {
  id:        String(raw.dbId),
  expressId: raw.dbId,
  bloc:      get('BLOC') ? String(get('BLOC')).trim() : null,
  zone:      get('ZONE') ? String(get('ZONE')).trim() : null,
  level:     get('ME_ELEMENT LEVEL') ? String(get('ME_ELEMENT LEVEL')).trim() : null,
  niveau:    get('ME_ELEMENT SUB ZONE') ? String(get('ME_ELEMENT SUB ZONE')).trim() : null,
  grue: toBBFlag(get('Inaccessible')) === 1 ? 'XCMG' : 'GRUE_TOUR',
  ferr:      toBBFlag(get('BB FERR', 'BB_FERR')),
  coul:      toBBFlag(get('BB COULAGE', 'BB_COULAGE')),
  pose:      toBBFlag(get('BB POSE', 'BB_POSE')),
  volume:    parseVolumeValue(get('Volume')),
  statut,
};
}

function parseVolumeValue(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const match = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : 0;
}

function toBBFlag(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v === true || v === 1 || v === '1' || v === '.T.' || v === 'true')  return 1;
  if (v === false || v === 0 || v === '0' || v === '.F.' || v === 'false') return 0;
  return null;
}

// ── Construire les levées depuis les éléments ─────────────────────────────────
function buildLeveesFromElements(elements) {
  const dict = {};
  for (const el of elements) {
    const level = el.level || 'L?';
    const key   = `${el.bloc}|${el.zone}|${level}`;
    if (!dict[key]) dict[key] = { key, bloc: el.bloc, zone: el.zone, niveau: el.niveau, grue: el.grue, level, statuts: [], nb_elements: 0 };
    dict[key].statuts.push(el.statut);
    dict[key].nb_elements++;
  }
  return Object.values(dict).map(d => ({
    key:         d.key,
    bloc:        d.bloc,
    zone:        d.zone,
    niveau:      d.niveau,
    grue:        d.grue,
    level:       d.level,
    statut:      leveeStatus(d.statuts),
    nb_elements: d.nb_elements,
  }));
}

function leveeStatus(statuts) {
  const n = statuts.length;
  const c = { realise:0, en_cours:0, non_realise:0, non_concerne:0 };
  statuts.forEach(s => c[s] = (c[s]||0)+1);
  if (c.realise === n)  return 'realise';
  if (c.en_cours > 0)   return 'en_cours';
  if (c.non_realise > 0) return 'non_realise';
  return 'non_concerne';
}

// ── Calcul des stats sur les LEVÉES ──────────────────────────────────────────
function computeStats(levees) {
  const total    = levees.length;
  const byStatut = { realise:0, en_cours:0, non_realise:0, non_concerne:0 };
  const byBloc   = {};
  const byZone   = {};
  const byNiveau = {};
  const byGrue   = {};

  for (const l of levees) {
    byStatut[l.statut] = (byStatut[l.statut]||0) + 1;

    if (l.bloc) {
      if (!byBloc[l.bloc]) byBloc[l.bloc] = { total:0, realise:0, en_cours:0, non_realise:0, non_concerne:0 };
      byBloc[l.bloc].total++;
      byBloc[l.bloc][l.statut] = (byBloc[l.bloc][l.statut]||0) + 1;
    }
    if (l.zone) {
      if (!byZone[l.zone]) byZone[l.zone] = { total:0, realise:0, en_cours:0, non_realise:0, non_concerne:0 };
      byZone[l.zone].total++;
      byZone[l.zone][l.statut] = (byZone[l.zone][l.statut]||0) + 1;
    }
    if (l.niveau) {
      if (!byNiveau[l.niveau]) byNiveau[l.niveau] = { total:0, realise:0, en_cours:0, non_realise:0, non_concerne:0 };
      byNiveau[l.niveau].total++;
      byNiveau[l.niveau][l.statut] = (byNiveau[l.niveau][l.statut]||0) + 1;
    }
    if (l.grue) {
      if (!byGrue[l.grue]) byGrue[l.grue] = { total:0, realise:0, en_cours:0, non_realise:0, non_concerne:0 };
      byGrue[l.grue].total++;
      byGrue[l.grue][l.statut] = (byGrue[l.grue][l.statut]||0) + 1;
    }
  }

  return {
    total,
    byStatut,
    byBloc,
    byZone,
    byNiveau,
    byGrue,
    pctGlobal: total > 0 ? Math.round((byStatut.realise / total) * 100) : 0,
  };
}

// ── Filtres ───────────────────────────────────────────────────────────────────
function applyFilter(type, value) {
  AppState.activeFilter = { type, value };
  const filtered = AppState.allLevees.filter(l => {
    if (type === 'bloc')     return l.bloc === value;
    if (type === 'zone')     return l.zone === value;
    if (type === 'niveau')   return l.niveau === value;
    if (type === 'grue')     return l.grue === value;
    if (type === 'statut')   return l.statut === value;
    return true;
  });
  AppState.filteredLevees = filtered;
  AppState.filteredStats  = computeStats(filtered);

  const bar = document.getElementById('filterBar');
  const lbl = document.getElementById('filterLabel');
  if (bar) bar.style.display = 'flex';
  if (lbl) lbl.textContent = `Filtre actif : ${type === 'bloc' ? 'Bloc ' : ''}${value}`;

  return AppState.filteredStats;
}

function clearFilter() {
  AppState.activeFilter   = null;
  AppState.filteredLevees = [...AppState.allLevees];
  AppState.filteredStats  = AppState.stats;
  const bar = document.getElementById('filterBar');
  if (bar) bar.style.display = 'none';
}

function getDbIdsForFilter(type, value) {
  return AppState.allElements
    .filter(el => {
      if (type === 'bloc')     return el.bloc === value;
      if (type === 'zone')     return el.zone === value;
      if (type === 'niveau')   return el.niveau === value;
      if (type === 'grue')     return el.grue === value;
      if (type === 'statut')   return el.statut === value;
      return false;
    })
    .map(el => el.expressId || parseInt(el.id))
    .filter(Boolean);
}

// ── Avancement par activité (Ferraillage / Coulage / Pose) ────────────────────
function computeActivityStats(elements) {
  let ferrVolume = 0, coulVolume = 0, poseVolume = 0, totalVolume = 0;

  for (const el of elements) {
    const v = el.volume || 0;
    totalVolume += v;

    const effFerr = el.pose === 1 || el.coul === 1 || el.ferr === 1;
    if (effFerr) ferrVolume += v;

    const effCoul = el.pose === 1 || el.coul === 1;
    if (effCoul) coulVolume += v;

    if (el.pose === 1) poseVolume += v;
  }

  const pct = (v) => totalVolume > 0 ? Math.round((v / totalVolume) * 100) : 0;

  return {
    ferr: { label: 'Ferraillage', doneVolume: ferrVolume, totalVolume, pct: pct(ferrVolume) },
    coul: { label: 'Coulage',     doneVolume: coulVolume, totalVolume, pct: pct(coulVolume) },
    pose: { label: 'Pose',        doneVolume: poseVolume, totalVolume, pct: pct(poseVolume) },
  };
}

// ── Avancement par Bloc et par Activité (même logique, groupée par Bloc) ─────
function computeBlocActivityStats(elements) {
  const byBloc = {};
  for (const el of (elements || [])) {
    if (!el.bloc) continue;
    if (!byBloc[el.bloc]) byBloc[el.bloc] = { ferrVolume:0, coulVolume:0, poseVolume:0, totalVolume:0 };
    const v = el.volume || 0;
    const d = byBloc[el.bloc];
    d.totalVolume += v;

    const effFerr = el.pose === 1 || el.coul === 1 || el.ferr === 1;
    if (effFerr) d.ferrVolume += v;

    const effCoul = el.pose === 1 || el.coul === 1;
    if (effCoul) d.coulVolume += v;

    if (el.pose === 1) d.poseVolume += v;
  }

  const result = {};
  for (const [bloc, d] of Object.entries(byBloc)) {
    const pct = (v) => d.totalVolume > 0 ? Math.round((v / d.totalVolume) * 100) : 0;
    result[bloc] = {
      ferrPct: pct(d.ferrVolume),
      coulPct: pct(d.coulVolume),
      posePct: pct(d.poseVolume),
      totalVolume: d.totalVolume,
    };
  }
  return result;
}