// Catalogue des prix de référence (admin) + affichage public propre / sale
const PRICE_CATALOG_COLLECTION = 'weaponPriceCatalog';
let priceCatalogCache = [];

function normalizeWeaponName(name) {
    return (name || '').trim().toLowerCase();
}

async function loadPriceCatalogFromFirestore() {
    if (!window.db) {
        const stored = localStorage.getItem('weaponPriceCatalog');
        priceCatalogCache = stored ? JSON.parse(stored) : [];
        return priceCatalogCache;
    }
    try {
        const snapshot = await window.firebaseGetDocs(
            window.firebaseCollection(window.db, PRICE_CATALOG_COLLECTION)
        );
        priceCatalogCache = [];
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            priceCatalogCache.push({
                id: docSnap.id,
                name: data.name || '',
                salePricePropre: parseFloat(data.salePricePropre) || 0,
                salePriceSale: parseFloat(data.salePriceSale) || 0,
                purchasePricePropre: parseFloat(data.purchasePricePropre) || 0,
                purchasePriceSale: parseFloat(data.purchasePriceSale) || 0
            });
        });
        priceCatalogCache.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
        return priceCatalogCache;
    } catch (error) {
        console.error('[PRIX] Erreur chargement catalogue:', error);
        return priceCatalogCache;
    }
}

function getPriceCatalogMap() {
    const map = {};
    priceCatalogCache.forEach((entry) => {
        map[normalizeWeaponName(entry.name)] = entry;
    });
    return map;
}

function getCatalogEntryForName(name) {
    return getPriceCatalogMap()[normalizeWeaponName(name)] || null;
}

function resolveDualPrices(weaponGroup) {
    const catalog = getCatalogEntryForName(weaponGroup.name);
    let propre = weaponGroup.salePricePropre ?? null;
    let sale = weaponGroup.salePriceSale ?? null;

    if (weaponGroup.instances) {
        weaponGroup.instances.forEach((inst) => {
            if (inst.salePricePropre > 0) propre = inst.salePricePropre;
            if (inst.salePriceSale > 0) sale = inst.salePriceSale;
            const mt = inst.moneyType || 'propre';
            if (mt === 'propre' && inst.salePrice > 0 && !propre) propre = inst.salePrice;
            if (mt === 'sale' && inst.salePrice > 0 && !sale) sale = inst.salePrice;
        });
    }

    if (catalog) {
        if (catalog.salePricePropre > 0) propre = catalog.salePricePropre;
        if (catalog.salePriceSale > 0) sale = catalog.salePriceSale;
    }

    return {
        propre: propre != null && !isNaN(propre) && propre > 0 ? propre : null,
        sale: sale != null && !isNaN(sale) && sale > 0 ? sale : null
    };
}

/** Enregistre les deux prix de vente dans le catalogue (référence affichage) */
async function upsertCatalogPricesForWeapon(name, salePropre, saleSale, purchasePropre, purchaseSale) {
    if (!name) return;
    const data = {
        name,
        salePricePropre: parseFloat(salePropre) || 0,
        salePriceSale: parseFloat(saleSale) || 0,
        purchasePricePropre: parseFloat(purchasePropre) || 0,
        purchasePriceSale: parseFloat(purchaseSale) || 0
    };
    await loadPriceCatalogFromFirestore();
    const existing = getCatalogEntryForName(name);
    if (window.db) {
        if (existing?.id) {
            await window.firebaseUpdateDoc(
                window.firebaseDoc(window.db, PRICE_CATALOG_COLLECTION, existing.id),
                data
            );
        } else if (data.salePricePropre > 0 || data.salePriceSale > 0) {
            await window.firebaseAddDoc(
                window.firebaseCollection(window.db, PRICE_CATALOG_COLLECTION),
                data
            );
        }
    } else {
        if (existing) {
            Object.assign(existing, data);
        } else {
            priceCatalogCache.push({ id: Date.now().toString(36), ...data });
        }
        localStorage.setItem('weaponPriceCatalog', JSON.stringify(priceCatalogCache));
    }
    await loadPriceCatalogFromFirestore();
}

function getReferencePricesForName(name) {
    const catalog = getCatalogEntryForName(name);
    if (!catalog) return { propre: null, sale: null };
    return {
        propre: catalog.salePricePropre > 0 ? catalog.salePricePropre : null,
        sale: catalog.salePriceSale > 0 ? catalog.salePriceSale : null
    };
}

