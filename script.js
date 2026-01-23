// Code administrateur - chargé uniquement depuis le serveur (variable d'environnement)
let ADMIN_CODE = window.ADMIN_CODE_REMOTE || '';

// État de l'application
let isAdminLoggedIn = false;
let editingWeaponId = null;
let weaponsCache = []; // Cache local pour les armes (sync avec Firestore uniquement)
let firestoreListeners = {}; // Stockage des listeners Firestore
let firestoreInitialized = false; // Flag pour vérifier si Firestore est initialisé

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
    // Attendre que Firebase soit prêt
    if (window.firebaseReady) {
        initializeWithFirebase();
    } else {
        window.onFirebaseReady = () => initializeWithFirebase();
        // Timeout de sécurité si Firebase prend trop de temps
        setTimeout(() => {
            if (!firestoreInitialized && window.db) {
                initializeWithFirebase();
            }
        }, 2000);
    }
    
    initializeApp();
    setupEventListeners();
});

async function initializeWithFirebase() {
    if (firestoreInitialized) return; // Éviter les doubles initialisations
    
    if (!window.db) {
        console.warn('[INIT] Firestore non disponible, utilisation du localStorage');
        loadInventory();
        return;
    }
    
    try {
        // CRITIQUE: Vider TOUT le cache localStorage si Firestore est disponible (éviter les conflits)
        console.log('[INIT] Nettoyage du localStorage pour éviter les conflits...');
        localStorage.removeItem('weapons');
        localStorage.removeItem('logs');
        localStorage.removeItem('purchaseRequests');
        // Garder seulement adminSession pour la session utilisateur
        console.log('[INIT] localStorage nettoyé');
    } catch (e) {
        console.warn('[INIT] Erreur nettoyage localStorage:', e);
    }
    
    // CRITIQUE: Vérifier que la collection weapons existe (elle sera créée automatiquement au premier ajout)
    try {
        console.log('[INIT] Vérification de la collection weapons...');
        const weaponsCollection = window.firebaseCollection(window.db, 'weapons');
        const testSnapshot = await window.firebaseGetDocs(weaponsCollection);
        console.log(`[INIT] Collection 'weapons' vérifiée: ${testSnapshot.size} document(s) trouvé(s)`);
        
        // Si la collection n'existe pas ou est vide, c'est normal, elle sera créée au premier ajout
        if (testSnapshot.empty) {
            console.log('[INIT] La collection weapons est vide. Elle sera créée automatiquement lors du premier ajout d\'arme.');
        }
    } catch (initError) {
        console.error('[INIT] Erreur lors de la vérification de la collection weapons:', initError);
        if (initError.code === 'permission-denied') {
            console.error('[INIT] ✗ ERREUR CRITIQUE: Permissions Firestore insuffisantes!');
            console.error('[INIT] Action requise: Modifiez les règles de sécurité Firestore dans Firebase Console:');
            console.error('[INIT] Règles recommandées:');
            console.error(`[INIT] match /weapons/{document=**} {
  allow read, write: if true;
}`);
            alert('ERREUR: Permissions Firestore insuffisantes!\n\nVérifiez les règles de sécurité dans Firebase Console pour la collection "weapons".\n\nConsultez la console pour les règles recommandées.');
        }
        // Continuer quand même pour permettre l'ajout d'armes qui créera la collection
    }
    
    // CRITIQUE: Charger DIRECTEMENT depuis Firestore AVANT tout (pas depuis le cache)
    console.log('[INIT] Chargement initial depuis Firestore...');
    await loadWeaponsFromFirestore();
    
    // Mettre à jour l'inventaire avec les données Firestore
    await loadInventory();
    
    // Mettre en place les listeners pour synchronisation en temps réel
    setupFirestoreListeners();
    
    firestoreInitialized = true;
    console.log('[INIT] ✓ Firestore initialisé et synchronisé avec', weaponsCache.length, 'arme(s)');
    
    // Forcer un dernier rechargement après un court délai pour s'assurer que tout est à jour
    setTimeout(async () => {
        console.log('[INIT] Synchronisation finale...');
        await loadWeaponsFromFirestore();
        await loadInventory();
        console.log('[INIT] ✓ Synchronisation finale effectuée');
    }, 1000);
}

// Charger les armes directement depuis Firestore (TOUJOURS depuis la source, JAMAIS depuis localStorage)
async function loadWeaponsFromFirestore() {
    if (!window.db) {
        console.warn('[FIRESTORE] Firestore non disponible, impossible de charger');
        weaponsCache = []; // Vider le cache si Firestore n'est pas disponible
        return;
    }
    
    try {
        console.log('[FIRESTORE] Chargement DIRECT depuis Firestore (source de vérité)...');
        
        // Vérifier que la collection existe et est accessible
        const weaponsCollection = window.firebaseCollection(window.db, 'weapons');
        console.log('[FIRESTORE] Collection weapons récupérée:', weaponsCollection);
        
        const snapshot = await window.firebaseGetDocs(weaponsCollection);
        console.log('[FIRESTORE] Snapshot récupéré, taille:', snapshot.size);
        
        // CRITIQUE: TOUJOURS vider le cache avant de le remplir (éviter les doublons/conflits)
        weaponsCache = [];
        
        if (snapshot.empty) {
            console.log('[FIRESTORE] La collection weapons existe mais est vide. C\'est normal si aucune arme n\'a encore été ajoutée.');
        } else {
            snapshot.forEach((doc) => {
                try {
                    const data = doc.data();
                    console.log(`[FIRESTORE] Document trouvé: ID=${doc.id}, Nom=${data.name}, Quantité=${data.quantity}`);
                    
                    // S'assurer que toutes les propriétés sont présentes avec valeurs par défaut
                    const weapon = {
                        id: doc.id, 
                        name: data.name || '',
                        purchasePrice: parseFloat(data.purchasePrice) || 0,
                        salePrice: parseFloat(data.salePrice) || 0,
                        quantity: parseInt(data.quantity) || 0, // CRITIQUE: Forcer int pour quantité
                        moneyType: data.moneyType || 'propre',
                        dateAdded: data.dateAdded || new Date()
                    };
                    weaponsCache.push(weapon);
                } catch (docError) {
                    console.error(`[FIRESTORE] Erreur traitement document ${doc.id}:`, docError);
                }
            });
        }
        
        console.log(`[FIRESTORE] ${weaponsCache.length} arme(s) chargée(s) depuis Firestore`);
        
        // Debug: Afficher les armes avec quantité > 0
        const weaponsWithStock = weaponsCache.filter(w => w.quantity > 0);
        console.log(`[FIRESTORE] ${weaponsWithStock.length} arme(s) avec stock disponible`);
        
        if (weaponsCache.length > 0 && weaponsWithStock.length !== weaponsCache.length) {
            console.log(`[FIRESTORE] ${weaponsCache.length - weaponsWithStock.length} arme(s) avec quantité 0 (ne seront pas affichées)`);
        }
        
        // CRITIQUE: NE JAMAIS utiliser localStorage si Firestore est disponible
        // Ne pas sauvegarder dans localStorage pour éviter les conflits
        
    } catch (error) {
        console.error('[FIRESTORE] Erreur chargement armes:', error);
        console.error('[FIRESTORE] Détails erreur:', {
            message: error.message,
            code: error.code,
            stack: error.stack
        });
        
        // Si c'est une erreur de permissions, afficher un message plus clair
        if (error.code === 'permission-denied') {
            console.error('[FIRESTORE] ✗ ERREUR: Permissions insuffisantes. Vérifiez les règles de sécurité Firestore pour la collection "weapons".');
            alert('Erreur de permissions Firestore: Vérifiez les règles de sécurité dans Firebase Console.');
        } else if (error.code === 'failed-precondition') {
            console.error('[FIRESTORE] ✗ ERREUR: Firestore non initialisé correctement.');
        }
        
        weaponsCache = []; // Vider le cache en cas d'erreur
        // Ne JAMAIS utiliser localStorage en fallback si Firestore est disponible
        // Ne pas throw l'erreur pour permettre à l'application de continuer
        // throw error;
    }
}

// Initialiser l'application
function initializeApp() {
    showPage('inventory-page');
    checkAdminSession();
    
    // CRITIQUE: Nettoyer le localStorage au chargement si Firestore est disponible
    // Pour éviter les conflits avec les données Firestore
    if (window.db) {
        // Attendre un peu que Firestore soit initialisé, puis nettoyer
        setTimeout(() => {
            if (window.db) {
                try {
                    console.log('[CLEANUP] Nettoyage localStorage pour éviter les conflits...');
                    localStorage.removeItem('weapons');
                    localStorage.removeItem('logs');
                    localStorage.removeItem('purchaseRequests');
                    console.log('[CLEANUP] localStorage nettoyé');
                } catch (e) {
                    console.warn('[CLEANUP] Erreur nettoyage:', e);
                }
            }
        }, 1000);
    }
}

// Vérifier la session admin
function checkAdminSession() {
    const session = localStorage.getItem('adminSession');
    const token = localStorage.getItem('adminToken');
    const tokenExpiry = localStorage.getItem('adminTokenExpiry');
    
    if (session === 'true') {
        // Vérifier si le token n'a pas expiré
        if (token && tokenExpiry && Date.now() < parseInt(tokenExpiry)) {
            isAdminLoggedIn = true;
        } else if (tokenExpiry && Date.now() >= parseInt(tokenExpiry)) {
            // Token expiré, nettoyer
            localStorage.removeItem('adminSession');
            localStorage.removeItem('adminToken');
            localStorage.removeItem('adminTokenExpiry');
            isAdminLoggedIn = false;
        } else {
            // Pas de token, utiliser la méthode basique
            isAdminLoggedIn = true;
        }
    }
    
    // Charger le code admin depuis le serveur si disponible
    if (window.ADMIN_CODE_REMOTE) {
        ADMIN_CODE = window.ADMIN_CODE_REMOTE;
    }
}

