import { api, openFile } from '../api.js';
import { state, rerender } from '../state.js';
import { h, modal, fmt, rupees, badge, table, toast, field } from '../ui.js';
import { shell } from './shell.js';

/** Full-screen lightbox (shared) */
function lightbox(src, alt) {
  const ov = h('div', {
    style: 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;cursor:zoom-out',
    onclick: () => ov.remove(),
  },
    h('img', { src, alt, style: 'max-width:95vw;max-height:92vh;object-fit:contain;border-radius:6px;box-shadow:0 0 60px rgba(0,0,0,0.8)' }),
    h('button', {
      style: 'position:absolute;top:16px;right:20px;background:none;border:none;color:#fff;font-size:2rem;cursor:pointer;line-height:1',
      onclick: () => ov.remove(),
    }, '×'),
  );
  document.body.append(ov);
}

function lbImg(src, alt) {
  return h('img', {
    src, alt,
    style: 'max-height:180px;border-radius:8px;object-fit:contain;border:1px solid var(--line);cursor:zoom-in;transition:transform .15s',
    onclick: () => lightbox(src, alt),
    onmouseenter: (e) => { e.target.style.transform = 'scale(1.04)'; },
    onmouseleave: (e) => { e.target.style.transform = ''; },
  });
}

export async function studentView() {
  const body = h('div');
  let tab = 'catalog';
  let activeViewCleanup = null;
  const tabs = h('div', { class: 'tabs' });


  const draw = async () => {
    if (activeViewCleanup) { activeViewCleanup(); activeViewCleanup = null; }
    tabs.replaceChildren(...[
      ['catalog', 'Lab catalogue'],
      ['requests', 'My Requests'],
      ['mine', 'My issues & fines'],
      ['profile', '👤 My Profile']
    ].map(([k, t]) =>
      h('button', { class: `tab${tab === k ? ' on' : ''}`, onclick: () => { tab = k; draw(); } }, t)));


    if (tab === 'catalog') {
      body.replaceChildren(await catalog(onSwitchToRequests));
    } else if (tab === 'requests') {
      const res = await myRequests(onSwitchToRequests);
      if (res?.cleanup) activeViewCleanup = res.cleanup;
      body.replaceChildren(res?.el || res);
    } else if (tab === 'mine') {
      body.replaceChildren(await myIssues());
    } else if (tab === 'profile') {
      body.replaceChildren(await myProfile());
    }
  };

  const onSwitchToRequests = () => { tab = 'requests'; draw(); };
  await draw();

  const exitBtn = h('button', {
    type: 'button',
    class: 'btn ghost sm',
    style: 'font-weight:600;display:inline-flex;align-items:center;gap:6px;border-radius:8px;',
    title: 'Return to portal chooser / Sign out',
    onclick: async () => {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
      sessionStorage.removeItem('scet_auth_token');
      sessionStorage.removeItem('scet_branch_token');
      localStorage.removeItem('scet_auth_token');
      localStorage.removeItem('scet_branch_token');
      state.user = state.branch = null;
      rerender();
    }
  }, '← Portals (Sign out)');

  const navRow = h('div', {
    style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px'
  },
    tabs,
    exitBtn
  );

  const shellEl = shell('Student portal', navRow, body);
  return {
    el: shellEl,
    dispose: () => { if (activeViewCleanup) activeViewCleanup(); },
  };
}

async function catalog(onSwitchToRequests) {
  const branches = await api('/api/catalog/branches');
  if (!branches.length) return h('p', { class: 'muted' }, 'No departments have been registered by faculty yet.');
  const sel = h('select', {}, branches.map((b) => h('option', { value: b.code }, `${b.code} — ${b.name}`)));
  const q = h('input', { placeholder: 'Search by code, name or category…' });
  const stats = h('div', { class: 'stats' }), grid = h('div', { class: 'grid' });

  const load = async () => {
    const [s, rows] = await Promise.all([api(`/api/catalog/${sel.value}/stats`), api(`/api/catalog/${sel.value}/components?q=${encodeURIComponent(q.value)}`)]);
    stats.replaceChildren(...[['Item types', s.totalItems], ['Total units', s.totalQty], ['Currently issued', s.totalIssued], ['Overdue', s.totalOverdue]]
      .map(([l, v]) => h('div', { class: 'stat' }, h('b', {}, v), l)));
    grid.replaceChildren(...rows.map((c) => {
      const ph = h('div', { class: 'ph' }, c.imageCount ? '' : c.category);
      if (c.imageCount) api(`/api/catalog/${sel.value}/components/${c.compId}/images`).then((im) => { if (im[0]) { ph.style.backgroundImage = `url(${im[0]})`; } });
      return h('div', { class: 'card comp', onclick: () => detail(sel.value, c, onSwitchToRequests) }, ph,
        h('div', { class: 'bd' }, h('b', {}, c.name), h('div', { class: 'small muted' }, `${c.compId} · ${c.category}`),
          h('div', { style: 'margin-top:8px;display:flex;justify-content:space-between;align-items:center' },
            badge(c.availableQty > 0 ? `${c.availableQty} of ${c.totalQty} available` : 'Out of stock', c.availableQty > 0 ? 'ok' : 'bad'),
            h('span', { class: 'small', style: 'color:var(--blue);font-weight:700' }, 'Request ➔')
          )));
    }));
    if (!rows.length) grid.append(h('p', { class: 'muted' }, 'No components found.'));
  };
  sel.onchange = load; let t; q.oninput = () => { clearTimeout(t); t = setTimeout(load, 250); };
  load();
  return h('div', {}, h('div', { class: 'row', style: 'margin-bottom:14px' }, h('div', { style: 'width:280px' }, sel), h('div', { class: 'grow' }, q)), stats, grid);
}

