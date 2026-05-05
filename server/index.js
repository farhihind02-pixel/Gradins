require('dotenv').config();
const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

const app = express();
app.use(express.json());

const {
  APS_CLIENT_ID, APS_CLIENT_SECRET,
  APS_CALLBACK_URL = 'http://localhost:8080/api/auth/callback',
  ACC_PROJECT_ID, ACC_MODEL_URN, PORT = 8080,
} = process.env;

const ACC_FOLDER_URN = 'urn:adsk.wipprod:fs.folder:co.y57lR8imTbuJh37gU440fA';
const VERSION_URN = 'urn:adsk.wipprod:fs.file:vf.Fs-fmn5sROy4n6m4S5jokA?version=9';
const VIEWABLE_GUID = '40d54ded-3c29-f5a3-ed21-dc3126f84375';


// URN encodé base64 pour le viewer et la traduction
const DERIVATIVE_URN = Buffer.from(VERSION_URN).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

console.log('[Config] Derivative URN:', DERIVATIVE_URN);

let session = { token: null, refreshToken: null, expiresAt: 0 };

// ── Auth ──────────────────────────────────────────────────────────────────────
app.get('/api/auth/login', (req, res) => {
  const url = new URL('https://developer.api.autodesk.com/authentication/v2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id',     APS_CLIENT_ID);
  url.searchParams.set('redirect_uri',  APS_CALLBACK_URL);
  url.searchParams.set('scope',         'data:read data:write viewables:read');
  res.redirect(url.toString());
});

app.get('/api/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Code manquant');
  try {
    const resp = await fetch('https://developer.api.autodesk.com/authentication/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code,
        client_id: APS_CLIENT_ID, client_secret: APS_CLIENT_SECRET,
        redirect_uri: APS_CALLBACK_URL,
      }),
    });
    if (!resp.ok) throw new Error(`${resp.status} — ${await resp.text()}`);
    const data = await resp.json();
    session = {
      token: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };
    console.log('[Auth] Connecté ✓');
    res.redirect('/');
  } catch (err) { res.redirect('/?error=' + encodeURIComponent(err.message)); }
});

async function getValidToken() {
  if (session.token && Date.now() < session.expiresAt) return session.token;
  if (session.refreshToken) {
    const resp = await fetch('https://developer.api.autodesk.com/authentication/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token', refresh_token: session.refreshToken,
        client_id: APS_CLIENT_ID, client_secret: APS_CLIENT_SECRET,
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      session = {
        token: data.access_token,
        refreshToken: data.refresh_token || session.refreshToken,
        expiresAt: Date.now() + (data.expires_in - 60) * 1000,
      };
      return session.token;
    }
  }
  throw new Error('NON_AUTHENTIFIE');
}

app.get('/api/auth/status', (req, res) => {
  res.json({ connected: !!(session.token && Date.now() < session.expiresAt + 3600000) });
});

// Le frontend reçoit l'URN dérivé calculé automatiquement
app.get('/api/token', async (req, res) => {
  try { res.json({ access_token: await getValidToken(), expires_in: 3600 }); }
  catch { res.status(401).json({ error: 'NON_AUTHENTIFIE' }); }
});

app.get('/api/config', (req, res) => {
  res.json({
    modelUrn:     DERIVATIVE_URN,
    viewableGuid: VIEWABLE_GUID,
    versionUrn:   VERSION_URN,
  });
});

// ── Vérifier la traduction ────────────────────────────────────────────────────
app.get('/api/check-model', async (req, res) => {
  try {
    const token = await getValidToken();
    const urn   = req.query.urn || DERIVATIVE_URN;
    const url   = `https://developer.api.autodesk.com/modelderivative/v2/designdata/${urn}/metadata`;
    const resp  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const text  = await resp.text();
    console.log(`[CheckModel] ${resp.status}: ${text.slice(0, 300)}`);
    res.json({ status: resp.status, urn, body: text.slice(0, 1000) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Déclencher la traduction ──────────────────────────────────────────────────
app.post('/api/translate', async (req, res) => {
  try {
    const token = await getValidToken();
    const body  = {
      input:  { urn: DERIVATIVE_URN, compressedUrn: false },
      output: { formats: [{ type: 'svf2', views: ['2d', '3d'] }] },
    };
    console.log('[Translate] Lancement avec URN:', DERIVATIVE_URN);
    const resp = await fetch('https://developer.api.autodesk.com/modelderivative/v2/designdata/job', {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-ads-force':  'true',
      },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    console.log('[Translate]', resp.status, text.slice(0, 300));
    res.json({ status: resp.status, body: text });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Statut détaillé de la traduction ─────────────────────────────────────────
app.get('/api/manifest', async (req, res) => {
  try {
    const token = await getValidToken();
    const url   = `https://developer.api.autodesk.com/modelderivative/v2/designdata/${DERIVATIVE_URN}/manifest`;
    const resp  = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const text  = await resp.text();
    console.log(`[Manifest] ${resp.status}: ${text.slice(0, 400)}`);
    res.json({ status: resp.status, body: text.slice(0, 2000) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/list-models', async (req, res) => {
  try {
    const token = await getValidToken();
    const projectId = 'eb5f9611-c334-411f-b5bd-5d555f107c74';
    const folderUrn = 'urn:adsk.wipprod:fs.folder:co.y57lR8imTbuJh37gU440fA';
    const encodedFolder = encodeURIComponent(folderUrn);
    const url = `https://developer.api.autodesk.com/data/v1/projects/b.${projectId}/folders/${encodedFolder}/contents`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await resp.json();
    const items = data.included || [];
    const versions = items.map(i => ({
      name: i.attributes?.displayName,
      urn: i.id,
      version: i.attributes?.versionNumber
    }));
    res.json(versions);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.use(express.static(path.join(__dirname, '../public')));
app.use('/assets', express.static(path.join(__dirname, '../assets')));
app.get(/^(?!\/api).*$/, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  🏗️  BIM Dashboard APS → http://localhost:${PORT}\n`);
});
