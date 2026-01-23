const express = require('express');
const path = require('path');
// Charger .env en local, sur Render les variables sont déjà dans process.env
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware pour parser JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir les fichiers statiques
app.use(express.static(path.join(__dirname)));

// Route pour obtenir la configuration Firebase
app.get('/api/config', (req, res) => {
  const firebaseApiKey = process.env.FIREBASE_API_KEY;
  const adminCode = process.env.ADMIN_CODE;
  
  if (!firebaseApiKey || !adminCode) {
    return res.status(500).json({ 
      error: 'Variables d\'environnement manquantes',
      missing: {
        FIREBASE_API_KEY: !firebaseApiKey,
        ADMIN_CODE: !adminCode
      }
    });
  }
  
  res.json({
    firebase: {
      apiKey: firebaseApiKey,
      authDomain: 'projet-arme-gta.firebaseapp.com',
      projectId: 'projet-arme-gta',
      storageBucket: 'projet-arme-gta.firebasestorage.app',
      messagingSenderId: '471475185162',
      appId: '1:471475185162:web:70a55eedae8c06e4caa1f3',
      measurementId: 'G-39C0NQ3KH7'
    },
    adminCode: adminCode
  });
});

// Route pour vérifier le code admin
app.post('/api/admin/verify', (req, res) => {
  const { code } = req.body;
  const adminCode = process.env.ADMIN_CODE;
  
  if (!adminCode) {
    return res.status(500).json({ success: false, error: 'ADMIN_CODE non configurée' });
  }
  
  if (code === adminCode) {
    res.json({ 
      success: true, 
      token: Buffer.from(Date.now().toString()).toString('base64'),
      expiresIn: 3600000
    });
  } else {
    res.status(401).json({ success: false, error: 'Code incorrect' });
  }
});

// Route de santé pour Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Route racine - servir index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
  const hasAdmin = !!process.env.ADMIN_CODE;
  const hasApiKey = !!process.env.FIREBASE_API_KEY;
  console.log(`ADMIN_CODE: ${hasAdmin ? '✓' : '✗'}`);
  console.log(`FIREBASE_API_KEY: ${hasApiKey ? '✓' : '✗'}`);
  if (!hasAdmin || !hasApiKey) {
    console.log('⚠️  Configurez les variables dans Render Dashboard > Environment');
  }
});