async function detail(code, c, onSwitchToRequests) {
  const g = h('div', { class: 'gallery', style: 'display:flex;flex-wrap:wrap;gap:10px' },
    h('p', { class: 'muted' }, c.imageCount ? 'Loading images…' : 'No images uploaded.'));
  if (c.imageCount) api(`/api/catalog/${code}/components/${c.compId}/images`).then((im) =>
    g.replaceChildren(...im.map((s) => lbImg(s, c.name))));

  // Format specs as bullet list
  let specsEl;
  if (c.specifications) {
    const lines = c.specifications
      .split(/[;\n]|(?:,\s*(?=[A-Z]|[a-z]{1,4}[:]))|(?:\.\s+(?=[A-Z]))/)
      .map(s => s.replace(/^[,.\s]+|[,.\s]+$/g, '').trim())
      .filter(s => s.length > 3);
    specsEl = lines.length > 1
      ? h('ul', { style: 'padding-left:18px;margin:4px 0;list-style:disc' }, ...lines.map(l => h('li', { style: 'margin-bottom:3px;line-height:1.5' }, l)))
      : h('p', {}, c.specifications);
  } else {
    specsEl = h('span', { class: 'muted' }, '—');
  }

  modal(c.name, h('div', { class: 'stack' }, g,
    h('div', {}, h('b', {}, 'Code: '), c.compId), h('div', {}, h('b', {}, 'Category: '), c.category),
    h('div', {}, h('b', {}, 'Specifications:')), specsEl,
    h('div', {}, h('b', {}, 'Stock: '), `${c.availableQty} available / ${c.issuedQty} issued / ${c.totalQty} total`)),
    [{
      label: '📩 Request Component',
      cls: 'green',
      run: (close) => {
        close();
        openRequestModal(code, c, onSwitchToRequests);
      }
    }]
  );
}