function renderDualPricesHTML(prices, compact) {
    const fmt = compact ? formatCompactNumber : (n) => formatNumberWithSpaces(Math.round(n));
    const fmtFull = (n) => formatNumberWithSpaces(Math.round(n));
    const row = (label, value, cssClass) => {
        if (value != null && value > 0) {
            const v = fmt(value);
            return `
            <div class="price-row">
                <span class="price-label">${label}:</span>
                <span class="price-value sale-price ${cssClass}" title="${fmtFull(value)} €">${v} €</span>
            </div>`;
        }
        return `
            <div class="price-row price-row-missing">
                <span class="price-label">${label}:</span>
                <span class="price-value price-unset">—</span>
            </div>`;
    };
    return row('Propre', prices.propre, 'clean-price') + row('Sale', prices.sale, 'dirty-price');
}

function groupWeaponsByName(weapons, onlyInStock) {
    const grouped = {};
    weapons.forEach((weapon) => {
        const quantity = parseInt(weapon.quantity) || 0;
        if (onlyInStock && quantity <= 0) return;
        const name = weapon.name;
        if (!grouped[name]) {
            grouped[name] = {
                name,
                totalQuantity: 0,
                qtyPropre: 0,
                qtySale: 0,
                salePricePropre: null,
                salePriceSale: null,
                instances: []
            };
        }
        const g = grouped[name];
        g.totalQuantity += quantity;
        const mt = weapon.moneyType || 'propre';
        if (weapon.salePricePropre > 0) g.salePricePropre = parseFloat(weapon.salePricePropre);
        if (weapon.salePriceSale > 0) g.salePriceSale = parseFloat(weapon.salePriceSale);
        if (mt === 'sale') {
            g.qtySale += quantity;
            if (!g.salePriceSale) g.salePriceSale = parseFloat(weapon.salePrice);
        } else {
            g.qtyPropre += quantity;
            if (!g.salePricePropre) g.salePricePropre = parseFloat(weapon.salePrice);
        }
        g.instances.push(weapon);
    });
    return grouped;
}

async function refreshPriceCatalogCache() {
    await loadPriceCatalogFromFirestore();
}

function buildInfoBubblePricesHTML() {
    const grouped = groupWeaponsByName(
        typeof getWeapons === 'function' ? getWeapons() : [],
        true
    );
    const names = Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'fr'));
    if (names.length === 0) {
        return '<p class="info-prices-empty">Aucun stock disponible.</p>';
    }
    let html = '<div class="info-prices-list">';
    names.forEach((name) => {
        const g = grouped[name];
        const prices = resolveDualPrices(g);
        const qty = g.totalQuantity || 0;
        html += `<div class="info-price-item"><strong>${name}</strong><span class="info-qty">Quantité ${formatNumberWithSpaces(qty)}</span>${renderDualPricesHTML(prices, false)}</div>`;
    });
    html += '</div>';
    return html;
}

async function loadAdminPriceInfoTab() {
    const container = document.getElementById('admin-prices-list');
    if (!container) return;
    await loadPriceCatalogFromFirestore();
    container.innerHTML = '';
    if (priceCatalogCache.length === 0) {
        container.innerHTML =
            '<p class="admin-prices-empty">Aucune entrée. Ajoutez une arme ci-dessus (référence uniquement, sans impact sur le stock).</p>';
        return;
    }
    priceCatalogCache.forEach((entry) => {
        container.appendChild(createCatalogListItem(entry));
    });
}

