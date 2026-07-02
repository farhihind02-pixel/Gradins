/**
 * viewer-aps.js — Intégration APS Viewer (Autodesk Platform Services)
 *
 * Gère :
 *  - Initialisation du viewer avec token 2-legged
 *  - Chargement du modèle ACC
 *  - Colorisation par statut (override de couleurs)
 *  - Sélection / isolation d'éléments
 *  - Communication bidirectionnelle avec le dashboard
 */

let viewer = null;          // Autodesk.Viewing.GuiViewer3D
let modelUrn = null;        // URN base64 du modèle
let coloringApplied = false;

// APS_COLORS défini dans config.js

// ── Init ──────────────────────────────────────────────────────────────────────

async function initAPSViewer() {
  try {
    setLoaderText('Récupération du token APS…');
    setLoaderProgress(10);

    // 1. Récupérer le token depuis notre backend
    const tokenResp = await fetch('/api/token');
    if (!tokenResp.ok) throw new Error('Impossible de récupérer le token APS');
    const { access_token } = await tokenResp.json();

    setLoaderProgress(25);
    setLoaderText('Initialisation du viewer…');

    // 2. Récupérer la config (URN du modèle)
    const configResp = await fetch('/api/config');
    const config = await configResp.json();
    modelUrn = config.modelUrn;
    const viewableGuid = config.viewableGuid || null;

    // 3. Initialiser APS Viewer
    await new Promise((resolve, reject) => {
      Autodesk.Viewing.Initializer(
        {
          env:         'AutodeskProduction2',
          api:         'streamingV2',
          getAccessToken: (callback) => {
            // Le token est rafraîchi automatiquement avant expiration
            fetch('/api/token')
              .then(r => r.json())
              .then(d => callback(d.access_token, 3600))
              .catch(err => console.error('[Token refresh]', err));
          },
        },
        () => resolve()
      );
    });

    setLoaderProgress(40);
    setLoaderText('Création du viewer 3D…');

    // 4. Créer le viewer dans le div #apsViewer
    const container = document.getElementById('apsViewer');
    const config3d  = {
      extensions: [],
      theme: 'light-theme',
    };

    viewer = new Autodesk.Viewing.GuiViewer3D(container, config3d);
    const startCode = viewer.start();
    if (startCode > 0) throw new Error(`Viewer start error code ${startCode}`);

    // Qualité maximale
    viewer.setQualityLevel(false, true);
    viewer.setGroundShadow(true);
    viewer.setProgressiveRendering(true);
    viewer.setOptimizeNavigation(false);
    viewer.setGhosting(false);   // ← désactive le fondu en transparence des éléments non sélectionnés
    setLoaderProgress(55);
    setLoaderText('Chargement du modèle ACC…');

    // 5. Charger le document (modèle)
    await new Promise((resolve, reject) => {
      Autodesk.Viewing.Document.load(
        `urn:${modelUrn}`,
        (doc) => {
          const defaultModel = doc.getRoot().getDefaultGeometry();
          viewer.loadDocumentNode(doc, defaultModel).then(() => resolve()).catch(reject);
        },
        (errCode, errMsg) => reject(new Error(`Erreur chargement modèle : ${errCode} — ${errMsg}`))
      );
    });

    setLoaderProgress(80);
    setLoaderText('Lecture des propriétés BIM…');

    // 6. Attendre que le modèle soit entièrement chargé
    await new Promise(resolve => {
      if (viewer.model) {
        viewer.addEventListener(
          Autodesk.Viewing.GEOMETRY_LOADED_EVENT,
          () => resolve(),
          { once: true }
        );
        // Si déjà chargé
        if (viewer.isLoadDone()) resolve();
      } else {
        resolve();
      }
    });

    setLoaderProgress(90);

    // 7. Toujours reconstruire allElements + dbIdMap depuis le viewer
    // (les dbIds changent à chaque nouvelle maquette)
    setLoaderText('Lecture des éléments depuis la maquette…');
    await loadDataFromViewer(viewer);

    setLoaderProgress(100);

    // 8. Écouter les événements du viewer
    setupViewerEvents();

    hideLoader();
    setConnStatus('ok', 'ACC connecté ✓');
    console.log('[APS] Viewer initialisé ✓');

    // 9. Forcer l'orientation de la vue (corriger l'inversion ACC)
    setTimeout(() => {
      const nav = viewer.navigation;
      if (nav) {
        // Vue isométrique standard : position en haut-avant-droite
        const pos = new THREE.Vector3(200, -200, 150);
        const target = new THREE.Vector3(0, 0, 0);
        const up = new THREE.Vector3(0, 0, 1);
        nav.setView(pos, target);
        nav.setCameraUpVector(up);
        viewer.fitToView();
      }
    }, 500);

    // 10. Déclencher l'init du dashboard
    if (window.onViewerReady) window.onViewerReady(viewer);

  } catch (err) {
    console.error('[APS] Erreur:', err);
    setConnStatus('error', 'Erreur connexion ACC');
    showViewerError(err.message);
  }
}