async function openRequestModal(defaultBranchCode, defaultComp, onSuccess) {
  let branches = [];
  try { branches = await api('/api/catalog/branches'); } catch { /* ignore */ }
  if (!branches.length) { toast('No department catalogues available.', 'err'); return; }

  let currentBranch = defaultBranchCode || branches[0].code;
  let branchComponents = [];

  const branchSel = h('select', { style: 'font-weight:700' },
    branches.map(b => h('option', { value: b.code, selected: b.code === currentBranch }, `${b.code} — ${b.name}`))
  );

  const itemsContainer = h('div', { style: 'display:flex;flex-direction:column;gap:10px;margin-top:8px' });
  const itemsList = [];

  async function loadBranchComps(code) {
    try {
      branchComponents = await api(`/api/catalog/${code}/components`);
    } catch {
      branchComponents = [];
    }
  }

  await loadBranchComps(currentBranch);

  function addItemRow(prefillCompId, prefillQty = 1) {
    const rowEl = h('div', {
      style: 'display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--soft);border:1px solid var(--line);border-radius:8px;flex-wrap:wrap'
    });

    const compSelect = h('select', { style: 'flex:1;min-width:200px' },
      h('option', { value: '' }, '-- Select Component --'),
      ...branchComponents.map(c => h('option', {
        value: c.compId,
        selected: c.compId === prefillCompId
      }, `${c.name} (${c.compId}) — ${c.availableQty > 0 ? c.availableQty + ' available' : 'out of stock'}`))
    );

    const qtyInput = h('input', {
      type: 'number', min: 1, max: 20, value: prefillQty,
      style: 'width:60px;text-align:center;font-weight:700'
    });

    const rowItem = {
      get compId() { return compSelect.value; },
      get qty() { return Math.max(1, parseInt(qtyInput.value, 10) || 1); },
      get compName() {
        const c = branchComponents.find(x => x.compId === compSelect.value);
        return c ? c.name : compSelect.value;
      }
    };
    itemsList.push(rowItem);

    const removeBtn = h('button', {
      class: 'btn danger sm',
      style: 'padding:4px 8px;font-size:0.8em',
      onclick: () => {
        const idx = itemsList.indexOf(rowItem);
        if (idx !== -1) itemsList.splice(idx, 1);
        rowEl.remove();
      }
    }, '✕');

    rowEl.append(
      h('div', { style: 'flex:1;min-width:200px' }, compSelect),
      h('div', { style: 'display:flex;align-items:center;gap:4px' },
        h('span', { class: 'muted small' }, 'Qty:'),
        qtyInput
      ),
      removeBtn
    );
    itemsContainer.append(rowEl);
  }

  // Pre-fill initial item
  if (defaultComp) {
    addItemRow(defaultComp.compId, 1);
  } else {
    addItemRow('', 1);
  }

  branchSel.onchange = async () => {
    currentBranch = branchSel.value;
    await loadBranchComps(currentBranch);
    itemsContainer.replaceChildren();
    itemsList.length = 0;
    addItemRow('', 1);
  };

  const addMoreBtn = h('button', {
    class: 'btn ghost sm',
    style: 'align-self:flex-start;display:inline-flex;align-items:center;gap:4px',
    onclick: () => addItemRow('', 1)
  }, '+ Add Another Component');

  const daysInput = h('input', { type: 'number', min: 1, max: 30, value: 7 });
  const purposeInput = h('textarea', {
    rows: 3,
    placeholder: 'e.g. Microcontroller Lab Project / Sensor Experiment'
  });

  const formBody = h('div', { class: 'stack', style: 'gap:14px' },
    h('div', { class: 'field' },
      h('span', {}, 'Department:'),
      branchSel
    ),
    h('div', { class: 'field' },
      h('span', {}, 'Requested Components:'),
      itemsContainer,
      h('div', { style: 'margin-top:6px' }, addMoreBtn)
    ),
    h('div', { class: 'field' },
      h('span', {}, 'Loan Duration (Days):'),
      daysInput,
      h('span', { class: 'muted small' }, 'Standard duration is 7 days (max 30 days)')
    ),
    h('div', { class: 'field' },
      h('span', {}, 'Purpose / Subject / Project Notes:'),
      purposeInput
    )
  );

  modal('📩 Submit Hardware Request', formBody, [{
    label: 'Submit Request',
    cls: 'green',
    run: async (close) => {
      const branchCode = branchSel.value;
      const validItems = itemsList.filter(it => it.compId && it.qty > 0).map(it => ({
        compId: it.compId,
        compName: it.compName,
        qty: it.qty
      }));

      if (!validItems.length) {
        toast('Please select at least one component with quantity.', 'err');
        return;
      }

      const days = parseInt(daysInput.value, 10) || 7;
      const purpose = purposeInput.value.trim() || 'Academic / Lab Work';

      await api('/api/me/requests', {
        method: 'POST',
        body: { branchCode, items: validItems, days, purpose }
      });

      toast('Hardware request submitted! Lab admin will review and assign collection slot.');
      close();
      if (onSuccess) onSuccess();
    }
  }], true);
}

