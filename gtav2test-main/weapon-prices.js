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
    const propre =
        weaponGroup.salePricePropre ??
        (catalog ? catalog.salePricePropre : null);
    const sale =
        weaponGroup.salePriceSale ??
        (catalog ? catalog.salePriceSale : null);
    return {
        propre: propre != null && !isNaN(propre) ? propre : null,
        sale: sale != null && !isNaN(sale) ? sale : null
    };
}

function renderDualPricesHTML(prices, compact) {
    const fmt = compact ? formatCompactNumber : (n) => formatNumberWithSpaces(Math.round(n));
    const fmtFull = (n) => formatNumberWithSpaces(Math.round(n));
    let html = '';
    if (prices.propre != null) {
        const v = fmt(prices.propre);
        html += `
            <div class="price-row">
                <span class="price-label">✅ Propre:</span>
                <span class="price-value sale-price clean-price" title="${fmtFull(prices.propre)} €">${v} €</span>
            </div>`;
    }
    if (prices.sale != null) {
        const v = fmt(prices.sale);
        html += `
            <div class="price-row">
                <span class="price-label">💀 Sale:</span>
                <span class="price-value sale-price dirty-price" title="${fmtFull(prices.sale)} €">${v} €</span>
            </div>`;
    }
    if (!html) {
        html = `<div class="price-row"><span class="price-label">Prix:</span><span class="price-value">—</span></div>`;
    }
    return html;
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
        if (mt === 'sale') {
            g.qtySale += quantity;
            g.salePriceSale = parseFloat(weapon.salePrice);
        } else {
            g.qtyPropre += quantity;
            g.salePricePropre = parseFloat(weapon.salePrice);
        }
        g.instances.push(weapon);
    });
    return grouped;
}

async function refreshPriceCatalogCache() {
    await loadPriceCatalogFromFirestore();
}

function buildInfoBubblePricesHTML() {
    if (priceCatalogCache.length === 0) {
        const grouped = groupWeaponsByName(
            typeof getWeapons === 'function' ? getWeapons() : [],
            false
        );
        const names = Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'fr'));
        if (names.length === 0) {
            return '<p class="info-prices-empty">Aucun prix configuré.</p>';
        }
        let html = '<div class="info-prices-list">';
        names.forEach((name) => {
            const prices = resolveDualPrices(grouped[name]);
            html += `<div class="info-price-item"><strong>${name}</strong>${renderDualPricesHTML(prices, false)}</div>`;
        });
        html += '</div>';
        return html;
    }
    let html = '<div class="info-prices-list">';
    priceCatalogCache.forEach((entry) => {
        const prices = {
            propre: entry.salePricePropre || null,
            sale: entry.salePriceSale || null
        };
        if (prices.propre == null && prices.sale == null) return;
        html += `<div class="info-price-item"><strong>${entry.name}</strong>${renderDualPricesHTML(prices, false)}</div>`;
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

async function importCatalogFromStock() {
    const weapons = typeof getWeapons === 'function' ? getWeapons() : [];
    const grouped = groupWeaponsByName(weapons, false);
    const names = Object.keys(grouped);
    if (names.length === 0) {
        alert('Aucune arme en base');
        return;
    }
    if (!confirm(`Importer / mettre à jour ${names.length} arme(s) depuis le stock ?`)) return;
    await loadPriceCatalogFromFirestore();
    const map = getPriceCatalogMap();
    for (const name of names) {
        const g = grouped[name];
        const existing = map[normalizeWeaponName(name)];
        const data = {
            name,
            salePricePropre: g.salePricePropre ?? existing?.salePricePropre ?? 0,
            salePriceSale: g.salePriceSale ?? existing?.salePriceSale ?? 0,
            purchasePricePropre: existing?.purchasePricePropre ?? 0,
            purchasePriceSale: existing?.purchasePriceSale ?? 0
        };
        if (window.db) {
            if (existing?.id) {
                await window.firebaseUpdateDoc(
                    window.firebaseDoc(window.db, PRICE_CATALOG_COLLECTION, existing.id),
                    data
                );
            } else {
                await window.firebaseAddDoc(
                    window.firebaseCollection(window.db, PRICE_CATALOG_COLLECTION),
                    data
                );
            }
        }
    }
    await loadPriceCatalogFromFirestore();
    await loadAdminPriceInfoTab();
    showNotification('Import terminé', 'success');
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
    const importBtn = document.getElementById('btn-import-catalog-stock');
    if (importBtn) importBtn.addEventListener('click', importCatalogFromStock);
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
