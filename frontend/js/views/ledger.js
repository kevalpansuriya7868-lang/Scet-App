import { api, openFile } from '../api.js';
import { h, fields, modal, toast, badge, fmt, rupees, countdown } from '../ui.js';
import { requestAuditTab } from './requestAudit.js';

function mailToast(msg, r) {
  if (r.emailed) toast(`${msg} Proof PDF emailed to the student.`);
  else if (r.isFullReturn === false) toast(msg); // partial return — no email expected
  else toast(`${msg} BUT the email was NOT sent: ${r.emailError || 'unknown error'}`, 'err');
}

/** Format a specification string into a clean bullet-point list */
export function specsModal(name, specs) {
  if (!specs) { toast('No specifications available.', 'err'); return; }
  const lines = specs
    .split(/[;\n]|(?:,\s*(?=[A-Z]|[a-z]{1,4}[:]))|(?:\.\s+(?=[A-Z]))/)
    .map((s) => s.replace(/^[,.\s]+|[,.\s]+$/g, '').trim())
    .filter((s) => s.length > 3);
  const items = lines.length > 1
    ? lines.map((l) => h('li', { style: 'margin-bottom:4px;line-height:1.5' }, l))
    : [h('li', {}, specs)];
  modal(name + ' — Specifications',
    h('div', { class: 'stack' },
      h('ul', { style: 'padding-left:18px;margin:0;list-style:disc' }, ...items)
    )
  );
}