function viewRequestDetailsModal(r) {
  const items = Array.isArray(r.items) && r.items.length > 0 ? r.items : [{ compId: r.compId, compName: r.compName, qty: r.qty || 1 }];

  const content = h('div', { class: 'stack', style: 'gap:12px' },
    h('div', { style: 'background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:12px' },
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px' },
        h('span', { style: 'font-weight:800;font-size:1.05em' }, `Request #${r.id.slice(-6)}`),
        badge(r.status, r.status === 'ACCEPTED' ? 'ok' : r.status === 'PENDING' ? 'warn' : r.status === 'ISSUED' ? 'info' : 'bad')
      ),
      h('div', { class: 'muted small' }, `Department: ${r.branchCode} · Submitted: ${fmt(r.createdAt)}`)
    ),

    r.collectionTime && h('div', { style: 'background:rgba(5,150,105,0.08);border:1.5px solid var(--green);border-radius:10px;padding:12px' },
      h('div', { style: 'font-weight:800;color:var(--green);font-size:0.95em' }, 'Assigned Collection Slot:'),
      h('div', { style: 'font-size:1.2em;font-weight:800;color:var(--ink);margin:4px 0' }, `🕒 ${r.collectionTime}`),
      r.collectionNote && h('div', { class: 'muted small', style: 'margin-bottom:6px' }, `📍 Location: ${r.collectionNote}`),
      h('div', { style: 'font-size:0.85em;color:var(--green);font-weight:700;display:flex;align-items:center;gap:6px' },
        '🪪 Please bring your College ID card to the lab counter for collection.'
      )
    ),

    h('div', {},
      h('b', {}, 'Requested Components:'),
      h('div', { style: 'display:flex;flex-direction:column;gap:6px;margin-top:6px' },
        ...items.map(it => h('div', {
          style: 'display:flex;justify-content:space-between;padding:8px 10px;background:var(--soft);border:1px solid var(--line);border-radius:6px;font-size:0.9em'
        },
          h('span', { style: 'font-weight:600' }, `${it.compName || it.compId} (${it.compId})`),
          h('span', { class: 'badge sm info' }, `×${it.qty}`)
        ))
      )
    ),

    h('div', { style: 'font-size:0.9em' },
      h('b', {}, 'Loan Duration: '), `${r.days} days`
    ),
    h('div', { style: 'font-size:0.9em' },
      h('b', {}, 'Purpose: '), r.purpose || 'Academic / Lab Work'
    ),
    r.rejectionReason && h('div', { style: 'background:#FEE2E2;border:1px solid var(--red);padding:10px;border-radius:8px;font-size:0.88em;color:var(--red)' },
      h('b', {}, 'Rejection Reason: '), r.rejectionReason
    )
  );

  const actions = [];
  if (r.status === 'ISSUED' && r.issueSeq) {
    actions.push({
      label: '📄 View Gate Pass',
      cls: 'primary',
      run: () => openFile(`/api/me/issues/${r.branchCode}/${r.issueSeq}/gatepass`)
    });
  }
  actions.push({ label: 'Close', run: (close) => close() });

  modal(`Request Details #${r.id.slice(-6)}`, content, actions, true);
}

