/**
 * charts.js — Graphiques SGTM
 */
let kpiDonutChart=null, blocChart=null;

const SGTM_BLOCS = new Set(['1','2','3']);
const TGCC_BLOCS = new Set(['TGCC']);

function initCharts(stats) {
  initKpiDonut(stats);
  updateKPIs(stats);
}

function updateCharts(stats) {
  if (!stats) return;
  updateKPIs(stats);
  updateKpiDonut(stats);
}

function initKpiDonut(stats) {
  const ctx = document.getElementById('kpiDonut');
  if (!ctx) return;
  if (kpiDonutChart) { kpiDonutChart.destroy(); kpiDonutChart=null; }
  const pct = stats.pctGlobal||0;
  kpiDonutChart = new Chart(ctx, {
    type:'doughnut',
    data:{ datasets:[{ data:[pct,100-pct], backgroundColor:['#22b07d','#E5E2DC'], borderWidth:0 }] },
    options:{ responsive:true, cutout:'80%', animation:{duration:700}, plugins:{legend:{display:false},tooltip:{enabled:false}} },
  });
}

function updateKpiDonut(stats) {
  if (!kpiDonutChart) return;
  const pct=stats.pctGlobal||0;
  kpiDonutChart.data.datasets[0].data=[pct,100-pct];
  kpiDonutChart.update();
}

function updateKPIs(stats) {
  // calculé dans updateActivityBars
}

// ── Avancement par activité ───────────────────────────────────────────────────
// Unités Réalisées / Unité Totale = uniquement les éléments ME_ELEMENT TYPE = GD
function updateActivityBars(elements, elementsForGlobal) {
  const stats = computeActivityStats(elements || []);
  const set  = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  const setW = (id,v) => { const el=document.getElementById(id); if(el) el.style.width=v+'%'; };

  set('ferrPct', `${stats.ferr.pct}%`); setW('ferrBar', stats.ferr.pct);
  set('coulPct', `${stats.coul.pct}%`); setW('coulBar', stats.coul.pct);
  set('posePct', `${stats.pose.pct}%`); setW('poseBar', stats.pose.pct);

  // ── Unités Réalisées / Unité Totale ──────────────────────────────────────
  // Filtrés sur ME_ELEMENT TYPE = 'GD' uniquement
  const els   = elements || [];
  const elsGD = els.filter(el => el.elementType === 'GD');

  const unitesRealisees = elsGD.filter(el => el.pose === 1).length;
  const uniteTotale     = elsGD.filter(el => el.pose === 0 || el.pose === 1).length;
  set('kpiUnitesRealisees', unitesRealisees.toLocaleString('fr-FR'));
  set('kpiUniteTotale',     uniteTotale.toLocaleString('fr-FR'));

  // ── % Avancement Global (roue) ────────────────────────────────────────────
  // Ignore le filtre Grue — filtre GD aussi
  const elsGlobal   = (elementsForGlobal || elements || []).filter(el => el.elementType === 'GD');
  const realiseGlobal = elsGlobal.filter(el => el.pose === 1).length;
  const totalGlobal   = elsGlobal.filter(el => el.pose === 0 || el.pose === 1).length;
  const pctGlobal     = totalGlobal > 0 ? Math.round((realiseGlobal / totalGlobal) * 100) : 0;
  set('kpiPct', `${pctGlobal}%`);
  updateKpiDonutValue(pctGlobal);

  updateEnterprise(elements);
  updateBlocChartData(elements);
  renderBlocActivityTable(elements);
}

function updateKpiDonutValue(pct) {
  if (!kpiDonutChart) return;
  kpiDonutChart.data.datasets[0].data = [pct, 100 - pct];
  kpiDonutChart.update();
}

function updateEnterprise(elements) {
  let sgtmReal=0, sgtmTot=0, tgccReal=0, tgccTot=0;
  for (const el of (elements || [])) {
    if (el.pose !== 0 && el.pose !== 1) continue;
    if (SGTM_BLOCS.has(el.bloc)) { sgtmTot++; if (el.pose === 1) sgtmReal++; }
    if (TGCC_BLOCS.has(el.bloc)) { tgccTot++; if (el.pose === 1) tgccReal++; }
  }
  const sgtmPct = sgtmTot>0 ? Math.round(sgtmReal/sgtmTot*100) : 0;
  const tgccPct = tgccTot>0 ? Math.round(tgccReal/tgccTot*100) : 0;
  const set  = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  const setW = (id,v) => { const el=document.getElementById(id); if(el) el.style.width=v+'%'; };
  set('sgtmPct',`${sgtmPct}%`); setW('sgtmBar',sgtmPct);
  set('tgccPct',`${tgccPct}%`); setW('tgccBar',tgccPct);
}

