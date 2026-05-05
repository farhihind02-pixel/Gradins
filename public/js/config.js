/**
 * config.js — Configuration SGTM BIM Dashboard
 */
const BIM_CONFIG = {
  colors: {
    realise:     '#22b07d',
    nonRealise:  '#D93025',
    sgtmOrange:  '#E87722',
    sgtmGray:    '#4A4A4A',
  },
  labels: {
    realise:     'Réalisé',
    nonRealise:  'Non réalisé',
  },
};

function getStatusColor(statut) {
  const map = {
    'realise':      BIM_CONFIG.colors.realise,
    'en_cours':     BIM_CONFIG.colors.enCours,
    'non_realise':  BIM_CONFIG.colors.nonRealise,
    'non_concerne': BIM_CONFIG.colors.nonConcerne,
  };
  return map[statut] || BIM_CONFIG.colors.nonConcerne;
}

function getStatusLabel(statut) {
  const map = {
    'realise':      'Réalisé',
    'non_realise':  'Non réalisé',
  };
  return map[statut] || 'Non concerné';
}

function getStatusBadgeClass(statut) {
  const map = {
    'realise':      'status-realise',
    'non_realise':  'status-non-realise',
  };
  return map[statut] || 'status-non-concerne';
}

// Couleurs APS pour le viewer (THREE.Vector4)
const APS_COLORS = {
  realise:      { x:0.133, y:0.690, z:0.490, w:1 },
  non_realise:  { x:0.851, y:0.188, z:0.145, w:1 },
};

function getAPSColor(statut) {
  const c = APS_COLORS[statut] || APS_COLORS.non_concerne;
  return new THREE.Vector4(c.x, c.y, c.z, c.w);
}