async function myRequests(refresh) {
  const container = h('div');
  let requests = [];
  let pollTimer = null;
  let activeFilter = 'ALL';
  let searchQuery = '';
  let knownAcceptedIds = new Set();
  let pushInfo = null;

  // Query push and mobile status for display
  api('/api/me/push-status').then(res => {
    pushInfo = res;
    render();
  }).catch(() => {});

  async function loadData(silent = false) {
    try {
      const data = await api('/api/me/requests');
      if (silent && requests.length > 0) {
        // Detect newly accepted requests
        for (const req of data) {
          if (req.status === 'ACCEPTED' && !knownAcceptedIds.has(req.id)) {
            toast(`🎉 Request #${req.id.slice(-6)} has been ACCEPTED! Pickup slot: ${req.collectionTime}`);
            break;
          }
        }
      }

      requests = data;
      knownAcceptedIds = new Set(requests.filter(r => r.status === 'ACCEPTED').map(r => r.id));
      render();
    } catch (e) {
      if (!silent) container.replaceChildren(h('p', { class: 'muted' }, 'Failed to load requests: ' + e.message));
    }
  }


  function renderPickupHero(acceptedRequests) {
    if (!acceptedRequests.length) return null;
    const top = acceptedRequests[0];
    const items = Array.isArray(top.items) && top.items.length > 0 ? top.items : [{ compId: top.compId, compName: top.compName, qty: top.qty || 1 }];
    const itemsText = items.map(it => `${it.qty}× ${it.compName || it.compId}`).join(', ');

    return h('div', { class: 'pickup-hero' },
      h('div', { style: 'flex:1;min-width:260px' },
        h('div', { style: 'display:flex;align-items:center;gap:6px' },
          h('span', { class: 'pulse-dot' }),
          h('span', { style: 'font-weight:800;font-size:0.85em;color:var(--green);letter-spacing:0.04em;text-transform:uppercase' },
            'Hardware Ready for Counter Pickup'
          )
        ),
        h('div', { class: 'pickup-slot-badge' }, `🕒 Slot: ${top.collectionTime}`),
        h('div', { style: 'font-size:0.9em;color:var(--ink);margin-top:8px;font-weight:600' },
          `Department: `, h('span', { class: 'badge sm info' }, top.branchCode), ` · Items: ${itemsText}`
        ),
        top.collectionNote && h('div', { class: 'muted small', style: 'margin-top:4px' }, `📍 ${top.collectionNote}`)
      ),
      h('div', { style: 'display:flex;flex-direction:column;gap:6px;align-items:flex-end;text-align:right' },
        h('div', {
          style: 'background:rgba(5,150,105,0.12);color:var(--green);border:1.5px solid var(--green);font-weight:800;font-size:0.88em;padding:6px 14px;border-radius:20px;display:inline-flex;align-items:center;gap:6px'
        }, '✓ READY AT COUNTER'),
        h('span', { class: 'muted small', style: 'font-size:0.8em;font-weight:600' }, '🪪 Bring College ID to counter')
      )
    );
  }

  function render() {
    const pendingCount = requests.filter(r => r.status === 'PENDING').length;
    const acceptedCount = requests.filter(r => r.status === 'ACCEPTED').length;
    const issuedCount = requests.filter(r => r.status === 'ISSUED').length;
    const rejectedCount = requests.filter(r => r.status === 'REJECTED').length;

    // Filter requests
    let filtered = requests.filter(r => {
      if (activeFilter === 'PENDING') return r.status === 'PENDING';
      if (activeFilter === 'ACCEPTED') return r.status === 'ACCEPTED';
      if (activeFilter === 'ISSUED') return r.status === 'ISSUED';
      if (activeFilter === 'REJECTED') return r.status === 'REJECTED';
      return true;
    });

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(r => {
        const idMatch = r.id && r.id.toLowerCase().includes(q);
        const branchMatch = r.branchCode && r.branchCode.toLowerCase().includes(q);
        const purposeMatch = r.purpose && r.purpose.toLowerCase().includes(q);
        const itemsMatch = Array.isArray(r.items) && r.items.some(it => (it.compName || it.compId || '').toLowerCase().includes(q));
        return idMatch || branchMatch || purposeMatch || itemsMatch;
      });
    }

    const header = h('div', {
      style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px'
    },
      h('div', {},
        h('h3', { style: 'margin:0;font-size:1.35em;font-weight:800;color:var(--ink)' }, 'My Hardware Requests'),
        h('span', { class: 'muted small' }, 'Track components, collection slots & gate passes')
      ),
      h('button', {
        class: 'btn gold',
        style: 'font-weight:700',
        onclick: () => openRequestModal(null, null, () => loadData(false))
      }, '+ New Hardware Request')
    );

    const stats = h('div', { class: 'stats', style: 'margin-bottom:18px' },
      h('div', { class: 'stat', style: 'cursor:pointer', onclick: () => { activeFilter = 'ALL'; render(); } },
        h('b', {}, requests.length), 'Total Requests'
      ),
      h('div', { class: 'stat', style: 'cursor:pointer', onclick: () => { activeFilter = 'PENDING'; render(); } },
        h('b', { style: 'color:var(--gold)' }, pendingCount), 'Pending Review'
      ),
      h('div', { class: 'stat', style: 'cursor:pointer', onclick: () => { activeFilter = 'ACCEPTED'; render(); } },
        h('b', { style: 'color:var(--green)' }, acceptedCount), 'Ready for Pickup'
      ),
      h('div', { class: 'stat', style: 'cursor:pointer', onclick: () => { activeFilter = 'ISSUED'; render(); } },
        h('b', { style: 'color:var(--blue)' }, issuedCount), 'Issued Passes'
      )
    );

    // Filter bar with search
    const filterTabs = [
      ['ALL', `All (${requests.length})`],
      ['PENDING', `⏳ Pending (${pendingCount})`],
      ['ACCEPTED', `✅ Ready / Approved (${acceptedCount})`],
      ['ISSUED', `⚡ Issued (${issuedCount})`],
      ['REJECTED', `❌ Rejected (${rejectedCount})`],
    ];

    const searchInput = h('input', {
      placeholder: 'Search requests by component, ID, purpose…',
      value: searchQuery,
      style: 'max-width:320px;padding:6px 12px;font-size:0.88em',
      oninput: (e) => { searchQuery = e.target.value.trim(); render(); }
    });

    const filterBar = h('div', {
      style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap'
    },
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
        ...filterTabs.map(([key, label]) => h('button', {
          class: `btn sm ${activeFilter === key ? 'primary' : 'ghost'}`,
          style: 'font-weight:700',
          onclick: () => { activeFilter = key; render(); }
        }, label))
      ),
      searchInput
    );

    const acceptedList = requests.filter(r => r.status === 'ACCEPTED');
    const heroCard = renderPickupHero(acceptedList);

    let contentArea;
    if (!requests.length) {
      contentArea = h('div', {
        class: 'card',
        style: 'text-align:center;padding:48px 24px;border:1.5px dashed var(--line);border-radius:14px;background:#fff'
      },
        h('div', { style: 'font-size:2.5em;margin-bottom:12px' }, '📦'),
        h('h4', { style: 'margin:0 0 6px 0;font-weight:700' }, 'No Hardware Requests Yet'),
        h('p', { class: 'muted', style: 'max-width:440px;margin:0 auto 16px auto;font-size:0.92em' },
          'You can request components in advance for lab sessions and student projects. Faculty will assign a collection time slot.'
        ),
        h('button', {
          class: 'btn primary',
          onclick: () => openRequestModal(null, null, () => loadData(false))
        }, 'Create Your First Request')
      );
    } else if (!filtered.length) {
      contentArea = h('div', {
        class: 'card',
        style: 'text-align:center;padding:36px 20px;border:1.5px dashed var(--line);border-radius:12px;background:#fff'
      },
        h('div', { style: 'font-size:2em;margin-bottom:8px' }, '🔍'),
        h('h4', { style: 'margin:0 0 4px 0' }, 'No Matching Requests'),
        h('p', { class: 'muted', style: 'font-size:0.88em;margin:0' }, 'No requests found matching your filter or search criteria.')
      );
    } else {
      const reqHeads = ['Request ID', 'Department', 'Components', 'Duration & Purpose', 'Progress & Collection Slot', 'Actions'];
      const tbody = h('tbody');

      tbody.replaceChildren(...filtered.map(r => {
        const items = Array.isArray(r.items) && r.items.length > 0 ? r.items : [{ compId: r.compId, compName: r.compName, qty: r.qty || 1 }];
        const compSummary = h('div', { style: 'display:flex;flex-direction:column;gap:4px;min-width:160px' },
          ...items.map(it => h('div', { style: 'display:flex;align-items:baseline;gap:5px;flex-wrap:wrap;line-height:1.3' },
            h('span', { style: 'font-weight:600;font-size:0.9em;color:var(--ink)' }, it.compName || it.compId),
            h('span', { class: 'muted', style: 'font-size:0.75em;font-family:monospace' }, `(${it.compId})`),
            h('span', { class: 'badge sm info', style: 'font-size:0.72em;padding:0 5px' }, `×${it.qty}`)
          ))
        );

        // Progress Step Indicators
        const step1 = h('span', { class: 'step-node done' }, '✓ 1. Submitted');
        let step2;
        let step3;

        if (r.status === 'PENDING') {
          step2 = h('span', { class: 'step-node active' }, h('span', { class: 'pulse-dot gold' }), '2. Under Review');
          step3 = h('span', { class: 'step-node' }, '3. Checkout');
        } else if (r.status === 'ACCEPTED') {
          step2 = h('span', { class: 'step-node done' }, `✓ 2. ${r.collectionTime}`);
          step3 = h('span', { class: 'step-node active' }, h('span', { class: 'pulse-dot' }), '3. Ready at Counter');
        } else if (r.status === 'ISSUED') {
          step2 = h('span', { class: 'step-node done' }, '✓ 2. Slot Assigned');
          step3 = h('span', { class: 'step-node done' }, `✓ 3. Issued (${r.gatePassNo || `Pass #${r.issueSeq}`})`);
        } else {
          step2 = h('span', { class: 'step-node', style: 'color:var(--red);border-color:var(--red)' }, '❌ Rejected');
          step3 = h('span', { class: 'step-node' }, '3. Closed');
        }

        const stepTrack = h('div', { class: 'step-track' },
          step1, h('span', { class: 'step-arrow' }, '➔'),
          step2, h('span', { class: 'step-arrow' }, '➔'),
          step3
        );

        let statusCell;
        if (r.status === 'ACCEPTED') {
          statusCell = h('div', {
            style: 'background:rgba(5,150,105,0.08);border:1.5px solid var(--green);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:3px'
          },
            badge('✅ APPROVED / READY FOR PICKUP', 'ok'),
            h('div', { style: 'font-weight:800;font-size:0.95em;color:var(--ink)' }, `🕒 ${r.collectionTime}`),
            r.collectionNote && h('div', { style: 'font-size:0.78em;color:var(--muted)' }, `📍 ${r.collectionNote}`),
            stepTrack
          );
        } else if (r.status === 'PENDING') {
          statusCell = h('div', { style: 'display:flex;flex-direction:column;gap:4px;align-items:flex-start' },
            badge('⏳ AWAITING FACULTY APPROVAL', 'warn'),
            h('span', { class: 'muted small', style: 'font-size:0.75em' }, 'Approval updates will be sent to your registered email'),
            stepTrack
          );
        } else if (r.status === 'ISSUED') {
          statusCell = h('div', { style: 'display:flex;flex-direction:column;gap:4px;align-items:flex-start' },
            badge('⚡ CHECKED OUT / ISSUED', 'ok'),
            h('span', { style: 'font-size:0.85em;font-family:monospace;font-weight:700' }, r.gatePassNo || `Pass #${r.issueSeq}`),
            r.issuedAt && h('span', { class: 'muted small', style: 'font-size:0.72em' }, fmt(r.issuedAt)),
            stepTrack
          );
        } else {
          statusCell = h('div', { style: 'display:flex;flex-direction:column;gap:4px;align-items:flex-start' },
            badge('❌ REJECTED', 'bad'),
            r.rejectionReason && h('span', { class: 'muted small', style: 'font-size:0.75em;color:var(--red)' }, r.rejectionReason),
            stepTrack
          );
        }

        const actionsCell = h('td', { class: 'row', style: 'gap:6px;align-items:center' },
          h('button', {
            class: 'btn ghost sm',
            style: 'font-weight:600',
            onclick: () => viewRequestDetailsModal(r)
          }, '🔍 Details'),
          r.status === 'ISSUED' && r.issueSeq && h('button', {
            class: 'btn ghost sm',
            style: 'font-weight:600',
            onclick: () => openFile(`/api/me/issues/${r.branchCode}/${r.issueSeq}/gatepass`)
          }, '📄 Gate Pass')
        );

        return h('tr', {},
          h('td', {},
            h('div', { style: 'font-weight:700;font-size:0.88em' }, `#${r.id.slice(-6)}`),
            h('div', { class: 'muted small', style: 'font-size:0.75em' }, fmt(r.createdAt))
          ),
          h('td', {}, badge(r.branchCode, 'info')),
          h('td', {}, compSummary),
          h('td', {},
            h('div', { style: 'font-weight:700;font-size:0.88em' }, `${r.days} days`),
            h('div', { class: 'muted small', style: 'font-size:0.78em;max-width:180px' }, r.purpose || '—')
          ),
          h('td', {}, statusCell),
          actionsCell
        );
      }));

      contentArea = h('div', { class: 'tbl-wrap' },
        h('table', {},
          h('thead', {}, h('tr', {}, reqHeads.map(x => h('th', {}, x)))),
          tbody
        )
      );
    }

    container.replaceChildren(
      header,
      heroCard || '',
      stats,
      filterBar,
      contentArea
    );
  }

  // Initial load
  loadData(false);

  // Auto-refresh loop every 12 seconds to catch live request acceptance & phone alerts
  pollTimer = setInterval(() => {
    loadData(true);
  }, 12000);

  return {
    el: container,
    cleanup: () => {
      if (pollTimer) clearInterval(pollTimer);
    }
  };
}

