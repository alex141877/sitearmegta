// Code administrateur
const ADMIN_CODE = '268977';

// État de l'application
let isAdminLoggedIn = false;
let editingWeaponId = null;

// Initialisation
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
    loadInventory();
});

// Initialiser l'application
function initializeApp() {
    showPage('inventory-page');
    checkAdminSession();
}

// Vérifier la session admin
function checkAdminSession() {
    const session = localStorage.getItem('adminSession');
    if (session === 'true') {
        isAdminLoggedIn = true;
    }
}

// Configuration des écouteurs d'événements
function setupEventListeners() {
    // Navigation
    document.getElementById('btn-inventory').addEventListener('click', (e) => {
        e.preventDefault();
        showPage('inventory-page');
        loadInventory();
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

    document.getElementById('btn-admin-inventory-list-tab').addEventListener('click', () => {
        showAdminTab('inventory');
        loadAdminInventory();
    });

    document.getElementById('btn-admin-log-tab').addEventListener('click', () => {
        showAdminTab('logs');
        loadLogs();
    });

    document.getElementById('btn-admin-settings-tab').addEventListener('click', () => {
        showAdminTab('settings');
        loadSettings();
        loadPendingRequests();
    });

    // Effacer les logs
    document.getElementById('btn-clear-logs').addEventListener('click', () => {
        if (confirm('Êtes-vous sûr de vouloir effacer tous les logs ?')) {
            clearLogs();
        }
    });

    // Réinitialiser les bénéfices
    document.getElementById('btn-reset-profits').addEventListener('click', () => {
        if (confirm('Êtes-vous sûr de vouloir réinitialiser les bénéfices totaux ?\n\nCela supprimera uniquement les logs de ventes.')) {
            resetProfits();
        }
    });

    // Menu burger
    const burger = document.querySelector('.burger');
    const navLinks = document.querySelector('.nav-links');
    burger.addEventListener('click', () => {
        navLinks.classList.toggle('active');
    });

    // Formulaire de connexion admin
    document.getElementById('admin-login-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const code = document.getElementById('admin-code').value;
        if (code === ADMIN_CODE) {
            isAdminLoggedIn = true;
            localStorage.setItem('adminSession', 'true');
            showPage('admin-page');
            loadAdminPage();
            showAdminTab('gestion');
            addLog('connexion', 'Connexion administrateur', 0);
            document.getElementById('admin-code').value = '';
            document.getElementById('login-error').classList.remove('show');
        } else {
            document.getElementById('login-error').textContent = 'Code incorrect !';
            document.getElementById('login-error').classList.add('show');
        }
    });

    // Bouton de déconnexion
    document.getElementById('btn-logout').addEventListener('click', () => {
        addLog('deconnexion', 'Déconnexion administrateur', 0);
        isAdminLoggedIn = false;
        localStorage.removeItem('adminSession');
        showPage('inventory-page');
        loadInventory();
    });

    // Formulaire d'ajout/modification d'arme
    document.getElementById('weapon-form').addEventListener('submit', (e) => {
        e.preventDefault();
        saveWeapon();
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
    document.getElementById('sell-form').addEventListener('submit', (e) => {
        e.preventDefault();
        sellWeaponWithCustomPrice();
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
    document.getElementById('setting-notifications').addEventListener('change', (e) => {
        saveSetting('notifications', e.target.checked);
    });

    document.getElementById('setting-sales-enabled').addEventListener('change', (e) => {
        saveSetting('salesEnabled', e.target.checked);
        loadInventory(); // Recharger pour afficher/cacher les boutons
    });

    document.getElementById('setting-info-bubble').addEventListener('change', (e) => {
        saveSetting('infoBubble', e.target.checked);
        toggleInfoBubble();
    });

    document.getElementById('setting-info-text').addEventListener('input', (e) => {
        saveSetting('infoText', e.target.value);
        updateInfoBubbleText();
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
    document.getElementById('purchase-request-form').addEventListener('submit', (e) => {
        e.preventDefault();
        submitPurchaseRequest();
    });

    // Fermer la modale de demande en cliquant en dehors
    document.getElementById('purchase-request-modal').addEventListener('click', (e) => {
        if (e.target.id === 'purchase-request-modal') {
            closePurchaseRequestModal();
        }
    });

    // Initialiser les settings et l'info bubble
    initializeSettings();
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

// Charger l'inventaire
function loadInventory() {
    const weapons = getWeapons();
    const grid = document.getElementById('weapons-grid');
    grid.innerHTML = '';

    let totalWeapons = 0;
    let totalValue = 0;

    // Grouper les armes par nom ET par type d'argent
    const weaponsGrouped = {};
    weapons.forEach(weapon => {
        const key = `${weapon.name}_${weapon.moneyType || 'propre'}`;
        if (!weaponsGrouped[key]) {
            weaponsGrouped[key] = {
                ...weapon,
                totalQuantity: 0,
                instances: []
            };
        }
        weaponsGrouped[key].totalQuantity += weapon.quantity;
        weaponsGrouped[key].instances.push(weapon);
    });

    // Afficher une seule carte par groupe avec badge de quantité
    Object.values(weaponsGrouped).forEach(group => {
        const card = createWeaponCard(group);
        grid.appendChild(card);
        totalWeapons += group.totalQuantity;
        totalValue += parseFloat(group.salePrice) * group.totalQuantity;
    });

    // Mettre à jour les statistiques
    document.getElementById('total-weapons').textContent = formatNumberWithSpaces(totalWeapons);
    document.getElementById('total-value').textContent = formatNumberWithSpaces(Math.round(totalValue)) + ' €';
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
        ${getSetting('salesEnabled') !== false ? `<button class="btn-buy" onclick="openPurchaseRequestModal('${weaponNameEscaped}', '${moneyTypeEscaped}', ${salePrice})" ${quantity === 0 ? 'disabled' : ''}>${quantity === 0 ? 'Rupture de stock' : 'Demander'}</button>` : ''}
    `;

    return card;
}

// Charger la page admin
function loadAdminPage() {
    loadAdminWeaponsList();
    resetForm();
    updateTotalProfits();
}

// Charger la liste des armes dans l'admin
function loadAdminWeaponsList() {
    const weapons = getWeapons();
    const list = document.getElementById('admin-weapons-list');
    list.innerHTML = '';

    if (weapons.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: #6b7280; padding: 2rem;">Aucune arme en stock</p>';
        return;
    }

    // Grouper les armes par nom ET par type d'argent (séparer propre et sale)
    const weaponsGrouped = {};
    weapons.forEach(weapon => {
        const key = `${weapon.name}_${weapon.moneyType || 'propre'}`;
        if (!weaponsGrouped[key]) {
            weaponsGrouped[key] = {
                ...weapon,
                totalQuantity: 0
            };
        }
        weaponsGrouped[key].totalQuantity += weapon.quantity;
    });

    Object.values(weaponsGrouped).forEach(weapon => {
        const item = createAdminWeaponItem(weapon);
        list.appendChild(item);
    });
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
function saveWeapon() {
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
        const weaponIndex = weapons.findIndex(w => w.id === editingWeaponId);
        const oldWeapon = weapons[weaponIndex];
        if (weaponIndex !== -1) {
            weapons[weaponIndex] = {
                id: editingWeaponId,
                name,
                purchasePrice: parseFloat(purchasePrice),
                salePrice: parseFloat(salePrice),
                quantity: quantity,
                moneyType: moneyType
            };
        }
        addLog('modification', `Modification: ${name} (${quantity} unités, ${moneyTypeLabel}) - Achat: ${formatNumberWithSpaces(Math.round(purchasePrice))}€, Vente: ${formatNumberWithSpaces(Math.round(salePrice))}€`, parseFloat(salePrice) * quantity);
        editingWeaponId = null;
    } else {
        // Vérifier si une arme avec le même nom ET le même type d'argent existe déjà
        const existingWeaponIndex = weapons.findIndex(w => 
            w.name === name && 
            (w.moneyType || 'propre') === moneyType &&
            Math.abs(w.purchasePrice - parseFloat(purchasePrice)) < 0.01 &&
            Math.abs(w.salePrice - parseFloat(salePrice)) < 0.01
        );

        if (existingWeaponIndex !== -1) {
            // Ajouter à la quantité existante
            weapons[existingWeaponIndex].quantity += quantity;
            addLog('ajout', `Ajout: ${name} (+${quantity} unités, ${moneyTypeLabel}) - Total: ${weapons[existingWeaponIndex].quantity} unités`, parseFloat(salePrice) * quantity);
        } else {
            // Ajouter une nouvelle arme
            const newWeapon = {
                id: generateId(),
                name,
                purchasePrice: parseFloat(purchasePrice),
                salePrice: parseFloat(salePrice),
                quantity: quantity,
                moneyType: moneyType,
                dateAdded: new Date().toISOString()
            };
            weapons.push(newWeapon);
            addLog('ajout', `Ajout: ${name} (${quantity} unités, ${moneyTypeLabel}) - Achat: ${formatNumberWithSpaces(Math.round(purchasePrice))}€, Vente: ${formatNumberWithSpaces(Math.round(salePrice))}€`, parseFloat(salePrice) * quantity);
        }
    }

    saveWeapons(weapons);
    loadAdminWeaponsList();
    resetForm();
    loadInventory();
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
function deleteWeapon(id) {
    if (confirm('Êtes-vous sûr de vouloir supprimer cette arme ?')) {
        let weapons = getWeapons();
        const weapon = weapons.find(w => w.id === id);
        if (weapon) {
            addLog('suppression', `Suppression: ${weapon.name} (${weapon.quantity} unités)`, 0);
        }
        weapons = weapons.filter(w => w.id !== id);
        saveWeapons(weapons);
        loadAdminWeaponsList();
        loadInventory();
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

// Obtenir les armes depuis le localStorage
function getWeapons() {
    const stored = localStorage.getItem('weapons');
    return stored ? JSON.parse(stored) : [];
}

// Sauvegarder les armes dans le localStorage
function saveWeapons(weapons) {
    localStorage.setItem('weapons', JSON.stringify(weapons));
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
function loadAdminInventory() {
    const weapons = getWeapons();
    const grid = document.getElementById('admin-inventory-grid');
    grid.innerHTML = '';

    // Grouper les armes par nom ET par type d'argent (en conservant toutes les instances)
    const weaponsGrouped = {};
    weapons.forEach(weapon => {
        const key = `${weapon.name}_${weapon.moneyType || 'propre'}`;
        if (!weaponsGrouped[key]) {
            weaponsGrouped[key] = {
                id: weapon.id, // Prendre le premier ID pour référence
                name: weapon.name,
                purchasePrice: weapon.purchasePrice,
                salePrice: weapon.salePrice,
                moneyType: weapon.moneyType || 'propre',
                totalQuantity: 0,
                instances: []
            };
        }
        weaponsGrouped[key].totalQuantity += weapon.quantity;
        weaponsGrouped[key].instances.push({
            id: weapon.id,
            quantity: weapon.quantity
        });
    });

    // Afficher chaque arme avec bouton "Vendu"
    Object.values(weaponsGrouped).forEach(group => {
        const card = createAdminInventoryCard(group);
        grid.appendChild(card);
    });

    // Mettre à jour les bénéfices totaux
    updateTotalProfits();
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
function openSellModal(name, moneyType = null) {
    let weapons = getWeapons();
    
    // Trouver la première instance avec quantité > 0 et même nom
    // Si moneyType est fourni, chercher aussi par type d'argent
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
    
    if (weaponIndex === -1) {
        alert('Stock épuisé pour cette arme');
        return;
    }

    const weapon = weapons[weaponIndex];
    
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
function sellWeaponWithCustomPrice() {
    const weapon = window.currentSellingWeapon;
    if (!weapon) return;
    
    let weapons = getWeapons();
    const weaponIndex = weapons.findIndex(w => w.id === weapon.id);
    
    if (weaponIndex === -1) {
        alert('Arme introuvable');
        closeSellModal();
        return;
    }

    const currentWeapon = weapons[weaponIndex];
    
    if (currentWeapon.quantity <= 0) {
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

    // Réduire la quantité
    currentWeapon.quantity -= 1;

    const purchasePrice = parseFloat(currentWeapon.purchasePrice);
    const profit = salePrice - purchasePrice;
    const moneyType = document.getElementById('modal-money-type').value;
    const moneyTypeLabel = moneyType === 'sale' ? 'Argent Sale' : 'Argent Propre';
    
    // Enregistrer dans les logs avec le prix réel et le type d'argent
    const profitLabel = profit >= 0 ? 'Bénéfice' : 'Perte';
    addLog('vente', `Vente: ${currentWeapon.name} (${moneyTypeLabel}) - Prix réel: ${formatNumberWithSpaces(Math.round(salePrice))}€ (suggéré: ${formatNumberWithSpaces(Math.round(currentWeapon.salePrice))}€), ${profitLabel}: ${formatNumberWithSpaces(Math.round(Math.abs(profit)))}€`, profit, moneyType);

    // Sauvegarder
    saveWeapons(weapons);
    
    // Fermer la modale
    closeSellModal();
    
    // Recharger les vues
    loadAdminInventory();
    loadInventory();
    updateTotalProfits();
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
function updateTotalProfits() {
    const logs = getLogs();
    let totalProfits = 0;
    let totalProfitsClean = 0;
    let totalProfitsDirty = 0;
    
    logs.forEach(log => {
        if (log.type === 'vente') {
            // Le montant est directement le bénéfice
            const profit = parseFloat(log.amount || 0);
            totalProfits += profit;
            
            // Séparer selon le type d'argent
            if (log.moneyType === 'sale') {
                totalProfitsDirty += profit;
            } else {
                totalProfitsClean += profit;
            }
        }
    });
    
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
function addLog(type, message, amount, moneyType) {
    const logs = getLogs();
    const newLog = {
        id: generateId(),
        type: type, // 'ajout', 'modification', 'suppression', 'vente', 'connexion', 'deconnexion'
        message: message,
        amount: amount || 0,
        moneyType: moneyType || null, // 'propre' ou 'sale' pour les ventes
        timestamp: new Date().toISOString(),
        date: new Date().toLocaleString('fr-FR')
    };
    
    logs.unshift(newLog); // Ajouter au début
    
    // Garder seulement les 500 derniers logs
    if (logs.length > 500) {
        logs.splice(500);
    }
    
    saveLogs(logs);
    
    // Recharger les logs si on est sur l'onglet logs
    if (document.getElementById('admin-tab-logs').classList.contains('active')) {
        loadLogs();
    }
}

function getLogs() {
    const stored = localStorage.getItem('logs');
    return stored ? JSON.parse(stored) : [];
}

function saveLogs(logs) {
    localStorage.setItem('logs', JSON.stringify(logs));
}

function loadLogs() {
    const logs = getLogs();
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

function clearLogs() {
    saveLogs([]);
    loadLogs();
    updateTotalProfits();
    addLog('system', 'Tous les logs ont été effacés', 0);
}

// Réinitialiser les bénéfices (supprime uniquement les logs de ventes)
function resetProfits() {
    const logs = getLogs();
    
    // Compter combien de ventes vont être supprimées
    const salesCount = logs.filter(log => log.type === 'vente').length;
    
    // Filtrer pour garder tous les logs sauf les ventes
    const filteredLogs = logs.filter(log => log.type !== 'vente');
    
    // Ajouter un log de réinitialisation au début
    const resetLog = {
        id: generateId(),
        type: 'system',
        message: `Réinitialisation des bénéfices - ${salesCount} vente(s) supprimée(s)`,
        amount: 0,
        timestamp: new Date().toISOString(),
        date: new Date().toLocaleString('fr-FR')
    };
    
    filteredLogs.unshift(resetLog);
    
    // Enregistrer les logs (avec le log de réinitialisation)
    saveLogs(filteredLogs);
    
    // Mettre à jour l'affichage
    updateTotalProfits();
    
    // Recharger les logs si on est sur l'onglet logs
    if (document.getElementById('admin-tab-logs').classList.contains('active')) {
        loadLogs();
    }
    
    alert(`Bénéfices réinitialisés !\n${salesCount} vente(s) supprimée(s) des logs.`);
}

// ========== SYSTÈME DE SETTINGS ==========

// Obtenir un setting
function getSetting(key) {
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    // Valeurs par défaut
    const defaults = {
        notifications: false,
        salesEnabled: true,
        infoBubble: false,
        infoText: ''
    };
    return settings[key] !== undefined ? settings[key] : defaults[key];
}

// Sauvegarder un setting
function saveSetting(key, value) {
    const settings = JSON.parse(localStorage.getItem('settings') || '{}');
    settings[key] = value;
    localStorage.setItem('settings', JSON.stringify(settings));
}

// Charger les settings dans l'interface
function loadSettings() {
    document.getElementById('setting-notifications').checked = getSetting('notifications');
    document.getElementById('setting-sales-enabled').checked = getSetting('salesEnabled');
    document.getElementById('setting-info-bubble').checked = getSetting('infoBubble');
    document.getElementById('setting-info-text').value = getSetting('infoText');
}

// Initialiser les settings au chargement
function initializeSettings() {
    loadSettings();
    toggleInfoBubble();
    updateInfoBubbleText();
    
    // Notification de connexion si activée
    if (getSetting('notifications')) {
        showNotification('Un utilisateur s\'est connecté au site', 'info');
    }
}

// Toggle la bulle d'info
function toggleInfoBubble() {
    const enabled = getSetting('infoBubble');
    let bubble = document.getElementById('info-bubble');
    
    if (enabled && !bubble) {
        bubble = document.createElement('div');
        bubble.id = 'info-bubble';
        bubble.className = 'info-bubble';
        document.body.appendChild(bubble);
    } else if (!enabled && bubble) {
        bubble.remove();
    }
}

// Mettre à jour le texte de la bulle
function updateInfoBubbleText() {
    const bubble = document.getElementById('info-bubble');
    if (bubble) {
        const text = getSetting('infoText') || 'Information';
        bubble.innerHTML = `
            <button class="info-bubble-close" onclick="toggleInfoBubble()">&times;</button>
            <div class="info-bubble-content">${text}</div>
        `;
    }
}

// ========== SYSTÈME DE DEMANDES D'ACHAT ==========

// Ouvrir la modale de demande d'achat
function openPurchaseRequestModal(name, moneyType, basePrice) {
    if (getSetting('salesEnabled') === false) {
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
function submitPurchaseRequest() {
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
    
    // Sauvegarder la demande
    const requests = getPurchaseRequests();
    const newRequest = {
        id: generateId(),
        weaponName: weapon.name,
        weaponMoneyType: weapon.moneyType,
        basePrice: weapon.basePrice,
        requestedPrice: finalPrice,
        priceType: priceType,
        buyerName: name,
        buyerIG: ig,
        timestamp: new Date().toISOString(),
        date: new Date().toLocaleString('fr-FR'),
        status: 'pending'
    };
    
    requests.push(newRequest);
    savePurchaseRequests(requests);
    
    alert('Votre demande a été envoyée !');
    closePurchaseRequestModal();
    
    // Si on est admin et sur l'onglet settings, recharger les demandes
    if (isAdminLoggedIn && document.getElementById('admin-tab-settings').classList.contains('active')) {
        loadPendingRequests();
    }
}

// Obtenir les demandes d'achat
function getPurchaseRequests() {
    const stored = localStorage.getItem('purchaseRequests');
    return stored ? JSON.parse(stored) : [];
}

// Sauvegarder les demandes
function savePurchaseRequests(requests) {
    localStorage.setItem('purchaseRequests', JSON.stringify(requests));
}

// Charger les demandes en attente dans l'admin
function loadPendingRequests() {
    const requests = getPurchaseRequests().filter(r => r.status === 'pending');
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
function acceptPurchaseRequest(requestId) {
    if (confirm('Accepter cette demande d\'achat ?')) {
        const requests = getPurchaseRequests();
        const request = requests.find(r => r.id === requestId);
        
        if (request) {
            request.status = 'accepted';
            savePurchaseRequests(requests);
            addLog('system', `Demande acceptée: ${request.weaponName} - ${request.buyerName} (IG: ${request.buyerIG}) - ${formatNumberWithSpaces(Math.round(request.requestedPrice))}€`, 0);
            loadPendingRequests();
        }
    }
}

// Refuser une demande
function rejectPurchaseRequest(requestId) {
    if (confirm('Refuser cette demande d\'achat ?')) {
        const requests = getPurchaseRequests();
        const request = requests.find(r => r.id === requestId);
        
        if (request) {
            request.status = 'rejected';
            savePurchaseRequests(requests);
            addLog('system', `Demande refusée: ${request.weaponName} - ${request.buyerName}`, 0);
            loadPendingRequests();
        }
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