// Configuration des écouteurs d'événements
function setupEventListeners() {
    // Navigation
    document.getElementById('btn-inventory').addEventListener('click', async (e) => {
        e.preventDefault();
        showPage('inventory-page');
        await loadInventory();
    });

    document.getElementById('btn-admin').addEventListener('click', (e) => {
        e.preventDefault();
        if (isAdminLoggedIn) {
            showPage('admin-page');
            loadAdminPage();
            showAdminTab('gestion');
        } else {
            showPage('admin-login-page');
        }
    });

    // Onglets admin
    document.getElementById('btn-admin-inventory-tab').addEventListener('click', () => {
        showAdminTab('gestion');
    });

    document.getElementById('btn-admin-inventory-list-tab').addEventListener('click', async () => {
        showAdminTab('inventory');
        await loadAdminInventory();
    });

    document.getElementById('btn-admin-log-tab').addEventListener('click', async () => {
        showAdminTab('logs');
        await loadLogs();
    });

    document.getElementById('btn-admin-settings-tab').addEventListener('click', async () => {
        showAdminTab('settings');
        await loadSettings();
        await loadPendingRequests();
    });

    // Effacer les logs
    document.getElementById('btn-clear-logs').addEventListener('click', async () => {
        if (confirm('Êtes-vous sûr de vouloir effacer tous les logs ?')) {
            await clearLogs();
        }
    });

    // Réinitialiser les bénéfices
    document.getElementById('btn-reset-profits').addEventListener('click', async () => {
        if (confirm('Êtes-vous sûr de vouloir réinitialiser les bénéfices totaux ?\n\nCela supprimera uniquement les profits enregistrés.')) {
            await resetProfits();
        }
    });

    // Menu burger
    const burger = document.querySelector('.burger');
    const navLinks = document.querySelector('.nav-links');
    burger.addEventListener('click', () => {
        navLinks.classList.toggle('active');
    });

    // Formulaire de connexion admin - vérification côté serveur
    document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = document.getElementById('admin-code').value;
        
        // Vérifier côté serveur si possible, sinon fallback côté client
        try {
            const response = await fetch('/api/admin/verify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ code: code })
            });
            
            const result = await response.json();
            
            if (result.success) {
                isAdminLoggedIn = true;
                localStorage.setItem('adminSession', 'true');
                localStorage.setItem('adminToken', result.token);
                localStorage.setItem('adminTokenExpiry', Date.now() + result.expiresIn);
                showPage('admin-page');
                await loadAdminPage();
                showAdminTab('gestion');
                await addLog('connexion', 'Connexion administrateur', 0);
                document.getElementById('admin-code').value = '';
                document.getElementById('login-error').classList.remove('show');
            } else {
                document.getElementById('login-error').textContent = result.error || 'Code incorrect !';
                document.getElementById('login-error').classList.add('show');
            }
        } catch (error) {
            console.error('Erreur vérification admin:', error);
            // Fallback côté client si le serveur n'est pas disponible
            if (code === ADMIN_CODE) {
                isAdminLoggedIn = true;
                localStorage.setItem('adminSession', 'true');
                showPage('admin-page');
                await loadAdminPage();
                showAdminTab('gestion');
                await addLog('connexion', 'Connexion administrateur', 0);
                document.getElementById('admin-code').value = '';
                document.getElementById('login-error').classList.remove('show');
            } else {
                document.getElementById('login-error').textContent = 'Code incorrect !';
                document.getElementById('login-error').classList.add('show');
            }
        }
    });

    // Bouton de déconnexion
    document.getElementById('btn-logout').addEventListener('click', async () => {
        await addLog('deconnexion', 'Déconnexion administrateur', 0);
        isAdminLoggedIn = false;
        localStorage.removeItem('adminSession');
        showPage('inventory-page');
        await loadInventory();
    });

    // Formulaire d'ajout/modification d'arme
    document.getElementById('weapon-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveWeapon();
    });

    // Bouton annuler
    document.getElementById('cancel-btn').addEventListener('click', () => {
        resetForm();
    });

    // Formatage automatique des inputs de prix avec espaces
    const priceInputs = ['weapon-purchase-price', 'weapon-sale-price', 'weapon-quantity'];
    priceInputs.forEach(inputId => {
        const input = document.getElementById(inputId);
        
        // Pendant la saisie, enlever seulement les caractères non-numériques (sauf espaces qu'on enlève aussi)
        input.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\s/g, ''); // Enlever les espaces
            
            // Permettre seulement les nombres (avec point décimal pour les prix)
            if (inputId === 'weapon-quantity') {
                // Pour la quantité, seulement les entiers
                value = value.replace(/[^0-9]/g, '');
            } else {
                // Pour les prix, permettre les nombres avec point décimal
                value = value.replace(/[^0-9.]/g, '');
                // S'assurer qu'il n'y a qu'un seul point
                const parts = value.split('.');
                if (parts.length > 2) {
                    value = parts[0] + '.' + parts.slice(1).join('');
                }
            }
            
            e.target.value = value;
        });
        
        // Formater avec espaces quand on sort du champ
        input.addEventListener('blur', (e) => {
            const value = e.target.value.replace(/\s/g, '');
            if (value && !isNaN(value) && value !== '') {
                if (inputId === 'weapon-quantity') {
                    e.target.value = formatNumberWithSpaces(parseInt(value));
                } else {
                    e.target.value = formatNumberWithSpaces(parseFloat(value));
                }
            }
        });
        
        // Empêcher de coller du texte non-numérique
        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const paste = (e.clipboardData || window.clipboardData).getData('text');
            const cleaned = paste.replace(/\s/g, '').replace(/[^0-9.]/g, '');
            if (cleaned) {
                e.target.value = cleaned;
                // Déclencher l'événement input pour la validation
                e.target.dispatchEvent(new Event('input'));
            }
        });
    });

    // Formulaire de vente avec prix personnalisé
    document.getElementById('sell-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await sellWeaponWithCustomPrice();
    });

    // Mise à jour de l'aperçu du bénéfice en temps réel
    const modalPriceInput = document.getElementById('modal-sale-price');
    modalPriceInput.addEventListener('input', () => {
        // Enlever les espaces pendant la saisie
        modalPriceInput.value = modalPriceInput.value.replace(/\s/g, '');
        updateProfitPreview();
    });
    
    modalPriceInput.addEventListener('blur', () => {
        // Formater avec espaces quand on sort du champ
        const value = modalPriceInput.value.replace(/\s/g, '');
        if (value && !isNaN(value)) {
            modalPriceInput.value = formatNumberWithSpaces(parseFloat(value));
        }
    });

    // Fermer la modale en cliquant en dehors
    document.getElementById('sell-modal').addEventListener('click', (e) => {
        if (e.target.id === 'sell-modal') {
            closeSellModal();
        }
    });

    // Settings
    document.getElementById('setting-notifications').addEventListener('change', async (e) => {
        await saveSetting('notifications', e.target.checked);
    });

    document.getElementById('setting-sales-enabled').addEventListener('change', async (e) => {
        await saveSetting('salesEnabled', e.target.checked);
        // Mettre à jour la variable globale
        window.salesEnabledSetting = e.target.checked;
        loadInventory(); // Recharger pour afficher/cacher les boutons
    });

    document.getElementById('setting-info-bubble').addEventListener('change', async (e) => {
        await saveSetting('infoBubble', e.target.checked);
        await toggleInfoBubble();
    });

    document.getElementById('setting-info-text').addEventListener('input', async (e) => {
        await saveSetting('infoText', e.target.value);
        await updateInfoBubbleText();
    });

    // Message d'affichage - Blanchiment
    document.getElementById('setting-laundering-enabled').addEventListener('change', (e) => {
        const percentageContainer = document.getElementById('laundering-percentage-container');
        if (e.target.checked) {
            percentageContainer.style.display = 'flex';
            percentageContainer.style.alignItems = 'center';
        } else {
            percentageContainer.style.display = 'none';
        }
    });

    // Bouton générer message
    document.getElementById('btn-generate-message').addEventListener('click', async () => {
        await generateDisplayMessage();
    });

    // Bouton copier message
    document.getElementById('btn-copy-message').addEventListener('click', async () => {
        const messageTextarea = document.getElementById('generated-message');
        const message = messageTextarea.value;
        
        try {
            // Utiliser l'API moderne si disponible
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(message);
            } else {
                // Fallback pour les anciens navigateurs
                messageTextarea.select();
                document.execCommand('copy');
            }
            showNotification('Message copié dans le presse-papiers !', 'success');
        } catch (error) {
            console.error('Erreur lors de la copie:', error);
            showNotification('Erreur lors de la copie', 'error');
        }
    });

    document.getElementById('request-price-type').addEventListener('change', (e) => {
        const customContainer = document.getElementById('custom-price-container');
        customContainer.style.display = e.target.value === 'custom' ? 'block' : 'none';
        if (e.target.value === 'custom') {
            document.getElementById('request-custom-price').required = true;
        } else {
            document.getElementById('request-custom-price').required = false;
        }
    });

    // Formulaire de demande d'achat
    document.getElementById('purchase-request-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitPurchaseRequest();
    });

    // Fermer la modale de demande en cliquant en dehors
    document.getElementById('purchase-request-modal').addEventListener('click', (e) => {
        if (e.target.id === 'purchase-request-modal') {
            closePurchaseRequestModal();
        }
    });

    // Initialiser les settings et l'info bubble (attendre que Firebase soit prêt)
    setTimeout(async () => {
        await initializeSettings();
    }, 500);
    
    // Boutons rafraîchir - forcer un rechargement depuis Firestore
    const btnRefreshInventory = document.getElementById('btn-refresh-inventory');
    if (btnRefreshInventory) {
        btnRefreshInventory.addEventListener('click', async () => {
            console.log('[REFRESH] Bouton rafraîchir inventaire cliqué');
            showNotification('Rafraîchissement de l\'inventaire...', 'info');
            await refreshInventory();
        });
    }
    
    const btnRefreshAdminList = document.getElementById('btn-refresh-admin-list');
    if (btnRefreshAdminList) {
        btnRefreshAdminList.addEventListener('click', async () => {
            console.log('[REFRESH] Bouton rafraîchir liste admin cliqué');
            showNotification('Rafraîchissement de la liste...', 'info');
            await refreshAdminList();
        });
    }
    
    const btnRefreshAdminInventory = document.getElementById('btn-refresh-admin-inventory');
    if (btnRefreshAdminInventory) {
        btnRefreshAdminInventory.addEventListener('click', async () => {
            console.log('[REFRESH] Bouton rafraîchir inventaire admin cliqué');
            showNotification('Rafraîchissement de l\'inventaire admin...', 'info');
            await refreshAdminInventory();
        });
    }
    
    // CRITIQUE: Forcer un rechargement depuis Firestore à chaque actualisation de page
    window.addEventListener('focus', async () => {
        if (window.db && firestoreInitialized) {
            console.log('[FOCUS] Actualisation forcée depuis Firestore...');
            await loadWeaponsFromFirestore();
            await loadInventory();
        }
    });
    
    // CRITIQUE: Forcer un rechargement complet au chargement de la page (après Firebase init)
    window.addEventListener('load', async () => {
        if (window.db && firestoreInitialized) {
            setTimeout(async () => {
                console.log('[LOAD] Rechargement final depuis Firestore...');
                await loadWeaponsFromFirestore();
                await loadInventory();
                await updateTotalProfits();
            }, 1500);
        }
    });
}

// Afficher une page
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    document.getElementById(pageId).classList.add('active');
}