// ── Events viewer ─────────────────────────────────────────────────────────────

function setupViewerEvents() {
  // Clic sur un élément → afficher ses propriétés dans le dashboard
  viewer.addEventListener(
    Autodesk.Viewing.SELECTION_CHANGED_EVENT,
    (event) => {
      const dbIds = event.dbIdArray;
      if (!dbIds || dbIds.length === 0) {
        closeDetail();
        return;
      }
      // Sélection multiple (ex: résultat d'un filtre) → ne pas relancer le filtre automatique,
      // juste afficher un résumé pour éviter une boucle avec onQuickFilter().
      if (dbIds.length > 1) {
        showSelectionSummary(dbIds.length);
        return;
      }
      const dbId = dbIds[0];
      // Try dbIdMap first
      const el = AppState.dbIdMap.get(dbId);
      if (el) {
        showElementDetail(el);
      } else {
        // Chercher par ID dans allElements
        const found = AppState.allElements.find(e => parseInt(e.id) === dbId);
        if (found) {
          showElementDetail(found);
        } else {
          showRawProperties(dbId);
        }
      }
    }
  );
}

// ── Colorisation par statut ───────────────────────────────────────────────────

function applyColorOverrides() {
  if (!viewer || !AppState.allElements.length) return;

  // Réinitialiser les overrides
  viewer.clearThemingColors(viewer.model);
  coloringApplied = true;

  // Appliquer une couleur par statut
  for (const [dbId, el] of AppState.dbIdMap) {
    const color = getAPSColor(el.statut);
    viewer.setThemingColor(dbId, color, viewer.model, true);
  }

  document.getElementById('btnColor')?.classList.add('active');
  console.log('[APS] Couleurs statut appliquées ✓');
}

function resetViewerColors() {
  if (!viewer) return;
  viewer.clearThemingColors(viewer.model);
  coloringApplied = false;
  document.getElementById('btnColor')?.classList.remove('active');
}

// ── Filtres depuis dashboard → viewer ─────────────────────────────────────────

/**
 * Isoler les éléments d'un bloc dans le viewer
 */
function filterViewerByBloc(bloc) {
  if (!viewer) return;
  if (!bloc) { showAllElements(); return; }
  const dbIds = getDbIdsForFilter('bloc', bloc);
  if (dbIds.length) {
    viewer.isolate(dbIds);
    viewer.fitToView(dbIds);
  }
}

/**
 * Isoler les éléments d'une zone dans le viewer
 */
function filterViewerByZone(zone) {
  if (!viewer) return;
  if (!zone) { showAllElements(); return; }
  const dbIds = getDbIdsForFilter('zone', zone);
  if (dbIds.length) {
    viewer.isolate(dbIds);
    viewer.fitToView(dbIds);
  }
}

/**
 * Isoler les éléments d'un statut dans le viewer
 */
function filterViewerByStatut(statut) {
  if (!viewer) return;
  if (!statut) { showAllElements(); return; }
  const dbIds = getDbIdsForFilter('statut', statut);
  if (dbIds.length) {
    viewer.isolate(dbIds);
  }
}