export async function ledgerTab(code) {
  const base = `/api/branches/${code}/issues`;
  let overdueOnly = false;
  const heads = ['Pass', 'Enrollment', 'Student', 'Components', 'Total Qty', 'Issued', 'Due', 'Status', 'Fine', 'Issued by', 'Condition', ''];
  const q = h('input', { placeholder: 'Search enrollment no. or student name…' });
  const tbody = h('tbody');
  const ticks = [];

  // Helper to render condition chips (e.g. "1 Working", "1 Damaged", "1 Burnt")
  function renderConditionChips(condMap, fallbackCond, fallbackQty = 1) {
    let entries = [];
    if (condMap && typeof condMap === 'object') {
      ['Working', 'Damaged', 'Burnt', 'Lost'].forEach((c) => {
        const count = Number(condMap[c]) || 0;
        if (count > 0) entries.push({ cond: c, count });
      });
    }
    if (entries.length === 0 && fallbackCond && fallbackCond !== 'Pending') {
      entries = [{ cond: fallbackCond, count: fallbackQty }];
    }
    if (!entries.length) return h('span', { class: 'muted' }, '—');

    return h('div', { class: 'cond-chips-wrap', style: 'display:flex;flex-wrap:wrap;gap:4px;align-items:center' },
      ...entries.map(({ cond, count }) => {
        const cls = cond === 'Working' ? 'ok' : cond === 'Damaged' ? 'warn' : 'bad';
        return h('span', {
          class: `badge sm ${cls}`,
          style: 'font-size:0.75em;padding:2px 7px;font-weight:700;display:inline-flex;align-items:center;gap:3px'
        }, `${count} ${cond}`);
      })
    );
  }

  function getConditionText(condMap, fallbackCond, fallbackQty = 1) {
    if (condMap && typeof condMap === 'object') {
      const parts = ['Working', 'Damaged', 'Burnt', 'Lost']
        .filter((c) => (Number(condMap[c]) || 0) > 0)
        .map((c) => `${condMap[c]} ${c}`);
      if (parts.length > 0) return parts.join(', ');
    }
    return fallbackCond && fallbackCond !== 'Pending' ? `${fallbackQty} ${fallbackCond}` : '';
  }

  function viewRecordDetails(r) {
    const open = r.status === 'ISSUED' || r.status === 'PARTIAL_RETURN';
    const items = Array.isArray(r.items) && r.items.length > 0
      ? r.items
      : [{ compId: r.compId, compName: r.compName, qty: r.issueQty, returnedQty: r.returnedQty || 0, remainingQty: r.remainingQty, returnCondition: r.returnCondition, conditions: r.conditions }];
    const totalIssueQty = items.reduce((acc, it) => acc + (it.qty || 0), 0);
    const totalReturnedQty = items.reduce((acc, it) => acc + (it.returnedQty || 0), 0);
    const totalRemQty = totalIssueQty - totalReturnedQty;

    const body = h('div', { class: 'ledger-modal-content stack', style: 'gap:18px;font-size:15px;line-height:1.5' },
      // Top Hero Banner
      h('div', {
        style: 'background:linear-gradient(135deg, var(--soft) 0%, #fff 100%);padding:16px 20px;border-radius:14px;border:1.5px solid var(--line);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px'
      },
        h('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' },
          h('span', { class: 'chip', style: 'font-size:1em;padding:4px 14px;font-weight:700' }, r.gatePassNo || `Issue #${r.seq}`),
          r.status === 'RETURNED'
            ? h('span', { class: 'badge ok', style: 'font-size:0.9em;padding:4px 12px;font-weight:700' }, '✅ FULLY RETURNED')
            : r.status === 'PARTIAL_RETURN'
              ? h('span', { class: 'badge warn', style: 'font-size:0.9em;padding:4px 12px;font-weight:700' }, `⚠️ PARTIALLY RETURNED (${totalReturnedQty}/${totalIssueQty})`)
              : r.overdue
                ? h('span', { class: 'badge bad', style: 'font-size:0.9em;padding:4px 12px;font-weight:700' }, `🚨 OVERDUE (+${r.daysLate || 1}d)`)
                : h('span', { class: 'badge info', style: 'font-size:0.9em;padding:4px 12px;font-weight:700' }, '⏳ ISSUED (ACTIVE)')
        ),
        h('div', { style: 'display:flex;align-items:center;gap:12px;flex-wrap:wrap' },
          h('span', { class: 'muted', style: 'font-size:0.9em' }, `Issued: ${fmt(r.issueDate)}`),
          h('span', { class: 'chip', style: 'font-size:0.85em' }, `Dept ${code}`)
        )
      ),

      // Student + Timeline Cards Grid
      h('div', {
        style: 'display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:14px'
      },
        // Student Info
        h('div', { class: 'card', style: 'padding:16px;background:var(--soft);border:1px solid var(--line);border-radius:12px;margin:0' },
          h('div', { style: 'font-size:0.75em;font-weight:700;letter-spacing:0.06em;color:var(--muted);text-transform:uppercase;margin-bottom:6px' }, 'Student Details'),
          h('div', { style: 'font-size:1.35em;font-weight:800;color:var(--ink);margin-bottom:6px' }, r.studentName || '—'),
          h('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px' },
            h('span', { style: 'font-family:monospace;font-size:0.95em;font-weight:700;background:#fff;padding:3px 9px;border-radius:6px;border:1px solid var(--line)' }, r.enrollmentNo || '—'),
            h('span', { class: 'chip', style: 'font-size:0.78em;padding:2px 8px' }, r.studentBranch || code)
          ),
          r.studentMobile && h('div', { style: 'font-size:0.88em;color:var(--muted)' }, `📱 ${r.studentMobile}`),
          r.studentEmail && h('div', { style: 'font-size:0.88em;color:var(--muted)' }, `✉️ ${r.studentEmail}`)
        ),

        // Financial & Timeline Info
        h('div', { class: 'card', style: 'padding:16px;background:var(--soft);border:1px solid var(--line);border-radius:12px;margin:0' },
          h('div', { style: 'font-size:0.75em;font-weight:700;letter-spacing:0.06em;color:var(--muted);text-transform:uppercase;margin-bottom:6px' }, 'Timeline & Penalties'),
          h('div', { style: 'display:flex;flex-direction:column;gap:6px;font-size:0.92em' },
            h('div', { style: 'display:flex;justify-content:space-between' },
              h('span', { class: 'muted' }, 'Due Date:'),
              h('strong', {}, fmt(r.dueDate))
            ),
            r.returnDate && h('div', { style: 'display:flex;justify-content:space-between' },
              h('span', { class: 'muted' }, 'Returned On:'),
              h('strong', { style: 'color:var(--green)' }, fmt(r.returnDate))
            ),
            h('div', { style: 'display:flex;justify-content:space-between' },
              h('span', { class: 'muted' }, 'Fine / Penalty:'),
              h('strong', { style: r.fine > 0 ? 'color:var(--red);font-size:1.05em' : 'color:var(--green)' },
                r.fine > 0 ? `${rupees(r.fine)} ${open ? '(accruing)' : '(assessed)'}` : '₹0.00 (On Time)'
              )
            ),
            h('div', { style: 'display:flex;justify-content:space-between' },
              h('span', { class: 'muted' }, 'Issued By Admin:'),
              h('span', { style: 'font-weight:600' }, r.issuedBy || 'admin')
            ),
            r.returnedBy && h('div', { style: 'display:flex;justify-content:space-between' },
              h('span', { class: 'muted' }, 'Received By Admin:'),
              h('span', { style: 'font-weight:600' }, r.returnedBy)
            )
          )
        )
      ),

      // Components Breakdown & Return Condition Table (BIG TEXT)
      h('div', { class: 'card', style: 'padding:18px;border:1.5px solid var(--line);border-radius:14px;background:#fff;margin:0' },
        h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px' },
          h('h4', { style: 'margin:0;font-size:1.15em;font-weight:800;color:var(--ink)' }, '📦 Components Breakdown & Conditions'),
          h('span', { class: 'muted small', style: 'font-weight:600' }, `${totalIssueQty} total unit(s) · ${totalReturnedQty} returned · ${totalRemQty} remaining`)
        ),
        h('div', { class: 'tbl-wrap', style: 'border:1px solid #f1f5f9;border-radius:10px' },
          h('table', { style: 'width:100%;font-size:0.95em' },
            h('thead', {},
              h('tr', {},
                h('th', { style: 'padding:10px 14px' }, 'Component Name'),
                h('th', { style: 'padding:10px 14px' }, 'Hardware ID'),
                h('th', { style: 'padding:10px 14px;text-align:center' }, 'Issued'),
                h('th', { style: 'padding:10px 14px;text-align:center' }, 'Returned'),
                h('th', { style: 'padding:10px 14px' }, 'Return Condition Breakdown')
              )
            ),
            h('tbody', {},
              ...items.map(it => {
                const condChips = renderConditionChips(it.conditions, it.returnCondition, it.returnedQty || 0);
                return h('tr', {},
                  h('td', { style: 'font-weight:700;font-size:1.02em;color:var(--ink);padding:12px 14px' }, it.compName || it.compId),
                  h('td', { style: 'font-family:monospace;color:var(--muted);padding:12px 14px' }, it.compId),
                  h('td', { style: 'text-align:center;font-weight:700;padding:12px 14px' }, `×${it.qty}`),
                  h('td', { style: 'text-align:center;font-weight:700;padding:12px 14px' },
                    h('span', { class: `badge sm ${(it.returnedQty || 0) >= it.qty ? 'ok' : (it.returnedQty || 0) > 0 ? 'warn' : 'info'}` },
                      `${it.returnedQty || 0} / ${it.qty}`
                    )
                  ),
                  h('td', { style: 'padding:12px 14px' }, (it.returnedQty || 0) > 0 ? condChips : h('span', { class: 'muted' }, 'Not returned yet'))
                );
              })
            )
          )
        )
      )
    );

    const actions = [
      { label: '📄 View Gate Pass', cls: 'ghost', run: () => openFile(`${base}/${r.seq}/gatepass`) },
      ...(open ? [{ label: '↩ Process Return', cls: 'green', run: (close) => { close(); doReturn(r); } }] : [])
    ];

    modal(`📋 Issue Record #${r.seq} Details`, body, actions, true);
  }

  const load = async () => {
    const rows = await api(`${base}?q=${encodeURIComponent(q.value)}${overdueOnly ? '&overdue=1' : ''}`);
    ticks.length = 0;
    tbody.replaceChildren(...rows.map((r) => {
      const due = h('td', {}, fmt(r.dueDate));
      const open = r.status === 'ISSUED' || r.status === 'PARTIAL_RETURN';
      if (open) ticks.push(() => { due.textContent = `${fmt(r.dueDate)} · ${countdown(r.dueDate)}`; });

      // Status badge & return timestamp
      let statusBadge;
      if (r.status === 'RETURNED') {
        statusBadge = h('div', { style: 'display:flex;flex-direction:column;gap:3px;align-items:flex-start' },
          badge('RETURNED', 'ok'),
          r.returnDate && h('span', { style: 'font-size:0.75em;color:var(--green);font-weight:600' }, `↩ ${fmt(r.returnDate)}`),
          r.returnedBy && h('span', { class: 'muted', style: 'font-size:0.72em' }, `Recv: ${r.returnedBy}`)
        );
      } else if (r.status === 'PARTIAL_RETURN') {
        statusBadge = h('div', { style: 'display:flex;flex-direction:column;gap:3px;align-items:flex-start' },
          badge(`PARTIAL (${r.returnedQty}↩ / ${r.remainingQty} left)`, 'warn'),
          r.returnDate && h('span', { style: 'font-size:0.75em;color:var(--warn);font-weight:600' }, `↩ ${fmt(r.returnDate)}`),
          r.returnedBy && h('span', { class: 'muted', style: 'font-size:0.72em' }, `Recv: ${r.returnedBy}`)
        );
      } else {
        statusBadge = r.overdue ? badge(`OVERDUE${r.daysLate ? ` +${r.daysLate}d` : ''}`, 'bad') : badge('ISSUED', 'info');
      }

      // Component summary — show all item names prominently with ID in small text
      const items = Array.isArray(r.items) && r.items.length > 0
        ? r.items
        : [{ compId: r.compId, compName: r.compName, qty: r.issueQty, returnedQty: r.returnedQty || 0, remainingQty: r.remainingQty, returnCondition: r.returnCondition, conditions: r.conditions }];

      const compSummary = h('div', { class: 'ledger-comp-list', style: 'display:flex;flex-direction:column;min-width:170px;max-width:300px' },
        ...items.map((it, idx) => {
          const isReturned = (it.returnedQty || 0) > 0;
          const isFullyRet = (it.returnedQty || 0) >= it.qty;
          const condText = getConditionText(it.conditions, it.returnCondition, it.returnedQty);
          return h('div', {
            class: 'comp-row',
            style: `display:flex;align-items:center;justify-content:space-between;gap:8px;line-height:1.35;padding:6px 0;${idx < items.length - 1 ? 'border-bottom:1px solid var(--line,#cbd5e1);' : ''}`
          },
            h('div', { style: 'display:flex;align-items:baseline;gap:5px;flex-wrap:wrap;flex:1' },
              h('span', { style: 'font-weight:600;color:var(--text);font-size:0.9em' }, it.compName || it.compId),
              h('span', { class: 'muted', style: 'font-size:0.75em;font-family:monospace' }, `(${it.compId})`),
            ),
            h('div', { style: 'display:flex;align-items:center;gap:4px;flex-shrink:0' },
              h('span', { class: 'badge sm info', style: 'font-size:0.72em;padding:2px 6px;font-weight:700' }, `×${it.qty}`),
              isReturned && h('span', {
                class: `badge sm ${isFullyRet ? 'ok' : 'warn'}`,
                style: 'font-size:0.7em;padding:1px 6px',
                title: `Returned on ${fmt(r.returnDate)}`
              }, `↩ ${it.returnedQty}${condText ? ` (${condText})` : ''}`)
            )
          );
        })
      );

      const totalIssueQty = items.reduce((acc, it) => acc + (it.qty || 0), 0);
      let qtySummary;
      if (r.status === 'RETURNED') {
        qtySummary = h('div', { style: 'font-size:0.9em' },
          h('span', { style: 'font-weight:700;color:var(--green)' }, `${r.returnedQty || totalIssueQty}`),
          h('div', { class: 'small muted', style: 'font-size:0.75em' }, 'all returned')
        );
      } else if (r.status === 'PARTIAL_RETURN') {
        qtySummary = h('div', { style: 'font-size:0.9em' },
          h('span', { style: 'font-weight:700;color:var(--warn)' }, `${r.returnedQty || 0} / ${totalIssueQty}`),
          h('div', { class: 'small warn', style: 'font-size:0.75em' }, `${r.remainingQty} left`)
        );
      } else {
        qtySummary = h('span', { style: 'font-weight:700' }, totalIssueQty);
      }

      // Condition cell: itemized or overall with condition counts
      let conditionCell;
      if (r.status === 'RETURNED' || r.status === 'PARTIAL_RETURN' || (r.returnedQty && r.returnedQty > 0)) {
        const returnedItems = items.filter((it) => (it.returnedQty || 0) > 0);
        if (returnedItems.length > 1) {
          conditionCell = h('div', { style: 'display:flex;flex-direction:column;gap:5px;min-width:140px' },
            ...returnedItems.map((it) => h('div', { style: 'font-size:0.82em;line-height:1.3' },
              h('div', { style: 'font-weight:600;color:var(--text);margin-bottom:2px' }, it.compName || it.compId),
              renderConditionChips(it.conditions, it.returnCondition, it.returnedQty)
            ))
          );
        } else {
          const item = returnedItems[0] || items[0];
          const condMap = (item && item.conditions && Object.keys(item.conditions).length) ? item.conditions : r.conditions;
          conditionCell = renderConditionChips(condMap, r.returnCondition, r.returnedQty);
        }
      } else {
        conditionCell = h('span', { class: 'muted' }, '—');
      }

      const DELETE_WINDOW_MS = 10 * 60 * 1000;
      const issuedAt = r.issueDate ? new Date(r.issueDate).getTime() : 0;
      const canDelete = (Date.now() - issuedAt) < DELETE_WINDOW_MS;

      return h('tr', {},
        h('td', {}, r.gatePassNo), h('td', {}, r.enrollmentNo), h('td', {}, r.studentName),
        h('td', {}, compSummary),
        h('td', {}, qtySummary),
        h('td', {}, fmt(r.issueDate)), due,
        h('td', {}, statusBadge),
        h('td', {}, open ? (r.fine ? `${rupees(r.fine)} (accruing)` : 'ON TIME') : (r.fine ? rupees(r.fine) : 'ON TIME')),
        h('td', {}, r.issuedBy), h('td', {}, conditionCell),
        h('td', { class: 'row' },
          h('button', { class: 'btn ghost sm', style: 'font-weight:700;display:inline-flex;align-items:center;gap:3px;border:1.5px solid var(--line);background:#fff', onclick: () => viewRecordDetails(r) }, '🔍 Details'),
          open && h('button', { class: 'btn green sm', onclick: () => doReturn(r) }, 'Return'),
          h('button', { class: 'btn ghost sm', onclick: () => openFile(`${base}/${r.seq}/gatepass`) }, 'Gate pass'),
          open && h('button', { class: 'btn ghost sm', onclick: () => issueForm(r) }, 'Edit'),
          canDelete && h('button', { class: 'btn danger sm', onclick: () => del(r) }, 'Delete')));
    }));
    ticks.forEach((f) => f());
  };

  /* ─── Issue / Edit form ──────────────────────────────────────────────────── */
  async function issueForm(rec) {
    const comps = await api(`/api/catalog/${code}/components`);
    let allStudents = [];
    try {
      allStudents = await api('/api/auth/students');
    } catch {
      try { allStudents = await api(`/api/branches/${code}/students`); } catch { /* not admin */ }
    }

    // ── Student fields ────────────────────────────────────────────────────────
    const enrollEl  = h('input', { value: rec?.enrollmentNo || '', placeholder: 'Type enrollment number to search student…' });
    const nameEl    = h('input', { value: rec?.studentName    || '', placeholder: 'Student full name' });
    const branchEl  = h('input', { value: rec?.studentBranch  || code, placeholder: 'Branch' });
    const mobileEl  = h('input', { value: rec?.studentMobile  || '', placeholder: '10-digit mobile' });
    const emailEl   = h('input', { type: 'email', value: rec?.studentEmail || '', placeholder: 'student@scet.ac.in' });
    const daysEl    = h('input', { type: 'number', min: 0, value: 7 });

    const enrollHint = h('span', { style: 'font-size:0.78em;margin-top:3px;display:block;min-height:1.1em' });

    function fillStudent(s) {
      enrollEl.value  = s.enrollmentNo || '';
      nameEl.value    = s.displayName  || '';
      branchEl.value  = s.branch       || code;
      mobileEl.value  = s.mobile       || '';
      emailEl.value   = s.email        || `${(s.enrollmentNo || '').toLowerCase()}@scet.ac.in`;
      enrollHint.textContent = `✅ Auto-filled: ${s.displayName} · ${s.branch}`;
      enrollHint.style.color = 'var(--green, #22c55e)';
      enrollDropdown.replaceChildren();
      enrollDropdown.style.display = 'none';
    }

    const enrollDropdown = h('div', {
      class: 'student-search-results',
      style: 'display:none;position:absolute;left:0;right:0;top:100%;z-index:300',
    });

    let debounce;
    enrollEl.oninput = () => {
      clearTimeout(debounce);
      const val = enrollEl.value.trim();
      if (!val) { enrollDropdown.style.display = 'none'; enrollDropdown.replaceChildren(); enrollHint.textContent = ''; return; }
      const exact = allStudents.find((s) => s.enrollmentNo?.toUpperCase() === val.toUpperCase());
      if (exact) { fillStudent(exact); return; }
      debounce = setTimeout(async () => {
        const q = val.toLowerCase();
        let matches = allStudents.filter((s) => s.enrollmentNo?.toLowerCase().includes(q) || s.displayName?.toLowerCase().includes(q));
        if (!matches.length) {
          // Direct server lookup fallback by enrollment number
          try {
            const found = await api(`/api/auth/students/${encodeURIComponent(val.toUpperCase())}`);
            if (found && found.enrollmentNo && enrollEl.value.trim().toUpperCase() === val.toUpperCase()) {
              if (!allStudents.some(s => s.enrollmentNo?.toUpperCase() === found.enrollmentNo.toUpperCase())) {
                allStudents.push(found);
              }
              fillStudent(found);
              return;
            }
          } catch {
            try {
              const found = await api(`/api/branches/${code}/students/${encodeURIComponent(val.toUpperCase())}/info`);
              if (found && found.enrollmentNo && enrollEl.value.trim().toUpperCase() === val.toUpperCase()) {
                if (!allStudents.some(s => s.enrollmentNo?.toUpperCase() === found.enrollmentNo.toUpperCase())) {
                  allStudents.push(found);
                }
                fillStudent(found);
                return;
              }
            } catch {}
          }
          enrollHint.textContent = '❌ No registered student found — fill manually if needed.';
          enrollHint.style.color = 'var(--orange, #f97316)';
          enrollDropdown.style.display = 'none';
          return;
        }
        enrollHint.textContent = `${matches.length} match(es) found — select below`;
        enrollHint.style.color = 'var(--muted, #888)';
        enrollDropdown.replaceChildren(
          ...matches.slice(0, 8).map((s) =>
            h('button', { class: 'search-result-item', type: 'button',
              onmousedown: (e) => { e.preventDefault(); fillStudent(s); } },
              h('div', { class: 'sri-name' }, s.displayName || s.enrollmentNo),
              h('div', { class: 'sri-sub' }, `${s.enrollmentNo}  ·  ${s.branch}  ·  ${s.mobile || '—'}`),
            )
          )
        );
        enrollDropdown.style.display = 'block';
      }, 200);
    };

    enrollEl.onchange = async () => {
      const val = enrollEl.value.trim().toUpperCase();
      if (!val) return;
      const exact = allStudents.find((s) => s.enrollmentNo?.toUpperCase() === val);
      if (exact) { fillStudent(exact); return; }
      try {
        const found = await api(`/api/auth/students/${encodeURIComponent(val)}`);
        if (found && found.enrollmentNo) {
          allStudents.push(found);
          fillStudent(found);
        }
      } catch {}
    };

    enrollEl.onblur = () => setTimeout(() => {
      enrollDropdown.style.display = 'none';
      if (!nameEl.value && enrollEl.value && !emailEl.value.includes('@'))
        emailEl.value = `${enrollEl.value.trim().toLowerCase()}@scet.ac.in`;
    }, 220);

    enrollEl.onfocus = () => { if (enrollDropdown.children.length) enrollDropdown.style.display = 'block'; };

    function makeField(label, inputEl, extra) {
      return h('div', { class: 'field', style: 'position:relative' },
        h('span', {}, label), inputEl, ...(extra ? [extra] : []));
    }

    // ── Multi-item component picker ───────────────────────────────────────────
    /**
     * Each row: { compId, qty }
     * We start with the items from `rec` (if editing) or a blank row.
     */
    const existingItems = rec && Array.isArray(rec.items) && rec.items.length > 0
      ? rec.items.map((it) => ({ compId: it.compId, qty: it.qty }))
      : rec?.compId
        ? [{ compId: rec.compId, qty: rec.issueQty }]
        : [{ compId: '', qty: 1 }];

    let itemRows = [...existingItems];
    const itemsContainer = h('div', { class: 'stack', style: 'gap:6px' });

    function buildSelect(selected) {
      return h('select', { style: 'flex:1;min-width:0' },
        h('option', { value: '' }, '— Select component —'),
        ...comps.map((c) => {
          const opt = h('option', { value: c.compId }, `${c.compId} — ${c.name} (${c.availableQty} avail.)`);
          if (selected === c.compId) opt.selected = true;
          return opt;
        })
      );
    }

    function renderItemRows() {
      itemsContainer.replaceChildren(
        ...itemRows.map((row, idx) => {
          const sel  = buildSelect(row.compId);
          const qty  = h('input', {
            type: 'number', min: 1, value: row.qty,
            style: 'width:70px;text-align:center;flex-shrink:0',
          });
          sel.onchange  = () => { itemRows[idx].compId = sel.value; };
          qty.oninput   = () => { itemRows[idx].qty = Number(qty.value) || 1; };

          const removeBtn = itemRows.length > 1
            ? h('button', {
                type: 'button', title: 'Remove this row',
                class: 'btn danger sm',
                style: 'flex-shrink:0;padding:4px 10px',
                onclick: () => { itemRows.splice(idx, 1); renderItemRows(); },
              }, '✕')
            : null;

          return h('div', {
            style: 'display:flex;align-items:center;gap:8px;background:var(--surface2,#f8f9fa);border:1px solid var(--line,#e0e0e0);border-radius:8px;padding:8px 10px',
          },
            h('span', { style: 'font-size:0.8em;font-weight:700;color:var(--muted);width:22px;text-align:center;flex-shrink:0' }, `${idx + 1}.`),
            sel,
            h('span', { style: 'font-size:0.8em;color:var(--muted);flex-shrink:0' }, 'Qty:'),
            qty,
            removeBtn,
          );
        }),
        // Add another component row
        h('button', {
          type: 'button', class: 'btn ghost sm',
          style: 'align-self:flex-start;margin-top:2px',
          onclick: () => { itemRows.push({ compId: '', qty: 1 }); renderItemRows(); },
        }, '＋ Add another component'),
      );
    }

    renderItemRows();

    const itemsField = h('div', { class: 'field' },
      h('span', {}, 'Components to Issue'),
      h('div', { style: 'font-size:0.75em;color:var(--muted);margin-bottom:6px' },
        'You can add multiple components in a single gate pass. Each row is one component type.'),
      itemsContainer,
    );

    // ── Edit mode: only show Duration field ─────────────────────────────────
    if (rec) {
      const items = Array.isArray(rec.items) && rec.items.length > 0 ? rec.items : [{ compId: rec.compId, qty: rec.issueQty }];
      const daysEditEl = h('input', { type: 'number', min: 0, value: 7 });

      const infoBox = h('div', {
        style: 'background:var(--surface2,#f0f4ff);border:1.5px solid var(--line,#c7d2fe);border-radius:10px;padding:14px 16px;font-size:0.88em;line-height:1.7;color:var(--ink)'
      },
        h('div', { style: 'font-weight:700;margin-bottom:8px;font-size:0.95em' }, `🎫 ${rec.gatePassNo}`),
        h('div', {}, `👤 ${rec.studentName} (${rec.enrollmentNo})`),
        h('div', {}, `🏫 ${rec.studentBranch}  ·  📞 ${rec.studentMobile}`),
        h('div', { style: 'margin-top:8px;font-weight:600' }, 'Components:'),
        h('ul', { style: 'margin:4px 0 0;padding-left:18px' },
          ...items.map((it) => h('li', {}, `${it.compId} × ${it.qty}`))
        ),
        h('div', { style: 'margin-top:10px;padding:8px 10px;background:#fef9c3;border-radius:6px;font-size:0.82em;color:#92400e' },
          '🔒 Student details and components are locked after issue. Only the return deadline can be changed.'
        ),
      );

      const editForm = h('div', { class: 'stack' },
        infoBox,
        makeField('New Duration (days — new due at 4 PM)', daysEditEl),
      );

      modal(`Edit deadline — ${rec.gatePassNo}`, editForm, [{
        label: 'Update deadline & resend gate pass', cls: 'green',
        run: async (close) => {
          const body = { days: Number(daysEditEl.value) };
          const r = await api(`${base}/${rec.seq}`, { method: 'PUT', body });
          mailToast('Deadline updated.', r); close(); load();
        }
      }], true);
      return; // early exit — don't fall through to the new-issue form
    }

    // ── New issue form continues below ────────────────────────────────────────
    const formEl = h('div', { class: 'stack' },
      makeField('Enrollment No.', enrollEl,
        h('div', { style: 'position:relative' }, enrollDropdown, enrollHint)),
      makeField('Student Name',        nameEl),
      makeField('Branch',              branchEl),
      makeField('Mobile',              mobileEl),
      makeField('Email (@scet.ac.in)', emailEl),
      itemsField,
      makeField('Duration (days — due at 4 PM)', daysEl),
    );

    modal('Issue Components', formEl, [{
      label: 'Issue & email gate pass', cls: 'green',
      run: async (close) => {
        // Validate items before sending
        const finalItems = itemRows.map((it) => ({ compId: it.compId, qty: Number(it.qty) }));
        if (finalItems.some((it) => !it.compId)) { toast('Please select a component for every row.', 'err'); return; }
        if (finalItems.some((it) => it.qty < 1)) { toast('Quantity must be at least 1.', 'err'); return; }
        const body = {
          enrollmentNo: enrollEl.value, studentName: nameEl.value, studentBranch: branchEl.value,
          studentMobile: mobileEl.value, studentEmail: emailEl.value,
          items: finalItems,
          days: Number(daysEl.value),
        };
        const r = await api(base, { method: 'POST', body });
        mailToast('Issued.', r); close(); load();
      }
    }], true);
  }

  /* ─── Return form ────────────────────────────────────────────────────────── */
  function doReturn(r) {
    // Normalise items with per-item remaining quantities from server
    const allItems = (Array.isArray(r.items) && r.items.length > 0
      ? r.items
      : [{ compId: r.compId, compName: r.compName, qty: r.issueQty }]
    ).map((it) => ({
      ...it,
      returnedQty: it.returnedQty || 0,
      remainingQty: it.remainingQty ?? it.qty,
    }));

    // Only show items that still have units outstanding
    const pendingItems = allItems.filter((it) => it.remainingQty > 0);
    if (!pendingItems.length) { toast('All items in this gate pass have already been returned.', 'warn'); return; }

    // Build per-item input rows with condition breakdown
    const COND_COLORS = { Working: '#16a34a', Damaged: '#d97706', Burnt: '#dc2626', Lost: '#7c3aed' };
    const itemInputs = pendingItems.map((it) => {
      const isSingle = it.remainingQty === 1;
      const afterSpan = h('span', { style: 'font-weight:700;color:var(--green,#16a34a);min-width:24px;text-align:center' }, '0');

      let getConditions, getReturnQty, condWidget;

      if (isSingle) {
        const qtyInput = h('input', {
          type: 'number', min: 0, max: 1, value: 1,
          style: 'width:46px;text-align:center;font-weight:700;border-radius:6px;border:1.5px solid var(--line,#e0e0e0);padding:3px 4px',
        });
        const condSelect = h('select', {
          style: 'font-size:0.82em;border-radius:6px;border:1.5px solid var(--line,#e0e0e0);padding:3px 6px;font-weight:700;color:#16a34a;background:#fff',
          onchange() { this.style.color = COND_COLORS[this.value] || '#333'; sync(); },
        },
          ...['Working', 'Damaged', 'Burnt', 'Lost'].map((c) => h('option', { value: c }, c))
        );
        qtyInput.oninput = () => sync();

        function sync() {
          const v = Math.min(Math.max(0, Number(qtyInput.value) || 0), 1);
          const rem = 1 - v;
          afterSpan.textContent = String(rem);
          afterSpan.style.color = rem === 0 ? 'var(--green,#16a34a)' : 'var(--orange,#f97316)';
          updateTotal();
          updateCondSummary();
        }

        getReturnQty = () => Math.min(Math.max(0, Number(qtyInput.value) || 0), 1);
        getConditions = () => {
          const q = getReturnQty();
          return q > 0 ? { [condSelect.value]: q } : {};
        };
        condWidget = h('div', { style: 'display:flex;align-items:center;gap:6px' },
          h('span', { style: 'font-size:0.8em;color:var(--muted)' }, 'Qty:'),
          qtyInput,
          condSelect
        );
      } else {
        // Multi-quantity: provide inputs for Working, Damaged, Burnt, Lost
        const counts = { Working: it.remainingQty, Damaged: 0, Burnt: 0, Lost: 0 };
        const inputs = {};
        const condGrid = h('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center' },
          ...['Working', 'Damaged', 'Burnt', 'Lost'].map((c) => {
            const inp = h('input', {
              type: 'number', min: 0, max: it.remainingQty, value: counts[c],
              style: `width:46px;text-align:center;font-weight:700;border-radius:6px;border:1.5px solid ${COND_COLORS[c]};padding:2px 3px;font-size:0.82em;color:${COND_COLORS[c]}`,
            });
            inputs[c] = inp;
            inp.oninput = () => {
              counts[c] = Math.max(0, Number(inp.value) || 0);
              sync();
            };
            return h('label', { style: 'display:inline-flex;align-items:center;gap:3px;font-size:0.78em;font-weight:700' },
              h('span', { style: `color:${COND_COLORS[c]}` }, c.slice(0, 4) + ':'),
              inp
            );
          })
        );

        function sync() {
          const sum = Object.values(counts).reduce((a, b) => a + b, 0);
          const rem = it.remainingQty - sum;
          afterSpan.textContent = rem < 0 ? `⚠ ${rem}` : String(rem);
          afterSpan.style.color = rem === 0 ? 'var(--green,#16a34a)' : rem < 0 ? 'var(--red,#dc2626)' : 'var(--orange,#f97316)';
          updateTotal();
          updateCondSummary();
        }

        getReturnQty = () => Object.values(counts).reduce((a, b) => a + b, 0);
        getConditions = () => {
          const res = {};
          Object.entries(counts).forEach(([k, v]) => { if (v > 0) res[k] = v; });
          return res;
        };
        condWidget = condGrid;
      }

      return { it, getReturnQty, getConditions, afterSpan, condWidget };
    });

    // Total summary bar
    const totalBar = h('div', { style: 'padding:7px 12px;background:var(--surface2,#f0f4ff);border-radius:6px;font-size:0.85em;font-weight:600;color:var(--ink)' });
    function updateTotal() {
      const ret = itemInputs.reduce((s, inp) => s + inp.getReturnQty(), 0);
      const out = pendingItems.reduce((s, it) => s + it.remainingQty, 0);
      totalBar.textContent = `Returning ${ret} of ${out} outstanding unit(s) — ${out - ret} will remain out`;
    }
    updateTotal();

    // Grid header
    const gridHead = h('div', {
      style: 'display:grid;grid-template-columns:1fr auto 50px;gap:8px 12px;padding:8px 12px;background:var(--primary,#1a3a8f);color:#fff;border-radius:8px 8px 0 0;font-size:0.76em;font-weight:700;letter-spacing:.03em;align-items:center',
    },
      h('span', {}, 'Component'),
      h('span', { style: 'text-align:center' }, 'Return Condition & Quantities'),
      h('span', { style: 'text-align:center' }, 'After'),
    );

    const gridRows = itemInputs.map(({ it, condWidget, afterSpan }, idx) =>
      h('div', {
        style: `display:grid;grid-template-columns:1fr auto 50px;gap:8px 12px;padding:10px 12px;align-items:center;background:${idx % 2 === 0 ? '#fff' : 'var(--surface2,#f8f9fa)'};border:1px solid var(--line,#e0e0e0);border-top:none`,
      },
        h('div', {},
          h('div', { style: 'font-weight:700;font-size:0.88em;color:var(--ink)' }, it.compName || it.compId),
          h('div', { style: 'font-size:0.75em;color:var(--muted);font-family:monospace' }, it.compId),
          h('div', { style: 'font-size:0.78em;color:var(--orange,#f97316);font-weight:600;margin-top:2px' }, `Outstanding: ${it.remainingQty}`),
        ),
        condWidget,
        h('div', { style: 'display:flex;justify-content:center' }, afterSpan),
      )
    );

    // Summary section — shows how many items per condition (live update)
    const condSummaryBox = h('div', { style: 'font-size:0.8em;color:var(--muted);margin-top:4px;display:flex;flex-wrap:wrap;gap:6px' });
    function updateCondSummary() {
      const groups = {};
      itemInputs.forEach(({ it, getConditions }) => {
        const conds = getConditions();
        Object.entries(conds).forEach(([c, cnt]) => {
          if (!groups[c]) groups[c] = [];
          groups[c].push(`${it.compName || it.compId} ×${cnt}`);
        });
      });
      const COND_BADGE = { Working: '#16a34a', Damaged: '#d97706', Burnt: '#dc2626', Lost: '#7c3aed' };
      condSummaryBox.replaceChildren(
        ...Object.entries(groups).map(([cond, items]) =>
          h('span', {
            style: `display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:12px;font-weight:700;font-size:0.85em;background:${COND_BADGE[cond]}18;border:1.5px solid ${COND_BADGE[cond]}40;color:${COND_BADGE[cond]}`
          },
            h('span', {}, cond + ':'),
            h('span', { title: items.join(', '), style: 'font-weight:400' }, items.join(', '))
          )
        )
      );
    }
    updateCondSummary();

    const body = h('div', { class: 'stack' },
      r.fine ? h('p', { class: 'badge b-warn' }, `⚠ Late fine payable: ${rupees(r.fine)}`) : h('p', { class: 'muted' }, '✅ Returned on time — no fine.'),
      h('div', { class: 'field' },
        h('span', {}, 'Return quantity & condition per component'),
        h('div', { style: 'font-size:0.75em;color:var(--muted);margin-bottom:6px' }, 'Specify quantities for each condition (Working, Damaged, Burnt, Lost). You can return items in multiple conditions.'),
        h('div', { style: 'border-radius:8px;overflow:hidden;border:1px solid var(--line,#e0e0e0)' }, gridHead, ...gridRows),
        h('div', { style: 'margin-top:6px' }, totalBar),
        h('div', { class: 'field', style: 'margin-top:8px' },
          h('span', { style: 'font-size:0.82em;font-weight:600' }, 'Condition summary:'),
          condSummaryBox,
        ),
      ),
    );

    modal(`Return ${r.gatePassNo}`, body, [{
      label: 'Confirm return', cls: 'green',
      run: async (close) => {
        const itemReturns = [];
        for (const { it, getReturnQty, getConditions } of itemInputs) {
          const retQty = getReturnQty();
          if (retQty > it.remainingQty) {
            toast(`Total returned for ${it.compName || it.compId} (${retQty}) exceeds remaining (${it.remainingQty}).`, 'err');
            return;
          }
          if (retQty > 0) {
            const conditions = getConditions();
            const active = Object.keys(conditions);
            const SEVERITY = { Working: 0, Damaged: 1, Burnt: 2, Lost: 3 };
            const condition = active.reduce((w, c) => SEVERITY[c] > SEVERITY[w] ? c : w, 'Working');
            itemReturns.push({
              compId: it.compId,
              returnQty: retQty,
              condition,
              conditions,
            });
          }
        }

        if (!itemReturns.length) { toast('Please enter at least one unit to return.', 'err'); return; }

        const x = await api(`${base}/${r.seq}/return`, {
          method: 'POST', body: { itemReturns },
        });
        const msg = x.isFullReturn
          ? `All items fully returned. Fine: ${rupees(x.fine)}.`
          : `Partial return recorded (${x.totalReturnQty} unit(s)). Fine so far: ${rupees(x.fine)}.`;
        mailToast(msg, x);
        close(); load();
      }
    }]);
  }

  async function del(r) {
    if (!confirm(`Permanently delete record ${r.gatePassNo}?`)) return;
    try { await api(`${base}/${r.seq}`, { method: 'DELETE' }); toast('Record deleted.'); load(); } catch (e) { toast(e.message, 'err'); }
  }

  /* ─── Student Component Requests Workflow ─────────────────────────────── */
  let activeTab = 'ledger'; // 'ledger' | 'requests' | 'request-audit'
  let requestsList = [];
  let requestFilter = 'ALL'; // 'ALL' | 'PENDING' | 'ACCEPTED' | 'ISSUED' | 'REJECTED'

  const ledgerTblWrap = h('div', { class: 'tbl-wrap' },
    h('table', {},
      h('thead', {}, h('tr', {}, heads.map((x) => h('th', {}, x)))),
      tbody
    )
  );

  const requestsContainer = h('div', { style: 'display:none' });
  const requestAuditContainer = h('div', { style: 'display:none' });

  function acceptModal(r) {
    const timeInput = h('input', {
      placeholder: 'e.g. Today 9:00 AM - 11:00 AM, Tomorrow 2:00 PM - 4:00 PM',
      value: r.collectionTime || ''
    });
    const locationInput = h('input', {
      placeholder: 'e.g. Hardware Lab Counter - Room 302 / Desk 1',
      value: r.collectionLocation || `Hardware Lab Counter (${code} Dept)`
    });
    const noteInput = h('input', {
      placeholder: 'e.g. Bring Student College ID Card and project notebook',
      value: r.collectionNote || ''
    });

    const standardSlots = [
      '9:00 AM - 11:00 AM',
      '11:00 AM - 1:00 PM',
      '2:00 PM - 4:00 PM',
      '4:00 PM - 4:30 PM',
    ];

    function highlightChip(activeBtn) {
      presetChips.querySelectorAll('button').forEach((b) => {
        b.style.borderColor = 'var(--line)';
        b.style.background = '#fff';
        b.style.color = 'var(--ink)';
      });
      activeBtn.style.borderColor = 'var(--green)';
      activeBtn.style.background = 'rgba(5,150,105,0.12)';
      activeBtn.style.color = 'var(--green)';
    }

    const todayChips = h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center' },
      h('span', { class: 'muted small', style: 'font-weight:700;min-width:65px' }, 'Today:'),
      ...standardSlots.map((s) => {
        const full = `Today ${s}`;
        return h('button', {
          type: 'button',
          class: 'btn ghost sm',
          style: 'font-size:0.78em;padding:3px 9px;border-radius:12px;background:#fff;border:1.5px solid var(--line);font-weight:600',
          onclick: (e) => {
            timeInput.value = full;
            highlightChip(e.currentTarget);
          }
        }, s);
      })
    );

    const tomorrowChips = h('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;align-items:center' },
      h('span', { class: 'muted small', style: 'font-weight:700;min-width:65px' }, 'Tomorrow:'),
      ...standardSlots.map((s) => {
        const full = `Tomorrow ${s}`;
        return h('button', {
          type: 'button',
          class: 'btn ghost sm',
          style: 'font-size:0.78em;padding:3px 9px;border-radius:12px;background:#fff;border:1.5px solid var(--line);font-weight:600',
          onclick: (e) => {
            timeInput.value = full;
            highlightChip(e.currentTarget);
          }
        }, s);
      })
    );

    const presetChips = h('div', { style: 'display:flex;flex-direction:column;gap:6px;margin-top:8px' },
      todayChips,
      tomorrowChips
    );

    const items = Array.isArray(r.items) && r.items.length > 0 ? r.items : [{ compId: r.compId, compName: r.compName, qty: r.qty || 1 }];
    const itemsSummary = items.map((it) => `${it.qty} × ${it.compName || it.compId} (${it.compId})`).join(', ');

    const body = h('div', { class: 'stack', style: 'gap:14px' },
      h('div', { style: 'background:var(--soft);padding:12px 16px;border-radius:10px;border:1px solid var(--line)' },
        h('div', { style: 'font-weight:800;font-size:1.05em;color:var(--ink)' }, `${r.studentName} (${r.enrollmentNo})`),
        h('div', { class: 'muted small', style: 'margin-top:2px' }, `Dept: ${r.studentBranch || code} · 📱 ${r.studentMobile || '—'} · ✉️ ${r.studentEmail || '—'}`),
        h('div', { style: 'margin-top:8px;font-size:0.92em' },
          h('b', {}, 'Components: '), itemsSummary
        ),
        h('div', { style: 'margin-top:4px;font-size:0.88em' },
          h('b', {}, 'Duration: '), `${r.days} days · `,
          h('b', {}, 'Purpose: '), r.purpose || '—'
        )
      ),
      h('div', { class: 'field' },
        h('span', {}, 'Collection Time Slot (Required):'),
        timeInput,
        presetChips
      ),
      h('div', { class: 'field' },
        h('span', {}, 'Pickup Location Given to Student (Required):'),
        locationInput
      ),
      h('div', { class: 'field' },
        h('span', {}, 'Additional Instructions / Notes (Optional):'),
        noteInput
      )
    );

    const modalActions = [
      {
        label: '✓ Confirm Acceptance',
        cls: 'green',
        run: async (close) => {
          const collectionTime = timeInput.value.trim();
          if (!collectionTime) { toast('Please specify a collection time slot.', 'err'); return; }
          const collectionLocation = locationInput.value.trim() || 'Hardware Lab Counter';
          const collectionNote = noteInput.value.trim();

          await api(`/api/branches/${code}/requests/${r.id}/accept`, {
            method: 'POST',
            body: { collectionTime, collectionLocation, collectionNote }
          });
          toast('✓ Request accepted! Confirmation email sent to student.', 'ok');
          close();
          await loadRequests();
        }
      },
      { label: 'Cancel', run: (close) => close() }
    ];

    modal(`Accept Request #${r.id.slice(-6)}`, body, modalActions, true);
  }

  function oneClickIssue(r) {
    const items = Array.isArray(r.items) && r.items.length > 0 ? r.items : [{ compId: r.compId, compName: r.compName, qty: r.qty || 1 }];
    const itemsSummary = items.map((it) => `${it.qty} × ${it.compName || it.compId} (${it.compId})`).join(', ');

    const body = h('div', { class: 'stack', style: 'gap:12px' },
      h('div', { style: 'background:rgba(217,119,6,0.08);border:1.5px solid var(--gold);padding:14px;border-radius:10px' },
        h('div', { style: 'font-weight:800;font-size:1.1em;color:var(--ink);margin-bottom:6px' }, '⚡ Ready for One-Click Checkout'),
        h('div', { style: 'font-size:0.92em;line-height:1.5' },
          `Student `, h('b', {}, r.studentName), ` (${r.enrollmentNo}) has arrived at the counter to collect the requested components.`
        )
      ),
      h('div', { style: 'background:var(--soft);padding:12px 14px;border-radius:10px;border:1px solid var(--line);font-size:0.9em' },
        h('div', { style: 'margin-bottom:4px' }, h('b', {}, 'Components to Issue: '), itemsSummary),
        h('div', { style: 'margin-bottom:4px' }, h('b', {}, 'Loan Duration: '), `${r.days} days`),
        h('div', {}, h('b', {}, 'Student Contact: '), `${r.studentMobile || '—'} · ${r.studentEmail || '—'}`)
      ),
      h('div', { style: 'font-size:0.85em;color:var(--muted);line-height:1.4' },
        'Clicking "⚡ Issue Now" will immediately:',
        h('ul', { style: 'margin:4px 0 0 16px;padding:0' },
          h('li', {}, 'Deduct required quantities from catalog stock'),
          h('li', {}, 'Generate official Gate Pass (SCET-GP-...)'),
          h('li', {}, 'Register record in the Issue & Return Ledger'),
          h('li', {}, 'Email the official Gate Pass PDF to student and CC lab admin')
        )
      )
    );

    modal(`⚡ One-Click Issue — ${r.studentName}`, body, [{
      label: '⚡ Confirm & Issue Now',
      cls: 'gold',
      run: async (close) => {
        try {
          const res = await api(`/api/branches/${code}/requests/${r.id}/issue`, {
            method: 'POST'
          });
          mailToast(`Issued! Gate Pass ${res.gatePassNo} generated.`, res);
          close();
          await Promise.all([loadRequests(), load()]);
        } catch (err) {
          toast(err.message || 'Failed to issue components.', 'err');
        }
      }
    }], true);
  }

  function rejectModal(r) {
    const reasonInput = h('textarea', {
      rows: 3,
      placeholder: 'State reason (e.g. Component currently out of stock or reserved for exam lab)'
    }, 'Item unavailable or allocation limit reached for this week.');

    modal(`Reject Request #${r.id.slice(-6)}`, h('div', { class: 'stack' },
      h('p', { class: 'muted' }, `Reject request for ${r.studentName} (${r.enrollmentNo})? An email will be sent explaining the reason.`),
      h('div', { class: 'field' },
        h('span', {}, 'Rejection Reason:'),
        reasonInput
      )
    ), [{
      label: 'Confirm Rejection',
      cls: 'danger',
      run: async (close) => {
        const reason = reasonInput.value.trim();
        await api(`/api/branches/${code}/requests/${r.id}/reject`, {
          method: 'POST',
          body: { reason }
        });
        toast('Request rejected and notification email sent.');
        close();
        await loadRequests();
      }
    }]);
  }

  function showIdCardModal(imgSrc, studentName) {
    if (!imgSrc) {
      toast('No ID card image available.', 'err');
      return;
    }
    const body = h('div', { style: 'text-align:center;padding:10px;' },
      h('div', { style: 'background:#0f172a;border-radius:12px;padding:12px;display:inline-block;max-width:100%;box-shadow:0 8px 30px rgba(0,0,0,0.3);border:1px solid #334155;' },
        h('img', {
          src: imgSrc,
          alt: `Student ID Card - ${studentName}`,
          style: 'max-height:70vh;max-width:100%;border-radius:8px;object-fit:contain;display:block;margin:0 auto;'
        })
      ),
      h('div', { style: 'margin-top:14px;display:flex;justify-content:center;gap:10px;align-items:center;flex-wrap:wrap;' },
        h('span', { class: 'badge ok', style: 'font-size:0.85em;padding:4px 12px;' }, '✅ Official SCET ID Card Verified'),
        h('button', {
          type: 'button',
          class: 'btn ghost sm',
          onclick: () => {
            const w = window.open();
            if (w) {
              w.document.write(`<img src="${imgSrc}" style="max-width:100%;height:auto;display:block;margin:20px auto;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.2);">`);
              w.document.title = `SCET ID Card - ${studentName}`;
            }
          }
        }, '🔍 Open Full Resolution')
      )
    );

    modal(`🪪 SCET ID Card — ${studentName}`, body, [{ label: 'Close', run: (close) => close() }], true);
  }

  function viewRequestDetails(r) {
    const items = Array.isArray(r.items) && r.items.length > 0 ? r.items : [{ compId: r.compId, compName: r.compName, qty: r.qty || 1 }];

    const idCardBox = h('div', { class: 'card', style: 'padding:14px;border:1px solid var(--line);border-radius:10px;background:#fff;margin:0' },
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px' },
        h('h4', { style: 'margin:0;font-weight:800;font-size:0.95em;display:flex;align-items:center;gap:6px' }, '🪪 SCET Student ID Card'),
        h('span', { class: 'badge sm ok' }, '✓ Official ID')
      ),
      h('div', { class: 'muted small' }, 'Loading ID card image...')
    );

    const loadIdCard = async () => {
      let imgSrc = r.idCardImage;
      if (!imgSrc) {
        try {
          const res = await api(`/api/branches/${code}/requests/${r.id}/idcard`);
          if (res?.idCardImage) {
            imgSrc = res.idCardImage;
            r.idCardImage = imgSrc;
          }
        } catch {}
      }
      if (imgSrc) {
        idCardBox.replaceChildren(
          h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px' },
            h('h4', { style: 'margin:0;font-weight:800;font-size:0.95em;display:flex;align-items:center;gap:6px' }, '🪪 SCET Student ID Card'),
            h('span', { class: 'badge sm ok' }, '✓ OCR Verified')
          ),
          h('div', {
            style: 'text-align:center;background:#0f172a;border-radius:8px;padding:8px;position:relative;cursor:pointer',
            title: 'Click to view high resolution',
            onclick: () => showIdCardModal(imgSrc, r.studentName)
          },
            h('img', {
              src: imgSrc,
              alt: `ID Card - ${r.studentName}`,
              style: 'max-height:220px;max-width:100%;border-radius:6px;object-fit:contain;display:block;margin:0 auto;'
            }),
            h('div', { class: 'muted small', style: 'color:#94a3b8;font-size:0.75em;margin-top:6px' }, '🔍 Click image to enlarge')
          )
        );
      } else {
        idCardBox.replaceChildren(
          h('div', { style: 'display:flex;justify-content:space-between;align-items:center;' },
            h('h4', { style: 'margin:0;font-weight:800;font-size:0.95em;display:flex;align-items:center;gap:6px' }, '🪪 SCET Student ID Card'),
            h('span', { class: 'badge sm warn' }, 'No Image on File')
          ),
          h('div', { class: 'muted small', style: 'margin-top:4px' }, 'No ID card photo on file for this record.')
        );
      }
    };
    loadIdCard();

    const body = h('div', { class: 'stack', style: 'gap:14px;font-size:15px;line-height:1.5' },
      h('div', { style: 'background:var(--soft);padding:14px;border-radius:12px;border:1px solid var(--line)' },
        h('div', { style: 'font-size:1.2em;font-weight:800;color:var(--ink)' }, r.studentName),
        h('div', { style: 'display:flex;gap:8px;margin-top:4px;flex-wrap:wrap' },
          h('span', { style: 'font-family:monospace;font-weight:700' }, r.enrollmentNo),
          h('span', { class: 'chip' }, r.studentBranch || code),
          r.studentMobile && h('span', { class: 'muted small' }, `📱 ${r.studentMobile}`),
          r.studentEmail && h('span', { class: 'muted small' }, `✉️ ${r.studentEmail}`)
        )
      ),
      idCardBox,
      h('div', { class: 'card', style: 'padding:14px;border:1px solid var(--line);border-radius:10px;background:#fff;margin:0' },
        h('h4', { style: 'margin:0 0 8px 0;font-weight:800' }, 'Requested Components'),
        ...items.map((it) => h('div', { style: 'display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line)' },
          h('span', { style: 'font-weight:600' }, `${it.compName || it.compId} (${it.compId})`),
          h('span', { class: 'badge sm info' }, `×${it.qty}`)
        )),
        h('div', { style: 'margin-top:10px;font-size:0.9em' },
          h('div', {}, h('b', {}, 'Requested Duration: '), `${r.days} days`),
          h('div', { style: 'margin-top:4px' }, h('b', {}, 'Purpose: '), r.purpose || '—'),
          h('div', { style: 'margin-top:4px' }, h('b', {}, 'Submitted On: '), fmt(r.createdAt))
        )
      ),
      r.collectionTime && h('div', { style: 'background:rgba(5,150,105,0.08);border:1.5px solid var(--green);border-radius:10px;padding:12px' },
        h('div', { style: 'font-weight:700;color:var(--green)' }, 'Collection Schedule'),
        h('div', { style: 'font-weight:800;font-size:1.05em;color:var(--ink);margin-top:2px' }, `🕒 ${r.collectionTime}`),
        r.collectionNote && h('div', { class: 'muted small', style: 'margin-top:2px' }, `📍 ${r.collectionNote}`),
        r.acceptedBy && h('div', { class: 'muted small', style: 'margin-top:2px' }, `Accepted by: ${r.acceptedBy}`)
      ),
      r.status === 'ISSUED' && h('div', { style: 'background:rgba(30,64,175,0.08);border:1.5px solid var(--blue);border-radius:10px;padding:12px' },
        h('div', { style: 'font-weight:700;color:var(--blue)' }, `Issued Gate Pass: ${r.gatePassNo}`),
        r.issuedAt && h('div', { class: 'muted small', style: 'margin-top:2px' }, `Issued at: ${fmt(r.issuedAt)} by ${r.issuedBy}`)
      )
    );

    const actions = [
      ...(r.status === 'PENDING' ? [
        { label: '✓ Accept Request', cls: 'green', run: (close) => { close(); acceptModal(r); } },
        { label: 'Reject', cls: 'danger', run: (close) => { close(); rejectModal(r); } }
      ] : []),
      ...(r.status === 'ACCEPTED' ? [
        { label: '⚡ One-Click Issue', cls: 'gold', run: (close) => { close(); oneClickIssue(r); } },
        { label: 'Edit Time', cls: 'ghost', run: (close) => { close(); acceptModal(r); } },
        { label: 'Reject', cls: 'danger', run: (close) => { close(); rejectModal(r); } }
      ] : []),
      ...(r.status === 'ISSUED' && r.issueSeq ? [
        { label: '📄 View Gate Pass', cls: 'ghost', run: () => openFile(`/api/branches/${code}/issues/${r.issueSeq}/gatepass`) }
      ] : [])
    ];

    modal(`Request #${r.id.slice(-6)} Details`, body, actions, true);
  }

  function renderRequests() {
    let list = [...requestsList];
    const searchVal = (q.value || '').trim().toLowerCase();
    if (searchVal) {
      list = list.filter((r) => {
        const student = (r.studentName || '').toLowerCase();
        const enroll = (r.enrollmentNo || '').toLowerCase();
        const itemsMatch = (r.items || []).some((it) =>
          (it.compName || '').toLowerCase().includes(searchVal) || (it.compId || '').toLowerCase().includes(searchVal)
        );
        return student.includes(searchVal) || enroll.includes(searchVal) || itemsMatch;
      });
    }

    if (requestFilter !== 'ALL') {
      list = list.filter((r) => r.status === requestFilter);
    }

    const allCount = requestsList.length;
    const pendingCount = requestsList.filter((r) => r.status === 'PENDING').length;
    const acceptedCount = requestsList.filter((r) => r.status === 'ACCEPTED').length;
    const issuedCount = requestsList.filter((r) => r.status === 'ISSUED').length;
    const rejectedCount = requestsList.filter((r) => r.status === 'REJECTED').length;

    const filterDefs = [
      ['ALL', `All Requests (${allCount})`],
      ['PENDING', `⏳ Pending (${pendingCount})`],
      ['ACCEPTED', `✅ Accepted / Ready (${acceptedCount})`],
      ['ISSUED', `⚡ Issued (${issuedCount})`],
      ['REJECTED', `❌ Rejected (${rejectedCount})`],
    ];

    const filterBar = h('div', { class: 'tabs', style: 'margin-bottom:12px;overflow-x:auto;padding-bottom:2px' },
      ...filterDefs.map(([key, label]) =>
        h('button', {
          class: `tab${requestFilter === key ? ' on' : ''}`,
          onclick: () => { requestFilter = key; renderRequests(); }
        }, label)
      )
    );

    if (!list.length) {
      requestsContainer.replaceChildren(
        filterBar,
        h('div', {
          class: 'card',
          style: 'text-align:center;padding:42px 20px;border:1.5px dashed var(--line);border-radius:12px;background:#fff'
        },
          h('div', { style: 'font-size:2em;margin-bottom:8px' }, '📩'),
          h('h4', { style: 'margin:0 0 6px 0' }, 'No Component Requests Found'),
          h('p', { class: 'muted', style: 'font-size:0.9em;margin:0' },
            requestFilter === 'PENDING' ? 'No pending requests at the moment. All caught up!' : 'No requests match the selected filter.'
          )
        )
      );
      return;
    }

    const reqHeads = ['Request ID', 'Student', 'Enrollment', 'Requested Components', 'Duration & Purpose', 'Status & Collection Slot', 'Actions'];
    const reqTbody = h('tbody');

    reqTbody.replaceChildren(...list.map((r) => {
      const items = Array.isArray(r.items) && r.items.length > 0 ? r.items : [{ compId: r.compId, compName: r.compName, qty: r.qty || 1 }];
      const compSummary = h('td', {
        class: 'td-requested-comps',
        style: 'border-left:1px solid var(--line,#cbd5e1);border-right:1px solid var(--line,#cbd5e1);vertical-align:middle;padding:6px 12px'
      },
        h('div', { style: 'display:flex;flex-direction:column;min-width:180px;max-width:320px' },
          ...items.map((it, idx) => h('div', {
            style: `display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;line-height:1.35;${idx < items.length - 1 ? 'border-bottom:1px solid var(--line,#cbd5e1);' : ''}`
          },
            h('div', { style: 'display:flex;align-items:baseline;gap:5px;flex-wrap:wrap;flex:1' },
              h('span', { style: 'font-weight:600;font-size:0.9em;color:var(--text)' }, it.compName || it.compId),
              h('span', { class: 'muted', style: 'font-size:0.75em;font-family:monospace' }, `(${it.compId})`),
            ),
            h('span', { class: 'badge sm info', style: 'font-size:0.75em;padding:2px 7px;font-weight:700;flex-shrink:0' }, `×${it.qty}`)
          ))
        )
      );

      let statusCell;
      if (r.status === 'PENDING') {
        statusCell = h('div', { style: 'display:flex;flex-direction:column;gap:3px;align-items:flex-start' },
          badge('⏳ PENDING', 'warn'),
          h('span', { class: 'muted small', style: 'font-size:0.75em' }, 'Awaiting acceptance')
        );
      } else if (r.status === 'ACCEPTED') {
        statusCell = h('div', {
          style: 'background:rgba(5,150,105,0.08);border:1.5px solid var(--green);border-radius:8px;padding:6px 10px;display:flex;flex-direction:column;gap:3px'
        },
          badge('✅ ACCEPTED', 'ok'),
          h('div', { style: 'font-weight:700;font-size:0.88em;color:var(--ink)' }, `🕒 ${r.collectionTime}`),
          h('div', { class: 'muted small', style: 'font-size:0.75em' }, `📍 ${r.collectionLocation || r.collectionNote || 'Hardware Lab Counter'}`),
          r.acceptedBy && h('div', { class: 'muted small', style: 'font-size:0.72em;color:var(--ink)' }, `By: ${r.acceptedBy}`),
          h('span', { style: 'font-size:0.72em;color:var(--green);font-weight:600' }, '📲 Phone alert sent')
        );
      } else if (r.status === 'ISSUED') {
        statusCell = h('div', { style: 'display:flex;flex-direction:column;gap:3px;align-items:flex-start' },
          badge('⚡ ISSUED', 'info'),
          h('span', { style: 'font-size:0.8em;font-family:monospace;font-weight:700' }, r.gatePassNo || `Pass #${r.issueSeq}`),
          r.issuedAt && h('span', { class: 'muted small', style: 'font-size:0.72em' }, fmt(r.issuedAt))
        );
      } else if (r.status === 'REJECTED') {
        statusCell = h('div', { style: 'display:flex;flex-direction:column;gap:3px;align-items:flex-start' },
          badge('❌ REJECTED', 'bad'),
          r.rejectedBy && h('div', { class: 'muted small', style: 'font-size:0.72em;font-weight:600' }, `By: ${r.rejectedBy}`),
          r.rejectionReason && h('span', { class: 'muted small', style: 'font-size:0.75em' }, r.rejectionReason)
        );
      }

      const actionsCell = h('td', { class: 'row', style: 'gap:6px' },
        h('button', {
          class: 'btn ghost sm',
          style: 'font-weight:700',
          onclick: () => viewRequestDetails(r)
        }, '🔍 Details'),
        h('button', {
          class: 'btn ghost sm',
          style: 'font-weight:700',
          title: 'View Verified SCET ID Card',
          onclick: async () => {
            if (r.idCardImage) {
              showIdCardModal(r.idCardImage, r.studentName);
            } else {
              try {
                const res = await api(`/api/branches/${code}/requests/${r.id}/idcard`);
                if (res?.idCardImage) {
                  r.idCardImage = res.idCardImage;
                  showIdCardModal(res.idCardImage, r.studentName);
                } else {
                  toast('No ID card photo on file for this student.', 'err');
                }
              } catch (err) {
                toast(err.message || 'Could not load student ID card.', 'err');
              }
            }
          }
        }, '🪪 ID Card'),
        r.status === 'PENDING' && h('button', {
          class: 'btn green sm',
          style: 'font-weight:700',
          onclick: () => acceptModal(r)
        }, '✓ Accept Request'),
        r.status === 'PENDING' && h('button', {
          class: 'btn danger sm',
          onclick: () => rejectModal(r)
        }, 'Reject'),
        r.status === 'ACCEPTED' && h('button', {
          class: 'btn gold sm',
          style: 'font-weight:800;letter-spacing:0.02em',
          title: 'Student is at counter: 1-click stock deduction and gatepass generation',
          onclick: () => oneClickIssue(r)
        }, '⚡ One-Click Issue'),
        r.status === 'ACCEPTED' && h('button', {
          class: 'btn ghost sm',
          title: 'Modify collection time slot',
          onclick: () => acceptModal(r)
        }, 'Edit Time'),
        r.status === 'ACCEPTED' && h('button', {
          class: 'btn danger sm',
          onclick: () => rejectModal(r)
        }, 'Reject'),
        r.status === 'ISSUED' && r.issueSeq && h('button', {
          class: 'btn ghost sm',
          onclick: () => openFile(`/api/branches/${code}/issues/${r.issueSeq}/gatepass`)
        }, 'Gate pass')
      );

      return h('tr', {},
        h('td', {},
          h('div', { style: 'font-weight:700;font-size:0.88em' }, `#${r.id.slice(-6)}`),
          h('div', { class: 'muted small', style: 'font-size:0.75em' }, fmt(r.createdAt))
        ),
        h('td', {},
          h('div', { style: 'font-weight:700;color:var(--ink)' }, r.studentName),
          h('div', { class: 'muted small', style: 'font-size:0.75em;display:flex;align-items:center;gap:4px;flex-wrap:wrap' },
            r.studentMobile && h('a', {
              href: `https://wa.me/91${String(r.studentMobile).replace(/\D/g, '')}`,
              target: '_blank',
              style: 'color:var(--green);text-decoration:none;font-weight:600',
              title: 'Open WhatsApp chat'
            }, `📱 ${r.studentMobile}`),
            r.studentEmail && h('span', {}, `· ${r.studentEmail}`)
          )
        ),
        h('td', {},
          h('span', { style: 'font-family:monospace;font-weight:700;background:var(--soft);padding:2px 7px;border-radius:4px;border:1px solid var(--line)' }, r.enrollmentNo),
          h('div', { class: 'chip', style: 'font-size:0.7em;padding:1px 5px;margin-top:2px;display:inline-block' }, r.studentBranch || code)
        ),
        compSummary,
        h('td', {},
          h('div', { style: 'font-weight:700;font-size:0.88em' }, `${r.days} days`),
          h('div', { class: 'muted small', style: 'font-size:0.78em;max-width:180px' }, r.purpose || '—')
        ),
        h('td', {}, statusCell),
        actionsCell
      );
    }));

    requestsContainer.replaceChildren(
      filterBar,
      h('div', { class: 'tbl-wrap' },
        h('table', {},
          h('thead', {}, h('tr', {}, reqHeads.map((x) => h('th', {
            style: x === 'Requested Components' ? 'border-left:1px solid var(--line,#cbd5e1);border-right:1px solid var(--line,#cbd5e1);' : ''
          }, x)))),
          reqTbody
        )
      )
    );
  }

  async function loadRequests() {
    try {
      requestsList = await api(`/api/branches/${code}/requests`);
    } catch {
      requestsList = [];
    }

    const pendingCount = requestsList.filter((r) => r.status === 'PENDING').length;
    if (pendingCount > 0) {
      pendingBadge.textContent = String(pendingCount);
      pendingBadge.style.display = 'inline-flex';
    } else {
      pendingBadge.style.display = 'none';
    }

    renderRequests();
  }

  const ledgerBtn = h('button', {
    class: 'btn gold',
    style: 'font-weight:700',
    onclick: () => switchView('ledger')
  }, 'Ledger');

  const pendingBadge = h('span', {
    class: 'badge sm bad',
    style: 'display:none;padding:1px 6px;font-size:0.75em;margin-left:4px'
  }, '0');

  const requestBtn = h('button', {
    class: 'btn ghost',
    style: 'font-weight:700;display:inline-flex;align-items:center',
    onclick: () => switchView('requests')
  }, 'Request', pendingBadge);

  const requestAuditBtn = h('button', {
    class: 'btn ghost',
    style: 'font-weight:700;display:inline-flex;align-items:center;gap:5px',
    onclick: () => switchView('request-audit')
  }, '📜 Request Audit Trail');

  const overdueBtn = h('button', {
    class: 'btn ghost',
    onclick: () => { overdueOnly = !overdueOnly; overdueBtn.className = `btn ${overdueOnly ? 'gold' : 'ghost'}`; load(); }
  }, 'Overdue only');

  const issueBtn = h('button', {
    class: 'btn gold',
    onclick: () => issueForm(null)
  }, '+ Issue components');

  let auditDispose = null;
  async function loadRequestAudit() {
    auditDispose?.();
    const out = await requestAuditTab(code);
    auditDispose = out.dispose;
    requestAuditContainer.replaceChildren(out.el);
  }

  function switchView(tab) {
    activeTab = tab;
    if (tab === 'ledger') {
      ledgerBtn.className = 'btn gold';
      requestBtn.className = 'btn ghost';
      requestAuditBtn.className = 'btn ghost';
      overdueBtn.style.display = '';
      issueBtn.style.display = '';
      ledgerTblWrap.style.display = '';
      requestsContainer.style.display = 'none';
      requestAuditContainer.style.display = 'none';
      q.style.display = '';
      q.placeholder = 'Search enrollment no. or student name…';
      load();
    } else if (tab === 'requests') {
      ledgerBtn.className = 'btn ghost';
      requestBtn.className = 'btn gold';
      requestAuditBtn.className = 'btn ghost';
      overdueBtn.style.display = 'none';
      issueBtn.style.display = 'none';
      ledgerTblWrap.style.display = 'none';
      requestsContainer.style.display = '';
      requestAuditContainer.style.display = 'none';
      q.style.display = '';
      q.placeholder = 'Search requests by student, enrollment, or component…';
      loadRequests();
    } else if (tab === 'request-audit') {
      ledgerBtn.className = 'btn ghost';
      requestBtn.className = 'btn ghost';
      requestAuditBtn.className = 'btn gold';
      overdueBtn.style.display = 'none';
      issueBtn.style.display = 'none';
      ledgerTblWrap.style.display = 'none';
      requestsContainer.style.display = 'none';
      requestAuditContainer.style.display = '';
      q.style.display = 'none';
      loadRequestAudit();
    }
  }

  let t;
  q.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (activeTab === 'ledger') load();
      else if (activeTab === 'requests') renderRequests();
    }, 250);
  };

  let reqPollCount = 0;
  ticks.push(() => {
    reqPollCount++;
    if (reqPollCount % 15 === 0 && activeTab === 'requests') {
      loadRequests();
    }
  });

  await Promise.all([load(), loadRequests()]);
  // Automatically check and deliver any pending 1-day deadline reminders and alerts
  api('/api/issues/check-reminders', { method: 'POST' }).catch(() => {});
  const timer = setInterval(() => ticks.forEach((f) => f()), 1000);
  return {
    dispose: () => {
      clearInterval(timer);
      auditDispose?.();
    },
    el: h('div', {},
      h('div', { class: 'row', style: 'margin-bottom:12px;gap:8px;flex-wrap:wrap' },
        h('div', { class: 'grow', style: 'min-width:240px' }, q),
        ledgerBtn,
        requestBtn,
        requestAuditBtn,
        overdueBtn,
        issueBtn
      ),
      ledgerTblWrap,
      requestsContainer,
      requestAuditContainer
    )
  };
}