// Formater un nombre avec des espaces (ex: 150000 → 150 000)
function formatNumberWithSpaces(number) {
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Formater un nombre en format compact K/M (ex: 150000 → 150K, 1500000 → 1.5M)
function formatCompactNumber(number) {
    if (number >= 1000000) {
        return (number / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    } else if (number >= 1000) {
        return (number / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return formatNumberWithSpaces(Math.round(number));
}

// Charger l'inventaire (TOUJOURS depuis Firestore, jamais depuis localStorage)
async function loadInventory() {
    // CRITIQUE: Si Firestore est disponible, forcer un rechargement pour avoir les VRAIES données
    if (window.db && firestoreInitialized) {
        try {
            await loadWeaponsFromFirestore();
        } catch (error) {
            console.error('[INVENTORY] Erreur rechargement Firestore:', error);
            // Continuer avec le cache actuel en cas d'erreur
        }
    }
    
    const weapons = getWeapons();
    const grid = document.getElementById('weapons-grid');
    if (!grid) return; // Si l'élément n'existe pas encore
    
    grid.innerHTML = '';

    let totalWeapons = 0;
    let totalValue = 0;

    // Grouper les armes par nom ET par type d'argent
    const weaponsGrouped = {};
    weapons.forEach(weapon => {
        // CRITIQUE: Filtrer les armes avec quantité > 0 uniquement pour l'affichage
        // Si quantité est 0 ou négative, on ne l'affiche PAS
        const quantity = weapon.quantity || 0;
        if (quantity > 0) {
            const key = `${weapon.name}_${weapon.moneyType || 'propre'}`;
            if (!weaponsGrouped[key]) {
                weaponsGrouped[key] = {
                    ...weapon,
                    totalQuantity: 0,
                    instances: []
                };
            }
            weaponsGrouped[key].totalQuantity += quantity;
            weaponsGrouped[key].instances.push(weapon);
        }
    });

    // Afficher une seule carte par groupe avec badge de quantité
    Object.values(weaponsGrouped).forEach(group => {
        const card = createWeaponCard(group);
        grid.appendChild(card);
        totalWeapons += group.totalQuantity;
        totalValue += parseFloat(group.salePrice || 0) * group.totalQuantity;
    });

    // Mettre à jour les statistiques
    document.getElementById('total-weapons').textContent = formatNumberWithSpaces(totalWeapons);
    document.getElementById('total-value').textContent = formatNumberWithSpaces(Math.round(totalValue)) + ' €';
    
    console.log(`[INVENTORY] Inventaire mis à jour: ${totalWeapons} armes, ${Object.keys(weaponsGrouped).length} types différents`);
}

// Créer une carte d'arme
function createWeaponCard(weapon) {
    const card = document.createElement('div');
    card.className = 'weapon-card';

    const salePrice = parseFloat(weapon.salePrice);
    const moneyType = weapon.moneyType || 'propre';
    const isDirty = moneyType === 'sale';
    const quantity = weapon.totalQuantity || weapon.quantity || 0;

    // Formater avec espaces pour affichage détaillé
    const saleFormatted = formatNumberWithSpaces(Math.round(salePrice));

    // Format compact K/M pour l'inventaire
    const saleCompact = formatCompactNumber(salePrice);

    const weaponNameEscaped = weapon.name.replace(/'/g, "\\'");
    const moneyTypeEscaped = (weapon.moneyType || 'propre').replace(/'/g, "\\'");
    
    card.innerHTML = `
        <div class="weapon-header">
            <div class="weapon-name">${weapon.name}</div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <div class="money-type-badge ${isDirty ? 'dirty' : 'clean'}">${isDirty ? '💀 Sale' : '✅ Propre'}</div>
                <div class="weapon-quantity">${formatNumberWithSpaces(quantity)}</div>
            </div>
        </div>
        <div class="weapon-price">
            <div class="price-row">
                <span class="price-label">Prix de vente:</span>
                <span class="price-value sale-price" title="${saleFormatted} €">${saleCompact} €</span>
            </div>
        </div>
        ${(window.salesEnabledSetting !== false) ? `<button class="btn-buy" onclick="openPurchaseRequestModal('${weaponNameEscaped}', '${moneyTypeEscaped}', ${salePrice})" ${quantity === 0 ? 'disabled' : ''}>${quantity === 0 ? 'Rupture de stock' : 'Demander'}</button>` : ''}
    `;

    return card;
}

// Charger la page admin
async function loadAdminPage() {
    // CRITIQUE: Forcer un rechargement depuis Firestore avant d'afficher
    if (window.db && firestoreInitialized) {
        await loadWeaponsFromFirestore();
    }
    await loadAdminWeaponsList();
    resetForm();
    await updateTotalProfits();
}

// Charger la liste des armes dans l'admin
async function loadAdminWeaponsList() {
    // CRITIQUE: Si Firestore est disponible, forcer un rechargement depuis la source
    if (window.db && firestoreInitialized) {
        await loadWeaponsFromFirestore();
    }
    
    const weapons = getWeapons();
    const list = document.getElementById('admin-weapons-list');
    if (!list) return; // Si l'élément n'existe pas encore
    
    list.innerHTML = '';

    if (weapons.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: #6b7280; padding: 2rem;">Aucune arme en stock</p>';
        return;
    }

    // Grouper les armes par nom ET par type d'argent (séparer propre et sale)
    const weaponsGrouped = {};
    weapons.forEach(weapon => {
        // CRITIQUE: Filtrer les armes avec quantité valide
        const quantity = parseInt(weapon.quantity) || 0;
        const key = `${weapon.name}_${weapon.moneyType || 'propre'}`;
        if (!weaponsGrouped[key]) {
            weaponsGrouped[key] = {
                ...weapon,
                totalQuantity: 0
            };
        }
        // CRITIQUE: Ajouter la quantité au total
        weaponsGrouped[key].totalQuantity += quantity;
    });

    Object.values(weaponsGrouped).forEach(weapon => {
        const item = createAdminWeaponItem(weapon);
        list.appendChild(item);
    });
    
    console.log(`[ADMIN LIST] ${Object.keys(weaponsGrouped).length} type(s) d'armes affiché(s)`);
}

// Créer un élément d'arme dans l'admin
function createAdminWeaponItem(weapon) {
    const item = document.createElement('div');
    item.className = 'admin-weapon-item';

    const purchasePrice = parseFloat(weapon.purchasePrice);
    const salePrice = parseFloat(weapon.salePrice);
    const profit = salePrice - purchasePrice;
    const moneyType = weapon.moneyType || 'propre';
    const isDirty = moneyType === 'sale';

    // Formater avec espaces dans l'admin
    const purchaseFormatted = formatNumberWithSpaces(Math.round(purchasePrice));
    const saleFormatted = formatNumberWithSpaces(Math.round(salePrice));
    const profitFormatted = formatNumberWithSpaces(Math.round(Math.abs(profit)));

    item.innerHTML = `
        <div class="admin-weapon-info">
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem;">
                <h4 style="margin: 0;">${weapon.name}</h4>
                <div class="money-type-badge ${isDirty ? 'dirty' : 'clean'}">${isDirty ? '💀 Sale' : '✅ Propre'}</div>
            </div>
            <div class="admin-weapon-details">
                <span>Quantité: <strong>${formatNumberWithSpaces(weapon.totalQuantity)}</strong></span>
                <span>Achat: <strong>${purchaseFormatted} €</strong></span>
                <span>Vente: <strong>${saleFormatted} €</strong></span>
                <span>Bénéfice: <strong style="color: ${profit >= 0 ? 'var(--success-color)' : 'var(--primary-color)'}">${profit >= 0 ? '+' : '-'}${profitFormatted} €</strong></span>
            </div>
        </div>
        <div class="admin-weapon-actions">
            <button class="btn-edit" onclick="editWeapon('${weapon.id}')">Modifier</button>
            <button class="btn-delete" onclick="deleteWeapon('${weapon.id}')">Supprimer</button>
        </div>
    `;

    return item;
}

// Sauvegarder une arme
async function saveWeapon() {
    const name = document.getElementById('weapon-name').value.trim();
    // Enlever les espaces des prix pour la conversion
    const purchasePrice = document.getElementById('weapon-purchase-price').value.replace(/\s/g, '');
    const salePrice = document.getElementById('weapon-sale-price').value.replace(/\s/g, '');
    const quantity = parseInt(document.getElementById('weapon-quantity').value.replace(/\s/g, ''));
    const moneyType = document.getElementById('weapon-money-type').value;

    if (!name || !purchasePrice || !salePrice || !quantity || !moneyType) {
        alert('Veuillez remplir tous les champs');
        return;
    }

    let weapons = getWeapons();
    const moneyTypeLabel = moneyType === 'sale' ? 'Argent Sale' : 'Argent Propre';

    if (editingWeaponId) {
        // Modifier une arme existante
        await saveWeaponToDB({
            id: editingWeaponId,
            name,
            purchasePrice: parseFloat(purchasePrice),
            salePrice: parseFloat(salePrice),
            quantity: quantity,
            moneyType: moneyType
        });
        await addLog('modification', `Modification: ${name} (${quantity} unités, ${moneyTypeLabel}) - Achat: ${formatNumberWithSpaces(Math.round(purchasePrice))}€, Vente: ${formatNumberWithSpaces(Math.round(salePrice))}€`, parseFloat(salePrice) * quantity);
        editingWeaponId = null;
    } else {
        // Vérifier si une arme avec le même nom ET le même type d'argent existe déjà
        if (window.db) {
            try {
                const q = window.firebaseQuery(
                    window.firebaseCollection(window.db, 'weapons'),
                    window.firebaseWhere('name', '==', name),
                    window.firebaseWhere('moneyType', '==', moneyType),
                    window.firebaseLimit(1)
                );
                const querySnapshot = await window.firebaseGetDocs(q);
                
                if (!querySnapshot.empty) {
                    const existingDoc = querySnapshot.docs[0];
                    const existingData = existingDoc.data();
                    
                    // Vérifier si les prix correspondent
                    if (Math.abs(existingData.purchasePrice - parseFloat(purchasePrice)) < 0.01 &&
                        Math.abs(existingData.salePrice - parseFloat(salePrice)) < 0.01) {
                        // Ajouter à la quantité existante dans Firestore
                        const newQuantity = existingData.quantity + quantity;
                        await window.firebaseUpdateDoc(existingDoc.ref, {
                            quantity: window.firebaseFieldValue.increment(quantity)
                        });
                        await addLog('ajout', `Ajout: ${name} (+${quantity} unités, ${moneyTypeLabel}) - Total: ${newQuantity} unités`, parseFloat(salePrice) * quantity);
                        resetForm();
                        return;
                    }
                }
        } catch (error) {
            console.error('Erreur recherche arme existante:', error);
        }
        }
        
        // Ne pas chercher dans localStorage si Firestore est disponible
        // Si pas trouvé dans Firestore, créer une nouvelle arme
        if (window.db) {
            // Nouvelle arme (pas trouvée dans Firestore)
            // CRITIQUE: Ne PAS mettre d'ID, Firestore le générera automatiquement
            const newWeapon = {
                name: name,
                purchasePrice: parseFloat(purchasePrice) || 0,
                salePrice: parseFloat(salePrice) || 0,
                quantity: parseInt(quantity) || 0,
                moneyType: moneyType || 'propre',
                dateAdded: new Date()
            };
            
            console.log(`[SAVE] Sauvegarde nouvelle arme: ${name}`);
            console.log(`[SAVE] Données arme:`, newWeapon);
            
            try {
                // Sauvegarder dans Firestore (dans la collection 'weapons')
                // La collection sera créée automatiquement si elle n'existe pas
                const savedId = await saveWeaponToDB(newWeapon);
                
                if (savedId) {
                    console.log(`[SAVE] ✓ Arme sauvegardée avec succès dans Firestore collection 'weapons': ${name} (ID: ${savedId})`);
                    await addLog('ajout', `Ajout: ${name} (${quantity} unités, ${moneyTypeLabel}) - Achat: ${formatNumberWithSpaces(Math.round(purchasePrice))}€, Vente: ${formatNumberWithSpaces(Math.round(salePrice))}€`, parseFloat(salePrice) * quantity);
                    
                    // Afficher une notification de succès
                    showNotification(`Arme "${name}" ajoutée avec succès !`, 'success');
                } else {
                    console.error(`[SAVE] ✗ ERREUR: Arme non sauvegardée, ID retourné: ${savedId}`);
                    alert('Erreur: L\'arme n\'a pas pu être sauvegardée dans Firestore. Vérifiez la console pour plus de détails.');
                    return;
                }
            } catch (saveError) {
                console.error(`[SAVE] ✗ ERREUR lors de la sauvegarde:`, saveError);
                let errorMessage = 'Erreur lors de la sauvegarde de l\'arme dans Firestore.\n\n';
                
                if (saveError.code === 'permission-denied') {
                    errorMessage += 'Permissions insuffisantes. Vérifiez les règles de sécurité Firestore dans Firebase Console.';
                } else if (saveError.code === 'unavailable') {
                    errorMessage += 'Firestore est temporairement indisponible. Vérifiez votre connexion internet.';
                } else {
                    errorMessage += `Détails: ${saveError.message}`;
                }
                
                alert(errorMessage);
                console.error('[SAVE] Détails complets de l\'erreur:', {
                    code: saveError.code,
                    message: saveError.message,
                    stack: saveError.stack
                });
                return;
            }
        } else {
            // Fallback localStorage uniquement si Firestore n'est PAS disponible
            const existingWeaponIndex = weapons.findIndex(w => 
                w.name === name && 
                (w.moneyType || 'propre') === moneyType &&
                Math.abs(w.purchasePrice - parseFloat(purchasePrice)) < 0.01 &&
                Math.abs(w.salePrice - parseFloat(salePrice)) < 0.01
            );

            if (existingWeaponIndex !== -1) {
                // Ajouter à la quantité existante
                const existingWeapon = weapons[existingWeaponIndex];
                existingWeapon.quantity += quantity;
                await saveWeaponToDB(existingWeapon);
                await addLog('ajout', `Ajout: ${name} (+${quantity} unités, ${moneyTypeLabel}) - Total: ${existingWeapon.quantity} unités`, parseFloat(salePrice) * quantity);
            } else {
                // Nouvelle arme
                const newWeapon = {
                    name,
                    purchasePrice: parseFloat(purchasePrice),
                    salePrice: parseFloat(salePrice),
                    quantity: quantity,
                    moneyType: moneyType,
                    dateAdded: new Date().toISOString()
                };
                await saveWeaponToDB(newWeapon);
                await addLog('ajout', `Ajout: ${name} (${quantity} unités, ${moneyTypeLabel}) - Achat: ${formatNumberWithSpaces(Math.round(purchasePrice))}€, Vente: ${formatNumberWithSpaces(Math.round(salePrice))}€`, parseFloat(salePrice) * quantity);
            }
        }
    }

    resetForm();
    
    // CRITIQUE: Attendre que Firestore se synchronise, puis forcer un rechargement complet
    // Le listener devrait mettre à jour automatiquement, mais on force pour être sûr
    // Recharger immédiatement puis après un délai pour s'assurer de la synchronisation
    try {
        if (window.db) {
            console.log('[SAVE] Rechargement immédiat depuis Firestore...');
            await loadWeaponsFromFirestore();
            await loadInventory();
            await loadAdminWeaponsList();
            console.log('[SAVE] ✓ Rechargement immédiat effectué');
        }
    } catch (reloadError) {
        console.error('[SAVE] Erreur lors du rechargement immédiat:', reloadError);
    }
    
    // Recharger à nouveau après un court délai pour s'assurer que tout est synchronisé
    setTimeout(async () => {
        try {
            if (window.db) {
                console.log('[SAVE] Rechargement final après délai...');
                await loadWeaponsFromFirestore();
                await loadInventory();
                await loadAdminWeaponsList();
                console.log('[SAVE] ✓ Rechargement final effectué');
            }
        } catch (reloadError) {
            console.error('[SAVE] Erreur lors du rechargement final:', reloadError);
        }
    }, 1000);
}

// Modifier une arme
function editWeapon(id) {
    const weapons = getWeapons();
    const weapon = weapons.find(w => w.id === id);

    if (weapon) {
        editingWeaponId = id;
        document.getElementById('weapon-id').value = id;
        document.getElementById('weapon-name').value = weapon.name;
        document.getElementById('weapon-purchase-price').value = formatNumberWithSpaces(Math.round(weapon.purchasePrice));
        document.getElementById('weapon-sale-price').value = formatNumberWithSpaces(Math.round(weapon.salePrice));
        document.getElementById('weapon-quantity').value = formatNumberWithSpaces(weapon.quantity);
        document.getElementById('weapon-money-type').value = weapon.moneyType || 'propre';

        document.getElementById('form-title').textContent = 'Modifier une arme';
        document.getElementById('submit-btn').textContent = 'Modifier';
        document.getElementById('cancel-btn').style.display = 'block';

        // Scroll vers le formulaire
        document.querySelector('.admin-form-section').scrollIntoView({ behavior: 'smooth' });
    }
}

// Supprimer une arme
async function deleteWeapon(id) {
    if (confirm('Êtes-vous sûr de vouloir supprimer cette arme ?')) {
        let weapons = getWeapons();
        const weapon = weapons.find(w => w.id === id);
        if (weapon) {
            await addLog('suppression', `Suppression: ${weapon.name} (${weapon.quantity} unités)`, 0);
        }
        await deleteWeaponFromDB(id);
        // Les listeners Firestore mettront à jour automatiquement
    }
}

// Réinitialiser le formulaire
function resetForm() {
    document.getElementById('weapon-form').reset();
    document.getElementById('weapon-id').value = '';
    document.getElementById('weapon-quantity').value = '1';
    document.getElementById('weapon-money-type').value = 'propre';
    editingWeaponId = null;
    document.getElementById('form-title').textContent = 'Ajouter une arme';
    document.getElementById('submit-btn').textContent = 'Ajouter';
    document.getElementById('cancel-btn').style.display = 'none';
}

// ========== SYSTÈME FIRESTORE EN TEMPS RÉEL ==========

// Setup des listeners Firestore pour synchronisation en temps réel
function setupFirestoreListeners() {
    if (!window.db) {
        console.warn('Firestore non disponible, utilisation du localStorage');
        loadInventory();
        return;
    }

    // Listener pour les armes (synchronisation en temps réel)
    if (firestoreListeners.weapons) {
        firestoreListeners.weapons(); // Désabonner l'ancien listener
    }
    
    firestoreListeners.weapons = window.firebaseOnSnapshot(
        window.firebaseCollection(window.db, 'weapons'),
        async (snapshot) => {
            // CRITIQUE: TOUJOURS vider le cache et recharger depuis Firestore (source de vérité absolue)
            weaponsCache = [];
            
            snapshot.forEach((doc) => {
                const data = doc.data();
                // S'assurer que toutes les propriétés sont présentes avec valeurs par défaut
                // CRITIQUE: Forcer les types corrects (int pour quantité, float pour prix)
                weaponsCache.push({ 
                    id: doc.id, 
                    name: data.name || '',
                    purchasePrice: parseFloat(data.purchasePrice) || 0,
                    salePrice: parseFloat(data.salePrice) || 0,
                    quantity: parseInt(data.quantity) || 0, // CRITIQUE: Forcer int
                    moneyType: data.moneyType || 'propre',
                    dateAdded: data.dateAdded || new Date()
                });
            });
            
            console.log(`[REALTIME] ${weaponsCache.length} arme(s) synchronisée(s) depuis Firestore`);
            
            // Debug: Vérifier les quantités
            const weaponsWithStock = weaponsCache.filter(w => w.quantity > 0);
            console.log(`[REALTIME] ${weaponsWithStock.length} arme(s) avec stock > 0`);
            
            // CRITIQUE: Ne JAMAIS sauvegarder dans localStorage (éviter les conflits)
            
            // Mettre à jour toutes les vues immédiatement (async)
            await loadInventory();
            await loadAdminWeaponsList();
            await loadAdminInventory();
        },
        (error) => {
            console.error('[LISTENER] Erreur listener armes:', error);
            // Ne JAMAIS utiliser localStorage si Firestore est disponible
            // Essayer de recharger depuis Firestore directement
            loadWeaponsFromFirestore().then(() => {
                loadInventory();
            }).catch(err => {
                console.error('[LISTENER] Impossible de recharger depuis Firestore:', err);
            });
        }
    );

    // Listener pour les logs
    if (firestoreListeners.logs) {
        firestoreListeners.logs();
    }
    
    firestoreListeners.logs = window.firebaseOnSnapshot(
        window.firebaseCollection(window.db, 'logs'),
        async (snapshot) => {
            if (document.getElementById('admin-tab-logs')?.classList.contains('active')) {
                await loadLogs();
            }
            await updateTotalProfits();
        }
    );
    
    // Listener pour les bénéfices (profits)
    if (firestoreListeners.profits) {
        firestoreListeners.profits();
    }
    
    firestoreListeners.profits = window.firebaseOnSnapshot(
        window.firebaseCollection(window.db, 'profits'),
        async (snapshot) => {
            await updateTotalProfits();
        }
    );

    // Listener pour les settings
    if (firestoreListeners.settings) {
        firestoreListeners.settings();
    }
    
    firestoreListeners.settings = window.firebaseOnSnapshot(
        window.firebaseDoc(window.db, 'settings', 'appSettings'),
        async (docSnap) => {
            if (docSnap.exists()) {
                const settings = docSnap.data();
                // Mettre à jour la variable globale pour un accès synchrone
                window.salesEnabledSetting = settings.salesEnabled !== false;
                
                // Mettre à jour l'interface
                if (document.getElementById('setting-notifications')) {
                    document.getElementById('setting-notifications').checked = settings.notifications || false;
                    document.getElementById('setting-sales-enabled').checked = settings.salesEnabled !== false;
                    document.getElementById('setting-info-bubble').checked = settings.infoBubble || false;
                    document.getElementById('setting-info-text').value = settings.infoText || '';
                }
                await toggleInfoBubble();
                await updateInfoBubbleText();
                loadInventory(); // Recharger pour afficher/cacher les boutons
            } else {
                // Créer les settings par défaut
                window.firebaseSetDoc(window.firebaseDoc(window.db, 'settings', 'appSettings'), {
                    notifications: false,
                    salesEnabled: true,
                    infoBubble: false,
                    infoText: ''
                });
            }
        }
    );
    
    // Initialiser la variable globale au chargement
    window.salesEnabledSetting = true; // Valeur par défaut

    // Listener pour les demandes d'achat
    if (firestoreListeners.requests) {
        firestoreListeners.requests();
    }
    
    firestoreListeners.requests = window.firebaseOnSnapshot(
        window.firebaseCollection(window.db, 'purchaseRequests'),
        async (snapshot) => {
            if (document.getElementById('admin-tab-settings')?.classList.contains('active')) {
                await loadPendingRequests();
            }
        }
    );
}

// Obtenir les armes (TOUJOURS depuis Firestore si disponible, JAMAIS depuis localStorage)
function getWeapons() {
    // Si Firestore est disponible, TOUJOURS utiliser le cache Firestore (qui est synchronisé en temps réel)
    if (window.db) {
        // Le cache devrait toujours être rempli par le listener, mais on retourne ce qu'on a
        // Ne JAMAIS charger depuis localStorage si Firestore est disponible
        return weaponsCache;
    }
    
    // Fallback localStorage UNIQUEMENT si Firestore n'est PAS disponible (mode offline)
    const stored = localStorage.getItem('weapons');
    return stored ? JSON.parse(stored) : [];
}

// Sauvegarder une arme dans Firestore (TOUJOURS utiliser Firestore si disponible, JAMAIS localStorage)
async function saveWeaponToDB(weapon) {
    if (!window.db) {
        // Fallback localStorage UNIQUEMENT si Firestore n'est vraiment PAS disponible
        console.warn('[SAVE] Firestore non disponible, fallback localStorage');
        const weapons = getWeapons();
        const index = weapons.findIndex(w => w.id === weapon.id);
        if (index !== -1) {
            weapons[index] = weapon;
        } else {
            weapon.id = weapon.id || generateId();
            weapons.push(weapon);
        }
        localStorage.setItem('weapons', JSON.stringify(weapons));
        return weapon.id || generateId();
    }
    
    // CRITIQUE: Si Firestore est disponible, NE JAMAIS utiliser localStorage pour les armes

    // TOUJOURS utiliser Firestore si disponible (pas de fallback localStorage)
    try {
        // Vérifier que Firestore est bien initialisé
        if (!window.db) {
            throw new Error('Firestore non initialisé');
        }
        
        // Vérifier que les fonctions Firestore sont disponibles
        if (!window.firebaseCollection || !window.firebaseAddDoc || !window.firebaseUpdateDoc || !window.firebaseDoc) {
            throw new Error('Fonctions Firestore non disponibles');
        }
        
        if (weapon.id) {
            // Mise à jour
            console.log(`[SAVE] Mise à jour arme: ${weapon.name} (ID: ${weapon.id})`);
            const docRef = window.firebaseDoc(window.db, 'weapons', weapon.id);
            await window.firebaseUpdateDoc(docRef, {
                name: weapon.name,
                purchasePrice: weapon.purchasePrice,
                salePrice: weapon.salePrice,
                quantity: weapon.quantity,
                moneyType: weapon.moneyType || 'propre',
                dateAdded: weapon.dateAdded || new Date()
            });
            console.log(`[SAVE] ✓ Arme mise à jour dans Firestore: ${weapon.name} (ID: ${weapon.id})`);
            return weapon.id;
        } else {
            // Ajout - CRITIQUE: Créer un nouvel objet SANS id pour que Firestore génère l'ID
            console.log(`[SAVE] Ajout nouvelle arme: ${weapon.name}`);
            
            // Vérifier que Firestore est bien initialisé
            if (!window.db) {
                throw new Error('Firestore non initialisé');
            }
            
            // Récupérer la collection (elle sera créée automatiquement lors de la première écriture)
            const weaponsCollection = window.firebaseCollection(window.db, 'weapons');
            console.log(`[SAVE] Collection 'weapons' récupérée:`, weaponsCollection);
            
            // Créer l'objet à sauvegarder (sans id, Firestore le génère)
            const weaponData = {
                name: weapon.name || '',
                purchasePrice: parseFloat(weapon.purchasePrice) || 0,
                salePrice: parseFloat(weapon.salePrice) || 0,
                quantity: parseInt(weapon.quantity) || 0,
                moneyType: weapon.moneyType || 'propre',
                dateAdded: weapon.dateAdded || new Date()
            };
            
            console.log(`[SAVE] Données à sauvegarder:`, weaponData);
            
            // IMPORTANT: S'assurer que tous les champs sont valides
            if (!weaponData.name || weaponData.name.trim() === '') {
                throw new Error('Le nom de l\'arme est requis');
            }
            if (isNaN(weaponData.purchasePrice) || weaponData.purchasePrice < 0) {
                throw new Error('Le prix d\'achat doit être un nombre valide');
            }
            if (isNaN(weaponData.salePrice) || weaponData.salePrice < 0) {
                throw new Error('Le prix de vente doit être un nombre valide');
            }
            if (isNaN(weaponData.quantity) || weaponData.quantity < 0) {
                throw new Error('La quantité doit être un nombre valide');
            }
            
            // Ajouter le document dans Firestore (la collection sera créée automatiquement si elle n'existe pas)
            const docRef = await window.firebaseAddDoc(weaponsCollection, weaponData);
            console.log(`[SAVE] ✓ Arme ajoutée dans Firestore collection 'weapons': ${weapon.name} (ID: ${docRef.id})`);
            
            // Attendre un peu pour que Firestore synchronise
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Vérifier que l'arme a bien été sauvegardée
            try {
                const verifyDoc = await window.firebaseGetDoc(window.firebaseDoc(window.db, 'weapons', docRef.id));
                if (verifyDoc.exists()) {
                    const verifyData = verifyDoc.data();
                    console.log(`[SAVE] ✓ Vérification OK: arme trouvée dans Firestore avec ID ${docRef.id}`);
                    console.log(`[SAVE] Données vérifiées:`, verifyData);
                    
                    // Ajouter l'arme au cache immédiatement pour mise à jour instantanée
                    const newWeapon = {
                        id: docRef.id,
                        ...weaponData
                    };
                    weaponsCache.push(newWeapon);
                } else {
                    console.error(`[SAVE] ✗ ERREUR: arme non trouvée après sauvegarde (ID: ${docRef.id})`);
                    console.error(`[SAVE] La collection 'weapons' existe-t-elle dans Firestore? Vérifiez la console Firebase.`);
                }
            } catch (verifyError) {
                console.error(`[SAVE] Erreur lors de la vérification:`, verifyError);
                // Ne pas faire échouer la sauvegarde si la vérification échoue
            }
            
            return docRef.id;
        }
    } catch (error) {
        console.error('[SAVE] ✗ ERREUR sauvegarde arme Firestore:', error);
        console.error('[SAVE] Détails erreur:', {
            message: error.message,
            code: error.code,
            stack: error.stack
        });
        alert(`Erreur lors de la sauvegarde dans Firestore: ${error.message}\n\nVérifiez la console pour plus de détails.`);
        throw error; // Propager l'erreur pour que l'appelant sache que ça a échoué
    }
}

// Supprimer une arme de Firestore (TOUJOURS utiliser Firestore si disponible)
async function deleteWeaponFromDB(weaponId) {
    if (!weaponId) {
        console.error('[DELETE] ✗ ERREUR: ID d\'arme manquant');
        alert('Erreur: ID d\'arme manquant');
        return;
    }
    
    if (!window.db) {
        // Fallback localStorage uniquement si Firestore n'est PAS disponible
        console.warn('[DELETE] Firestore non disponible, fallback localStorage');
        const weapons = getWeapons();
        const filtered = weapons.filter(w => w.id !== weaponId);
        localStorage.setItem('weapons', JSON.stringify(filtered));
        return;
    }

    // TOUJOURS utiliser Firestore si disponible
    try {
        console.log(`[DELETE] Suppression arme avec ID: ${weaponId}`);
        
        // Vérifier que les fonctions Firestore sont disponibles
        if (!window.firebaseDoc || !window.firebaseDeleteDoc) {
            throw new Error('Fonctions Firestore non disponibles');
        }
        
        // Vérifier que l'arme existe avant de la supprimer
        const docRef = window.firebaseDoc(window.db, 'weapons', weaponId);
        const docSnap = await window.firebaseGetDoc(docRef);
        
        if (!docSnap.exists()) {
            console.error(`[DELETE] ✗ ERREUR: Arme non trouvée avec ID ${weaponId}`);
            alert(`Arme non trouvée avec l'ID ${weaponId}`);
            return;
        }
        
        console.log(`[DELETE] Arme trouvée: ${docSnap.data().name} (ID: ${weaponId})`);
        
        // Supprimer l'arme
        await window.firebaseDeleteDoc(docRef);
        console.log(`[DELETE] ✓ Arme supprimée de Firestore avec succès: ${weaponId}`);
        
        // Forcer un rechargement après suppression
        setTimeout(async () => {
            await loadWeaponsFromFirestore();
            await loadAdminWeaponsList();
            await loadAdminInventory();
            await loadInventory();
        }, 300);
        
    } catch (error) {
        console.error('[DELETE] ✗ ERREUR suppression arme Firestore:', error);
        console.error('[DELETE] Détails erreur:', {
            message: error.message,
            code: error.code,
            stack: error.stack,
            weaponId: weaponId
        });
        alert(`Erreur lors de la suppression: ${error.message}\n\nVérifiez la console pour plus de détails.`);
        throw error; // Propager l'erreur
    }
}

// Générer un ID unique
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Afficher un onglet admin
function showAdminTab(tabName) {
    // Masquer tous les onglets
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Afficher l'onglet sélectionné
    if (tabName === 'gestion') {
        document.getElementById('admin-tab-gestion').classList.add('active');
        document.getElementById('btn-admin-inventory-tab').classList.add('active');
    } else if (tabName === 'inventory') {
        document.getElementById('admin-tab-inventory').classList.add('active');
        document.getElementById('btn-admin-inventory-list-tab').classList.add('active');
    } else if (tabName === 'logs') {
        document.getElementById('admin-tab-logs').classList.add('active');
        document.getElementById('btn-admin-log-tab').classList.add('active');
    } else if (tabName === 'settings') {
        document.getElementById('admin-tab-settings').classList.add('active');
        document.getElementById('btn-admin-settings-tab').classList.add('active');
    }
}

// Charger l'inventaire admin avec boutons "Vendu"
async function loadAdminInventory() {
    // CRITIQUE: Si Firestore est disponible, forcer un rechargement depuis la source
    if (window.db && firestoreInitialized) {
        await loadWeaponsFromFirestore();
    }
    
    const weapons = getWeapons();
    const grid = document.getElementById('admin-inventory-grid');
    if (!grid) return; // Si l'élément n'existe pas encore
    
    grid.innerHTML = '';

    // Grouper les armes par nom ET par type d'argent (en conservant toutes les instances)
    const weaponsGrouped = {};
    weapons.forEach(weapon => {
        // CRITIQUE: Filtrer les armes avec quantité valide
        const quantity = parseInt(weapon.quantity) || 0;
        const key = `${weapon.name}_${weapon.moneyType || 'propre'}`;
        if (!weaponsGrouped[key]) {
            weaponsGrouped[key] = {
                id: weapon.id, // Prendre le premier ID pour référence
                name: weapon.name,
                purchasePrice: parseFloat(weapon.purchasePrice) || 0,
                salePrice: parseFloat(weapon.salePrice) || 0,
                moneyType: weapon.moneyType || 'propre',
                totalQuantity: 0,
                instances: []
            };
        }
        weaponsGrouped[key].totalQuantity += quantity;
        weaponsGrouped[key].instances.push({
            id: weapon.id,
            quantity: quantity
        });
    });

    // Afficher chaque arme avec bouton "Vendu"
    Object.values(weaponsGrouped).forEach(group => {
        const card = createAdminInventoryCard(group);
        grid.appendChild(card);
    });

    // Mettre à jour les bénéfices totaux
    await updateTotalProfits();
    
    console.log(`[ADMIN INVENTORY] ${Object.keys(weaponsGrouped).length} arme(s) affichée(s)`);
}

// Créer une carte d'arme pour l'inventaire admin
function createAdminInventoryCard(weapon) {
    const card = document.createElement('div');
    card.className = 'weapon-card admin-inventory-card';

    const salePrice = parseFloat(weapon.salePrice);
    const moneyType = weapon.moneyType || 'propre';
    const isDirty = moneyType === 'sale';

    const saleCompact = formatCompactNumber(salePrice);

    // Utiliser le nom comme identifiant pour la vente (on trouvera une instance disponible)
    const weaponNameEscaped = weapon.name.replace(/'/g, "\\'");

    card.innerHTML = `
        <div class="weapon-header">
            <div class="weapon-name">${weapon.name}</div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
                <div class="money-type-badge ${isDirty ? 'dirty' : 'clean'}">${isDirty ? '💀 Sale' : '✅ Propre'}</div>
                <div class="weapon-quantity">${formatNumberWithSpaces(weapon.totalQuantity)}</div>
            </div>
        </div>
        <div class="weapon-price">
            <div class="price-row">
                <span class="price-label">Prix de vente:</span>
                <span class="price-value sale-price">${saleCompact} €</span>
            </div>
        </div>
        <button class="btn-sell" onclick="openSellModal('${weaponNameEscaped}', '${moneyType}')" ${weapon.totalQuantity === 0 ? 'disabled' : ''}>
            ${weapon.totalQuantity === 0 ? 'Rupture de stock' : 'Vendu'}
        </button>
    `;

    return card;
}

// Ouvrir la modale de vente
async function openSellModal(name, moneyType = null) {
    let weapon = null;
    
    if (window.db) {
        try {
            // Chercher dans Firestore
            let q;
            if (moneyType) {
                q = window.firebaseQuery(
                    window.firebaseCollection(window.db, 'weapons'),
                    window.firebaseWhere('name', '==', name),
                    window.firebaseWhere('moneyType', '==', moneyType),
                    window.firebaseWhere('quantity', '>', 0),
                    window.firebaseLimit(1)
                );
            } else {
                q = window.firebaseQuery(
                    window.firebaseCollection(window.db, 'weapons'),
                    window.firebaseWhere('name', '==', name),
                    window.firebaseWhere('quantity', '>', 0),
                    window.firebaseLimit(1)
                );
            }
            const querySnapshot = await window.firebaseGetDocs(q);
            
            if (!querySnapshot.empty) {
                const doc = querySnapshot.docs[0];
                weapon = { id: doc.id, ...doc.data() };
            }
        } catch (error) {
            console.error('Erreur recherche arme:', error);
        }
    }
    
    // Si pas trouvé dans Firestore, chercher dans le cache local
    if (!weapon) {
        let weapons = getWeapons();
        let weaponIndex = -1;
        if (moneyType) {
            weaponIndex = weapons.findIndex(w => 
                w.name === name && 
                (w.moneyType || 'propre') === moneyType && 
                w.quantity > 0
            );
        } else {
            weaponIndex = weapons.findIndex(w => w.name === name && w.quantity > 0);
        }
        
        if (weaponIndex !== -1) {
            weapon = weapons[weaponIndex];
        }
    }
    
    if (!weapon || weapon.quantity <= 0) {
        alert('Stock épuisé pour cette arme');
        return;
    }
    
    // Stocker les informations de l'arme pour la vente
    window.currentSellingWeapon = weapon;
    
    // Remplir la modale
    document.getElementById('modal-weapon-name').textContent = weapon.name;
    document.getElementById('modal-purchase-price').textContent = formatNumberWithSpaces(Math.round(weapon.purchasePrice));
    document.getElementById('modal-suggested-price').textContent = formatNumberWithSpaces(Math.round(weapon.salePrice));
    document.getElementById('modal-sale-price').value = formatNumberWithSpaces(Math.round(weapon.salePrice));
    document.getElementById('modal-money-type').value = weapon.moneyType || 'propre';
    
    // Calculer et afficher le bénéfice initial
    updateProfitPreview();
    
    // Afficher la modale
    document.getElementById('sell-modal').classList.add('active');
    
    // Focus sur l'input
    setTimeout(() => {
        document.getElementById('modal-sale-price').focus();
        document.getElementById('modal-sale-price').select();
    }, 100);
}

// Fermer la modale de vente
function closeSellModal() {
    document.getElementById('sell-modal').classList.remove('active');
    document.getElementById('sell-form').reset();
    window.currentSellingWeapon = null;
}

// Mettre à jour l'aperçu du bénéfice
function updateProfitPreview() {
    const weapon = window.currentSellingWeapon;
    if (!weapon) return;
    
    const salePriceInput = document.getElementById('modal-sale-price').value.replace(/\s/g, '');
    const salePrice = parseFloat(salePriceInput) || weapon.salePrice;
    const purchasePrice = parseFloat(weapon.purchasePrice);
    const profit = salePrice - purchasePrice;
    
    const profitElement = document.getElementById('modal-profit-preview');
    profitElement.textContent = (profit >= 0 ? '+' : '') + formatNumberWithSpaces(Math.round(profit)) + ' €';
    profitElement.style.color = profit >= 0 ? 'var(--success-color)' : 'var(--primary-color)';
}

// Vendre une arme avec prix personnalisé
async function sellWeaponWithCustomPrice() {
    const weapon = window.currentSellingWeapon;
    if (!weapon || !weapon.id) {
        alert('Arme introuvable');
        closeSellModal();
        return;
    }

    // Vérifier que l'arme a encore du stock
    if (weapon.quantity <= 0) {
        alert('Stock épuisé pour cette arme');
        closeSellModal();
        return;
    }

    // Récupérer le prix de vente (avec ou sans espaces)
    const salePriceInput = document.getElementById('modal-sale-price').value.replace(/\s/g, '');
    const salePrice = parseFloat(salePriceInput);
    
    if (isNaN(salePrice) || salePrice < 0) {
        alert('Veuillez entrer un prix de vente valide');
        return;
    }

    const purchasePrice = parseFloat(weapon.purchasePrice);
    const profit = salePrice - purchasePrice;
    const moneyType = document.getElementById('modal-money-type').value;
    const moneyTypeLabel = moneyType === 'sale' ? 'Argent Sale' : 'Argent Propre';
    
    // Sauvegarder dans Firestore
    if (window.db) {
        try {
            const weaponRef = window.firebaseDoc(window.db, 'weapons', weapon.id);
            
            // Vérifier que l'arme existe encore et a du stock
            const weaponSnap = await window.firebaseGetDoc(weaponRef);
            if (!weaponSnap.exists()) {
                alert('Arme introuvable dans la base de données');
                closeSellModal();
                return;
            }
            
            const currentData = weaponSnap.data();
            if (currentData.quantity <= 0) {
                alert('Stock épuisé pour cette arme');
                closeSellModal();
                return;
            }
            
            // Réduire la quantité dans Firestore
            // Utiliser `increment` si disponible, sinon faire une mise à jour explicite
            try {
                if (window.firebaseFieldValue && typeof window.firebaseFieldValue.increment === 'function') {
                    await window.firebaseUpdateDoc(weaponRef, {
                        quantity: window.firebaseFieldValue.increment(-1)
                    });
                } else {
                    const newQty = Math.max(0, (currentData.quantity || 0) - 1);
                    await window.firebaseUpdateDoc(weaponRef, {
                        quantity: newQty
                    });
                }
            } catch (qtyError) {
                console.error('[VENTE] Erreur réduction quantité:', qtyError);
                // Tenter une mise à jour directe en fallback
                try {
                    const newQty = Math.max(0, (currentData.quantity || 0) - 1);
                    await window.firebaseUpdateDoc(weaponRef, { quantity: newQty });
                } catch (qtyError2) {
                    console.error('[VENTE] Fallback erreur réduction quantité:', qtyError2);
                    throw qtyError2;
                }
            }

            // Ajouter le bénéfice dans Firestore
            await window.firebaseAddDoc(window.firebaseCollection(window.db, 'profits'), {
                weaponName: weapon.name,
                purchasePrice: purchasePrice,
                salePrice: salePrice,
                profit: profit,
                moneyType: moneyType,
                timestamp: new Date()
            });
            
            // Enregistrer dans les logs avec le prix réel et le type d'argent
            const profitLabel = profit >= 0 ? 'Bénéfice' : 'Perte';
            await addLog('vente', `Vente: ${weapon.name} (${moneyTypeLabel}) - Prix réel: ${formatNumberWithSpaces(Math.round(salePrice))}€ (suggéré: ${formatNumberWithSpaces(Math.round(weapon.salePrice))}€), ${profitLabel}: ${formatNumberWithSpaces(Math.round(Math.abs(profit)))}€`, profit, moneyType);
            
            console.log(`[VENTE] Vente enregistrée: ${weapon.name} pour ${salePrice}€`);
        } catch (error) {
            console.error('[VENTE] Erreur vente Firestore:', error);
            alert('Erreur lors de la vente. Veuillez réessayer.');
            return;
        }
    } else {
        // Fallback localStorage UNIQUEMENT si Firestore n'est vraiment PAS disponible
        console.warn('[VENTE] Firestore non disponible, fallback localStorage');
        const weapons = getWeapons();
        const weaponIndex = weapons.findIndex(w => w.id === weapon.id);
        if (weaponIndex !== -1) {
            if (weapons[weaponIndex].quantity <= 0) {
                alert('Stock épuisé pour cette arme');
                closeSellModal();
                return;
            }
            weapons[weaponIndex].quantity -= 1;
            localStorage.setItem('weapons', JSON.stringify(weapons));
            
            // Enregistrer dans les logs avec le prix réel et le type d'argent
            const profitLabel = profit >= 0 ? 'Bénéfice' : 'Perte';
            await addLog('vente', `Vente: ${weapon.name} (${moneyTypeLabel}) - Prix réel: ${formatNumberWithSpaces(Math.round(salePrice))}€ (suggéré: ${formatNumberWithSpaces(Math.round(weapon.salePrice))}€), ${profitLabel}: ${formatNumberWithSpaces(Math.round(Math.abs(profit)))}€`, profit, moneyType);
        } else {
            alert('Arme introuvable');
            closeSellModal();
            return;
        }
    }
    
    // Fermer la modale
    closeSellModal();
    
    // CRITIQUE: Forcer un rechargement complet depuis Firestore immédiatement
    // Le listener devrait mettre à jour automatiquement, mais on force pour être sûr
    setTimeout(async () => {
        if (window.db) {
            await loadWeaponsFromFirestore();
        }
        await loadAdminInventory();
        await loadInventory();
        await updateTotalProfits();
    }, 400);
}

// Vendre une arme par nom (pour compatibilité)
function sellWeaponByName(name) {
    openSellModal(name);
}

// Vendre une arme par ID (pour compatibilité)
function sellWeapon(id) {
    let weapons = getWeapons();
    const weaponIndex = weapons.findIndex(w => w.id === id);
    
    if (weaponIndex === -1) {
        alert('Arme introuvable');
        return;
    }

    const weapon = weapons[weaponIndex];
    sellWeaponByName(weapon.name);
}

// Mettre à jour les bénéfices totaux
async function updateTotalProfits() {
    let totalProfits = 0;
    let totalProfitsClean = 0;
    let totalProfitsDirty = 0;
    
    if (window.db) {
        try {
            const snapshot = await window.firebaseGetDocs(window.firebaseCollection(window.db, 'profits'));
            snapshot.forEach((doc) => {
                const data = doc.data();
                const profit = parseFloat(data.profit || 0);
                totalProfits += profit;
                
                if (data.moneyType === 'sale') {
                    totalProfitsDirty += profit;
                } else {
                    totalProfitsClean += profit;
                }
            });
        } catch (error) {
            console.error('Erreur calcul bénéfices:', error);
            // Fallback sur les logs
            const logs = await getLogs();
            logs.forEach(log => {
                if (log.type === 'vente') {
                    const profit = parseFloat(log.amount || 0);
                    totalProfits += profit;
                    if (log.moneyType === 'sale') {
                        totalProfitsDirty += profit;
                    } else {
                        totalProfitsClean += profit;
                    }
                }
            });
        }
    } else {
        // Fallback localStorage - utiliser les logs
        const logs = await getLogs();
        logs.forEach(log => {
            if (log.type === 'vente') {
                const profit = parseFloat(log.amount || 0);
                totalProfits += profit;
                if (log.moneyType === 'sale') {
                    totalProfitsDirty += profit;
                } else {
                    totalProfitsClean += profit;
                }
            }
        });
    }
    
    const profitsElement = document.getElementById('total-profits');
    if (profitsElement) {
        profitsElement.textContent = formatNumberWithSpaces(Math.round(totalProfits)) + ' €';
    }
    
    const profitsCleanElement = document.getElementById('total-profits-clean');
    if (profitsCleanElement) {
        profitsCleanElement.textContent = formatNumberWithSpaces(Math.round(totalProfitsClean)) + ' €';
    }
    
    const profitsDirtyElement = document.getElementById('total-profits-dirty');
    if (profitsDirtyElement) {
        profitsDirtyElement.textContent = formatNumberWithSpaces(Math.round(totalProfitsDirty)) + ' €';
    }
}

// Système de logs
async function addLog(type, message, amount, moneyType) {
    const newLog = {
        type: type, // 'ajout', 'modification', 'suppression', 'vente', 'connexion', 'deconnexion'
        message: message,
        amount: amount || 0,
        moneyType: moneyType || null, // 'propre' ou 'sale' pour les ventes
        timestamp: window.db ? new Date() : new Date().toISOString(),
        date: new Date().toLocaleString('fr-FR')
    };

    if (window.db) {
        try {
            await window.firebaseAddDoc(window.firebaseCollection(window.db, 'logs'), newLog);
            // Le listener Firestore mettra à jour automatiquement
        } catch (error) {
            console.error('Erreur ajout log:', error);
            // Fallback localStorage
            const logs = JSON.parse(localStorage.getItem('logs') || '[]');
            newLog.id = generateId();
            logs.unshift(newLog);
            if (logs.length > 500) logs.splice(500);
            localStorage.setItem('logs', JSON.stringify(logs));
        }
    } else {
        // Fallback localStorage
        const logs = JSON.parse(localStorage.getItem('logs') || '[]');
        newLog.id = generateId();
        logs.unshift(newLog);
        if (logs.length > 500) logs.splice(500);
        localStorage.setItem('logs', JSON.stringify(logs));
        
        // Recharger les logs si on est sur l'onglet logs
        if (document.getElementById('admin-tab-logs')?.classList.contains('active')) {
            await loadLogs();
        }
    }
}

async function getLogs() {
    if (!window.db) {
        const stored = localStorage.getItem('logs');
        return stored ? JSON.parse(stored) : [];
    }

    try {
        const snapshot = await window.firebaseGetDocs(window.firebaseCollection(window.db, 'logs'));
        const logs = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            logs.push({
                id: doc.id,
                ...data,
                // Convertir Timestamp en date si nécessaire
                date: data.timestamp?.toDate ? data.timestamp.toDate().toLocaleString('fr-FR') : data.date
            });
        });
        return logs.sort((a, b) => {
            const dateA = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : new Date(a.timestamp || a.date).getTime();
            const dateB = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : new Date(b.timestamp || b.date).getTime();
            return dateB - dateA; // Plus récent en premier
        });
    } catch (error) {
        console.error('Erreur récupération logs:', error);
        const stored = localStorage.getItem('logs');
        return stored ? JSON.parse(stored) : [];
    }
}

async function loadLogs() {
    const logs = await getLogs();
    const container = document.getElementById('logs-container');
    container.innerHTML = '';

    if (logs.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #6b7280; padding: 2rem;">Aucun log enregistré</p>';
        return;
    }

    logs.forEach(log => {
        const logElement = createLogElement(log);
        container.appendChild(logElement);
    });
}

function createLogElement(log) {
    const element = document.createElement('div');
    element.className = `log-item log-${log.type}`;
    
    const typeLabels = {
        'ajout': '➕ Ajout',
        'modification': '✏️ Modification',
        'suppression': '❌ Suppression',
        'vente': '💰 Vente',
        'connexion': '🔐 Connexion',
        'deconnexion': '🚪 Déconnexion'
    };
    
    const typeLabel = typeLabels[log.type] || log.type;
    const amountDisplay = log.amount > 0 ? ` - ${formatNumberWithSpaces(Math.round(log.amount))} €` : '';

    element.innerHTML = `
        <div class="log-header">
            <span class="log-type">${typeLabel}</span>
            <span class="log-date">${log.date}</span>
        </div>
        <div class="log-message">${log.message}${amountDisplay}</div>
    `;

    return element;
}

async function clearLogs() {
    if (window.db) {
        try {
            const snapshot = await window.firebaseGetDocs(window.firebaseCollection(window.db, 'logs'));
            const batch = window.firebaseWriteBatch(window.db);
            snapshot.forEach((doc) => {
                batch.delete(doc.ref);
            });
            await batch.commit();
        } catch (error) {
            console.error('Erreur suppression logs:', error);
            localStorage.setItem('logs', JSON.stringify([]));
        }
    } else {
        localStorage.setItem('logs', JSON.stringify([]));
    }
    
    await loadLogs();
    await updateTotalProfits();
    await addLog('system', 'Tous les logs ont été effacés', 0);
}

// Réinitialiser les bénéfices (supprime uniquement les profits)
async function resetProfits() {
    let salesCount = 0;
    
    if (window.db) {
        try {
            const snapshot = await window.firebaseGetDocs(window.firebaseCollection(window.db, 'profits'));
            salesCount = snapshot.size;
            const batch = window.firebaseWriteBatch(window.db);
            snapshot.forEach((doc) => {
                batch.delete(doc.ref);
            });
            await batch.commit();
            await addLog('system', `Réinitialisation des bénéfices - ${salesCount} vente(s) supprimée(s)`, 0);
        } catch (error) {
            console.error('Erreur reset bénéfices:', error);
            alert('Erreur lors de la réinitialisation');
            return;
        }
    } else {
        // Fallback localStorage
        const logs = await getLogs();
        salesCount = logs.filter(log => log.type === 'vente').length;
        const filteredLogs = logs.filter(log => log.type !== 'vente');
        const resetLog = {
            id: generateId(),
            type: 'system',
            message: `Réinitialisation des bénéfices - ${salesCount} vente(s) supprimée(s)`,
            amount: 0,
            timestamp: new Date().toISOString(),
            date: new Date().toLocaleString('fr-FR')
        };
        filteredLogs.unshift(resetLog);
        localStorage.setItem('logs', JSON.stringify(filteredLogs));
    }
    
    // Mettre à jour l'affichage
    await updateTotalProfits();
    
    // Recharger les logs si on est sur l'onglet logs
    if (document.getElementById('admin-tab-logs')?.classList.contains('active')) {
        await loadLogs();
    }
    
    alert(`Bénéfices réinitialisés !\n${salesCount} vente(s) supprimée(s).`);
}

// ========== SYSTÈME DE SETTINGS ==========

// Obtenir un setting
async function getSetting(key) {
    const defaults = {
        notifications: false,
        salesEnabled: true,
        infoBubble: false,
        infoText: ''
    };
    
    if (window.db) {
        try {
            const docSnap = await window.firebaseGetDoc(window.firebaseDoc(window.db, 'settings', 'appSettings'));
            if (docSnap.exists()) {
                const settings = docSnap.data();
                return settings[key] !== undefined ? settings[key] : defaults[key];
            }
        } catch (error) {
            console.error('Erreur récupération setting:', error);
        }
    }
    
    // Fallback localStorage
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    return settings[key] !== undefined ? settings[key] : defaults[key];
}

// Sauvegarder un setting
async function saveSetting(key, value) {
    if (window.db) {
        try {
            const settingsRef = window.firebaseDoc(window.db, 'settings', 'appSettings');
            const docSnap = await window.firebaseGetDoc(settingsRef);
            
            if (docSnap.exists()) {
                await window.firebaseUpdateDoc(settingsRef, { [key]: value });
            } else {
                await window.firebaseSetDoc(settingsRef, {
                    [key]: value,
                    notifications: false,
                    salesEnabled: true,
                    infoBubble: false,
                    infoText: ''
                });
            }
        } catch (error) {
            console.error('Erreur sauvegarde setting:', error);
            // Fallback localStorage
            const settings = JSON.parse(localStorage.getItem('settings') || '{}');
            settings[key] = value;
            localStorage.setItem('settings', JSON.stringify(settings));
        }
    } else {
        // Fallback localStorage
        const settings = JSON.parse(localStorage.getItem('settings') || '{}');
        settings[key] = value;
        localStorage.setItem('settings', JSON.stringify(settings));
    }
}

// Charger les settings dans l'interface
async function loadSettings() {
    const notifications = await getSetting('notifications');
    const salesEnabled = await getSetting('salesEnabled');
    const infoBubble = await getSetting('infoBubble');
    const infoText = await getSetting('infoText');
    
    document.getElementById('setting-notifications').checked = notifications;
    document.getElementById('setting-sales-enabled').checked = salesEnabled;
    document.getElementById('setting-info-bubble').checked = infoBubble;
    document.getElementById('setting-info-text').value = infoText;
}

// Initialiser les settings au chargement
async function initializeSettings() {
    await loadSettings();
    await toggleInfoBubble();
    await updateInfoBubbleText();
    
    // Notification de connexion si activée
    const notifications = await getSetting('notifications');
    if (notifications) {
        showNotification('Un utilisateur s\'est connecté au site', 'info');
    }
}

// Toggle la bulle d'info
async function toggleInfoBubble() {
    const enabled = await getSetting('infoBubble');
    let bubble = document.getElementById('info-bubble');
    
    if (enabled && !bubble) {
        bubble = document.createElement('div');
        bubble.id = 'info-bubble';
        bubble.className = 'info-bubble';
        document.body.appendChild(bubble);
        await updateInfoBubbleText();
    } else if (!enabled && bubble) {
        bubble.remove();
    }
}

// Mettre à jour le texte de la bulle
async function updateInfoBubbleText() {
    const bubble = document.getElementById('info-bubble');
    if (bubble) {
        const text = (await getSetting('infoText')) || 'Information';
        bubble.innerHTML = `
            <button class="info-bubble-close" onclick="toggleInfoBubble()">&times;</button>
            <div class="info-bubble-content">${text}</div>
        `;
    }
}

// Formater un prix en format K/M
function formatPriceForMessage(price) {
    if (price >= 1000000) {
        const millions = price / 1000000;
        // Si c'est un nombre entier, ne pas afficher de décimales
        if (millions % 1 === 0) {
            return `${millions}M`;
        } else {
            // Arrondir à 1 décimale si nécessaire
            return `${Math.round(millions * 10) / 10}M`;
        }
    } else if (price >= 1000) {
        const thousands = price / 1000;
        // Si c'est un nombre entier, ne pas afficher de décimales
        if (thousands % 1 === 0) {
            return `${thousands}K`;
        } else {
            // Arrondir à 1 décimale si nécessaire
            return `${Math.round(thousands * 10) / 10}K`;
        }
    }
    return price.toString();
}

// Générer le message d'affichage
async function generateDisplayMessage() {
    try {
        // Charger les armes depuis la base de données
        if (!window.db) {
            showNotification('Firestore non disponible', 'error');
            return;
        }

        // Recharger les armes depuis Firestore
        await loadWeaponsFromFirestore();
        
        // Filtrer les armes avec quantité > 0
        const weaponsInStock = weaponsCache.filter(w => w.quantity > 0);
        
        if (weaponsInStock.length === 0) {
            showNotification('Aucune arme en stock', 'error');
            return;
        }

        // Vérifier si le blanchiment est activé
        const launderingEnabled = document.getElementById('setting-laundering-enabled').checked;
        const launderingPercentage = launderingEnabled 
            ? parseInt(document.getElementById('setting-laundering-percentage').value) || 5 
            : 0;

        // Construire le message
        let message = '🔥 ';
        
        // Ajouter le titre avec blanchiment si activé
        if (launderingEnabled) {
            message += `VENTE D'ARMES/BLANCHIMENT ${launderingPercentage}% 🔥\n\n`;
        } else {
            message += `VENTE D'ARMES 🔥\n\n`;
        }

        // Trier les armes par prix de vente (décroissant)
        const sortedWeapons = [...weaponsInStock].sort((a, b) => b.salePrice - a.salePrice);

        // Ajouter chaque arme au message
        sortedWeapons.forEach(weapon => {
            const formattedPrice = formatPriceForMessage(weapon.salePrice);
            message += `🔫 ${weapon.name} — ${formattedPrice} €\n`;
        });

        // Vérifier s'il y a des "tablettes illégales" (on peut chercher par nom ou ajouter une catégorie)
        // Pour l'instant, on ajoute juste les armes. Si vous voulez ajouter d'autres catégories, on peut le faire.

        // Afficher le message
        const messageContainer = document.getElementById('generated-message-container');
        const messageTextarea = document.getElementById('generated-message');
        messageTextarea.value = message;
        messageContainer.style.display = 'block';

        showNotification('Message généré avec succès !', 'success');
    } catch (error) {
        console.error('Erreur génération message:', error);
        showNotification('Erreur lors de la génération du message', 'error');
    }
}

// ========== SYSTÈME DE DEMANDES D'ACHAT ==========

// Ouvrir la modale de demande d'achat
async function openPurchaseRequestModal(name, moneyType, basePrice) {
    const salesEnabled = await getSetting('salesEnabled');
    if (salesEnabled === false) {
        alert('Les demandes d\'achat sont désactivées');
        return;
    }
    
    document.getElementById('request-weapon-name').textContent = name;
    document.getElementById('request-weapon-price').textContent = formatNumberWithSpaces(Math.round(basePrice));
    document.getElementById('purchase-request-modal').classList.add('active');
    
    // Reset form
    document.getElementById('purchase-request-form').reset();
    document.getElementById('custom-price-container').style.display = 'none';
    
    // Stocker les infos de l'arme
    window.currentRequestWeapon = { name, moneyType, basePrice };
}

// Fermer la modale de demande
function closePurchaseRequestModal() {
    document.getElementById('purchase-request-modal').classList.remove('active');
    document.getElementById('purchase-request-form').reset();
    window.currentRequestWeapon = null;
}

// Soumettre une demande d'achat
async function submitPurchaseRequest() {
    const weapon = window.currentRequestWeapon;
    if (!weapon) return;
    
    const name = document.getElementById('request-name').value.trim();
    const ig = document.getElementById('request-ig').value.trim();
    const priceType = document.getElementById('request-price-type').value;
    const customPrice = priceType === 'custom' ? document.getElementById('request-custom-price').value.replace(/\s/g, '') : null;
    
    if (!name || !ig) {
        alert('Veuillez remplir tous les champs');
        return;
    }
    
    if (priceType === 'custom' && (!customPrice || isNaN(customPrice) || parseFloat(customPrice) < 0)) {
        alert('Veuillez entrer un prix valide');
        return;
    }
    
    const finalPrice = priceType === 'base' ? weapon.basePrice : parseFloat(customPrice);
    
    // Sauvegarder la demande dans Firestore
    const newRequest = {
        weaponName: weapon.name,
        weaponMoneyType: weapon.moneyType,
        basePrice: weapon.basePrice,
        requestedPrice: finalPrice,
        priceType: priceType,
        buyerName: name,
        buyerIG: ig,
        timestamp: window.db ? new Date() : new Date().toISOString(),
        date: new Date().toLocaleString('fr-FR'),
        status: 'pending'
    };
    
    if (window.db) {
        try {
            await window.firebaseAddDoc(window.firebaseCollection(window.db, 'purchaseRequests'), newRequest);
        } catch (error) {
            console.error('Erreur ajout demande:', error);
            // Fallback localStorage
            const requests = await getPurchaseRequests();
            newRequest.id = generateId();
            requests.push(newRequest);
            localStorage.setItem('purchaseRequests', JSON.stringify(requests));
        }
    } else {
        // Fallback localStorage
        const requests = await getPurchaseRequests();
        newRequest.id = generateId();
        requests.push(newRequest);
        localStorage.setItem('purchaseRequests', JSON.stringify(requests));
    }
    
    alert('Votre demande a été envoyée !');
    closePurchaseRequestModal();
    
    // Si on est admin et sur l'onglet settings, recharger les demandes
    if (isAdminLoggedIn && document.getElementById('admin-tab-settings')?.classList.contains('active')) {
        await loadPendingRequests();
    }
}

// Obtenir les demandes d'achat
async function getPurchaseRequests() {
    if (!window.db) {
        const stored = localStorage.getItem('purchaseRequests');
        return stored ? JSON.parse(stored) : [];
    }

    try {
        const snapshot = await window.firebaseGetDocs(window.firebaseCollection(window.db, 'purchaseRequests'));
        const requests = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            requests.push({
                id: doc.id,
                ...data,
                date: data.timestamp?.toDate ? data.timestamp.toDate().toLocaleString('fr-FR') : data.date
            });
        });
        return requests;
    } catch (error) {
        console.error('Erreur récupération demandes:', error);
        const stored = localStorage.getItem('purchaseRequests');
        return stored ? JSON.parse(stored) : [];
    }
}

// Charger les demandes en attente dans l'admin
async function loadPendingRequests() {
    const allRequests = await getPurchaseRequests();
    const requests = allRequests.filter(r => r.status === 'pending');
    const container = document.getElementById('pending-requests-container');
    container.innerHTML = '';
    
    if (requests.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #6b7280; padding: 1rem;">Aucune demande en attente</p>';
        return;
    }
    
    requests.forEach(request => {
        const requestElement = createRequestElement(request);
        container.appendChild(requestElement);
    });
}

// Créer un élément de demande
function createRequestElement(request) {
    const div = document.createElement('div');
    div.className = 'request-item';
    
    div.innerHTML = `
        <div class="request-info">
            <div class="request-header">
                <strong>${request.weaponName}</strong>
                <span class="request-date">${request.date}</span>
            </div>
            <div class="request-details">
                <p><strong>Acheteur:</strong> ${request.buyerName} (IG: ${request.buyerIG})</p>
                <p><strong>Prix de base:</strong> ${formatNumberWithSpaces(Math.round(request.basePrice))} €</p>
                <p><strong>Prix demandé:</strong> ${formatNumberWithSpaces(Math.round(request.requestedPrice))} € ${request.priceType === 'custom' ? '(personnalisé)' : '(prix de base)'}</p>
                <p><strong>Type d'argent:</strong> ${request.weaponMoneyType === 'sale' ? '💀 Sale' : '✅ Propre'}</p>
            </div>
        </div>
        <div class="request-actions">
            <button class="btn-accept" onclick="acceptPurchaseRequest('${request.id}')">Accepter</button>
            <button class="btn-reject" onclick="rejectPurchaseRequest('${request.id}')">Refuser</button>
        </div>
    `;
    
    return div;
}

// Accepter une demande
async function acceptPurchaseRequest(requestId) {
    if (!confirm('Accepter cette demande d\'achat ?')) return;
    
    if (window.db) {
        try {
            const requestRef = window.firebaseDoc(window.db, 'purchaseRequests', requestId);
            const requestSnap = await window.firebaseGetDoc(requestRef);
            
            if (requestSnap.exists()) {
                const requestData = requestSnap.data();
                await window.firebaseUpdateDoc(requestRef, {
                    status: 'accepted',
                    processedAt: new Date()
                });
                
                // Réduire la quantité de l'arme
                const q = window.firebaseQuery(
                    window.firebaseCollection(window.db, 'weapons'),
                    window.firebaseWhere('name', '==', requestData.weaponName),
                    window.firebaseWhere('moneyType', '==', requestData.weaponMoneyType || 'propre'),
                    window.firebaseWhere('quantity', '>', 0),
                    window.firebaseLimit(1)
                );
                const querySnapshot = await window.firebaseGetDocs(q);
                
                if (!querySnapshot.empty) {
                    const weaponDoc = querySnapshot.docs[0];
                    await window.firebaseUpdateDoc(weaponDoc.ref, {
                        quantity: window.firebaseFieldValue.increment(-1)
                    });
                    
                    // Ajouter le bénéfice
                    const purchasePrice = requestData.basePrice || 0;
                    const salePrice = requestData.requestedPrice || 0;
                    const profit = salePrice - purchasePrice;
                    
                    await window.firebaseAddDoc(window.firebaseCollection(window.db, 'profits'), {
                        weaponName: requestData.weaponName,
                        purchasePrice: purchasePrice,
                        salePrice: salePrice,
                        profit: profit,
                        moneyType: requestData.weaponMoneyType || 'propre',
                        timestamp: new Date(),
                        fromRequest: true
                    });
                }
                
                await addLog('system', `Demande acceptée: ${requestData.weaponName} - ${requestData.buyerName} (IG: ${requestData.buyerIG}) - ${formatNumberWithSpaces(Math.round(requestData.requestedPrice))}€`, 0);
            }
        } catch (error) {
            console.error('Erreur acceptation demande:', error);
            alert('Erreur lors de l\'acceptation de la demande');
        }
    } else {
        // Fallback localStorage
        const requests = await getPurchaseRequests();
        const request = requests.find(r => r.id === requestId);
        
        if (request) {
            request.status = 'accepted';
            localStorage.setItem('purchaseRequests', JSON.stringify(requests));
            await addLog('system', `Demande acceptée: ${request.weaponName} - ${request.buyerName} (IG: ${request.buyerIG}) - ${formatNumberWithSpaces(Math.round(request.requestedPrice))}€`, 0);
        }
    }
    
    await loadPendingRequests();
}

// Refuser une demande
async function rejectPurchaseRequest(requestId) {
    if (!confirm('Refuser cette demande d\'achat ?')) return;
    
    if (window.db) {
        try {
            const requestRef = window.firebaseDoc(window.db, 'purchaseRequests', requestId);
            const requestSnap = await window.firebaseGetDoc(requestRef);
            
            if (requestSnap.exists()) {
                const requestData = requestSnap.data();
                await window.firebaseUpdateDoc(requestRef, {
                    status: 'rejected',
                    processedAt: new Date()
                });
                await addLog('system', `Demande refusée: ${requestData.weaponName} - ${requestData.buyerName}`, 0);
            }
        } catch (error) {
            console.error('Erreur refus demande:', error);
            alert('Erreur lors du refus de la demande');
        }
    } else {
        // Fallback localStorage
        const requests = await getPurchaseRequests();
        const request = requests.find(r => r.id === requestId);
        
        if (request) {
            request.status = 'rejected';
            localStorage.setItem('purchaseRequests', JSON.stringify(requests));
            await addLog('system', `Demande refusée: ${request.weaponName} - ${request.buyerName}`, 0);
        }
    }
    
    await loadPendingRequests();
}

// ========== FONCTIONS DE RAFRAÎCHISSEMENT ==========

// Rafraîchir l'inventaire principal depuis Firestore
async function refreshInventory() {
    try {
        console.log('[REFRESH] Rechargement inventaire depuis Firestore...');
        if (window.db) {
            await loadWeaponsFromFirestore();
            await loadInventory();
            showNotification('Inventaire rafraîchi avec succès !', 'success');
        } else {
            showNotification('Firestore non disponible', 'error');
        }
    } catch (error) {
        console.error('[REFRESH] Erreur rafraîchissement inventaire:', error);
        showNotification('Erreur lors du rafraîchissement', 'error');
    }
}

// Rafraîchir la liste admin depuis Firestore
async function refreshAdminList() {
    try {
        console.log('[REFRESH] Rechargement liste admin depuis Firestore...');
        if (window.db) {
            await loadWeaponsFromFirestore();
            await loadAdminWeaponsList();
            showNotification('Liste admin rafraîchie avec succès !', 'success');
        } else {
            showNotification('Firestore non disponible', 'error');
        }
    } catch (error) {
        console.error('[REFRESH] Erreur rafraîchissement liste admin:', error);
        showNotification('Erreur lors du rafraîchissement', 'error');
    }
}

// Rafraîchir l'inventaire admin depuis Firestore
async function refreshAdminInventory() {
    try {
        console.log('[REFRESH] Rechargement inventaire admin depuis Firestore...');
        if (window.db) {
            await loadWeaponsFromFirestore();
            await loadAdminInventory();
            await updateTotalProfits();
            showNotification('Inventaire admin rafraîchi avec succès !', 'success');
        } else {
            showNotification('Firestore non disponible', 'error');
        }
    } catch (error) {
        console.error('[REFRESH] Erreur rafraîchissement inventaire admin:', error);
        showNotification('Erreur lors du rafraîchissement', 'error');
    }
}

// Fonction pour afficher une notification
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('show');
    }, 100);
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}


// Exposer les fonctions pour les boutons onclick
window.editWeapon = editWeapon;
window.deleteWeapon = deleteWeapon;
window.sellWeapon = sellWeapon;
window.sellWeaponByName = sellWeaponByName;
window.openSellModal = openSellModal;
window.closeSellModal = closeSellModal;
window.openPurchaseRequestModal = openPurchaseRequestModal;
window.closePurchaseRequestModal = closePurchaseRequestModal;
window.acceptPurchaseRequest = acceptPurchaseRequest;
window.rejectPurchaseRequest = rejectPurchaseRequest;
