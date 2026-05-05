/**
 * data.js — Données BIM
 * 
 * LEVÉE = groupe d'éléments ayant le même Bloc + Chambord + Niveau (ME_ELEMENT LEVEL)
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
    // Peupler la dbIdMap depuis les éléments JSON
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
      { propFilter: ['Bloc','CHAMBORD','ME_ELEMENT LEVEL','levée réalisé','RESTE','Coulé 1','Coulé 2','Phase','Levée','Category'] },
      (results) => {
        AppState.allElements = [];
        AppState.dbIdMap.clear();

        for (const r of results) {
          const el = normalizeElementFromViewer(r);
          if (el.bloc && el.chambord) {
            AppState.allElements.push(el);
            AppState.dbIdMap.set(r.dbId, el);
          }
        }

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
  }
  const get = (...keys) => {
    for (const k of keys) {
      const v = props[k.toLowerCase()];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return null;
  };

  // levée réalisé = 1 → réalisé, sinon → non réalisé
  // Scan robuste insensible à la casse et aux accents
  const leveeRealiseProp = (raw.properties || []).find(p =>
    p.type === 1 && p.displayCategory === 'Autre' &&
    p.attributeName && p.attributeName.toLowerCase().includes('lev') &&
    p.attributeName.toLowerCase().includes('r')
  );
  const leveeRealise = leveeRealiseProp ? leveeRealiseProp.displayValue : null;
  const isTrue = v => v === true || v === 'true' || v === 1 || v === '.T.';

  const statut = isTrue(leveeRealise) ? 'realise' : 'non_realise';

  const reste = get('RESTE', 'reste');
  // Récupérer la catégorie Revit
  const categorie = (raw.properties || []).find(p => p.displayName === 'Category')?.displayValue || '';

  return {
    id:        String(raw.dbId),
    expressId: raw.dbId,
    bloc:      get('Bloc', 'bloc') ? String(get('Bloc','bloc')).trim() : null,
    chambord:  get('CHAMBORD','Chambord') ? String(get('CHAMBORD','Chambord')).trim() : null,
    level:     get('ME_ELEMENT LEVEL') ? String(get('ME_ELEMENT LEVEL')).trim() : null,
    levee:     get('Levée', 'Levee', 'levée', 'levee') !== null ? String(get('Levée','Levee','levée','levee')) : null,
    phase:     get('Phase', 'phase') !== null ? 'Phase ' + get('Phase','phase') : null,
    reste:     isTrue(reste),
    categorie,
    statut,
  };
}

// ── Construire les levées depuis les éléments ─────────────────────────────────
function buildLeveesFromElements(elements) {
  const dict = {};
  for (const el of elements) {
    // Clé basée sur Bloc + Chambord + Levée (numéro) + Phase
    // C'est la vraie définition d'une levée physique
    // Ignorer les éléments sans levée/phase assignée et les éléments RESTE
    if (el.reste) continue;
    // Inclure seulement les Murs dans le calcul des levées
    if ((el.categorie || '') !== 'Revit Murs') continue;
    const leveeNum = el.levee && el.levee !== '0' ? el.levee : null;
    if (!leveeNum) continue;
    const phase    = el.phase || '?';
    if (phase === 'Phase 0' || phase === '?') continue;
    const key      = `${el.bloc}|${el.chambord}|${phase}|${leveeNum}`;
    if (!dict[key]) dict[key] = {
      key, bloc: el.bloc, chambord: el.chambord,
      level:  el.level || null,
      phase:  el.phase || null,
      levee:  el.levee || null,
      statuts: [], nb_elements: 0
    };
    dict[key].statuts.push(el.statut);
    dict[key].nb_elements++;
  }
  return Object.values(dict).map(d => ({
    key:         d.key,
    bloc:        d.bloc,
    chambord:    d.chambord,
    level:       d.level,
    phase:       d.phase,
    levee:       d.levee,
    statut:      leveeStatus(d.statuts),
    nb_elements: d.nb_elements,
  }));
}

function leveeStatus(statuts) {
  const n = statuts.length;
  const realises = statuts.filter(s => s === 'realise').length;
  if (realises === n) return 'realise';
  return 'non_realise';
}

// ── Calcul des stats sur les LEVÉES ──────────────────────────────────────────
function computeStats(levees) {
  const total    = levees.length;
  const byStatut = { realise:0, non_realise:0 };
  const byBloc   = {};
  const byChambord = {};

  for (const l of levees) {
    byStatut[l.statut] = (byStatut[l.statut]||0) + 1;

    if (l.bloc) {
      if (!byBloc[l.bloc]) byBloc[l.bloc] = { total:0, realise:0, non_realise:0 };
      byBloc[l.bloc].total++;
      byBloc[l.bloc][l.statut] = (byBloc[l.bloc][l.statut]||0) + 1;
    }
    if (l.chambord) {
      if (!byChambord[l.chambord]) byChambord[l.chambord] = { total:0, realise:0, non_realise:0 };
      byChambord[l.chambord].total++;
      byChambord[l.chambord][l.statut] = (byChambord[l.chambord][l.statut]||0) + 1;
    }
  }

  return {
    total,
    byStatut,
    byBloc,
    byChambord,
    pctGlobal: total > 0 ? Math.round((byStatut.realise / total) * 100) : 0,
  };
}

// ── Filtres ───────────────────────────────────────────────────────────────────
function applyFilter(type, value) {
  AppState.activeFilter = { type, value };
  const filtered = AppState.allLevees.filter(l => {
    if (type === 'bloc')     return l.bloc === value;
    if (type === 'chambord') return l.chambord === value;
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
      if (type === 'chambord') return el.chambord === value;
      if (type === 'statut')   return el.statut === value;
      return false;
    })
    .map(el => el.expressId || parseInt(el.id))
    .filter(Boolean);
}