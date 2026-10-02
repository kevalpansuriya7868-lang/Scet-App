import { api, openFile } from '../api.js';
import { h, fields, toast, fmt, rupees, badge, table, modal, countdown } from '../ui.js';

export async function historyTab(code) {
  const q = h('input', { placeholder: 'Enrollment number or student name…' }), out = h('div');
  const search = async () => {
    if (!q.value.trim()) return;
    const rows = await api(`/api/branches/${code}/issues?q=${encodeURIComponent(q.value.trim())}`);
    if (!rows.length) return out.replaceChildren(h('p', { class: 'muted' }, 'No records found.'));
    const enroll = rows[0].enrollmentNo;
    out.replaceChildren(
      h('div', { class: 'row', style: 'margin:12px 0' }, h('b', { class: 'grow' }, `${rows[0].studentName} · ${enroll}`),
        h('button', { class: 'btn gold', onclick: () => clearance(enroll) }, 'No-dues certificate')),
      table(['Pass', 'Component', 'Qty', 'Issued', 'Returned', 'Status', 'Fine', 'Condition'], rows.map((r) => h('tr', {},
        h('td', {}, r.gatePassNo), h('td', {}, r.compId), h('td', {}, r.issueQty), h('td', {}, fmt(r.issueDate)), h('td', {}, fmt(r.returnDate)),
        h('td', {}, r.status === 'RETURNED' ? badge('RETURNED', 'ok') : r.overdue ? badge('OVERDUE', 'bad') : badge('ISSUED', 'info')),
        h('td', {}, rupees(r.fine)), h('td', {}, r.returnCondition)))));
  };
  const clearance = async (enroll) => {
    try {
      await api(`/api/branches/${code}/students/${enroll}/no-dues?check=1`);
      openFile(`/api/branches/${code}/students/${enroll}/no-dues`);
    } catch (e) { toast(e.message, 'err'); }
  };
  q.onkeydown = (e) => e.key === 'Enter' && search().catch((x) => toast(x.message, 'err'));
  return { el: h('div', {}, h('div', { class: 'row' }, h('div', { class: 'grow' }, q), h('button', { class: 'btn primary', onclick: () => search().catch((x) => toast(x.message, 'err')) }, 'Search')), out) };
}

