// Participation + Annonces IG
const PARTICIPATIONS_COLLECTION = 'participations';
let participationsCache = [];

function formatAnnoncePrice(number) {
    if (number == null || isNaN(number) || number <= 0) return null;
    if (number >= 1000000) {
        return (number / 1000000).toFixed(1).replace(/\.0$/, '').replace('.', ',') + 'M';
    }
    if (number >= 1000) {
        return (number / 1000).toFixed(1).replace(/\.0$/, '').replace('.', ',') + 'K';
    }
    return formatNumberWithSpaces(Math.round(number));
}

async function loadParticipations() {
    if (!window.db) {
        const stored = localStorage.getItem('participations');
        participationsCache = stored ? JSON.parse(stored) : [];
        return participationsCache;
    }
    try {
        const snapshot = await window.firebaseGetDocs(
            window.firebaseCollection(window.db, PARTICIPATIONS_COLLECTION)
        );
        participationsCache = [];
        snapshot.forEach((docSnap) => {
            const d = docSnap.data();
            participationsCache.push({
                id: docSnap.id,
                personName: d.personName || '',
                amount: parseFloat(d.amount) || 0,
                note: d.note || ''
            });
        });
        participationsCache.sort((a, b) => a.personName.localeCompare(b.personName, 'fr'));
        return participationsCache;
    } catch (e) {
        console.error('[PARTICIPATION]', e);
        return participationsCache;
    }
}

function renderParticipationPanel() {
    const list = document.getElementById('participation-list');
    const totalEl = document.getElementById('participation-total');
    if (!list) return;
    list.innerHTML = '';
    let total = 0;
    if (participationsCache.length === 0) {
        list.innerHTML = '<p class="participation-empty">Aucune participation</p>';
    } else {
        participationsCache.forEach((p) => {
            total += p.amount;
            list.appendChild(createParticipationItem(p));
        });
    }
    if (totalEl) {
        totalEl.textContent = 'Total: ' + formatNumberWithSpaces(Math.round(total)) + ' €';
    }
}

