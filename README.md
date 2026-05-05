# 🏗️ BIM Dashboard — Connecté à ACC via APS Viewer

Dashboard web moderne connecté à votre maquette Autodesk ACC,
avec le vrai APS Viewer, des KPI d'avancement et des graphes interactifs.

---

## ⚠️ Sécurité importante

> Votre **Client Secret APS** a été partagé dans une conversation.
> **Régénérez-le immédiatement** sur https://aps.autodesk.com → Applications → votre app → Credentials.

---

## 📋 Prérequis

- **Node.js** v18+ — https://nodejs.org (téléchargez la version LTS)
- Votre application APS déjà créée sur https://aps.autodesk.com
- Votre modèle déjà uploadé sur ACC

---

## 🚀 Installation et démarrage

### 1. Installer Node.js
Téléchargez sur https://nodejs.org → version **LTS** → installez normalement.

### 2. Configurer vos identifiants

Copiez le fichier template :
```
.env.template  →  renommez-le en  .env
```

Ouvrez `.env` et remplissez vos vraies valeurs :

```env
APS_CLIENT_ID=votre_client_id
APS_CLIENT_SECRET=votre_nouveau_client_secret
APS_CALLBACK_URL=http://localhost:8080/api/auth/callback

ACC_PROJECT_ID=f5001748-8c02-45e5-b4f7-8c585f3ddd84
ACC_MODEL_URN=dXJuOmFkc2sud2lwcHJvZDpkbS5saW5lYWdlOlJUb1pmN21hVGJPUWpjYmh0Y2w0cGc

PORT=8080
```

> **Comment obtenir l'URN du modèle ?**
> L'URN est l'Entity ID de votre modèle, encodé en base64.
> Entity ID : `urn:adsk.wipprod:dm.lineage:RToZf7maTbOQjcbhtcl4pg`
> Encodé en base64 : `dXJuOmFkc2sud2lwcHJvZDpkbS5saW5lYWdlOlJUb1pmN21hVGJPUWpjYmh0Y2w0cGc`
> (déjà pré-rempli ci-dessus)

### 3. Installer les dépendances
```bash
cd bim-dashboard-aps
npm install
```

### 4. Démarrer le serveur
```bash
npm start
```

### 5. Ouvrir dans le navigateur
```
http://localhost:8080
```

---

## 🔧 Configuration APS — Vérifications importantes

Dans votre application APS sur https://aps.autodesk.com :

1. **APIs activées** : assurez-vous que ces APIs sont cochées :
   - Data Management API ✓
   - Model Derivative API ✓

2. **Callback URL** : doit contenir `http://localhost:8080/`

3. **Accès au modèle** : votre application doit avoir accès au hub ACC
   - Dans ACC → Admin → Apps & Integrations → ajoutez votre Client ID

---

## 📁 Structure du projet

```
bim-dashboard-aps/
├── .env                    ← VOS IDENTIFIANTS (ne pas commiter !)
├── .env.template           ← Template vide à copier
├── package.json
├── server/
│   └── index.js            ← Backend Node.js (authentification APS)
└── public/
    ├── index.html          ← Page principale
    ├── css/
    │   └── style.css
    └── js/
        ├── config.js       ← Mapping propriétés IFC + couleurs
        ├── data.js         ← Extraction données depuis le Viewer
        ├── charts.js       ← Graphiques Chart.js
        ├── viewer-aps.js   ← Intégration APS Viewer
        └── dashboard.js    ← Orchestration
```

---

## 🎯 Fonctionnalités

- ✅ **Vraie maquette ACC** affichée via APS Viewer officiel
- ✅ **Colorisation par statut** (Réalisé / En cours / Non réalisé / Non concerné)
- ✅ **KPI automatiques** calculés depuis les propriétés BIM du modèle
- ✅ **Histogramme par bloc** interactif
- ✅ **Tableau par chambord** filtrable
- ✅ **Donut de répartition** globale
- ✅ **Interactions bidirectionnelles** : clic graphe → isolation viewer, clic viewer → détail
- ✅ **Panneau de détails** avec toutes les propriétés métier
- ✅ **Réinitialisation** des filtres
- ✅ **Export PDF**

---

## 🛠️ Dépannage

| Problème | Solution |
|----------|----------|
| "Erreur token APS" | Vérifiez Client ID et Secret dans `.env` |
| "Erreur chargement modèle" | Vérifiez ACC_MODEL_URN et les permissions ACC |
| Graphes vides après chargement | Les propriétés Bloc/CHAMBORD doivent être dans le modèle IFC |
| Viewer ne démarre pas | Vérifiez que Node.js est bien installé (`node --version`) |