export async function reportsTab(code) {
  const b = `/api/branches/${code}`;
  const wrap = h('div', { class: 'stack', style: 'gap:24px' });

  // 1. Report Cards (PDF Exports & Operations)
  const th = fields([{ name: 't', label: 'Low-stock threshold (units)', type: 'number', min: 0, value: 3 }]);
  const card = (title, desc, ...btns) => h('div', { class: 'card stack' }, h('h3', {}, title), h('p', { class: 'muted' }, desc), h('div', { class: 'row' }, btns));

  const reportCards = h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px' },
    // Featured Outstanding Issued Items Report
    h('div', {
      class: 'card stack',
      style: 'border:2px solid var(--blue);background:linear-gradient(135deg, #f0f7ff 0%, #fff 100%);box-shadow:0 4px 16px rgba(30,64,175,0.08)'
    },
      h('div', { style: 'display:flex;align-items:center;gap:6px' },
        h('span', { class: 'badge sm ok', style: 'font-weight:700' }, 'LIVE REGISTER'),
        h('h3', { style: 'margin:0;color:var(--blue)' }, '📦 Outstanding Issued Items')
      ),
      h('p', { class: 'muted', style: 'font-size:0.9em;margin:0' },
        'Official register & printable PDF of ALL components currently issued to students that have NOT been returned yet (both on-time and overdue).'
      ),
      h('div', { class: 'row', style: 'margin-top:auto;gap:8px;flex-wrap:wrap' },
        h('button', {
          class: 'btn primary sm',
          style: 'display:inline-flex;align-items:center;gap:5px;font-weight:700',
          onclick: () => openFile(`${b}/reports/outstanding.pdf`)
        }, '📥 Download PDF Report'),
        h('button', {
          class: 'btn ghost sm',
          style: 'font-weight:600',
          onclick: () => document.getElementById('outstanding-section')?.scrollIntoView({ behavior: 'smooth' })
        }, '⬇ View Live Register')
      )
    ),

    card('Full stock report', 'PDF of every component with total / issued / available counts.',
      h('button', { class: 'btn primary', onclick: () => openFile(`${b}/reports/inventory.pdf`) }, 'Open PDF')),

    card('Procurement slip', 'PDF of items at or below a low-stock threshold.', th.el,
      h('button', { class: 'btn gold', onclick: () => openFile(`${b}/reports/procurement.pdf?threshold=${th.refs.t.value}`) }, 'Open PDF')),

    card('Overdue reminders', 'Emails every student with an overdue item (fine accrues per day).',
      h('button', { class: 'btn danger', onclick: async (e) => {
        if (!confirm('Email all students with overdue items in this branch?')) return;
        e.target.disabled = true;
        try { const r = await api(`${b}/issues/reminders/send`, { method: 'POST' }); toast(r.queued ? `Queued ${r.queued} reminder(s).` : 'No overdue items.'); } catch (x) { toast(x.message, 'err'); } finally { e.target.disabled = false; }
      } }, 'Send reminders')),

    card('Branch backup', 'Download a JSON snapshot of this branch (components + issue ledger).',
      h('button', { class: 'btn ghost', onclick: () => openFile(`${b}/reports/backup.json`) }, 'Download JSON'))
  );

  // 2. Dedicated Section: Currently Issued & Unreturned Hardware Register
  const searchInput = h('input', {
    placeholder: '🔍 Search by student name, enrollment no, or item…',
    style: 'max-width:340px;flex:1',
  });

  const filterSel = h('select', { style: 'font-weight:600' },
    h('option', { value: 'all' }, 'All Unreturned (On-Time + Overdue)'),
    h('option', { value: 'ontime' }, 'On-Time Only'),
    h('option', { value: 'overdue' }, 'Overdue Only'),
    h('option', { value: 'partial' }, 'Partial Returns Only'),
  );

  const statsContainer = h('div', { class: 'stats', style: 'margin-bottom:12px' });
  const tbody = h('tbody');
  const ticks = [];

  function viewDetailsModal(r) {
    const items = Array.isArray(r.items) && r.items.length > 0
      ? r.items
      : [{ compId: r.compId, compName: r.compName, qty: r.issueQty, returnedQty: r.returnedQty || 0, remainingQty: r.remainingQty, returnCondition: r.returnCondition, conditions: r.conditions }];
    const totalIssueQty = items.reduce((acc, it) => acc + (it.qty || 0), 0);
    const totalReturnedQty = items.reduce((acc, it) => acc + (it.returnedQty || 0), 0);
    const totalRemQty = totalIssueQty - totalReturnedQty;

    const body = h('div', { class: 'stack', style: 'gap:16px;font-size:15px;line-height:1.5' },
      h('div', {
        style: 'background:linear-gradient(135deg, var(--soft) 0%, #fff 100%);padding:14px 18px;border-radius:12px;border:1.5px solid var(--line);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px'
      },
        h('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' },
          h('span', { class: 'chip', style: 'font-size:0.95em;font-weight:700' }, r.gatePassNo || `Issue #${r.seq}`),
          r.overdue
            ? h('span', { class: 'badge bad', style: 'font-weight:700;font-size:0.88em;padding:4px 10px' }, `🚨 OVERDUE (+${r.daysLate || 1}d)`)
            : r.status === 'PARTIAL_RETURN'
              ? h('span', { class: 'badge warn', style: 'font-weight:700;font-size:0.88em;padding:4px 10px' }, `⚠️ PARTIALLY RETURNED (${totalReturnedQty}/${totalIssueQty})`)
              : h('span', { class: 'badge info', style: 'font-weight:700;font-size:0.88em;padding:4px 10px' }, '⏳ ACTIVE ON-TIME')
        ),
        h('span', { class: 'muted', style: 'font-size:0.9em' }, `Issued: ${fmt(r.issueDate)}`)
      ),

      h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:12px' },
        h('div', { class: 'card', style: 'padding:14px;background:var(--soft);border:1px solid var(--line);border-radius:10px;margin:0' },
          h('div', { style: 'font-size:0.75em;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px' }, 'Student Recipient'),
          h('div', { style: 'font-size:1.3em;font-weight:800;color:var(--ink);margin-bottom:4px' }, r.studentName || '—'),
          h('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:6px' },
            h('span', { style: 'font-family:monospace;font-weight:700;font-size:0.92em;background:#fff;padding:2px 8px;border-radius:6px;border:1px solid var(--line)' }, r.enrollmentNo || '—'),
            h('span', { class: 'chip', style: 'font-size:0.75em' }, r.studentBranch || code)
          ),
          r.studentMobile && h('div', { style: 'font-size:0.85em;color:var(--muted)' }, `📱 ${r.studentMobile}`),
          r.studentEmail && h('div', { style: 'font-size:0.85em;color:var(--muted)' }, `✉️ ${r.studentEmail}`)
        ),
        h('div', { class: 'card', style: 'padding:14px;background:var(--soft);border:1px solid var(--line);border-radius:10px;margin:0' },
          h('div', { style: 'font-size:0.75em;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:4px' }, 'Due Date & Fine Status'),
          h('div', { style: 'display:flex;flex-direction:column;gap:5px;font-size:0.9em' },
            h('div', { style: 'display:flex;justify-content:space-between' },
              h('span', { class: 'muted' }, 'Return Deadline:'),
              h('strong', {}, fmt(r.dueDate))
            ),
            h('div', { style: 'display:flex;justify-content:space-between' },
              h('span', { class: 'muted' }, 'Accrued Fine:'),
              h('strong', { style: r.fine > 0 ? 'color:var(--red)' : 'color:var(--green)' }, r.fine > 0 ? `${rupees(r.fine)} (accruing)` : '₹0.00 (On Time)')
            ),
            h('div', { style: 'display:flex;justify-content:space-between' },
              h('span', { class: 'muted' }, 'Issued By Admin:'),
              h('span', { style: 'font-weight:600' }, r.issuedBy || 'admin')
            )
          )
        )
      ),

      h('div', { class: 'card', style: 'padding:16px;border:1.5px solid var(--line);border-radius:12px;background:#fff;margin:0' },
        h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px' },
          h('h4', { style: 'margin:0;font-size:1.1em;font-weight:800;color:var(--ink)' }, '📦 Components & Quantities'),
          h('span', { class: 'badge sm warn', style: 'font-weight:700' }, `${totalRemQty} Unit(s) Still With Student`)
        ),
        h('div', { class: 'tbl-wrap', style: 'border:1px solid #f1f5f9;border-radius:8px' },
          h('table', { style: 'width:100%;font-size:0.92em' },
            h('thead', {},
              h('tr', {},
                h('th', { style: 'padding:8px 12px' }, 'Component Name'),
                h('th', { style: 'padding:8px 12px' }, 'Hardware ID'),
                h('th', { style: 'padding:8px 12px;text-align:center' }, 'Issued'),
                h('th', { style: 'padding:8px 12px;text-align:center' }, 'Returned'),
                h('th', { style: 'padding:8px 12px;text-align:center' }, 'Remaining (Unreturned)')
              )
            ),
            h('tbody', {},
              ...items.map(it => {
                const rem = (it.remainingQty ?? (it.qty - (it.returnedQty || 0)));
                return h('tr', {},
                  h('td', { style: 'font-weight:700;color:var(--ink);padding:10px 12px' }, it.compName || it.compId),
                  h('td', { style: 'font-family:monospace;color:var(--muted);padding:10px 12px' }, it.compId),
                  h('td', { style: 'text-align:center;font-weight:700;padding:10px 12px' }, `×${it.qty}`),
                  h('td', { style: 'text-align:center;padding:10px 12px' }, `${it.returnedQty || 0}`),
                  h('td', { style: 'text-align:center;padding:10px 12px' },
                    h('span', { class: `badge sm ${rem > 0 ? 'warn' : 'ok'}`, style: 'font-weight:700' }, `${rem} left`)
                  )
                );
              })
            )
          )
        )
      )
    );

    modal(`📋 Gate Pass ${r.gatePassNo} Details`, body, [
      { label: '📄 View Gate Pass PDF', cls: 'ghost', run: () => openFile(`${b}/issues/${r.seq}/gatepass`) }
    ], true);
  }

  async function loadOutstanding() {
    const allIssues = await api(`${b}/issues`);
    ticks.length = 0;

    // Filter strictly for unreturned items (ISSUED or PARTIAL_RETURN, or remainingQty > 0)
    const unreturnedRows = allIssues.filter(r =>
      r.status === 'ISSUED' || r.status === 'PARTIAL_RETURN' || (r.remainingQty && r.remainingQty > 0)
    );

    // Compute summary stats
    const totalActiveCount = unreturnedRows.length;
    let totalUnreturnedUnits = 0;
    let onTimeCount = 0;
    let overdueCount = 0;

    unreturnedRows.forEach(r => {
      const items = Array.isArray(r.items) && r.items.length > 0
        ? r.items
        : [{ compId: r.compId, compName: r.compName, qty: r.issueQty, remainingQty: r.remainingQty ?? r.issueQty }];
      const rem = items.reduce((acc, it) => acc + (it.remainingQty ?? it.qty ?? 0), 0);
      totalUnreturnedUnits += rem;
      if (r.overdue) overdueCount++;
      else onTimeCount++;
    });

    statsContainer.replaceChildren(
      h('div', { class: 'stat' },
        h('span', { class: 'small muted' }, '📦 Unreturned Hardware Units'),
        h('b', { style: 'color:var(--gold)' }, totalUnreturnedUnits),
        h('span', { class: 'small muted' }, 'Currently out of lab')
      ),
      h('div', { class: 'stat' },
        h('span', { class: 'small muted' }, '👥 Active Borrowings'),
        h('b', { style: 'color:var(--blue)' }, totalActiveCount),
        h('span', { class: 'small muted' }, 'Unreturned student passes')
      ),
      h('div', { class: 'stat' },
        h('span', { class: 'small muted' }, '⏱️ On-Time Active'),
        h('b', { style: 'color:var(--green)' }, onTimeCount),
        h('span', { class: 'small muted' }, 'Within return deadline')
      ),
      h('div', { class: 'stat' },
        h('span', { class: 'small muted' }, '🚨 Overdue Items'),
        h('b', { style: 'color:var(--red)' }, overdueCount),
        h('span', { class: 'small muted' }, 'Past return deadline')
      )
    );

    // Apply search and status filter
    const q = searchInput.value.trim().toLowerCase();
    const f = filterSel.value;

    const filtered = unreturnedRows.filter(r => {
      if (f === 'ontime' && r.overdue) return false;
      if (f === 'overdue' && !r.overdue) return false;
      if (f === 'partial' && r.status !== 'PARTIAL_RETURN') return false;
      if (!q) return true;
      const hay = `${r.gatePassNo || ''} ${r.enrollmentNo || ''} ${r.studentName || ''} ${r.compId || ''} ${r.compName || ''}`.toLowerCase();
      return hay.includes(q);
    });

    if (filtered.length === 0) {
      tbody.replaceChildren(
        h('tr', {}, h('td', { colspan: '9', style: 'text-align:center;padding:36px;color:var(--muted)' },
          unreturnedRows.length === 0
            ? '🎉 All issued hardware has been returned! No outstanding items.'
            : 'No matching outstanding records found.'
        ))
      );
      return;
    }

    tbody.replaceChildren(...filtered.map(r => {
      const items = Array.isArray(r.items) && r.items.length > 0
        ? r.items
        : [{ compId: r.compId, compName: r.compName, qty: r.issueQty, returnedQty: r.returnedQty || 0, remainingQty: r.remainingQty ?? r.issueQty }];

      const totalRem = items.reduce((acc, it) => acc + (it.remainingQty ?? (it.qty - (it.returnedQty || 0))), 0);
      const totalIssued = items.reduce((acc, it) => acc + (it.qty || 0), 0);

      // Due date with live countdown
      const dueCell = h('td', { style: 'white-space:nowrap' }, fmt(r.dueDate));
      ticks.push(() => {
        dueCell.textContent = `${fmt(r.dueDate)} · ${countdown(r.dueDate)}`;
      });

      // Status badge
      let statusBadge;
      if (r.overdue) {
        statusBadge = badge(`OVERDUE${r.daysLate ? ` +${r.daysLate}d` : ''}`, 'bad');
      } else if (r.status === 'PARTIAL_RETURN') {
        statusBadge = badge(`PARTIAL (${r.returnedQty}↩ / ${totalRem} left)`, 'warn');
      } else {
        statusBadge = badge('ISSUED', 'info');
      }

      // Items list cell
      const itemsCell = h('div', { class: 'ledger-comp-list', style: 'display:flex;flex-direction:column;gap:4px;min-width:160px;max-width:240px' },
        ...items.map(it => {
          const rem = it.remainingQty ?? (it.qty - (it.returnedQty || 0));
          return h('div', { class: 'comp-row', style: 'display:flex;align-items:baseline;gap:5px;flex-wrap:wrap;line-height:1.3' },
            h('span', { style: 'font-weight:700;color:var(--ink);font-size:0.88em' }, it.compName || it.compId),
            h('span', { class: 'muted', style: 'font-size:0.75em;font-family:monospace' }, `(${it.compId})`),
            h('span', { class: 'badge sm info', style: 'font-size:0.72em;padding:0 5px' }, `×${it.qty}`),
            rem < it.qty && h('span', { class: 'badge sm ok', style: 'font-size:0.7em' }, `↩${it.returnedQty}`),
            h('span', { class: `badge sm ${rem > 0 ? 'warn' : 'ok'}`, style: 'font-size:0.7em;font-weight:700' }, `${rem} left`)
          );
        })
      );

      return h('tr', {},
        h('td', {}, h('span', { class: 'chip', style: 'font-size:0.82em;font-weight:700' }, r.gatePassNo || `Pass #${r.seq}`)),
        h('td', {},
          h('div', { style: 'display:flex;flex-direction:column;gap:2px' },
            h('span', { style: 'font-weight:700;color:var(--ink);font-size:0.9em' }, r.studentName),
            h('span', { class: 'muted', style: 'font-size:0.76em;font-family:monospace' }, r.enrollmentNo)
          )
        ),
        h('td', { style: 'font-size:0.85em;color:var(--muted)' },
          r.studentMobile ? h('div', {}, `📱 ${r.studentMobile}`) : null,
          r.studentEmail ? h('div', { class: 'small' }, r.studentEmail) : null
        ),
        h('td', {}, itemsCell),
        h('td', { style: 'text-align:center;font-weight:800;font-size:0.95em' },
          h('span', { class: 'badge warn', style: 'font-size:0.85em;padding:3px 9px' }, `${totalRem} of ${totalIssued}`)
        ),
        h('td', { style: 'white-space:nowrap;font-size:0.85em' }, fmt(r.issueDate)),
        dueCell,
        h('td', {}, statusBadge),
        h('td', {}, r.fine ? h('strong', { style: 'color:var(--red)' }, `${rupees(r.fine)} (accruing)`) : h('span', { class: 'muted' }, 'ON TIME')),
        h('td', { class: 'row', style: 'gap:5px;white-space:nowrap' },
          h('button', {
            class: 'btn ghost sm',
            style: 'font-weight:700;border:1.5px solid var(--line);background:#fff',
            onclick: () => viewDetailsModal(r)
          }, '🔍 Details'),
          h('button', {
            class: 'btn ghost sm',
            onclick: () => openFile(`${b}/issues/${r.seq}/gatepass`)
          }, 'Gate Pass')
        )
      );
    }));

    ticks.forEach(f => f());
  }

  let searchTimeout;
  searchInput.oninput = () => { clearTimeout(searchTimeout); searchTimeout = setTimeout(loadOutstanding, 200); };
  filterSel.onchange = loadOutstanding;

  // Run initial load
  await loadOutstanding();

  const outstandingSection = h('div', { id: 'outstanding-section', class: 'stack', style: 'gap:14px;margin-top:10px' },
    h('div', { class: 'row', style: 'align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px' },
      h('div', {},
        h('h3', { style: 'margin:0;display:flex;align-items:center;gap:8px;color:var(--ink)' },
          '📦 Currently Issued & Unreturned Hardware Register'
        ),
        h('p', { class: 'muted small', style: 'margin:4px 0 0 0' },
          'Comprehensive tracking of all components currently out with students. Counts all borrowings where hardware has not been fully returned yet.'
        )
      ),
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
        h('button', {
          class: 'btn primary sm',
          style: 'display:inline-flex;align-items:center;gap:6px;font-weight:700',
          onclick: () => openFile(`${b}/reports/outstanding.pdf`)
        }, '📥 Download PDF Report')
      )
    ),

    statsContainer,

    h('div', { class: 'row', style: 'gap:10px;align-items:center;flex-wrap:wrap' },
      searchInput,
      filterSel,
      h('button', { class: 'btn ghost sm', onclick: loadOutstanding }, '🔄 Refresh')
    ),

    h('div', { class: 'tbl-wrap' },
      h('table', {},
        h('thead', {},
          h('tr', {},
            ['Gate Pass', 'Student', 'Contact', 'Components Issued', 'Remaining Qty', 'Issued At', 'Return Due At', 'Status', 'Fine', 'Actions']
              .map(x => h('th', {}, x))
          )
        ),
        tbody
      )
    )
  );

  wrap.replaceChildren(
    h('div', {},
      h('h3', { style: 'margin:0 0 4px 0' }, '📑 Department Reports & Exports'),
      h('p', { class: 'muted small', style: 'margin-bottom:14px' },
        'Generate official PDF slips, audit backups, and inspect currently issued hardware out in student possession.'
      ),
      reportCards
    ),
    outstandingSection
  );

  return {
    el: wrap,
    dispose: () => { ticks.length = 0; }
  };
}