async function myIssues() {
  const rows = await api('/api/me/issues');
  if (!rows.length) return h('p', { class: 'muted' }, 'You have no issue records yet.');
  return table(['Pass', 'Component', 'Qty', 'Issued', 'Due', 'Status', 'Fine', ''], rows.map((r) => {
    const items = Array.isArray(r.items) && r.items.length > 0 ? r.items : [{ compId: r.compId, compName: r.compName, qty: r.issueQty }];
    const compSummary = h('div', { style: 'display:flex;flex-direction:column;gap:4px;min-width:140px' },
      ...items.map(it => h('div', { style: 'display:flex;align-items:baseline;gap:5px;flex-wrap:wrap;line-height:1.3' },
        h('span', { style: 'font-weight:600;font-size:0.9em;color:var(--text)' }, it.compName || it.compId),
        h('span', { class: 'muted', style: 'font-size:0.75em;font-family:monospace' }, `(${it.compId})`),
        h('span', { class: 'badge sm info', style: 'font-size:0.72em;padding:0 5px' }, `×${it.qty}`)
      ))
    );
    const totalQty = items.reduce((acc, it) => acc + (it.qty || 0), 0);
    const statusCell = h('div', { style: 'display:flex;flex-direction:column;gap:3px;align-items:flex-start' },
      r.status === 'RETURNED' ? badge('RETURNED', 'ok') : r.status === 'PARTIAL_RETURN' ? badge(`PARTIAL (${r.returnedQty}↩ / ${r.remainingQty} left)`, 'warn') : r.overdue ? badge(`OVERDUE${r.daysLate ? ` +${r.daysLate}d` : ''}`, 'bad') : badge('ISSUED', 'info'),
      r.returnDate && h('span', { style: 'font-size:0.75em;color:var(--green);font-weight:600' }, `↩ ${fmt(r.returnDate)}`)
    );
    return h('tr', {},
      h('td', {}, r.gatePassNo), h('td', {}, compSummary), h('td', {}, totalQty), h('td', {}, fmt(r.issueDate)), h('td', {}, fmt(r.dueDate)),
      h('td', {}, statusCell),
      h('td', {}, rupees(r.fine)),
      h('td', {}, h('button', { class: 'btn ghost sm', onclick: () => openFile(`/api/me/issues/${r.branchCode}/${r.seq}/gatepass`) }, 'Gate pass')));
  }));
}