window.showAllElements = function() {
  if (!viewer) return;
  viewer.showAll();
  viewer.fitToView();
  document.getElementById('btnIsolate')?.classList.remove('active');
};

window.isolateSelection = function() {
  if (!viewer) return;
  const sel = viewer.getSelection();
  if (sel.length) {
    viewer.isolate(sel);
    document.getElementById('btnIsolate')?.classList.add('active');
  }
};

// ── Détail élément ────────────────────────────────────────────────────────────
function showSelectionSummary(count) {
  const panel = document.getElementById('detailPanel');
  const body  = document.getElementById('detailBody');
  if (!panel || !body) return;
  body.innerHTML = `
    <div class="detail-row">
      <span class="detail-label">Sélection</span>
      <span class="detail-value">${count.toLocaleString('fr-FR')} éléments</span>
    </div>
  `;
  panel.style.display = 'block';
}

function showElementDetail(el) {
  const panel = document.getElementById('detailPanel');
  const body  = document.getElementById('detailBody');
  if (!panel || !body) return;

  body.innerHTML = `
    <div class="detail-row">
      <span class="detail-label">ID</span>
      <span class="detail-value" style="font-family:monospace;font-size:10px">${el.expressId}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Bloc</span>
      <span class="detail-value">${el.bloc || '—'}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">Zone</span>
      <span class="detail-value">${el.zone || '—'}</span>
    </div>
  `;
  panel.style.display = 'block';
}

function showRawProperties(dbId) {
  viewer.getProperties(dbId, (props) => {
    const panel = document.getElementById('detailPanel');
    const body  = document.getElementById('detailBody');
    if (!panel || !body) return;

    const relevant = (props.properties || []).filter(p =>
      ['Bloc','BB_Bloc','YE_Zone','Phase 1','RESTE','Coulé 1','Coulé 2','Levée'].includes(p.displayName)
    );

    body.innerHTML = `
      ${relevant.map(p => `
        <div class="detail-row">
          <span class="detail-label">${p.displayName}</span>
          <span class="detail-value">${p.displayValue}</span>
        </div>`).join('')}
      ${!relevant.length ? '<div style="color:#94a3b8;font-size:11px;margin-top:4px">Pas de propriétés métier</div>' : ''}
    `;
    panel.style.display = 'block';
  });
}

window.closeDetail = function() {
  const panel = document.getElementById('detailPanel');
  if (panel) panel.style.display = 'none';
  if (viewer) viewer.clearSelection();
};

// ── Helpers UI ────────────────────────────────────────────────────────────────

function setLoaderText(txt) {
  const el = document.getElementById('loaderText');
  if (el) el.textContent = txt;
}

function setLoaderProgress(pct) {
  const bar = document.getElementById('loaderBar');
  if (bar) { bar.style.animation = 'none'; bar.style.width = pct + '%'; }
}

function hideLoader() {
  const l = document.getElementById('viewerLoader');
  if (l) {
    l.style.transition = 'opacity 0.5s';
    l.style.opacity = '0';
    setTimeout(() => l.style.display = 'none', 500);
  }
}

function showViewerError(msg) {
  const l = document.getElementById('viewerLoader');
  if (l) {
    l.innerHTML = `
      <div style="color:#f04438;font-size:24px">⚠️</div>
      <div style="color:#f04438;font-weight:600;font-size:14px">Erreur de connexion ACC</div>
      <div style="color:#64748b;font-size:12px;max-width:280px;text-align:center">${msg}</div>
      <div style="color:#94a3b8;font-size:11px;margin-top:8px">
        Vérifiez vos identifiants APS dans le fichier .env et redémarrez le serveur.
      </div>`;
  }
}

function setConnStatus(type, label) {
  const dot = document.querySelector('.status-dot');
  const lbl = document.getElementById('connLabel');
  if (dot) { dot.className = 'status-dot ' + type; }
  if (lbl) lbl.textContent = label;
}

// Toggle couleurs statut ON/OFF
window.toggleColorOverrides = function() {
  if (coloringApplied) {
    resetViewerColors();
  } else {
    applyColorOverrides();
  }
  document.getElementById('btnColor')?.classList.toggle('active', coloringApplied);
};