function createParticipationItem(p) {
    const div = document.createElement('div');
    div.className = 'participation-item';
    div.dataset.id = p.id;
    const nameEsc = (p.personName || '').replace(/'/g, "\\'");
    div.innerHTML = `
        <div class="participation-display">
            <strong class="part-name">${p.personName}</strong>
            <span class="part-amount">${formatNumberWithSpaces(Math.round(p.amount))} €</span>
            ${p.note ? `<span class="part-note">${p.note}</span>` : ''}
        </div>
        <div class="participation-actions">
            <button type="button" class="btn-edit btn-edit-part" onclick="editParticipation('${p.id}')">✏️</button>
            <button type="button" class="btn-delete" onclick="deleteParticipation('${p.id}')">×</button>
        </div>`;
    return div;
}

let editingParticipationId = null;

async function saveParticipation(e) {
    e.preventDefault();
    const personName = document.getElementById('part-person-name').value.trim();
    const amountRaw = document.getElementById('part-amount').value.replace(/\s/g, '');
    const amount = parseFloat(amountRaw);
    const note = document.getElementById('part-note').value.trim();
    if (!personName || isNaN(amount)) {
        alert('Nom et montant requis');
        return;
    }
    const data = { personName, amount, note };
    try {
        if (window.db) {
            if (editingParticipationId) {
                await window.firebaseUpdateDoc(
                    window.firebaseDoc(window.db, PARTICIPATIONS_COLLECTION, editingParticipationId),
                    data
                );
            } else {
                await window.firebaseAddDoc(
                    window.firebaseCollection(window.db, PARTICIPATIONS_COLLECTION),
                    data
                );
            }
        } else {
            if (editingParticipationId) {
                const idx = participationsCache.findIndex((x) => x.id === editingParticipationId);
                if (idx !== -1) participationsCache[idx] = { id: editingParticipationId, ...data };
            } else {
                participationsCache.push({ id: Date.now().toString(36), ...data });
            }
            localStorage.setItem('participations', JSON.stringify(participationsCache));
        }
        resetParticipationForm();
        await loadParticipations();
        renderParticipationPanel();
        showNotification('Participation enregistrée', 'success');
    } catch (err) {
        console.error(err);
        alert('Erreur sauvegarde');
    }
}

function editParticipation(id) {
    const p = participationsCache.find((x) => x.id === id);
    if (!p) return;
    editingParticipationId = id;
    document.getElementById('part-person-name').value = p.personName;
    document.getElementById('part-amount').value = formatNumberWithSpaces(Math.round(p.amount));
    document.getElementById('part-note').value = p.note || '';
    document.getElementById('part-submit-btn').textContent = 'Modifier';
    document.getElementById('part-cancel-btn').style.display = 'inline-block';
}

function resetParticipationForm() {
    const form = document.getElementById('participation-form');
    if (form) form.reset();
    editingParticipationId = null;
    const submit = document.getElementById('part-submit-btn');
    const cancel = document.getElementById('part-cancel-btn');
    if (submit) submit.textContent = 'Ajouter';
    if (cancel) cancel.style.display = 'none';
}

async function deleteParticipation(id) {
    if (!confirm('Supprimer cette participation ?')) return;
    try {
        if (window.db) {
            await window.firebaseDeleteDoc(
                window.firebaseDoc(window.db, PARTICIPATIONS_COLLECTION, id)
            );
        } else {
            participationsCache = participationsCache.filter((p) => p.id !== id);
            localStorage.setItem('participations', JSON.stringify(participationsCache));
        }
        await loadParticipations();
        renderParticipationPanel();
    } catch (e) {
        alert('Erreur suppression');
    }
}

function buildAnnonceDescription() {
    const weapons =
        typeof getWeapons === 'function' ? getWeapons() : [];
    const grouped =
        typeof groupWeaponsByName === 'function'
            ? groupWeaponsByName(weapons, true)
            : {};
    const lines = [];
    Object.values(grouped)
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
        .forEach((g) => {
            const prices =
                typeof resolveDualPrices === 'function' ? resolveDualPrices(g) : {};
            const pPropre = formatAnnoncePrice(prices.propre ?? g.salePricePropre);
            const pSale = formatAnnoncePrice(prices.sale ?? g.salePriceSale);
            if (pPropre && pSale) {
                lines.push(`${g.name} ${pPropre}/${pSale} sale`);
            } else if (pSale) {
                lines.push(`${g.name} ${pSale} sale`);
            } else if (pPropre) {
                lines.push(`${g.name} ${pPropre} propre`);
            }
        });
    return lines.join('\n');
}

async function refreshAnnoncePreview() {
    if (typeof loadPriceCatalogFromFirestore === 'function') {
        await loadPriceCatalogFromFirestore();
    }
    const titleInput = document.getElementById('annonce-title');
    const descArea = document.getElementById('annonce-description');
    if (!descArea) return;
    if (titleInput && !titleInput.dataset.userEdited) {
        titleInput.value = '-GFR- Vente Arme -GFR-';
    }
    descArea.value = buildAnnonceDescription();
}

async function loadAnnonceTab() {
    await refreshAnnoncePreview();
}

function copyAnnonceToClipboard() {
    const title = document.getElementById('annonce-title')?.value || '';
    const desc = document.getElementById('annonce-description')?.value || '';
    const text = title + '\n\n' + desc;
    navigator.clipboard
        .writeText(text)
        .then(() => showNotification('Annonce copiée !', 'success'))
        .catch(() => {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            showNotification('Annonce copiée !', 'success');
        });
}

function setupParticipationListeners() {
    if (!window.db || window.participationListenerSetup) return;
    window.participationListenerSetup = true;
    window.firebaseOnSnapshot(
        window.firebaseCollection(window.db, PARTICIPATIONS_COLLECTION),
        async () => {
            await loadParticipations();
            renderParticipationPanel();
        }
    );
}

function initAdminPanelModule() {
    const partForm = document.getElementById('participation-form');
    if (partForm) partForm.addEventListener('submit', saveParticipation);
    const partCancel = document.getElementById('part-cancel-btn');
    if (partCancel) partCancel.addEventListener('click', resetParticipationForm);

    const annonceTitle = document.getElementById('annonce-title');
    if (annonceTitle) {
        annonceTitle.addEventListener('input', () => {
            annonceTitle.dataset.userEdited = '1';
        });
    }
    const btnRefreshAnnonce = document.getElementById('btn-refresh-annonce');
    if (btnRefreshAnnonce) btnRefreshAnnonce.addEventListener('click', refreshAnnoncePreview);
    const btnCopyAnnonce = document.getElementById('btn-copy-annonce');
    if (btnCopyAnnonce) btnCopyAnnonce.addEventListener('click', copyAnnonceToClipboard);

}

document.addEventListener('DOMContentLoaded', initAdminPanelModule);

window.loadParticipations = loadParticipations;
window.renderParticipationPanel = renderParticipationPanel;
window.editParticipation = editParticipation;
window.deleteParticipation = deleteParticipation;
window.loadAnnonceTab = loadAnnonceTab;
window.refreshAnnoncePreview = refreshAnnoncePreview;
window.setupParticipationListeners = setupParticipationListeners;