async function myProfile() {
  const container = h('div', { class: 'stack', style: 'max-width:640px; margin:16px auto; padding:0 12px;' });

  let p = { displayName: '', enrollmentNo: '', email: '', mobile: '', branch: '' };
  try {
    p = await api('/api/me/profile');
  } catch (e) {
    toast(e.message, 'err');
  }

  const nameInput = h('input', { type: 'text', value: p.displayName || '', placeholder: 'Full Name' });
  const mobileInput = h('input', { type: 'tel', value: p.mobile || '', placeholder: '10-digit mobile number', maxlength: '10' });
  const branchInput = h('input', { type: 'text', value: p.branch || '', placeholder: 'e.g. CO, IT, EC' });

  // Read-only locked fields
  const enInput = h('input', {
    type: 'text',
    value: p.enrollmentNo || '',
    disabled: true,
    style: 'background:rgba(0,0,0,0.05); cursor:not-allowed; font-weight:600; color:var(--ink); opacity:0.85;'
  });

  const emailInput = h('input', {
    type: 'email',
    value: p.email || '',
    disabled: true,
    style: 'background:rgba(0,0,0,0.05); cursor:not-allowed; font-weight:600; color:var(--ink); opacity:0.85;'
  });

  const saveBtn = h('button', { class: 'btn primary block', type: 'submit' }, '💾 Save Profile Changes');

  const card = h('div', { class: 'card stack', style: 'padding:24px; gap:18px;' },
    h('div', { class: 'row', style: 'align-items:center; gap:16px; border-bottom:1.5px solid var(--line); padding-bottom:16px;' },
      h('div', {
        style: 'width:56px; height:56px; border-radius:50%; background:linear-gradient(135deg, var(--blue), var(--ink)); color:#fff; display:flex; align-items:center; justify-content:center; font-size:24px; font-weight:bold; flex-shrink:0; box-shadow:var(--shadow-glow);'
      }, (p.displayName || p.enrollmentNo || 'S')[0].toUpperCase()),
      h('div', { class: 'grow' },
        h('h2', { style: 'margin:0 0 4px 0; font-size:1.25rem;' }, p.displayName || 'Student Profile'),
        h('div', { class: 'row', style: 'gap:8px; align-items:center;' },
          h('span', { class: 'chip' }, p.enrollmentNo || 'Student'),
          h('span', { class: 'badge b-ok' }, p.branch ? `Dept: ${p.branch}` : 'Registered')
        )
      )
    ),

    h('div', {
      style: 'background:rgba(15,118,110,0.08); border:1px solid rgba(15,118,110,0.25); border-radius:8px; padding:12px 14px; font-size:13px; color:var(--teal-d); line-height:1.45;'
    }, '🔒 Official Record Policy: Your Enrollment Number and institutional @scet.ac.in Email are permanently locked to preserve laboratory tracking and gate pass audit integrity. Other details can be updated below anytime.'),


    h('form', { class: 'stack', style: 'gap:14px;' },
      field('Enrollment number (Login ID - Locked)', enInput),
      field('College Email (@scet.ac.in - Locked)', emailInput),
      field('Full Name (Editable)', nameInput),
      field('Mobile number (10 digits - Editable)', mobileInput),
      field('Department / Branch (Editable)', branchInput),
      h('div', { style: 'margin-top:10px;' }, saveBtn)
    )
  );

  card.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const displayName = nameInput.value.trim();
    const mobile = mobileInput.value.trim();
    const branch = branchInput.value.trim().toUpperCase();

    if (!displayName) return toast('Full name cannot be empty.', 'err');
    if (!branch) return toast('Branch cannot be empty.', 'err');
    if (!/^\d{10}$/.test(mobile)) return toast('Mobile number must be exactly 10 digits.', 'err');

    saveBtn.disabled = true;
    saveBtn.innerText = 'Saving changes...';
    try {
      const res = await api('/api/me/profile', {
        method: 'PUT',
        body: { displayName, mobile, branch }
      });
      toast('Profile updated successfully!');
      p.displayName = displayName;
      p.mobile = mobile;
      p.branch = branch;
      const titleEl = card.querySelector('h2');
      if (titleEl) titleEl.innerText = displayName;
      const deptBadge = card.querySelector('.badge');
      if (deptBadge) deptBadge.innerText = `Dept: ${branch}`;
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerText = '💾 Save Profile Changes';
    }
  };

  container.append(card);
  return container;
}