function computeBlocUnitStats(elements) {
  const byBloc = {};
  for (const el of (elements || [])) {
    if (el.pose !== 0 && el.pose !== 1) continue;
    if (!el.bloc) continue;
    if (!byBloc[el.bloc]) byBloc[el.bloc] = { total: 0, realise: 0 };
    byBloc[el.bloc].total++;
    if (el.pose === 1) byBloc[el.bloc].realise++;
  }
  return byBloc;
}

function initBlocChart(elements) {
  const ctx = document.getElementById('blocChart');
  if (!ctx) return;
  if (blocChart) { blocChart.destroy(); blocChart=null; }
  const byBloc = computeBlocUnitStats(elements);
  if (!Object.keys(byBloc).length) return;
  const blocs = Object.keys(byBloc).sort();
  const {labels,datasets} = getBlocData(byBloc, blocs);
  blocChart = new Chart(ctx, { type:'bar', data:{labels,datasets}, options:getBlocOptions() });
}

function getBlocData(byBloc, blocs) {
  const labels = blocs.map(b => b === 'TGCC' ? 'Bloc TGCC' : `Bloc ${b}`);
  return {
    labels,
    datasets: [
      { label:'Unités Réalisé', data: blocs.map(b => byBloc[b]?.realise || 0),
        backgroundColor:'#22b07d', borderRadius:4, borderSkipped:false },
      { label:'Unités Totale',  data: blocs.map(b => byBloc[b]?.total   || 0),
        backgroundColor:'#8A8480', borderRadius:4, borderSkipped:false },
    ]
  };
}

function getBlocOptions() {
  return {
    responsive:true, maintainAspectRatio:false, animation:{duration:400},
    onClick:(evt,els)=>{ if(els.length&&window.onBlocClick) window.onBlocClick(blocChart.data.labels[els[0].index].replace('Bloc ','')); },
    plugins:{
      legend:{ display:true, position:'bottom', labels:{font:{size:10},boxWidth:10,padding:6,color:'#6B6B6B'} },
      tooltip:{ callbacks:{ label:ctx=> ` ${ctx.parsed.y.toLocaleString('fr-FR')} unités` } },
    },
    scales:{
      x:{ grid:{display:false}, ticks:{font:{size:10},color:'#888'} },
      y:{ grid:{color:'#F0EFED'}, ticks:{font:{size:10},color:'#AAA'} },
    },
  };
}

window.updateBlocChart = function() {
  updateBlocChartData(AppState.filteredElements || AppState.allElements);
};

function updateBlocChartData(elements) {
  const byBloc = computeBlocUnitStats(elements);
  if (!Object.keys(byBloc).length) { if (blocChart) { blocChart.destroy(); blocChart=null; } return; }
  if (!blocChart) { initBlocChart(elements); return; }
  const blocs = Object.keys(byBloc).sort();
  const {labels,datasets} = getBlocData(byBloc, blocs);
  blocChart.data.labels = labels;
  blocChart.data.datasets = datasets;
  blocChart.update();
}

function renderBlocActivityTable(elements) {
  const tbody  = document.getElementById('blocActivityBody');
  const footer = document.getElementById('tableFooter');
  if (!tbody) return;

  const byBloc = computeBlocActivityStats(elements || []);
  const blocs  = Object.keys(byBloc).sort((a, b) => {
    if (a === 'TGCC') return 1;
    if (b === 'TGCC') return -1;
    return a.localeCompare(b, undefined, { numeric: true });
  });

  tbody.innerHTML = blocs.map(b => {
    const d = byBloc[b];
    const label = b === 'TGCC' ? 'Bloc TGCC' : `Bloc ${b}`;
    return `<tr data-bloc="${b}" onclick="if(window.onBlocClick)window.onBlocClick('${b}')">
      <td><strong>${label}</strong></td>
      <td style="color:#D93025;font-weight:700">${d.ferrPct}%</td>
      <td style="color:#3B82C4;font-weight:700">${d.coulPct}%</td>
      <td style="color:#22b07d;font-weight:700">${d.posePct}%</td>
      <td style="color:#22b07d;font-weight:800">${d.posePct}%</td>
    </tr>`;
  }).join('');

  const g = computeActivityStats(elements || []);
  tbody.innerHTML += `<tr style="background:#eef7f1;font-weight:700;cursor:default" onclick="event.stopPropagation()">
    <td>TOTAL</td>
    <td style="color:#D93025">${g.ferr.pct}%</td>
    <td style="color:#3B82C4">${g.coul.pct}%</td>
    <td style="color:#22b07d">${g.pose.pct}%</td>
    <td style="color:#22b07d">${g.pose.pct}%</td>
  </tr>`;

  if (footer) footer.textContent = `${blocs.length} bloc(s)`;
}