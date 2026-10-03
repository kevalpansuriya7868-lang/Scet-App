import { api } from '../api.js';
import { h, modal, fmt, badge, toast } from '../ui.js';

/**
 * Request Decisions Audit Trail
 * Tracks who accepted / denied each student request, when (timestamp),
 * and what pickup time and lab location was given to the student.
 * Note: Hardware issuing is tracked in the main Inventory Audit Trail, NOT here.
 */
export async function requestAuditTab(code) {
  const wrap = h('div', { class: 'stack', style: 'gap:14px' });

  let allRequests = [];
  let filterState = 'ALL'; // 'ALL' | 'ACCEPTED' | 'REJECTED'
  let searchQuery = '';

  const searchInput = h('input', {
    placeholder: '🔍 Search by student name, enrollment, admin who decided, or component…',
    style: 'max-width:380px;width:100%',
  });

  const statsContainer = h('div', { class: 'stats', style: 'margin-bottom:4px' });
  const filterTabsContainer = h('div', { class: 'tabs', style: 'margin-bottom:8px;overflow-x:auto' });
  const tableContainer = h('div', { class: 'tbl-wrap' });

  function openDecisionDetailModal(r) {
    const isAccepted = r.status === 'ACCEPTED' || r.status === 'ISSUED';
    const isIssued = r.status === 'ISSUED';
    const items = Array.isArray(r.items) && r.items.length > 0 ? r.items : [{ compId: r.compId, compName: r.compName, qty: r.qty || 1 }];
    const itemsSummary = items.map(it => `${it.qty} × ${it.compName || it.compId} (${it.compId})`).join(', ');

    const body = h('div', { class: 'stack', style: 'gap:16px;font-size:14px;line-height:1.5' },
      // Top Decision Banner
      h('div', {
        style: `background:${isAccepted ? 'rgba(5,150,105,0.08)' : 'rgba(220,38,38,0.08)'};border:1.5px solid ${isAccepted ? 'var(--green)' : 'var(--red)'};border-radius:12px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px`
      },
        h('div', { style: 'display:flex;align-items:center;gap:10px' },
          h('span', { style: 'font-size:1.8em;line-height:1' }, isAccepted ? '✅' : '❌'),
          h('div', {},
            h('div', { style: `font-weight:800;font-size:1.1em;color:${isAccepted ? 'var(--green)' : 'var(--red)'}` },
              isIssued ? 'REQUEST ACCEPTED & ISSUED' : (isAccepted ? 'REQUEST ACCEPTED & SCHEDULED' : 'REQUEST DENIED / REJECTED')
            ),
            h('div', { class: 'muted small' }, `Request ID #${r.id.slice(-6)} · Branch ${r.branchCode || code}${isIssued && r.gatePassNo ? ` · Gate Pass: ${r.gatePassNo}` : ''}`)
          )
        ),
        h('div', { style: 'text-align:right' },
          h('div', { style: 'font-weight:700;color:var(--ink)' }, `By: ${isAccepted ? (r.acceptedBy || 'Admin') : (r.rejectedBy || 'Admin')}`),
          h('div', { class: 'muted small' }, `Decided: ${fmt(isAccepted ? (r.acceptedAt || r.createdAt) : (r.rejectedAt || r.createdAt))}`)
        )
      ),

      // Two key summary cards
      h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:12px' },
        // Decision Specifics
        h('div', { class: 'card', style: 'margin:0;padding:14px;background:var(--soft);border:1px solid var(--line);border-radius:10px' },
          h('div', { style: 'font-size:0.75em;font-weight:800;letter-spacing:0.05em;color:var(--muted);text-transform:uppercase;margin-bottom:8px' },
            isAccepted ? 'Collection & Location Allocated' : 'Denial Reason'
          ),
          isAccepted ? h('div', { class: 'stack', style: 'gap:6px' },
            h('div', { style: 'font-size:0.95em' },
              h('span', { class: 'muted' }, '🕒 Pickup Time: '),
              h('strong', { style: 'color:var(--ink)' }, r.collectionTime || 'Today during lab hours')
            ),
            h('div', { style: 'font-size:0.95em' },
              h('span', { class: 'muted' }, '📍 Pickup Location: '),
              h('strong', { style: 'color:var(--ink)' }, r.collectionLocation || r.collectionNote || 'Hardware Lab Counter')
            ),
            r.collectionNote && r.collectionLocation && r.collectionNote !== r.collectionLocation ? h('div', { class: 'muted small', style: 'font-size:0.82em' },
              `Instructions: ${r.collectionNote}`
            ) : null
          ) : h('div', { class: 'stack', style: 'gap:6px' },
            h('div', { style: 'font-size:0.95em;color:var(--red);font-weight:600' },
              `⚠️ Reason: ${r.rejectionReason || 'Allocation limit reached or item unavailable.'}`
            )
          )
        ),

        // Student Recipient Details
        h('div', { class: 'card', style: 'margin:0;padding:14px;background:var(--soft);border:1px solid var(--line);border-radius:10px' },
          h('div', { style: 'font-size:0.75em;font-weight:800;letter-spacing:0.05em;color:var(--muted);text-transform:uppercase;margin-bottom:8px' }, 'Student Recipient'),
          h('div', { style: 'font-size:1.15em;font-weight:800;color:var(--ink);margin-bottom:4px' }, r.studentName || 'Student'),
          h('div', { style: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px' },
            h('span', { style: 'font-family:monospace;font-weight:700;font-size:0.9em;background:#fff;padding:2px 8px;border-radius:6px;border:1px solid var(--line)' }, r.enrollmentNo || '—'),
            h('span', { class: 'chip', style: 'font-size:0.78em;padding:2px 8px' }, `Dept ${r.studentBranch || code}`)
          ),
          h('div', { class: 'muted small', style: 'font-size:0.84em' }, `📱 Mobile: +91 ${r.studentMobile || '—'}`),
          h('div', { class: 'muted small', style: 'font-size:0.84em' }, `✉️ Email: ${r.studentEmail || '—'}`)
        )
      ),

      // Components Requested
      h('div', { class: 'card', style: 'margin:0;padding:14px;background:#fff;border:1px solid var(--line);border-radius:10px' },
        h('div', { style: 'font-size:0.75em;font-weight:800;letter-spacing:0.05em;color:var(--muted);text-transform:uppercase;margin-bottom:8px' }, 'Requested Components'),
        h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
          ...items.map(it => h('div', {
            style: 'display:flex;justify-content:space-between;align-items:center;background:var(--soft);padding:6px 12px;border-radius:6px'
          },
            h('div', {},
              h('strong', {}, it.compName || it.compId),
              h('span', { class: 'muted small', style: 'font-family:monospace;margin-left:6px' }, `(${it.compId})`)
            ),
            h('span', { class: 'badge sm info', style: 'font-weight:700' }, `× ${it.qty}`)
          ))
        ),
        h('div', { style: 'margin-top:10px;font-size:0.88em;color:var(--muted)' },
          `Requested Duration: ${r.days || 7} days · Purpose: ${r.purpose || 'Academic Lab'}`
        )
      ),

      h('div', { style: 'background:rgba(217,119,6,0.06);border:1px solid rgba(217,119,6,0.25);border-radius:8px;padding:10px 14px;font-size:0.82em;color:var(--gold-d)' },
        'ℹ️ Note: Physical hardware checkouts/issuing are recorded in the primary Inventory Audit Trail. This audit log focuses exclusively on request approvals and denials.'
      )
    );

    modal(`Request #${r.id.slice(-6)} Decision Audit Slip`, body, [{ label: 'Close', run: (close) => close() }], true);
  }

  function render() {
    // Show ACCEPTED, ISSUED (which were accepted), and REJECTED decisions only. PENDING requests have no decision yet.
    const decisions = allRequests.filter(r => r.status === 'ACCEPTED' || r.status === 'ISSUED' || r.status === 'REJECTED');

    const totalCount = decisions.length;
    const acceptedCount = decisions.filter(r => r.status === 'ACCEPTED' || r.status === 'ISSUED').length;
    const rejectedCount = decisions.filter(r => r.status === 'REJECTED').length;

    // 1. Stats bar
    statsContainer.replaceChildren(
      h('div', { class: 'stat', style: 'cursor:pointer', onclick: () => { filterState = 'ALL'; render(); } },
        h('b', {}, totalCount), 'Decisions Audited'
      ),
      h('div', { class: 'stat', style: 'cursor:pointer', onclick: () => { filterState = 'ACCEPTED'; render(); } },
        h('b', { style: 'color:var(--green)' }, acceptedCount), 'Requests Accepted'
      ),
      h('div', { class: 'stat', style: 'cursor:pointer', onclick: () => { filterState = 'REJECTED'; render(); } },
        h('b', { style: 'color:var(--red)' }, rejectedCount), 'Requests Denied'
      )
    );

    // 2. Filter tabs
    const filterDefs = [
      ['ALL', `All Decisions (${totalCount})`],
      ['ACCEPTED', `✅ Accepted Only (${acceptedCount})`],
      ['REJECTED', `❌ Denied Only (${rejectedCount})`],
    ];

    filterTabsContainer.replaceChildren(
      ...filterDefs.map(([key, label]) =>
        h('button', {
          class: `tab${filterState === key ? ' on' : ''}`,
          onclick: () => { filterState = key; render(); }
        }, label)
      )
    );

    // 3. Filter list
    let list = [...decisions];
    if (filterState === 'ACCEPTED') {
      list = list.filter(r => r.status === 'ACCEPTED' || r.status === 'ISSUED');
    } else if (filterState === 'REJECTED') {
      list = list.filter(r => r.status === 'REJECTED');
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(r => {
        const sName = (r.studentName || '').toLowerCase();
        const en = (r.enrollmentNo || '').toLowerCase();
        const isAcc = r.status === 'ACCEPTED' || r.status === 'ISSUED';
        const byWho = (isAcc ? (r.acceptedBy || '') : (r.rejectedBy || '')).toLowerCase();
        const timeLoc = (r.collectionTime || '' + ' ' + (r.collectionLocation || '') + ' ' + (r.rejectionReason || '') + ' ' + (r.gatePassNo || '')).toLowerCase();
        const itemsMatch = (r.items || []).some(it => (it.compName || it.compId || '').toLowerCase().includes(q));
        return sName.includes(q) || en.includes(q) || byWho.includes(q) || timeLoc.includes(q) || itemsMatch;
      });
    }

    // 4. Render Table
    if (!list.length) {
      tableContainer.replaceChildren(
        h('div', {
          class: 'card',
          style: 'text-align:center;padding:48px 20px;border:1.5px dashed var(--line);border-radius:12px;background:#fff'
        },
          h('div', { style: 'font-size:2.4em;margin-bottom:8px' }, '📜'),
          h('h4', { style: 'margin:0 0 6px 0;font-size:1.15em' }, 'No Request Decisions Found'),
          h('p', { class: 'muted', style: 'font-size:0.9em;margin:0' },
            decisions.length === 0
              ? 'No requests have been accepted or denied in this branch yet.'
              : 'No decisions match the current filter or search criteria.'
          )
        )
      );
      return;
    }

    const heads = [
      'Decision',
      'Action Taken By (Who)',
      'Pickup Time & Location Given / Denial Reason',
      'Student Recipient',
      'Components Requested',
      'Audit Slip'
    ];

    const tbody = h('tbody');
    tbody.replaceChildren(...list.map(r => {
      const isAccepted = r.status === 'ACCEPTED' || r.status === 'ISSUED';
      const isIssued = r.status === 'ISSUED';
      const items = Array.isArray(r.items) && r.items.length > 0 ? r.items : [{ compId: r.compId, compName: r.compName, qty: r.qty || 1 }];

      // Decision Cell
      let decisionBadge;
      if (isIssued) {
        decisionBadge = h('div', { style: 'display:flex;flex-direction:column;gap:3px;align-items:flex-start' },
          h('span', {
            style: 'background:rgba(5,150,105,0.12);color:var(--green);border:1.5px solid var(--green);padding:4px 10px;border-radius:20px;font-weight:800;font-size:0.82em;display:inline-flex;align-items:center;gap:4px'
          }, '✅ ACCEPTED'),
          h('span', {
            class: 'badge sm info',
            style: 'font-size:0.7em;padding:1px 6px',
            title: `Gate pass ${r.gatePassNo || ''} issued`
          }, `⚡ ISSUED${r.gatePassNo ? ` (${r.gatePassNo})` : ''}`)
        );
      } else if (isAccepted) {
        decisionBadge = h('span', {
          style: 'background:rgba(5,150,105,0.12);color:var(--green);border:1.5px solid var(--green);padding:4px 10px;border-radius:20px;font-weight:800;font-size:0.82em;display:inline-flex;align-items:center;gap:4px'
        }, '✅ ACCEPTED');
      } else {
        decisionBadge = h('span', {
          style: 'background:rgba(220,38,38,0.12);color:var(--red);border:1.5px solid var(--red);padding:4px 10px;border-radius:20px;font-weight:800;font-size:0.82em;display:inline-flex;align-items:center;gap:4px'
        }, '❌ DENIED');
      }

      // Who Cell
      const byWhom = isAccepted ? (r.acceptedBy || 'Admin') : (r.rejectedBy || 'Admin');
      const whoCell = h('div', {},
        h('span', {
          style: 'background:#e0f2fe;color:#0369a1;padding:3px 9px;border-radius:6px;font-weight:700;font-size:0.85em;font-family:monospace'
        }, byWhom),
        h('div', { class: 'muted small', style: 'font-size:0.75em;margin-top:3px' }, 'Faculty Admin')
      );

      // What Time and Location Given Cell
      let decisionDetailsCell;
      if (isAccepted) {
        decisionDetailsCell = h('div', {
          style: 'background:rgba(5,150,105,0.06);border:1px solid rgba(5,150,105,0.25);padding:6px 10px;border-radius:8px;display:flex;flex-direction:column;gap:3px;max-width:260px'
        },
          h('div', { style: 'font-weight:700;font-size:0.86em;color:var(--ink)' },
            `🕒 Slot: ${r.collectionTime || 'Check with lab'}`
          ),
          h('div', { style: 'font-size:0.8em;color:var(--green);font-weight:600' },
            `📍 Loc: ${r.collectionLocation || r.collectionNote || 'Hardware Lab Counter'}`
          ),
          isIssued && h('div', { style: 'font-size:0.75em;color:var(--blue);font-weight:700;margin-top:2px' },
            `✓ Gate Pass: ${r.gatePassNo || `#${r.issueSeq}`}`
          )
        );
      } else {
        decisionDetailsCell = h('div', {
          style: 'background:rgba(220,38,38,0.06);border:1px solid rgba(220,38,38,0.25);padding:6px 10px;border-radius:8px;max-width:260px'
        },
          h('div', { style: 'font-size:0.82em;color:var(--red);font-weight:600' },
            `⚠️ ${r.rejectionReason || 'Allocation limit or stock unavailable'}`
          )
        );
      }

      // Student Cell
      const studentCell = h('div', { style: 'line-height:1.35' },
        h('div', { style: 'font-weight:700;font-size:0.92em;color:var(--ink)' }, r.studentName || 'Student'),
        h('div', { style: 'display:flex;gap:4px;align-items:center;margin-top:2px' },
          h('span', { class: 'muted small', style: 'font-family:monospace;font-size:0.8em' }, r.enrollmentNo || '—'),
          h('span', { class: 'chip', style: 'font-size:0.7em;padding:1px 6px' }, r.studentBranch || code)
        ),
        r.studentMobile && h('div', { class: 'muted small', style: 'font-size:0.75em' }, `📱 +91 ${r.studentMobile}`)
      );

      // Components Requested Cell
      const compsCell = h('div', { style: 'display:flex;flex-direction:column;max-width:260px' },
        ...items.map((it, idx) => h('div', {
          style: `font-size:0.82em;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px 0;${idx < items.length - 1 ? 'border-bottom:1px solid var(--line,#cbd5e1);' : ''}`
        },
          h('span', { style: 'font-weight:600;color:var(--text)' }, it.compName || it.compId),
          h('span', { class: 'badge sm info', style: 'font-size:0.7em;padding:0 5px;flex-shrink:0' }, `×${it.qty}`)
        ))
      );

      // Action Cell
      const viewBtn = h('button', {
        class: 'btn ghost sm',
        style: 'font-size:0.8em;padding:4px 10px;font-weight:700',
        onclick: () => openDecisionDetailModal(r)
      }, '🔍 View');

      return h('tr', {},
        h('td', {}, decisionBadge),
        h('td', {}, whoCell),
        h('td', {}, decisionDetailsCell),
        h('td', {}, studentCell),
        h('td', {
          style: 'border-left:1px solid var(--line,#cbd5e1);border-right:1px solid var(--line,#cbd5e1);vertical-align:middle;padding:6px 12px'
        }, compsCell),
        h('td', {}, viewBtn)
      );
    }));

    tableContainer.replaceChildren(
      h('table', {},
        h('thead', {}, h('tr', {}, heads.map(x => h('th', {
          style: x === 'Components Requested' ? 'border-left:1px solid var(--line,#cbd5e1);border-right:1px solid var(--line,#cbd5e1);' : ''
        }, x)))),
        tbody
      )
    );
  }

  async function load() {
    try {
      allRequests = await api(`/api/branches/${code}/requests`);
    } catch {
      allRequests = [];
    }
    render();
  }

  let searchTimeout;
  searchInput.oninput = () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      searchQuery = (searchInput.value || '').trim();
      render();
    }, 250);
  };

  const refreshBtn = h('button', {
    class: 'btn ghost sm',
    style: 'display:inline-flex;align-items:center;gap:4px;font-weight:600',
    onclick: async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Refreshing…';
      await load();
      refreshBtn.disabled = false;
      refreshBtn.textContent = '🔄 Refresh';
      toast('Request Audit Trail refreshed', 'ok');
    }
  }, '🔄 Refresh');

  await load();

  // Auto poll every 15 seconds
  const pollTimer = setInterval(load, 15000);

  const header = h('div', {
    style: 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:8px'
  },
    h('div', {},
      h('h3', { style: 'margin:0;font-size:1.3em;font-weight:800;color:var(--ink);display:flex;align-items:center;gap:8px' },
        '📜 Request Decisions Audit Trail',
        h('span', { class: 'badge sm ok', style: 'font-size:0.7em' }, `Dept ${code}`)
      ),
      h('span', { class: 'muted small' },
        'Strict audit tracking of all request approvals & denials (who accepted/denied, timestamp, and pickup slot & location given to student)'
      )
    ),
    h('div', { style: 'display:flex;gap:8px;align-items:center' },
      searchInput,
      refreshBtn
    )
  );

  wrap.replaceChildren(
    header,
    statsContainer,
    filterTabsContainer,
    tableContainer
  );

  return {
    el: wrap,
    dispose: () => clearInterval(pollTimer),
  };
}
