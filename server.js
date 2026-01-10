const express = require('express');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware pour parser JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir les fichiers statiques
app.use(express.static(path.join(__dirname)));

// Route pour obtenir la configuration Firebase
app.get('/api/config', (req, res) => {
  if (!process.env.FIREBASE_API_KEY) {
    return res.status(500).json({ error: 'FIREBASE_API_KEY non configurée' });
  }
  
  res.json({
    firebase: {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: 'projet-arme-gta.firebaseapp.com',
      projectId: 'projet-arme-gta',
      storageBucket: 'projet-arme-gta.firebasestorage.app',
      messagingSenderId: '471475185162',
      appId: '1:471475185162:web:70a55eedae8c06e4caa1f3',
      measurementId: 'G-39C0NQ3KH7'
    },
    adminCode: process.env.ADMIN_CODE || ''
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
  console.log(`ADMIN_CODE: ${process.env.ADMIN_CODE ? '✓ Configuré' : '✗ Non configuré'}`);
  console.log(`FIREBASE_API_KEY: ${process.env.FIREBASE_API_KEY ? '✓ Configuré' : '✗ Non configuré'}`);
});