function createCatalogListItem(entry) {
    const item = document.createElement('div');
    item.className = 'admin-catalog-item';
    const propre = formatNumberWithSpaces(Math.round(entry.salePricePropre || 0));
    const sale = formatNumberWithSpaces(Math.round(entry.salePriceSale || 0));
    const achatP = formatNumberWithSpaces(Math.round(entry.purchasePricePropre || 0));
    const achatS = formatNumberWithSpaces(Math.round(entry.purchasePriceSale || 0));
    const nameEsc = entry.name.replace(/'/g, "\\'");
    item.innerHTML = `
        <div class="admin-catalog-info">
            <h4>${entry.name}</h4>
            <div class="admin-catalog-prices">
                <span>✅ Vente propre: <strong>${propre} €</strong></span>
                <span>💀 Vente sale: <strong>${sale} €</strong></span>
                <span class="catalog-achat">Achat propre: ${achatP} € · Achat sale: ${achatS} €</span>
            </div>
        </div>
        <div class="admin-catalog-actions">
            <button type="button" class="btn-edit" onclick="editCatalogEntry('${entry.id}')">Modifier</button>
            <button type="button" class="btn-delete" onclick="deleteCatalogEntry('${entry.id}')">Supprimer</button>
        </div>`;
    return item;
}

let editingCatalogId = null;

function resetCatalogForm() {
    const form = document.getElementById('catalog-price-form');
    if (!form) return;
    form.reset();
    editingCatalogId = null;
    const title = document.getElementById('catalog-form-title');
    const submit = document.getElementById('catalog-submit-btn');
    const cancel = document.getElementById('catalog-cancel-btn');
    if (title) title.textContent = 'Ajouter une référence prix';
    if (submit) submit.textContent = 'Ajouter';
    if (cancel) cancel.style.display = 'none';
}

function editCatalogEntry(id) {
    const entry = priceCatalogCache.find((e) => e.id === id);
    if (!entry) return;
    editingCatalogId = id;
    document.getElementById('catalog-weapon-name').value = entry.name;
    document.getElementById('catalog-sale-propre').value = formatNumberWithSpaces(
        Math.round(entry.salePricePropre || 0)
    );
    document.getElementById('catalog-sale-sale').value = formatNumberWithSpaces(
        Math.round(entry.salePriceSale || 0)
    );
    document.getElementById('catalog-purchase-propre').value = formatNumberWithSpaces(
        Math.round(entry.purchasePricePropre || 0)
    );
    document.getElementById('catalog-purchase-sale').value = formatNumberWithSpaces(
        Math.round(entry.purchasePriceSale || 0)
    );
    document.getElementById('catalog-form-title').textContent = 'Modifier la référence';
    document.getElementById('catalog-submit-btn').textContent = 'Enregistrer';
    document.getElementById('catalog-cancel-btn').style.display = 'inline-block';
    document.querySelector('.admin-prices-form-section')?.scrollIntoView({ behavior: 'smooth' });
}

async function saveCatalogEntry(e) {
    e.preventDefault();
    const name = document.getElementById('catalog-weapon-name').value.trim();
    const salePropre = parseFloat(
        document.getElementById('catalog-sale-propre').value.replace(/\s/g, '')
    );
    const saleSale = parseFloat(
        document.getElementById('catalog-sale-sale').value.replace(/\s/g, '')
    );
    const purchasePropre = parseFloat(
        document.getElementById('catalog-purchase-propre').value.replace(/\s/g, '') || 0
    );
    const purchaseSale = parseFloat(
        document.getElementById('catalog-purchase-sale').value.replace(/\s/g, '') || 0
    );
    if (!name) {
        alert('Nom requis');
        return;
    }
    if (isNaN(salePropre) || isNaN(saleSale)) {
        alert('Prix de vente propre et sale requis');
        return;
    }
    const data = {
        name,
        salePricePropre: salePropre,
        salePriceSale: saleSale,
        purchasePricePropre: purchasePropre || 0,
        purchasePriceSale: purchaseSale || 0
    };
    try {
        if (window.db) {
            if (editingCatalogId) {
                await window.firebaseUpdateDoc(
                    window.firebaseDoc(window.db, PRICE_CATALOG_COLLECTION, editingCatalogId),
                    data
                );
            } else {
                await window.firebaseAddDoc(
                    window.firebaseCollection(window.db, PRICE_CATALOG_COLLECTION),
                    data
                );
            }
        } else {
            if (editingCatalogId) {
                const idx = priceCatalogCache.findIndex((x) => x.id === editingCatalogId);
                if (idx !== -1) priceCatalogCache[idx] = { id: editingCatalogId, ...data };
            } else {
                priceCatalogCache.push({ id: Date.now().toString(36), ...data });
            }
            localStorage.setItem('weaponPriceCatalog', JSON.stringify(priceCatalogCache));
        }
        await loadPriceCatalogFromFirestore();
        resetCatalogForm();
        await loadAdminPriceInfoTab();
        if (typeof loadInventory === 'function') await loadInventory();
        if (typeof updateInfoBubbleText === 'function') await updateInfoBubbleText();
        showNotification('Référence prix enregistrée', 'success');
    } catch (err) {
        console.error('[PRIX] Sauvegarde catalogue:', err);
        alert('Erreur lors de la sauvegarde');
    }
}

async function deleteCatalogEntry(id) {
    if (!confirm('Supprimer cette référence prix ?')) return;
    try {
        if (window.db) {
            await window.firebaseDeleteDoc(
                window.firebaseDoc(window.db, PRICE_CATALOG_COLLECTION, id)
            );
        } else {
            priceCatalogCache = priceCatalogCache.filter((e) => e.id !== id);
            localStorage.setItem('weaponPriceCatalog', JSON.stringify(priceCatalogCache));
        }
        await loadPriceCatalogFromFirestore();
        await loadAdminPriceInfoTab();
        if (typeof loadInventory === 'function') await loadInventory();
        if (typeof updateInfoBubbleText === 'function') await updateInfoBubbleText();
    } catch (err) {
        console.error('[PRIX] Suppression:', err);
        alert('Erreur suppression');
    }
}

async function syncStockFromCatalog() {
    await loadPriceCatalogFromFirestore();
    if (priceCatalogCache.length === 0) {
        alert('Aucun prix de référence configuré');
        return;
    }
    const weapons = typeof getWeapons === 'function' ? getWeapons() : [];
    if (weapons.length === 0) {
        alert('Aucune arme en stock');
        return;
    }
    if (
        !confirm(
            'Appliquer les prix de référence sur toutes les armes du stock correspondantes ?'
        )
    ) {
        return;
    }
    let updated = 0;
    for (const entry of priceCatalogCache) {
        const matching = weapons.filter(
            (w) => normalizeWeaponName(w.name) === normalizeWeaponName(entry.name)
        );
        for (const w of matching) {
            const mt = w.moneyType || 'propre';
            const purchasePrice =
                mt === 'sale' ? entry.purchasePriceSale : entry.purchasePricePropre;
            const salePrice = mt === 'sale' ? entry.salePriceSale : entry.salePricePropre;
            if (window.db && w.id) {
                await window.firebaseUpdateDoc(
                    window.firebaseDoc(window.db, 'weapons', w.id),
                    {
                        purchasePrice,
                        salePrice,
                        salePricePropre: entry.salePricePropre,
                        salePriceSale: entry.salePriceSale
                    }
                );
                updated++;
            }
        }
    }
    if (typeof loadWeaponsFromFirestore === 'function') await loadWeaponsFromFirestore();
    if (typeof loadInventory === 'function') await loadInventory();
    if (typeof loadAdminWeaponsList === 'function') await loadAdminWeaponsList();
    if (typeof refreshAnnoncePreview === 'function') await refreshAnnoncePreview();
    showNotification(`${updated} entrée(s) de stock mises à jour`, 'success');
}

function setupCatalogPriceInputs() {
    const ids = [
        'catalog-sale-propre',
        'catalog-sale-sale',
        'catalog-purchase-propre',
        'catalog-purchase-sale'
    ];
    ids.forEach((inputId) => {
        const input = document.getElementById(inputId);
        if (!input) return;
        input.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\s/g, '').replace(/[^0-9.]/g, '');
        });
        input.addEventListener('blur', (e) => {
            const value = e.target.value.replace(/\s/g, '');
            if (value && !isNaN(value)) {
                e.target.value = formatNumberWithSpaces(parseFloat(value));
            }
        });
    });
}

