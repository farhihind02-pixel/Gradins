/**
 * upload-oss-v4.js — Upload OSS avec renouvellement d'URL par part
 * Exécuter avec : node upload-oss-v4.js
 */

const fs    = require('fs');
const fetch = require('node-fetch');

const CLIENT_ID     = 'R7i5eb00zoX7tcQavoEga9hMAtHgI77RzLh5KGlwbWNJuEuG';
const CLIENT_SECRET = 'wgA95unOg6SssZ2cougAhNJzXFughC72w7oq4rAMDDvRlGiYTvjXdQNcqzOURXRU';
const BUCKET_KEY    = 'sgtm-bim-dashboard-bucket';
const FILE_PATH     = 'C:\\Users\\Farhi-pc\\Downloads\\PFE\\Levee CR_CALEPINAGE.rvt';
const OBJECT_NAME   = 'Levee_CR_CALEPINAGE_v4.rvt';
const PART_SIZE     = 50 * 1024 * 1024; // 50MB par part

async function getToken() {
  const resp = await fetch('https://developer.api.autodesk.com/authentication/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      grant_type: 'client_credentials',
      scope: 'data:read data:write data:create bucket:read bucket:create',
    }),
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('Token échoué');
  return data.access_token;
}

async function createBucket(token) {
  const resp = await fetch('https://developer.api.autodesk.com/oss/v2/buckets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketKey: BUCKET_KEY, policyKey: 'persistent' }),
  });
  if (resp.status !== 409 && !resp.ok) throw new Error('Bucket échoué');
}

async function getUploadUrl(token, uploadKey, partNumber) {
  // Renouveler l'URL pour une part spécifique
  const url = uploadKey
    ? `https://developer.api.autodesk.com/oss/v2/buckets/${BUCKET_KEY}/objects/${OBJECT_NAME}/signeds3upload?part=${partNumber}&uploadKey=${encodeURIComponent(uploadKey)}`
    : `https://developer.api.autodesk.com/oss/v2/buckets/${BUCKET_KEY}/objects/${OBJECT_NAME}/signeds3upload?parts=1`;
  
  const resp = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error('URL part échouée: ' + JSON.stringify(data));
  return { uploadKey: data.uploadKey, url: data.urls[0] };
}

async function main() {
  console.log('\n=== UPLOAD OSS v4 — SGTM BIM Dashboard ===\n');
  try {
    const fileBuffer = fs.readFileSync(FILE_PATH);
    const fileSize   = fileBuffer.length;
    const nbParts    = Math.ceil(fileSize / PART_SIZE);
    console.log(`Fichier: ${(fileSize/1024/1024).toFixed(1)} MB — ${nbParts} parts de ${PART_SIZE/1024/1024}MB`);

    let token = await getToken();
    console.log('Token OK ✓');

    await createBucket(token);
    console.log('Bucket OK ✓');

    let uploadKey = null;

    console.log('\nUpload des parts...');
    for (let i = 0; i < nbParts; i++) {
      const partNum = i + 1;
      
      // Renouveler le token toutes les 5 parts
      if (i % 5 === 0 && i > 0) {
        token = await getToken();
        console.log('   Token renouvelé ✓');
      }

      // Obtenir une nouvelle URL pour cette part
      const { uploadKey: newKey, url } = await getUploadUrl(token, uploadKey, partNum);
      uploadKey = newKey;

      const start = i * PART_SIZE;
      const end   = Math.min(start + PART_SIZE, fileBuffer.length);
      const part  = fileBuffer.slice(start, end);

      // Upload avec retry
      let success = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const resp = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: part,
        });
        if (resp.ok) {
          console.log(`   Part ${partNum}/${nbParts} ✓`);
          success = true;
          break;
        }
        console.log(`   Part ${partNum} tentative ${attempt} échouée (${resp.status})`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
      }
      if (!success) throw new Error(`Part ${partNum} échouée`);
    }

    // Finalisation
    console.log('\nFinalisation...');
    const finalResp = await fetch(
      `https://developer.api.autodesk.com/oss/v2/buckets/${BUCKET_KEY}/objects/${OBJECT_NAME}/signeds3upload`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadKey }),
      }
    );
    const finalData = await finalResp.json();
    if (!finalResp.ok) throw new Error('Finalisation échouée: ' + JSON.stringify(finalData));
    console.log('Finalisation OK ✓');

    const objectId = finalData.objectId;
    const urn = Buffer.from(objectId).toString('base64')
      .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');

    // Traduction
    console.log('\nLancement de la traduction...');
    const transResp = await fetch('https://developer.api.autodesk.com/modelderivative/v2/designdata/job', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-ads-force': 'true' },
      body: JSON.stringify({
        input:  { urn },
        output: { formats: [{ type: 'svf2', views: ['3d'] }] },
      }),
    });
    if (!transResp.ok) throw new Error('Traduction échouée');
    console.log('Traduction lancée ✓');

    console.log('\n✅ SUCCÈS ! Ton URN OSS :');
    console.log('─'.repeat(60));
    console.log(urn);
    console.log('─'.repeat(60));
    console.log('\n⏳ Traduction en cours (5-15 min).');
    console.log('Vérifie : http://localhost:8080/api/manifest\n');

  } catch (err) {
    console.error('\n❌ Erreur:', err.message);
  }
}

main();