function setupPriceCatalogListeners() {
    if (!window.db || window.priceCatalogListenerSetup) return;
    window.priceCatalogListenerSetup = true;
    if (!window.firebaseOnSnapshot) return;
    window.firebaseOnSnapshot(
        window.firebaseCollection(window.db, PRICE_CATALOG_COLLECTION),
        async () => {
            await loadPriceCatalogFromFirestore();
            if (document.getElementById('admin-tab-prices')?.classList.contains('active')) {
                await loadAdminPriceInfoTab();
            }
            if (typeof loadInventory === 'function') await loadInventory();
            if (typeof updateInfoBubbleText === 'function') await updateInfoBubbleText();
        }
    );
}

function initWeaponPricesModule() {
    const form = document.getElementById('catalog-price-form');
    if (form) {
        form.addEventListener('submit', saveCatalogEntry);
    }
    const cancel = document.getElementById('catalog-cancel-btn');
    if (cancel) cancel.addEventListener('click', resetCatalogForm);
    const syncBtn = document.getElementById('btn-sync-stock-from-catalog');
    if (syncBtn) syncBtn.addEventListener('click', syncStockFromCatalog);
    const refreshBtn = document.getElementById('btn-refresh-catalog');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            await loadPriceCatalogFromFirestore();
            await loadAdminPriceInfoTab();
            showNotification('Catalogue rafraîchi', 'success');
        });
    }
    setupCatalogPriceInputs();
}

document.addEventListener('DOMContentLoaded', initWeaponPricesModule);

window.loadPriceCatalogFromFirestore = loadPriceCatalogFromFirestore;
window.getPriceCatalogMap = getPriceCatalogMap;
window.resolveDualPrices = resolveDualPrices;
window.renderDualPricesHTML = renderDualPricesHTML;
window.groupWeaponsByName = groupWeaponsByName;
window.loadAdminPriceInfoTab = loadAdminPriceInfoTab;
window.editCatalogEntry = editCatalogEntry;
window.deleteCatalogEntry = deleteCatalogEntry;
window.buildInfoBubblePricesHTML = buildInfoBubblePricesHTML;
window.setupPriceCatalogListeners = setupPriceCatalogListeners;
window.syncStockFromCatalog = syncStockFromCatalog;
window.getReferencePricesForName = getReferencePricesForName;
window.getCatalogEntryForName = getCatalogEntryForName;
window.upsertCatalogPricesForWeapon = upsertCatalogPricesForWeapon;
